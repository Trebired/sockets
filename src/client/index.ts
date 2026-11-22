import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import {
  CHANGE_EVENT,
  DENIED_EVENT,
  QUERY_CHANGED_EVENT,
  REQUEST_EVENT,
  SUBSCRIBE_EVENT,
  SUBSCRIBED_EVENT,
  text,
  UNSUBSCRIBE_EVENT,
  type RoomChange,
  type RoomReply,
} from "#qkhazf8njk4y";
import { createOutbox, createPublisher } from "./live.js";

type RoomListener = (change: RoomChange) => void;

type ChannelClientOptions = {
  ackTimeoutMs?: number;
  auth?: Record<string, unknown>;
  outboxLimit?: number;
  retryMs?: number;
  shared?: boolean;
  socketOptions?: Partial<ManagerOptions&SocketOptions>;
  url?: string;
};

type ChannelClient = {
  close: () => void;
  connected: () => boolean;
  emit: (event: string, ...args: unknown[]) => void;
  emitAck: <T = unknown > (event: string, payload?: unknown, timeoutMs?: number) => Promise<T|null>;
  namespace: string;
  on: (event: string, handler: (...args: any[]) => void) => () => void;
  pending: () => number;
  publish: (key: string, value: unknown) => void;
  published: () => string[];
  request: <T = unknown > (room: string, name: string, payload?: unknown, timeoutMs?: number) => Promise<RoomReply<T>>;
  socket: () => Socket;
  send: (event: string, payload?: unknown) => Promise<boolean>;
  subscribe: (room: string, listener: RoomListener) => () => void;
  unpublish: (key: string) => void;
};

const DEFAULT_ACK_TIMEOUT_MS = 8000;
const DEFAULT_OUTBOX_LIMIT = 1000;
const DEFAULT_RETRY_MS = 2000;
const sharedClients = new Map<string, ChannelClient>();

function emitWithAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs: number) {
  return new Promise<T|null>((resolve) => {
      let settled = false;
      const finish = (value: T | null) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(value);
      };
      const timer = globalThis.setTimeout(() => finish(null), Math.max(250, timeoutMs));
      socket.emit(event, payload, (response: T) => finish(response));
  });
}

function dispatchChange(listeners: Map<string, Set<RoomListener>>, change: RoomChange) {
  const bucket = listeners.get(text(change && change.room));
  bucket?.forEach((listener) => {
      try {
        listener(change);
      } catch {}
  });
}

type SubscriptionState = {
  confirmed: Set<string>;
  waiters: Map<string, Set<()=>void>>;
};

function settleWaiters(state: SubscriptionState, room: string) {
  const waiters = state.waiters.get(room);
  state.waiters.delete(room);
  waiters?.forEach((resolve) => resolve());
}

function trackSubscriptions(socket: Socket): SubscriptionState {
  const state: SubscriptionState = { confirmed: new Set(), waiters: new Map() };
  socket.on(SUBSCRIBED_EVENT, (payload: { room?: string }) => {
      const room = text(payload && payload.room);
      if (!room) return;
      state.confirmed.add(room);
      settleWaiters(state, room);
  });
  socket.on(DENIED_EVENT, (payload: { room?: string }) => settleWaiters(state, text(payload && payload.room)));
  socket.on("disconnect", () => state.confirmed.clear());
  return state;
}

function waitForSubscription(state: SubscriptionState, room: string, timeoutMs: number) {
  if (state.confirmed.has(room)) return Promise.resolve();
  return new Promise<void>((resolve) => {
      const done = () => {
        globalThis.clearTimeout(timer);
        state.waiters.get(room)?.delete(done);
        resolve();
      };
      const timer = globalThis.setTimeout(done, Math.max(250, timeoutMs));
      if (!state.waiters.has(room)) state.waiters.set(room, new Set());
      state.waiters.get(room)!.add(done);
  });
}

