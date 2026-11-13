# @trebired/sockets

Socket channels for Bun applications on socket.io: one namespace per system, each with its own connection guard, permission-checked rooms, snapshots, room requests and declared inbound events, plus one client for browsers and Bun processes.

The package owns the channel protocol, guard order, room membership, the permission check on every subscription, snapshots, start and stop of room work, request routing, inbound event routing, revocation, and the client's reconnect and resubscribe. The application owns the socket.io server, who a socket is (the guard it passes), who may watch each room, what a snapshot or broadcast contains, and when to revoke. The package does not own a central namespace, user sessions, permission rules, or any interface.

## Install

Runtime support: Bun 1+.

```sh
bun i @trebired/sockets
```

## Quick Start

```ts
import { createChannel } from "@trebired/sockets/server";
import { authenticateSocket } from "@trebired/auth/socket";

const boards = createChannel({
  namespace: "/boards",
  guard: authenticateSocket(getAuth),
  rooms: {
    board: {
      authorize: (socket, id) => canViewBoard(socket.viewer, id),
      snapshot: (socket, id) => readBoard(id),
    },
  },
});

boards.attach(io);
boards.broadcast(boards.room("board", 42), "card-moved", { cardId: 7 });
```

```ts
import { connectChannel } from "@trebired/sockets/client";

const boards = connectChannel("/boards");
const stop = boards.subscribe("board:42", (change) => render(change.event, change.data));
```

## Concepts

### Channels

A channel is one socket.io namespace owned by one system. Every channel has its own guard, its own rooms and its own inbound events, so a repository channel, a deployment channel and an agent ingest channel never share a gate. `createChannel` refuses a channel without a guard and refuses the root namespace.

### Guards

`guard` is one connection middleware or a list of them, run in order before the socket connects. A guard that calls `next(error)` refuses the connection. `loopbackOnly()` admits sockets from the same machine only. A session guard such as `authenticateSocket` from `@trebired/auth/socket` attaches the viewer that room checks read.

### Rooms

A room is `<kind>:<id>`. Each kind is declared once:

- `authorize(socket, id)` runs for every subscription and for every `reauthorize`. A kind that is not declared is refused.
- `snapshot(socket, id)` is sent to the socket that just subscribed, as the event `snapshot`.
- `activate(id)` runs when the first socket joins a room and may return a cleanup, which runs when the last socket leaves or disconnects.
- `requests` answer questions about a room for its subscribed sockets only. A request sent right after subscribing waits until the subscription is decided.

A room kind belongs to exactly one channel; declaring it on a second channel is refused. `broadcast(room, event, data)` delivers to the channel that declared the room's kind, so code that changes data names the room and never the channel.

### Inbound events

`events` declares the client-to-server events a channel accepts, such as an agent pushing samples or a terminal sending input. A handler receives the socket, the payload and the acknowledgement callback when the client asked for one. Any other event is ignored and logged.

### Revocation

Permissions change while sockets stay open. `channel.reauthorize(filter, prepare)` runs `prepare(socket)` first, for refreshing the viewer the room checks read, then runs `authorize` again for every room the matching sockets hold and drops each one that now fails, telling the client with `denied`. `reauthorizeAll(filter, prepare)` and `disconnectAll(filter)` do the same across every channel. The application calls them on sign-out, suspension and role changes.

## Runtime

### Protocol

Clients send `subscribe`, `unsubscribe` and `request`. The server answers with `subscribed` or `denied`, and sends every room change, snapshots included, as `change` with `{ room, event, data }`.

### Client

`connectChannel(namespace, options)` returns one client per namespace and URL, shared by every caller in the page. All namespaces share one connection through the socket.io manager. The client resubscribes its rooms after a reconnect, so each listener receives a fresh snapshot. A client created with `auth`, such as an agent's credential, is never shared.

### Logging

Logs go through `@trebired/logger-adapter` under the `sockets.channel` and `sockets.room` groups: attached channels, refused undefined rooms, ignored events and failed handlers.

## Public API

### `@trebired/sockets/server`

`createChannel`, `broadcast`, `channelOf`, `loopbackOnly`, `isLoopbackAddress`, `reauthorizeAll`, `disconnectAll`, `roomFor`, `parseRoom`, and the types `Channel`, `ChannelOptions`, `ChannelContext`, `ChannelSocket`, `RoomDefinition`, `RoomRequestHandler`, `InboundHandler`, `SocketGuard`, `SocketFilter`.

A channel exposes `attach(io)`, `defineRoom(kind, definition)`, `on(event, handler)`, `broadcast(room, event, data)`, `reauthorize(filter)`, `disconnect(filter)`, `room(kind, id)`, `sockets()` and `namespace`. `withContext(context, run)` wraps every authorize, snapshot, request and inbound handler, for an application that keeps a per-request context.

### `@trebired/sockets/client`

`connectChannel(namespace, { url, auth, shared, socketOptions, ackTimeoutMs })` returns `subscribe(room, listener)`, `request(room, name, payload)`, `emit(event, ...args)`, `emitAck(event, payload)`, `on(event, handler)`, `connected()`, `socket()` and `close()`. `request` resolves to `{ ok, data }` or `{ ok: false, error }`.

`openRoom(namespace, room, { snapshotAs })` returns one room as a small event source: `on("connect" | "disconnect" | "connect_error", handler)` relays the connection, `on(event, handler)` receives that room's events by name with their data, `snapshotAs` delivers the snapshot under another event name, and `close()` leaves the room without closing the shared connection.

### Root

`roomFor`, `parseRoom`, `SNAPSHOT_EVENT` and the shared types, safe for any runtime.

## What It Does Not Do

This package does not:

- create the socket.io server or the HTTP server
- provide a shared namespace for every system
- decide who a socket is; the guard does
- decide who may watch a room; the room's `authorize` does
- store history, queue missed events or replay them after a reconnect
- render anything
