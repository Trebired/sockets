import { CHANGE_EVENT, DENIED_EVENT, parseRoom, roomFor, text } from "#qkhazf8njk4y";
import { bindConnection, type ConnectionState } from "./connection.js";
import { runGuards } from "./guards.js";
import { socketsLog } from "./logging.js";
import { createRoomRegistry } from "./rooms.js";
import type {
  Channel,
  ChannelNamespace,
  ChannelOptions,
  ChannelServer,
  ChannelSocket,
  InboundHandler,
  RoomDefinition,
  SocketFilter,
  SocketGuard,
  SocketPrepare,
} from "./types.js";

const channels = new Set<Channel>();
const kindOwners = new Map<string, Channel>();

function guardList(guard: ChannelOptions["guard"]): SocketGuard[] {
  const list = (Array.isArray(guard) ? guard : [guard]).filter((entry) => typeof entry === "function");
  if (!list.length) throw new Error("A socket channel needs a guard. Pass loopbackOnly(), a session guard or another middleware.");
  return list as SocketGuard[];
}

function normalizeNamespace(value: unknown) {
  const namespace = text(value);
  if (!namespace.startsWith("/") || namespace === "/") throw new Error(`A socket channel needs its own namespace, got "${namespace}".`);
  return namespace;
}

function connectionState(options: ChannelOptions, namespace: string): ConnectionState {
  const logger = socketsLog(options.logger);
  return {
    events: new Map(Object.entries(options.events || {})),
    logger,
    namespace,
    options,
    pending: new Map(),
    rooms: createRoomRegistry(options, logger),
    sockets: new Map(),
  };
}

async function reauthorizeSocket(state: ConnectionState, socket: ChannelSocket) {
  let dropped = 0;
  for (const roomName of state.rooms.roomsOf(socket)) {
    const room = parseRoom(roomName);
    if (room && (await state.rooms.authorize(socket, room))) continue;
    socket.leave?.(roomName);
    state.rooms.left(socket, roomName);
    socket.emit?.(DENIED_EVENT, { room: roomName });
    dropped += 1;
  }
  return dropped;
}

function matching(state: ConnectionState, filter?: SocketFilter) {
  return [...state.sockets.values()].filter((socket) => typeof filter !== "function" || filter(socket));
}

function channelApi(state: ConnectionState, guards: SocketGuard[]) {
  let attached: ChannelNamespace | null = null;
  return {
    attach(server: ChannelServer) {
      if (attached || typeof server?.of !== "function") return false;
      attached = server.of(state.namespace);
      attached.use?.((socket, next) => runGuards(guards, socket, next));
      attached.on?.("connection", (socket) => bindConnection(state, socket));
      state.logger.info("sockets.channel", "channel attached", { namespace: state.namespace });
      return true;
    },
    broadcast(room: unknown, event: unknown, data?: unknown) {
      const target = parseRoom(room);
      if (!target || !attached) return false;
      attached.to?.(target.room).emit?.(CHANGE_EVENT, { data: data === undefined ? null : data, event: text(event), room: target.room });
      return true;
    },
    defineRoom: (kind: unknown, definition: RoomDefinition) => state.rooms.define(kind, definition),
    disconnect(filter?: SocketFilter) {
      const targets = matching(state, filter);
      targets.forEach((socket) => socket.disconnect?.(true));
      return targets.length;
    },
    namespace: state.namespace,
    on(event: unknown, handler: InboundHandler) {
      const name = text(event);
      if (!name || typeof handler !== "function") return false;
      state.events.set(name, handler);
      return true;
    },
    async reauthorize(filter?: SocketFilter, prepare?: SocketPrepare) {
      let dropped = 0;
      for (const socket of matching(state, filter)) {
        if (typeof prepare === "function") await prepare(socket);
        dropped += await reauthorizeSocket(state, socket);
      }
      return dropped;
    },
    room: (kind: unknown, id: unknown) => roomFor(kind, id),
    sockets: () => [...state.sockets.values()],
  };
}

function createChannel(options: ChannelOptions): Channel {
  const namespace = normalizeNamespace(options && options.namespace);
  const guards = guardList(options && options.guard);
  const state = connectionState(options, namespace);
  const api = channelApi(state, guards);
  const channel: Channel = {
    ...api,
    defineRoom(kind: unknown, definition: RoomDefinition) {
      const safeKind = text(kind);
      const owner = kindOwners.get(safeKind);
      if (owner && owner !== channel) {
        state.logger.warn("sockets.channel", "a room kind is already owned by another channel", { kind: safeKind, owner: owner.namespace });
        return false;
      }
      if (!api.defineRoom(safeKind, definition)) return false;
      kindOwners.set(safeKind, channel);
      return true;
    },
  };
  for (const [kind, definition] of Object.entries(options.rooms || {})) {
    if (!channel.defineRoom(kind, definition)) throw new Error(`Room "${kind}" needs an authorize function and a kind no other channel owns.`);
  }
  channels.add(channel);
  return channel;
}

function broadcast(room: unknown, event: unknown, data?: unknown) {
  const target = parseRoom(room);
  const owner = target ? kindOwners.get(target.kind) : null;
  return Boolean(owner && owner.broadcast(target!.room, event, data));
}

function channelOf(kind: unknown) {
  return kindOwners.get(text(kind)) || null;
}

async function reauthorizeAll(filter?: SocketFilter, prepare?: SocketPrepare) {
  let dropped = 0;
  for (const channel of channels) dropped += await channel.reauthorize(filter, prepare);
  return dropped;
}

function disconnectAll(filter?: SocketFilter) {
  let closed = 0;
  for (const channel of channels) closed += channel.disconnect(filter);
  return closed;
}

export { broadcast, channelOf, createChannel, disconnectAll, reauthorizeAll };
