# Changelog

All notable changes to `@trebired/sockets` will be documented here.

This project follows semantic versioning once published.

## 0.2.0

- Added `queryRoom(definition)`, a room that serves a searchable, filtered, paged list. The client asks with the room's `query` request, the server keeps a short-lived snapshot per socket behind a cursor, renders each page item with `render` when given, and broadcasts `QUERY_CHANGED_EVENT` to the room when a watched `load` returns different items.
- Added a room handle to `activate`: `activate(id, room)` receives `room.broadcast(event, data)`, `id`, `kind` and the room name, so an activated room can publish without reaching for its channel.
- Changed `request` on the client to wait for the server to confirm a room subscription before sending a request to that room. A request sent right after `subscribe` reached the server before the socket had joined and was refused.
- Exported `QUERY_CHANGED_EVENT` from both `@trebired/sockets` and `@trebired/sockets/client`.

## 0.1.0

- Added `createChannel`: one socket.io namespace per system with a required connection guard, declared rooms with `authorize`, `snapshot`, `activate` and `requests`, declared inbound events, broadcasts, `reauthorize` and `disconnect`.
- Added `broadcast(room, event, data)` and `channelOf(kind)`. A room kind belongs to one channel, and `broadcast` delivers to that channel.
- Added `loopbackOnly()` and `isLoopbackAddress`.
- Added `reauthorizeAll` and `disconnectAll` across every channel.
- Added `@trebired/sockets/client`: `connectChannel` with shared clients per namespace, room subscriptions with snapshots, room requests, acknowledged events and resubscribe after reconnect, for browsers and Bun.
- Added `openRoom(namespace, room, { snapshotAs })`, one room as an event source with connection events, named room events and `close()`.
