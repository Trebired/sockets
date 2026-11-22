import type { LoggerAdapterLogger } from "@package/logger-adapter";

type ChannelSocket = {
  data?: Record<string, unknown>;
  disconnect?: (close?: boolean) => unknown;
  emit?: (event: string, ...args: unknown[]) => unknown;
  handshake?: Record<string, any>;
  id?: string;
  join?: (room: string) => unknown;
  leave?: (room: string) => unknown;
  on?: (event: string, handler: (...args: any[]) => unknown) => unknown;
  [key: string]: unknown;
};

type SocketNext = (error?: Error) => void;
type SocketGuard = (socket: ChannelSocket, next: SocketNext) => unknown;

type ChannelNamespace = {
  name?: string;
  on?: (event: string, handler: (socket: ChannelSocket) => unknown) => unknown;
  to?: (room: string) => { emit?: (event: string, payload?: unknown) => unknown };
  use?: (middleware: SocketGuard) => unknown;
};

type ChannelServer = { of?: (namespace: string) => ChannelNamespace };

type RoomRequestHandler = (socket: ChannelSocket, id: string, payload: unknown) => unknown;

type RoomHandle = {
  broadcast: (event: string, data?: unknown) => boolean;
  id: string;
  kind: string;
  room: string;
};

type RoomDefinition = {
  activate?: (id: string, room: RoomHandle) => unknown;
  authorize: (socket: ChannelSocket, id: string) => unknown;
  requests?: Record<string, RoomRequestHandler>;
  snapshot?: (socket: ChannelSocket, id: string) => unknown;
};

type InboundHandler = (socket: ChannelSocket, payload: unknown, ack?: (response: unknown) => unknown) => unknown;

type ChannelContext = {
  event: string;
  room: string;
  socket: ChannelSocket;
};

type StateContext = {
  key: string;
  previous: unknown;
  removed: boolean;
  state: Record<string, unknown>;
};

type StateHandler = (socket: ChannelSocket, value: unknown, context: StateContext) => unknown;

type PresenceOptions = {
  graceMs?: number;
  key: (socket: ChannelSocket) => unknown;
  lost?: (id: string) => unknown;
  offline?: (id: string) => unknown;
  online?: (id: string, socket: ChannelSocket) => unknown;
};

type ChannelOptions = {
  events?: Record<string, InboundHandler>;
  guard: SocketGuard | readonly SocketGuard[];
  logger?: LoggerAdapterLogger | null;
  namespace: string;
  onConnection?: (socket: ChannelSocket) => unknown;
  onDisconnect?: (socket: ChannelSocket) => unknown;
  presence?: PresenceOptions;
  rooms?: Record<string, RoomDefinition>;
  state?: Record<string, StateHandler>;
  withContext?: (context: ChannelContext, run: () => Promise<unknown>) => unknown;
};

type SocketFilter = (socket: ChannelSocket) => boolean;
type SocketPrepare = (socket: ChannelSocket) => unknown;

type Channel = {
  attach: (server: ChannelServer) => boolean;
  broadcast: (room: unknown, event: unknown, data?: unknown) => boolean;
  defineRoom: (kind: unknown, definition: RoomDefinition) => boolean;
  disconnect: (filter?: SocketFilter) => number;
  namespace: string;
  on: (event: unknown, handler: InboundHandler) => boolean;
  present: (id: unknown) => boolean;
  presentIds: () => string[];
  reauthorize: (filter?: SocketFilter, prepare?: SocketPrepare) => Promise<number>;
  room: (kind: unknown, id: unknown) => string;
  sockets: () => ChannelSocket[];
  stateOf: (socket: ChannelSocket) => Record<string, unknown>;
};

export type {
  Channel,
  ChannelContext,
  ChannelNamespace,
  ChannelOptions,
  ChannelServer,
  ChannelSocket,
  InboundHandler,
  PresenceOptions,
  RoomDefinition,
  RoomHandle,
  RoomRequestHandler,
  SocketFilter,
  SocketGuard,
  SocketNext,
  SocketPrepare,
  StateContext,
  StateHandler,
};
