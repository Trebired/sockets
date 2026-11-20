import { QUERY_CHANGED_EVENT, text } from "#qkhazf8njk4y";
import type { ChannelSocket, RoomDefinition, RoomHandle } from "./types.js";

type QueryFilter<T> = (item: T, value: string) => boolean;

type QueryRenderContext = {
  context: unknown;
  id: string;
  lang: string;
  socket: ChannelSocket;
};

type QueryRoomDefinition<T> = {
  activate?: RoomDefinition["activate"];
  authorize: RoomDefinition["authorize"];
  filters?: Record<string, QueryFilter<T>>;
  key?: (item: T) => string;
  load: (socket: ChannelSocket, id: string) => Promise<T[]>|T[];
  context?: (socket: ChannelSocket, id: string) => unknown;
  maxPageSize?: number;
  pageSize?: number;
  render?: (item: T, context: QueryRenderContext) => Promise<string>|string;
  text?: (item: T) => string;
  ttlMs?: number;
  watchMs?: number;
};

type QueryRequest = {
  cursor: string;
  filters: Record<string, string>;
  lang: string;
  limit: number;
  offset: number;
  search: string[];
};

type QueryReply = {
  cursor: string;
  hasMore: boolean;
  items: unknown[];
  keys?: string[];
  nextOffset: number;
  offset: number;
  total: number;
};

type QuerySnapshot<T> = {
  context: unknown;
  cursor: string;
  expires: number;
  matches: T[];
};

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGE_SIZE = 500;
const DEFAULT_TTL_MS = 60000;

let cursorCounter = 0;

function wholeNumber(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readQueryRequest<T>(definition: QueryRoomDefinition<T>, payload: unknown): QueryRequest {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const pageSize = wholeNumber(definition.pageSize, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
  const maxPageSize = wholeNumber(definition.maxPageSize, DEFAULT_MAX_PAGE_SIZE) || DEFAULT_MAX_PAGE_SIZE;
  const rawFilters = body.filters && typeof body.filters === "object" ? (body.filters as Record<string, unknown>) : {};
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFilters)) {
    const safe = text(value);
    if (safe && safe !== "all") filters[key] = safe;
  }
  return {
    cursor: text(body.cursor),
    filters,
    lang: text(body.lang),
    limit: Math.min(maxPageSize, wholeNumber(body.limit, pageSize) || pageSize),
    offset: wholeNumber(body.offset, 0),
    search: text(body.search).toLowerCase().split(/\s+/u).filter(Boolean),
  };
}

function itemText<T>(definition: QueryRoomDefinition<T>, item: T) {
  if (typeof definition.text === "function") return text(definition.text(item)).toLowerCase();
  try {
    return JSON.stringify(item).toLowerCase();
  } catch {
    return "";
  }
}

function matchesQuery<T>(definition: QueryRoomDefinition<T>, item: T, request: QueryRequest) {
  for (const [key, value] of Object.entries(request.filters)) {
    const filter = definition.filters && definition.filters[key];
    if (typeof filter === "function" && !filter(item, value)) return false;
  }
  if (!request.search.length) return true;
  const haystack = itemText(definition, item);
  return request.search.every((term) => haystack.includes(term));
}

function nextCursor() {
  cursorCounter += 1;
  return `${Date.now().toString(36)}.${cursorCounter.toString(36)}`;
}

function snapshotKey(socket: ChannelSocket, id: string) {
  return `${text(socket && socket.id)}\u0000${id}`;
}

function dropExpired<T>(snapshots: Map<string, QuerySnapshot<T>>, now: number) {
  snapshots.forEach((snapshot, key) => {
      if (snapshot.expires <= now) snapshots.delete(key);
  });
}

async function freshSnapshot<T>(
  definition: QueryRoomDefinition<T>,
  socket: ChannelSocket,
  id: string,
  request: QueryRequest,
): Promise<QuerySnapshot<T>> {
  const items = await definition.load(socket, id);
  const list = Array.isArray(items) ? items : [];
  const context = typeof definition.context === "function" ? await definition.context(socket, id) : undefined;
  return {
    cursor: nextCursor(),
    expires: Date.now() + (wholeNumber(definition.ttlMs, DEFAULT_TTL_MS) || DEFAULT_TTL_MS),
    context,
    matches: list.filter((item) => matchesQuery(definition, item, request)),
  };
}

async function renderPage<T>(definition: QueryRoomDefinition<T>, items: T[], context: QueryRenderContext) {
  if (typeof definition.render !== "function") return items;
  const render = definition.render;
  return await Promise.all(items.map(async(item) => text(await render(item, context))));
}

function pageKeys<T>(definition: QueryRoomDefinition<T>, items: T[]) {
  const key = definition.key;
  return typeof key === "function" ? { keys: items.map((item) => text(key(item))) } : {};
}

function fingerprint(items: unknown) {
  try {
    return JSON.stringify(Array.isArray(items) ? items : []);
  } catch {
    return "";
  }
}

function createWatcher<T>(definition: QueryRoomDefinition<T>, sockets: Map<string, ChannelSocket>) {
  const intervalMs = wholeNumber(definition.watchMs, 0);
  return function watch(id: string, room: RoomHandle) {
    if (!intervalMs) return undefined;
    let busy = false;
    let last = "";
    const tick = async() => {
      const socket = sockets.get(id);
      if (busy || !socket) return;
      busy = true;
      try {
        const next = fingerprint(await definition.load(socket, id));
        if (last && next && next !== last) room.broadcast(QUERY_CHANGED_EVENT);
        if (next) last = next;
      } catch {
        return;
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), intervalMs);
    void tick();
    return () => {
      clearInterval(timer);
      sockets.delete(id);
    };
  };
}

function createQueryHandler<T>(definition: QueryRoomDefinition<T>, sockets: Map<string, ChannelSocket>) {
  const snapshots = new Map<string, QuerySnapshot<T>>();
  return async function query(socket: ChannelSocket, id: string, payload: unknown): Promise<QueryReply> {
    sockets.set(id, socket);
    const request = readQueryRequest(definition, payload);
    const now = Date.now();
    dropExpired(snapshots, now);
    const key = snapshotKey(socket, id);
    const kept = snapshots.get(key);
    const reuse = request.offset > 0 && kept && kept.cursor === request.cursor;
    const snapshot = reuse ? kept : await freshSnapshot(definition, socket, id, request);
    snapshots.set(key, snapshot);
    const page = snapshot.matches.slice(request.offset, request.offset + request.limit);
    const nextOffset = request.offset + page.length;
    return {
      cursor: snapshot.cursor,
      hasMore: nextOffset < snapshot.matches.length,
      items: await renderPage(definition, page, { context: snapshot.context, id, lang: request.lang, socket }),
      ...pageKeys(definition, page),
      nextOffset,
      offset: request.offset,
      total: snapshot.matches.length,
    };
  };
}

function queryRoom<T>(definition: QueryRoomDefinition<T>): RoomDefinition {
  if (!definition || typeof definition.load !== "function") {
    throw new Error("A query room needs a load function that returns its items.");
  }
  const sockets = new Map<string, ChannelSocket>();
  const watch = createWatcher(definition, sockets);
  return {
    activate(id: string, room: RoomHandle) {
      const own = typeof definition.activate === "function" ? definition.activate(id, room) : undefined;
      const stop = watch(id, room);
      return () => {
        stop?.();
        if (typeof own === "function") own();
      };
    },
    authorize: definition.authorize,
    requests: { query: createQueryHandler(definition, sockets) },
  };
}

export { queryRoom };
export type { QueryFilter, QueryRenderContext, QueryReply, QueryRoomDefinition };
