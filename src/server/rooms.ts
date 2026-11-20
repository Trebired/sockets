import type { NormalizedLoggerAdapter } from "@package/logger-adapter";
import type { RoomRef, RoomReply } from "#qkhazf8njk4y";
import { text } from "#qkhazf8njk4y";
import type { ChannelOptions, ChannelSocket, RoomDefinition } from "./types.js";

type RoomState = {
  cleanups: Map<string, ()=>void>;
  definitions: Map<string, RoomDefinition>;
  logger: NormalizedLoggerAdapter;
  members: Map<string, Set<string>>;
  options: ChannelOptions;
  publish: (room: string, event: string, data?: unknown) => boolean;
  socketRooms: Map<string, Set<string>>;
};

function socketKey(socket: ChannelSocket) {
  return text(socket && socket.id);
}

function errorText(error: unknown) {
  return error && (error as Error).message ? (error as Error).message : String(error);
}

function inContext<T>(state: RoomState, socket: ChannelSocket, event: string, room: string, run: () => Promise<T>) {
  const wrap = state.options.withContext;
  return typeof wrap === "function" ? Promise.resolve(wrap({ event, room, socket }, run) as Promise<T>) : run();
}

function defineRoomKind(state: RoomState, kind: unknown, definition: RoomDefinition) {
  const safeKind = text(kind);
  if (!safeKind || safeKind.includes(":") || !definition || typeof definition.authorize !== "function") return false;
  state.definitions.set(safeKind, definition);
  return true;
}

async function authorizeRoom(state: RoomState, socket: ChannelSocket, room: RoomRef) {
  const definition = state.definitions.get(room.kind);
  if (!definition) {
    state.logger.warn("sockets.room", "subscription to an undefined room kind was refused", { kind: room.kind });
    return false;
  }
  try {
    const allow = async() => definition.authorize(socket, room.id);
    return Boolean(await inContext(state, socket, "authorize", room.room, allow));
  } catch {
    return false;
  }
}

function activateRoom(state: RoomState, room: RoomRef) {
  const activate = state.definitions.get(room.kind)?.activate;
  if (typeof activate !== "function") return;
  try {
    const cleanup = activate(room.id, {
        broadcast: (event: string, data?: unknown) => state.publish(room.room, event, data),
        id: room.id,
        kind: room.kind,
        room: room.room,
    });
    if (typeof cleanup === "function") state.cleanups.set(room.room, cleanup as() => void);
  } catch (error) {
    state.logger.warn("sockets.room", "room activation failed", { error: errorText(error), room: room.room });
  }
}

function deactivateRoom(state: RoomState, room: string) {
  const cleanup = state.cleanups.get(room);
  state.cleanups.delete(room);
  if (!cleanup) return;
  try {
    cleanup();
  } catch (error) {
    state.logger.warn("sockets.room", "room cleanup failed", { error: errorText(error), room });
  }
}

function joinRoom(state: RoomState, socket: ChannelSocket, room: RoomRef) {
  const key = socketKey(socket);
  if (!state.members.has(room.room)) state.members.set(room.room, new Set());
  const members = state.members.get(room.room)!;
  const first = members.size === 0;
  members.add(key);
  if (!state.socketRooms.has(key)) state.socketRooms.set(key, new Set());
  state.socketRooms.get(key)!.add(room.room);
  if (first) activateRoom(state, room);
}

function leaveRoom(state: RoomState, socket: ChannelSocket, room: string) {
  const key = socketKey(socket);
  state.socketRooms.get(key)?.delete(room);
  const members = state.members.get(room);
  if (!members || !members.delete(key) || members.size) return;
  state.members.delete(room);
  deactivateRoom(state, room);
}

function leaveAllRooms(state: RoomState, socket: ChannelSocket) {
  const key = socketKey(socket);
  for (const room of [...(state.socketRooms.get(key) || [])]) leaveRoom(state, socket, room);
  state.socketRooms.delete(key);
}

async function roomSnapshot(state: RoomState, socket: ChannelSocket, room: RoomRef) {
  const snapshot = state.definitions.get(room.kind)?.snapshot;
  if (typeof snapshot !== "function") return undefined;
  try {
    return await inContext(state, socket, "snapshot", room.room, async() => snapshot(socket, room.id));
  } catch (error) {
    state.logger.warn("sockets.room", "room snapshot failed", { error: errorText(error), room: room.room });
    return undefined;
  }
}

async function roomRequest(state: RoomState, socket: ChannelSocket, room: RoomRef, name: string, payload: unknown): Promise<RoomReply> {
  const handler = state.definitions.get(room.kind)?.requests?.[name];
  if (typeof handler !== "function") return { error: "unknown-request", ok: false };
  if (!state.members.get(room.room)?.has(socketKey(socket))) return { error: "not-subscribed", ok: false };
  try {
    const answer = async() => handler(socket, room.id, payload);
    return { data: await inContext(state, socket, `request:${name}`, room.room, answer), ok: true };
  } catch (error) {
    state.logger.warn("sockets.room", "room request failed", { error: errorText(error), name, room: room.room });
    return { error: "request-failed", ok: false };
  }
}

function createRoomRegistry(options: ChannelOptions, logger: NormalizedLoggerAdapter) {
  const state: RoomState = {
    cleanups: new Map(),
    definitions: new Map(),
    logger,
    members: new Map(),
    options,
    publish: () => false,
    socketRooms: new Map(),
  };
  return {
    authorize: (socket: ChannelSocket, room: RoomRef) => authorizeRoom(state, socket, room),
    define: (kind: unknown, definition: RoomDefinition) => defineRoomKind(state, kind, definition),
    disconnected: (socket: ChannelSocket) => leaveAllRooms(state, socket),
    joined: (socket: ChannelSocket, room: RoomRef) => joinRoom(state, socket, room),
    publishWith(publish: RoomState["publish"]) {
      state.publish = publish;
    },
    left: (socket: ChannelSocket, room: string) => leaveRoom(state, socket, room),
    request: (socket: ChannelSocket, room: RoomRef, name: string, payload: unknown) => roomRequest(state, socket, room, name, payload),
    roomsOf: (socket: ChannelSocket) => [...(state.socketRooms.get(socketKey(socket)) || [])],
    snapshot: (socket: ChannelSocket, room: RoomRef) => roomSnapshot(state, socket, room),
  };
}

type RoomRegistry = ReturnType<typeof createRoomRegistry>;

export { createRoomRegistry };
export type { RoomRegistry };
