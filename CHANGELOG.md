# Changelog

All notable changes to `@trebired/sockets` will be documented here.

This project follows semantic versioning once published.

## 0.1.0

- Added `createChannel`: one socket.io namespace per system with a required connection guard, declared rooms with `authorize`, `snapshot`, `activate` and `requests`, declared inbound events, broadcasts, `reauthorize` and `disconnect`.
- Added `broadcast(room, event, data)` and `channelOf(kind)`. A room kind belongs to one channel, and `broadcast` delivers to that channel.
- Added `loopbackOnly()` and `isLoopbackAddress`.
- Added `reauthorizeAll` and `disconnectAll` across every channel.
- Added `@trebired/sockets/client`: `connectChannel` with shared clients per namespace, room subscriptions with snapshots, room requests, acknowledged events and resubscribe after reconnect, for browsers and Bun.
- Added `openRoom(namespace, room, { snapshotAs })`, one room as an event source with connection events, named room events and `close()`.
