import type { ChannelSocket, SocketGuard, SocketNext } from "./types.js";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function isLoopbackAddress(address: unknown) {
  const value = address == null ? "" : String(address).trim().toLowerCase();
  return LOOPBACK_ADDRESSES.has(value) || value.startsWith("127.") || value.startsWith("::ffff:127.");
}

function loopbackOnly(): SocketGuard {
  return function guardLoopback(socket: ChannelSocket, next: SocketNext) {
    const address = socket && socket.handshake ? socket.handshake.address : "";
    next(isLoopbackAddress(address) ? undefined : new Error("loopback-only"));
  };
}

function runGuards(guards: readonly SocketGuard[], socket: ChannelSocket, next: SocketNext) {
  let index = 0;
  const step = (error?: Error) => {
    if (error) return next(error);
    const guard = guards[index];
    index += 1;
    if (!guard) return next();
    try {
      return guard(socket, step);
    } catch (thrown) {
      return next(thrown instanceof Error ? thrown : new Error(String(thrown)));
    }
  };
  return step();
}

export { isLoopbackAddress, loopbackOnly, runGuards };
