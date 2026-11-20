import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLogger } from "@package/logger-adapter";
import { Server } from "socket.io";
import { verifyQueryRoom } from "./query.mjs";
import { verifyRooms } from "./rooms.mjs";

const log = resolveLogger({ source: "@trebired/sockets" });
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function importDist(subpath) {
  return await import(path.join(rootDir, "dist", subpath));
}

function sessionGuard(socket, next) {
  const user = socket.handshake.auth && socket.handshake.auth.user;
  if (!user) return next(new Error("unauthorized"));
  socket.viewer = user;
  return next();
}

function verifyChannelRules(server) {
  assert.throws(() => server.createChannel({ namespace: "/open" }), /needs a guard/, "a channel without a guard is refused");
  assert.throws(() => server.createChannel({ guard: sessionGuard, namespace: "/" }), /own namespace/, "the root namespace is refused");
  assert.throws(
    () => server.createChannel({ guard: sessionGuard, namespace: "/bad", rooms: { thing: {} } }),
    /authorize/,
    "a room without authorize is refused",
  );
  assert.equal(server.isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(server.isLoopbackAddress("10.0.0.4"), false);
  assert.equal(server.roomFor("board", "1"), "board:1");
  assert.deepEqual(server.parseRoom("board:a:b"), { id: "a:b", kind: "board", room: "board:a:b" });
}

async function startServer() {
  const http = createServer();
  const io = new Server(http);
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  return { http, io, url: `http://127.0.0.1:${http.address().port}` };
}

async function main() {
  const server = await importDist("server/index.js");
  const client = await importDist("client/index.js");
  verifyChannelRules(server);
  const running = await startServer();
  try {
    await verifyRooms({ client, running, server, sessionGuard });
    await verifyQueryRoom({ client, running, server, sessionGuard });
  } finally {
    running.io.close();
    running.http.close();
  }
  log.info("verify.sockets", "Sockets verification succeeded.");
  process.exit(0);
}

await main();
