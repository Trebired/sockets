import type { NormalizedLoggerAdapter } from "@package/logger-adapter";
import {
  CHANGE_EVENT,
  DENIED_EVENT,
  parseRoom,
  REQUEST_EVENT,
  SNAPSHOT_EVENT,
  SUBSCRIBE_EVENT,
  SUBSCRIBED_EVENT,
  text,
  UNSUBSCRIBE_EVENT,
} from "#qkhazf8njk4y";
import type { RoomRef } from "#qkhazf8njk4y";
import type { RoomRegistry } from "./rooms.js";
import type { ChannelOptions, ChannelSocket, InboundHandler } from "./types.js";

type ConnectionState = {
  events: Map<string, InboundHandler>;
  logger: NormalizedLoggerAdapter;
  namespace: string;
  options: ChannelOptions;
  pending: Map<string, Promise<void>>;
  rooms: RoomRegistry;
  sockets: Map<string, ChannelSocket>;
};

const RESERVED_EVENTS = new Set([SUBSCRIBE_EVENT, UNSUBSCRIBE_EVENT, REQUEST_EVENT, "disconnect", "disconnecting", "error"]);

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pendingKey(socket: ChannelSocket, room: string) {
  return `${text(socket.id)}\u0000${room}`;
}

async function subscribeToRoom(state: ConnectionState, socket: ChannelSocket, room: RoomRef) {
  if (!(await state.rooms.authorize(socket, room))) {
    socket.emit?.(DENIED_EVENT, { room: room.room });
    return;
  }
  socket.join?.(room.room);
  state.rooms.joined(socket, room);
  socket.emit?.(SUBSCRIBED_EVENT, { room: room.room });
  const data = await state.rooms.snapshot(socket, room);
  if (data === undefined || data === null) return;
  socket.emit?.(CHANGE_EVENT, { data, event: SNAPSHOT_EVENT, room: room.room });
}

function handleSubscribe(state: ConnectionState, socket: ChannelSocket, payload: unknown) {
  const room = parseRoom(objectOf(payload).room);
  if (!room) return Promise.resolve();
  const key = pendingKey(socket, room.room);
  const pending: Promise<void> = subscribeToRoom(state, socket, room).finally(() => {
      if (state.pending.get(key) === pending) state.pending.delete(key);
  });
  state.pending.set(key, pending);
  return pending;
}

function handleUnsubscribe(state: ConnectionState, socket: ChannelSocket, payload: unknown) {
  const room = parseRoom(objectOf(payload).room);
  if (!room) return;
  socket.leave?.(room.room);
  state.rooms.left(socket, room.room);
}

async function handleRequest(state: ConnectionState, socket: ChannelSocket, payload: unknown, done?: unknown) {
  const body = objectOf(payload);
  const room = parseRoom(body.room);
  if (room) await state.pending.get(pendingKey(socket, room.room));
  const reply = room
  ? await state.rooms.request(socket, room, text(body.name), body.payload)
  : { error: "unknown-room", ok: false };
  if (typeof done === "function") done(reply);
}

async function handleInbound(state: ConnectionState, socket: ChannelSocket, event: string, args: unknown[]) {
  const handler = state.events.get(event);
  const ack = typeof args[args.length - 1] === "function" ? (args[args.length - 1] as(response: unknown) => unknown) : undefined;
  if (!handler) {
    state.logger.warn("sockets.channel", "an undeclared event was ignored", { event, namespace: state.namespace });
    return;
  }
  const run = async() => handler(socket, args[0], ack);
  const wrap = state.options.withContext;
  try {
    await (typeof wrap === "function" ? wrap({ event, room: "", socket }, run) : run());
  } catch (error) {
    const message = error && (error as Error).message ? (error as Error).message : String(error);
    state.logger.warn("sockets.channel", "an event handler failed", { error: message, event, namespace: state.namespace });
  }
}

function bindInbound(state: ConnectionState, socket: ChannelSocket) {
  const onAny = (socket as { onAny?: (handler: (event: string, ...args: unknown[]) => unknown) => unknown }).onAny;
  if (typeof onAny !== "function") {
    state.events.forEach((_handler, event) => socket.on?.(event, (...args: unknown[]) => handleInbound(state, socket, event, args)));
    return;
  }
  onAny.call(socket, (event: string, ...args: unknown[]) => {
      if (RESERVED_EVENTS.has(event)) return undefined;
      return handleInbound(state, socket, event, args);
  });
}

function bindConnection(state: ConnectionState, socket: ChannelSocket) {
  state.sockets.set(text(socket.id), socket);
  socket.on?.(SUBSCRIBE_EVENT, (payload: unknown) => handleSubscribe(state, socket, payload));
  socket.on?.(UNSUBSCRIBE_EVENT, (payload: unknown) => handleUnsubscribe(state, socket, payload));
  socket.on?.(REQUEST_EVENT, (payload: unknown, done: unknown) => handleRequest(state, socket, payload, done));
  bindInbound(state, socket);
  socket.on?.("disconnect", () => {
      state.sockets.delete(text(socket.id));
      state.rooms.disconnected(socket);
      if (typeof state.options.onDisconnect === "function") state.options.onDisconnect(socket);
  });
  if (typeof state.options.onConnection === "function") state.options.onConnection(socket);
}

export { bindConnection };
export type { ConnectionState };
