import type { Socket } from "socket.io-client";
import { SEND_EVENT, STATE_EVENT } from "#qkhazf8njk4y";
import type { LiveReply } from "#qkhazf8njk4y";

type EmitAck = <T > (socket: Socket, event: string, payload: unknown, timeoutMs: number) => Promise<T|null>;

type LiveOptions = {
  emitAck: EmitAck;
  outboxLimit: number;
  retryMs: number;
  timeoutMs: number;
};

type OutboxItem = {
  event: string;
  payload: unknown;
  resolve: (delivered: boolean) => void;
};

const REMOVED = "\u0000removed";

function serialize(value: unknown) {
  try {
    return JSON.stringify(value === undefined ? null : value);
  } catch {
    return String(value);
  }
}

function createPublisher(socket: Socket, options: LiveOptions) {
  const desired = new Map<string, {json:string;value:unknown}>();
  const acked = new Map<string, string>();
  const inFlight = new Set<string>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();

  function retry(key: string) {
    if (retries.has(key)) return;
    retries.set(key, globalThis.setTimeout(() => {
          retries.delete(key);
          flush(key);
        }, options.retryMs));
  }

  function flush(key: string) {
    if (!socket.connected || inFlight.has(key)) return;
    const entry = desired.get(key);
    const target = entry ? entry.json : REMOVED;
    if ((acked.get(key) || REMOVED) === target) return;
    inFlight.add(key);
    const payload = entry ? { key, value: entry.value } : { key, removed: true };
    void options.emitAck<LiveReply>(socket, STATE_EVENT, payload, options.timeoutMs).then((reply) => {
        inFlight.delete(key);
        if (!reply || reply.ok !== true) return retry(key);
        if (entry) acked.set(key, target);
        else acked.delete(key);
        flush(key);
    });
  }

  socket.on("connect", () => {
      acked.clear();
      inFlight.clear();
      desired.forEach((_entry, key) => flush(key));
  });
  socket.on("disconnect", () => inFlight.clear());

  return {
    publish(key: string, value: unknown) {
      const json = serialize(value);
      if (desired.get(key)?.json === json) return;
      desired.set(key, { json, value });
      flush(key);
    },
    published: () => Array.from(desired.keys()),
    unpublish(key: string) {
      if (!desired.delete(key)) return;
      flush(key);
    },
  };
}

function createOutbox(socket: Socket, options: LiveOptions) {
  const queue: OutboxItem[] = [];
  let sending = false;
  let retryTimer: ReturnType<typeof setTimeout>|null = null;

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = globalThis.setTimeout(() => {
        retryTimer = null;
        void pump();
      }, options.retryMs);
  }

  async function pump() {
    if (sending || !socket.connected) return;
    sending = true;
    while (queue.length && socket.connected) {
      const head = queue[0];
      const reply = await options.emitAck<LiveReply>(socket, SEND_EVENT, { event: head.event, payload: head.payload }, options.timeoutMs);
      if (reply && (reply.ok === true || reply.error === "unknown-event")) {
        queue.shift();
        head.resolve(reply.ok === true);
        continue;
      }
      scheduleRetry();
      break;
    }
    sending = false;
  }

  socket.on("connect", () => void pump());

  return {
    pending: () => queue.length,
    send(event: string, payload?: unknown) {
      return new Promise<boolean>((resolve) => {
          queue.push({ event, payload, resolve });
          while (queue.length > options.outboxLimit) queue.shift()!.resolve(false);
          void pump();
      });
    },
  };
}

export { createOutbox, createPublisher };
