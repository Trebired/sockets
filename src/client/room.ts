import { text, SNAPSHOT_EVENT, type RoomChange } from "#qkhazf8njk4y";
import { connectChannel, type ChannelClientOptions } from "./index.js";

type RoomHandler = (...args: any[]) => void;

type OpenRoomOptions = ChannelClientOptions& {
  snapshotAs?: string;
};

type OpenedRoom = {
  close: () => void;
  connected: () => boolean;
  on: (event: string, handler: RoomHandler) => OpenedRoom;
  room: string;
};

const CONNECTION_EVENTS = new Set(["connect", "connect_error", "disconnect"]);

function openRoom(namespace: string, room: string, options: OpenRoomOptions = {}): OpenedRoom {
  const client = connectChannel(namespace, options);
  const handlers = new Map<string, Set<RoomHandler>>();
  const offs: Array<()=>void> = [];
  const snapshotAs = text(options.snapshotAs);
  const dispatch = (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((handler) => handler(...args));
  const unsubscribe = client.subscribe(room, (change: RoomChange) => {
      const event = change.event === SNAPSHOT_EVENT && snapshotAs ? snapshotAs : change.event;
      dispatch(event, change.data);
  });
  const opened: OpenedRoom = {
    close() {
      unsubscribe();
      offs.splice(0).forEach((off) => off());
      handlers.clear();
    },
    connected: () => client.connected(),
    on(event, handler) {
      const name = text(event);
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(handler);
      if (CONNECTION_EVENTS.has(name) && handlers.get(name)!.size === 1) {
        offs.push(client.on(name, (...args: unknown[]) => dispatch(name, ...args)));
      }
      return opened;
    },
    room,
  };
  return opened;
}

export { openRoom };
export type { OpenedRoom, OpenRoomOptions, RoomHandler };
