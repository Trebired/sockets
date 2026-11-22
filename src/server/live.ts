import type { NormalizedLoggerAdapter } from "@package/logger-adapter";
import { text } from "#qkhazf8njk4y";
import type { LiveReply } from "#qkhazf8njk4y";
import type { ChannelOptions, ChannelSocket, InboundHandler, PresenceOptions, StateHandler } from "./types.js";

type LiveStore = {
  events: Map<string, InboundHandler>;
  handlers: Map<string, StateHandler>;
  logger: NormalizedLoggerAdapter;
  namespace: string;
  options: ChannelOptions;
  presence: PresenceTracker;
  values: Map<string, Map<string, unknown>>;
};

type PresenceTracker = {
  connected: (socket: ChannelSocket) => void;
  disconnected: (socket: ChannelSocket) => void;
  ids: () => string[];
  present: (id: unknown) => boolean;
};

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function reply(ack: unknown, payload: LiveReply) {
  if (typeof ack === "function") ack(payload);
}

function errorText(error: unknown) {
  return error && (error as Error).message ? (error as Error).message : String(error);
}

function stateHandlerFor(handlers: Map<string, StateHandler>, key: string) {
  const exact = handlers.get(key);
  if (exact) return exact;
  const separator = key.indexOf(":");
  return separator > 0 ? handlers.get(`${key.slice(0, separator)}:*`) : undefined;
}

function socketValues(store: LiveStore, socket: ChannelSocket) {
  const id = text(socket.id);
  if (!store.values.has(id)) store.values.set(id, new Map());
  return store.values.get(id)!;
}

function stateOf(store: LiveStore, socket: ChannelSocket) {
  return Object.fromEntries(store.values.get(text(socket.id)) || []);
}

async function runWrapped(store: LiveStore, socket: ChannelSocket, event: string, run: () => unknown) {
  const wrap = store.options.withContext;
  const task = async() => run();
  return typeof wrap === "function" ? wrap({ event, room: "", socket }, task) : task();
}

async function handleState(store: LiveStore, socket: ChannelSocket, payload: unknown, ack?: unknown) {
  const body = objectOf(payload);
  const key = text(body.key);
  const handler = key ? stateHandlerFor(store.handlers, key) : undefined;
  if (!handler) {
    store.logger.warn("sockets.live", "an undeclared state key was ignored", { key, namespace: store.namespace });
    return reply(ack, { error: "unknown-state", ok: false });
  }
  const values = socketValues(store, socket);
  const removed = body.removed === true;
  const previous = values.get(key);
  if (removed) values.delete(key);
  else values.set(key, body.value);
  try {
    const value = removed ? null : body.value;
    await runWrapped(store, socket, `state:${key}`, () => handler(socket, value, { key, previous, removed, state: stateOf(store, socket) }));
    reply(ack, { ok: true });
  } catch (error) {
    store.logger.warn("sockets.live", "a state handler failed", { error: errorText(error), key, namespace: store.namespace });
    reply(ack, { error: "handler-failed", ok: false });
  }
}

async function handleSend(store: LiveStore, socket: ChannelSocket, payload: unknown, ack?: unknown) {
  const body = objectOf(payload);
  const event = text(body.event);
  const handler = event ? store.events.get(event) : undefined;
  if (!handler) {
    store.logger.warn("sockets.live", "an undeclared sent event was ignored", { event, namespace: store.namespace });
    return reply(ack, { error: "unknown-event", ok: false });
  }
  try {
    await runWrapped(store, socket, event, () => handler(socket, body.payload));
    reply(ack, { ok: true });
  } catch (error) {
    store.logger.warn("sockets.live", "a sent event handler failed", { error: errorText(error), event, namespace: store.namespace });
    reply(ack, { error: "handler-failed", ok: false });
  }
}

function callHook(logger: NormalizedLoggerAdapter, name: string, run: () => unknown) {
  try {
    const out = run();
    if (out && typeof(out as Promise<unknown>).catch === "function") {
      (out as Promise<unknown>).catch ((error) => logger.warn("sockets.presence", `the ${name} hook failed`, { error: errorText(error) }));
    }
  } catch (error) {
    logger.warn("sockets.presence", `the ${name} hook failed`, { error: errorText(error) });
  }
}

function createPresenceTracker(options: PresenceOptions | undefined, logger: NormalizedLoggerAdapter): PresenceTracker {
  const counts = new Map<string, number>();
  const bySocket = new Map<string, string>();
  const lostTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const keyOf = (socket: ChannelSocket) => (options && typeof options.key === "function" ? text(options.key(socket)) : "");
  return {
    connected(socket) {
      const id = keyOf(socket);
      if (!id) return;
      bySocket.set(text(socket.id), id);
      const count = (counts.get(id) || 0) + 1;
      counts.set(id, count);
      const timer = lostTimers.get(id);
      if (timer) clearTimeout(timer);
      lostTimers.delete(id);
      if (count === 1 && options && options.online) callHook(logger, "online", () => options.online!(id, socket));
    },
    disconnected(socket) {
      const id = bySocket.get(text(socket.id));
      bySocket.delete(text(socket.id));
      if (!id) return;
      const count = Math.max(0, (counts.get(id) || 0) - 1);
      if (count) return void counts.set(id, count);
      counts.delete(id);
      if (options && options.offline) callHook(logger, "offline", () => options.offline!(id));
      if (!options || !options.lost) return;
      lostTimers.set(id, setTimeout(() => {
            lostTimers.delete(id);
            if (!counts.has(id)) callHook(logger, "lost", () => options.lost!(id));
          }, Math.max(0, Number(options.graceMs) || 0)));
    },
    ids: () => Array.from(counts.keys()),
    present: (id) => (counts.get(text(id)) || 0) > 0,
  };
}

export { createPresenceTracker, handleSend, handleState, stateOf };
export type { LiveStore, PresenceTracker };
