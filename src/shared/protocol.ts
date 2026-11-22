const SUBSCRIBE_EVENT = "subscribe";
const UNSUBSCRIBE_EVENT = "unsubscribe";
const REQUEST_EVENT = "request";
const SUBSCRIBED_EVENT = "subscribed";
const DENIED_EVENT = "denied";
const CHANGE_EVENT = "change";
const SNAPSHOT_EVENT = "snapshot";
const QUERY_CHANGED_EVENT = "query:changed";
const STATE_EVENT = "state";
const SEND_EVENT = "send";

type RoomRef = {
  id: string;
  kind: string;
  room: string;
};

type RoomChange<T=unknown> = {
  data: T;
  event: string;
  room: string;
};

type LiveReply = {
  error?: string;
  ok: boolean;
};

type RoomReply<T=unknown> = {
  data?: T;
  error?: string;
  ok: boolean;
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function roomFor(kind: unknown, id: unknown) {
  const safeKind = text(kind);
  const safeId = text(id);
  return safeKind && safeId && !safeKind.includes(":") ? `${safeKind}:${safeId}` : "";
}

function parseRoom(room: unknown): RoomRef | null {
  const value = text(room);
  const separator = value.indexOf(":");
  if (separator <= 0 || separator >= value.length - 1) return null;
  return { id: value.slice(separator + 1), kind: value.slice(0, separator), room: value };
}

export {
  CHANGE_EVENT,
  DENIED_EVENT,
  parseRoom,
  QUERY_CHANGED_EVENT,
  REQUEST_EVENT,
  roomFor,
  SEND_EVENT,
  SNAPSHOT_EVENT,
  STATE_EVENT,
  SUBSCRIBE_EVENT,
  SUBSCRIBED_EVENT,
  text,
  UNSUBSCRIBE_EVENT,
};
export type { LiveReply, RoomChange, RoomReply, RoomRef };
