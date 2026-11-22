import assert from "node:assert/strict";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await wait(25);
  }
  return check();
}

function liveChannel(server, sessionGuard, seen) {
  return server.createChannel({
      events: { "job:result": (socket, payload) => void seen.results.push([socket.viewer, payload]) },
      guard: sessionGuard,
      namespace: "/live",
      presence: {
        graceMs: 200,
        key: (socket) => socket.viewer,
        lost: (id) => void seen.presence.push(`lost:${id}`),
        offline: (id) => void seen.presence.push(`offline:${id}`),
        online: (id) => void seen.presence.push(`online:${id}`),
      },
      state: {
        "runtime:*": (socket, value, context) => void seen.states.push([context.key, value, context.removed]),
        info: (socket, value) => void seen.states.push(["info", value, false]),
      },
  });
}

async function verifyPublish(channel, target, seen) {
  target.publish("info", { name: "box" });
  target.publish("runtime:web", { status: "running" });
  target.publish("info", { name: "box" });
  await until(() => seen.states.length >= 2);
  await wait(100);
  const expected = [["info", { name: "box" }, false], ["runtime:web", { status: "running" }, false]];
  assert.deepEqual(seen.states, expected, "an unchanged value is not sent again");
  const [socket] = channel.sockets();
  assert.deepEqual(channel.stateOf(socket), { info: { name: "box" }, "runtime:web": { status: "running" } }, "the server keeps the socket's state");
  target.unpublish("runtime:web");
  await until(() => seen.states.length >= 3);
  assert.deepEqual(seen.states[2], ["runtime:web", null, true], "unpublish reaches the handler as a removal");
  target.publish("other", 1);
  await wait(100);
  assert.equal(seen.states.length, 3, "an undeclared key never reaches a handler");
  target.unpublish("other");
}

async function verifyReconnect(channel, target, seen) {
  const socket = target.socket();
  socket.disconnect();
  const sent = target.send("job:result", { id: 7 });
  assert.equal(target.pending(), 1, "an event sent while disconnected waits in the outbox");
  await until(() => seen.presence.includes("offline:ada"));
  socket.connect();
  assert.equal(await sent, true, "the outbox delivers after reconnect");
  await until(() => seen.states.length >= 4);
  assert.deepEqual(seen.states[3], ["info", { name: "box" }, false], "every published key is sent again after a reconnect");
  assert.deepEqual(seen.results, [["ada", { id: 7 }]]);
  await wait(300);
  assert.deepEqual(seen.presence, ["online:ada", "offline:ada", "online:ada"], "a return within the grace period is not lost");
  assert.equal(channel.present("ada"), true);
}

async function verifyLost(channel, target, seen) {
  target.close();
  await until(() => seen.presence.includes("lost:ada"), 1000);
  assert.deepEqual(seen.presence.slice(-2), ["offline:ada", "lost:ada"], "lost fires once the grace period passes");
  assert.equal(channel.present("ada"), false);
}

async function verifyLive({ client, running, server, sessionGuard }) {
  const seen = { presence: [], results: [], states: [] };
  const channel = liveChannel(server, sessionGuard, seen);
  channel.attach(running.io);
  const target = client.connectChannel("/live", { ackTimeoutMs: 500, auth: { user: "ada" }, retryMs: 100, shared: false, url: running.url });
  await until(() => target.connected());
  await verifyPublish(channel, target, seen);
  await verifyReconnect(channel, target, seen);
  await verifyLost(channel, target, seen);
}

export { verifyLive };
