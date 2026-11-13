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

type RoomDefinition = {
  activate?: (id: string) => unknown;
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

type ChannelOptions = {
  events?: Record<string, InboundHandler>;
  guard: SocketGuard | readonly SocketGuard[];
  logger?: LoggerAdapterLogger | null;
  namespace: string;
  onConnection?: (socket: ChannelSocket) => unknown;
  onDisconnect?: (socket: ChannelSocket) => unknown;
  rooms?: Record<string, RoomDefinition>;
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
  reauthorize: (filter?: SocketFilter, prepare?: SocketPrepare) => Promise<number>;
  room: (kind: unknown, id: unknown) => string;
  sockets: () => ChannelSocket[];
};

export type {
  Channel,
  ChannelContext,
  ChannelNamespace,
  ChannelOptions,
  ChannelServer,
  ChannelSocket,
  InboundHandler,
  RoomDefinition,
  RoomRequestHandler,
  SocketFilter,
  SocketGuard,
  SocketNext,
  SocketPrepare,
};
