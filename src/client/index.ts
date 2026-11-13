import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import {
  CHANGE_EVENT,
  REQUEST_EVENT,
  SUBSCRIBE_EVENT,
  text,
  UNSUBSCRIBE_EVENT,
  type RoomChange,
  type RoomReply,
} from "#qkhazf8njk4y";

type RoomListener = (change: RoomChange) => void;

type ChannelClientOptions = {
  ackTimeoutMs?: number;
  auth?: Record<string, unknown>;
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
  request: <T = unknown > (room: string, name: string, payload?: unknown, timeoutMs?: number) => Promise<RoomReply<T>>;
  socket: () => Socket;
  subscribe: (room: string, listener: RoomListener) => () => void;
};

const DEFAULT_ACK_TIMEOUT_MS = 8000;
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

function roomSubscriber(socket: Socket, listeners: Map<string, Set<RoomListener>>) {
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
  const timeout = Number(options.ackTimeoutMs) || DEFAULT_ACK_TIMEOUT_MS;
  socket.on("connect", () => listeners.forEach((_bucket, room) => socket.emit(SUBSCRIBE_EVENT, { room })));
  socket.on(CHANGE_EVENT, (change: RoomChange) => dispatchChange(listeners, change));
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
    async request(room, name, payload, timeoutMs) {
      const reply = await emitWithAck<RoomReply>(socket, REQUEST_EVENT, { name, payload, room }, Number(timeoutMs) || timeout);
      return (reply && typeof reply === "object" ? reply : { error: "timeout", ok: false }) as RoomReply<any>;
    },
    socket: () => socket,
    subscribe: roomSubscriber(socket, listeners),
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
export type { RoomChange, RoomReply } from "#qkhazf8njk4y";
