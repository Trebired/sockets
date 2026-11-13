import assert from "node:assert/strict";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nextEvent(target, event, ms = 2000) {
  return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
      target.socket().once(event, (payload) => {
          clearTimeout(timer);
          resolve(payload);
      });
  });
}

function boardChannel(server, sessionGuard, state) {
  return server.createChannel({
      events: { push: (socket, payload, ack) => (state.pushed.push([socket.viewer, payload]), ack && ack("stored")) },
      guard: sessionGuard,
      namespace: "/board",
      rooms: {
        board: {
          activate: (id) => (state.log.push(`start:${id}`), () => state.log.push(`stop:${id}`)),
          authorize: (socket, id) => state.allowed.has(socket.viewer) && id !== "secret",
          requests: { page: (socket, id, payload) => ({ id, page: payload && payload.page }) },
          snapshot: (socket, id) => ({ id, viewer: socket.viewer }),
        },
      },
  });
}

function changesOf(target, room) {
  const seen = [];
  const unsubscribe = target.subscribe(room, (change) => seen.push(change));
  return { seen, unsubscribe };
}

async function connect(client, running, user) {
  const target = client.connectChannel("/board", { auth: user ? { user } : undefined, shared: false, url: running.url });
  if (!user) return target;
  if (!target.connected()) await nextEvent(target, "connect");
  return target;
}

async function verifyGuardAndSnapshot(context) {
  const { client, running, state } = context;
  const anonymous = client.connectChannel("/board", { shared: false, url: running.url });
  const refused = await nextEvent(anonymous, "connect_error");
  assert.equal(refused.message, "unauthorized", "the guard refuses a socket without a session");
  anonymous.close();

  const ada = await connect(client, running, "ada");
  const adaChanges = changesOf(ada, "board:1");
  await wait(150);
  assert.deepEqual(adaChanges.seen[0], { data: { id: "1", viewer: "ada" }, event: "snapshot", room: "board:1" }, "the subscriber gets a snapshot");
  const reply = await ada.request("board:1", "page", { page: 3 });
  assert.deepEqual(reply, { data: { id: "1", page: 3 }, ok: true }, "a member's request is answered");
  const early = changesOf(ada, "board:2");
  assert.deepEqual(await ada.request("board:2", "page", { page: 1 }), { data: { id: "2", page: 1 }, ok: true }, "a request waits for its subscribe");
  early.unsubscribe();
  return { ada, adaChanges };
}

async function verifyMembersAndEvents(context, ada, adaChanges) {
  const { channel, client, running, server, state } = context;
  const eve = await connect(client, running, "eve");
  const eveDenied = nextEvent(eve, "denied");
  const eveChanges = changesOf(eve, "board:1");
  assert.deepEqual(await eveDenied, { room: "board:1" }, "a viewer without access is denied");
  assert.deepEqual(await eve.request("board:1", "page", {}), { error: "not-subscribed", ok: false }, "a denied socket cannot ask the room");
  assert.equal(server.broadcast("board:1", "moved", { x: 1 }), true, "broadcast finds the channel that owns the kind");
  assert.equal(server.broadcast("nobody:1", "moved", {}), false, "a kind no channel owns is not delivered");
  assert.equal(server.channelOf("board"), channel);
  await wait(150);
  assert.deepEqual(adaChanges.seen.at(-1), { data: { x: 1 }, event: "moved", room: "board:1" }, "a broadcast reaches members");
  assert.equal(eveChanges.seen.length, 0, "a broadcast skips a denied socket");
  assert.equal(await ada.emitAck("push", { n: 1 }), "stored", "a declared event is handled with its ack");
  ada.emit("unknown-event", { n: 2 });
  await wait(100);
  assert.deepEqual(state.pushed, [["ada", { n: 1 }]], "an undeclared event is ignored");
  eve.close();
}

async function verifyRevocation(context, ada, adaChanges) {
  const { channel, client, running, server, state } = context;
  const ben = await connect(client, running, "ada");
  changesOf(ben, "board:1");
  await wait(150);
  assert.deepEqual(state.log, ["start:1", "start:2", "stop:2"], "a room starts once and stops when its last member leaves");
  const denied = nextEvent(ada, "denied");
  const prepared = [];
  const revoke = (socket) => {
    prepared.push(socket.viewer);
    state.allowed.delete("ada");
  };
  assert.equal(await channel.reauthorize((socket) => socket.viewer === "ada", revoke), 2, "reauthorize drops rooms the viewer lost");
  assert.deepEqual(prepared, ["ada", "ada"], "prepare runs for each matching socket before its rooms are checked");
  assert.deepEqual(await denied, { room: "board:1" });
  assert.deepEqual(state.log.at(-1), "stop:1", "the room stops once reauthorize empties it");
  channel.broadcast("board:1", "moved", { x: 2 });
  await wait(150);
  assert.equal(adaChanges.seen.at(-1).data.x, 1, "a revoked socket receives nothing more");
  const closed = nextEvent(ben, "disconnect");
  assert.equal(server.disconnectAll((socket) => socket.viewer === "ada"), 2, "disconnectAll closes every matching socket");
  await closed;
}

async function verifyRooms({ client, running, server, sessionGuard }) {
  const state = { allowed: new Set(["ada"]), log: [], pushed: [] };
  const channel = boardChannel(server, sessionGuard, state);
  assert.equal(channel.attach(running.io), true);
  assert.equal(channel.attach(running.io), false, "a channel attaches once");
  const ingest = server.createChannel({ guard: server.loopbackOnly(), namespace: "/ingest" });
  assert.equal(ingest.defineRoom("board", { authorize: () => true }), false, "a kind belongs to one channel");
  ingest.attach(running.io);
  const context = { channel, client, running, server, state };
  const { ada, adaChanges } = await verifyGuardAndSnapshot(context);
  await verifyMembersAndEvents(context, ada, adaChanges);
  await verifyRevocation(context, ada, adaChanges);
  state.allowed.add("ada");
  const opened = client.openRoom("/board", "board:5", { auth: { user: "ada" }, snapshotAs: "board", url: running.url });
  const firstBoard = new Promise((resolve) => opened.on("board", resolve));
  assert.deepEqual(await firstBoard, { id: "5", viewer: "ada" }, "openRoom delivers the snapshot under the asked name");
  const moved = new Promise((resolve) => opened.on("moved", resolve));
  channel.broadcast("board:5", "moved", { x: 9 });
  assert.deepEqual(await moved, { x: 9 }, "openRoom delivers room events by name");
  opened.close();
  const local = client.connectChannel("/ingest", { shared: false, url: running.url });
  await nextEvent(local, "connect");
  assert.equal(local.connected(), true, "loopbackOnly admits a local socket");
  local.close();
}

export { verifyRooms };