function roomSubscriber(socket: Socket, listeners: Map<string, Set<RoomListener>>, state: SubscriptionState) {
  return function subscribe(room: string, listener: RoomListener) {
    const key = text(room);
    if (!key || typeof listener !== "function") return () => {};
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(listener);
    if (socket.connected) socket.emit(SUBSCRIBE_EVENT, { room: key });
    return function unsubscribe() {
      const bucket = listeners.get(key);
      if (!bucket || !bucket.delete(listener) || bucket.size) return;
      listeners.delete(key);
      state.confirmed.delete(key);
      if (socket.connected) socket.emit(UNSUBSCRIBE_EVENT, { room: key });
    };
  };
}

function createChannelClient(namespace: string, options: ChannelClientOptions, onClose: () => void): ChannelClient {
  const socket = io(`${text(options.url)}${namespace}`, {
      auth: options.auth,
      transports: ["websocket"],
      withCredentials: true,
      ...(options.socketOptions || {}),
  });
  const listeners = new Map<string, Set<RoomListener>>();
  const subscriptions = trackSubscriptions(socket);
  const timeout = Number(options.ackTimeoutMs) || DEFAULT_ACK_TIMEOUT_MS;
  socket.on("connect", () => listeners.forEach((_bucket, room) => socket.emit(SUBSCRIBE_EVENT, { room })));
  socket.on(CHANGE_EVENT, (change: RoomChange) => dispatchChange(listeners, change));
  const liveOptions = {
    emitAck: emitWithAck,
    outboxLimit: Number(options.outboxLimit) || DEFAULT_OUTBOX_LIMIT,
    retryMs: Number(options.retryMs) || DEFAULT_RETRY_MS,
    timeoutMs: timeout,
  };
  const publisher = createPublisher(socket, liveOptions);
  const outbox = createOutbox(socket, liveOptions);
  return {
    close() {
      socket.close();
      listeners.clear();
      onClose();
    },
    connected: () => socket.connected,
    emit: (event, ...args) => void socket.emit(event, ...args),
    emitAck: (event, payload, timeoutMs) => emitWithAck(socket, event, payload, Number(timeoutMs) || timeout),
    namespace,
    on(event, handler) {
      socket.on(event, handler);
      return () => void socket.off(event, handler);
    },
    pending: outbox.pending,
    publish: publisher.publish,
    published: publisher.published,
    async request(room, name, payload, timeoutMs) {
      const wait = Number(timeoutMs) || timeout;
      if (listeners.has(text(room))) await waitForSubscription(subscriptions, text(room), wait);
      const reply = await emitWithAck<RoomReply>(socket, REQUEST_EVENT, { name, payload, room }, wait);
      return (reply && typeof reply === "object" ? reply : { error: "timeout", ok: false }) as RoomReply<any>;
    },
    send: outbox.send,
    socket: () => socket,
    subscribe: roomSubscriber(socket, listeners, subscriptions),
    unpublish: publisher.unpublish,
  };
}

function connectChannel(namespaceInput: string, options: ChannelClientOptions = {}): ChannelClient {
  const namespace = text(namespaceInput);
  const shared = options.shared !== false && !options.auth;
  const key = `${text(options.url)}${namespace}`;
  if (shared && sharedClients.has(key)) return sharedClients.get(key)!;
  const client = createChannelClient(namespace, options, () => {
      if (sharedClients.get(key) === client) sharedClients.delete(key);
  });
  if (shared) sharedClients.set(key, client);
  return client;
}

export { connectChannel };
export { openRoom } from "./room.js";
export type { OpenedRoom, OpenRoomOptions, RoomHandler } from "./room.js";
export type { ChannelClient, ChannelClientOptions, RoomListener };
export { QUERY_CHANGED_EVENT } from "#qkhazf8njk4y";
export type { LiveReply, RoomChange, RoomReply } from "#qkhazf8njk4y";
