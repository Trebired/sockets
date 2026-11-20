import assert from "node:assert/strict";

const PROCESSES = Array.from({ length: 45 }, (_, index) => ({
      name: index % 3 === 0 ? `bun worker ${index}` : `node app ${index}`,
      pid: 1000 + index,
      ports: index % 5 === 0 ? [3000 + index] : [],
}));

function processChannel(server, sessionGuard, state) {
  return server.createChannel({
      guard: sessionGuard,
      namespace: "/query",
      rooms: {
        procs: server.queryRoom({
            authorize: (socket) => socket.viewer === "ada",
            filters: { ports: (item, value) => (value === "with" ? item.ports.length > 0 : item.ports.length === 0) },
            load: () => (state.loads += 1, PROCESSES),
            context: (socket) => ({ viewer: socket.viewer }),
            pageSize: 10,
            render: (
              item,
              context
            ) => `<row data-pid="${item.pid}" lang="${context.lang}" data-viewer="${context.context.viewer}">${item.name}</row>`,
            text: (item) => `${item.pid} ${item.name}`,
        }),
        live: server.queryRoom({
            authorize: () => true,
            key: (item) => String(item.pid),
            load: () => state.live,
            watchMs: 25,
        }),
      },
  });
}

function nextChange(changes) {
  return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the query room never reported its change")), 2000);
      changes.push((change) => {
          clearTimeout(timer);
          resolve(change);
      });
  });
}

async function verifyLiveQuery(client, running, state) {
  const watcher = client.connectChannel("/query", { auth: { user: "ada" }, shared: false, url: running.url });
  const waiting = [];
  const unsubscribe = watcher.subscribe("live:1", (change) => waiting.splice(0).forEach((resolve) => resolve(change)));
  const first = await watcher.request("live:1", "query", {});
  assert.deepEqual(first.data.keys, ["1"], "a keyed room sends each row's key beside it");
  const changed = nextChange(waiting);
  await new Promise((resolve) => setTimeout(resolve, 80));
  state.live = [{ pid: 1 }, { pid: 2 }];
  const change = await changed;
  assert.equal(change.event, "query:changed", "the watch tells subscribers once the loaded items change");
  const second = await watcher.request("live:1", "query", {});
  assert.deepEqual(second.data.keys, ["1", "2"]);
  unsubscribe();
  watcher.close();
}

async function verifyQueryRoom({ client, running, server, sessionGuard }) {
  const state = { live: [{ pid: 1 }], loads: 0 };
  processChannel(server, sessionGuard, state).attach(running.io);
  const ada = client.connectChannel("/query", { auth: { user: "ada" }, shared: false, url: running.url });
  const unsubscribe = ada.subscribe("procs:1", () => {});
  const first = await ada.request("procs:1", "query", { lang: "cs", search: "" });
  assert.equal(first.ok, true, "a query is answered right after subscribing, before the socket even connected");
  assert.equal(first.data.total, 45);
  assert.equal(first.data.items.length, 10, "the page size caps a page");
  assert.equal(
    first.data.items[0],
    '<row data-pid="1000" lang="cs" data-viewer="ada">bun worker 0</row>',
    "rows come back rendered in the asked language"
  );
  assert.equal(first.data.hasMore, true);
  assert.equal("context"in first.data, false, "server-side context never goes back to the client");
  const second = await ada.request("procs:1", "query", { cursor: first.data.cursor, offset: first.data.nextOffset });
  assert.equal(second.data.offset, 10);
  assert.equal(second.data.items.length, 10);
  assert.equal(state.loads, 1, "the next page reuses the first page's snapshot instead of loading again");
  const bun = await ada.request("procs:1", "query", { search: "BUN worker" });
  assert.equal(bun.data.total, 15, "every search term must match, ignoring case");
  assert.equal(state.loads, 2, "a new search loads fresh data");
  const ported = await ada.request("procs:1", "query", { filters: { ports: "with" }, search: "bun" });
  assert.equal(ported.data.total, 3, "filters and search combine");
  assert.equal(ported.data.hasMore, false);
  const everything = await ada.request("procs:1", "query", { filters: { ports: "all" }, limit: 500 });
  assert.equal(everything.data.items.length, 45, "a filter set to all is ignored, and limit stays within the maximum page size");
  unsubscribe();
  ada.close();
  const eve = client.connectChannel("/query", { auth: { user: "eve" }, shared: false, url: running.url });
  eve.subscribe("procs:1", () => {});
  assert.deepEqual(await eve.request("procs:1", "query", {}), { error: "not-subscribed", ok: false }, "a viewer without access cannot query");
  eve.close();
  await verifyLiveQuery(client, running, state);
  assert.throws(() => server.queryRoom({ authorize: () => true }), /load function/, "a query room needs a load function");
}

export { verifyQueryRoom };
