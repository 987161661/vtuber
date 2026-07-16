import type { LiveRoomEvent } from '../services/live-platform/types';

export const SIMULATOR_EVENT_CHANNEL = 'aituber-simulator-events-v1';

export function isSimulatorBridgeEvent(value: unknown): value is LiveRoomEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<LiveRoomEvent>;
  const author = event.author as Partial<LiveRoomEvent['author']> | undefined;
  return (
    typeof event.id === 'string' &&
    event.id.trim().length > 0 &&
    event.id.length <= 200 &&
    (event.type === 'comment' || event.type === 'entry' || event.type === 'follow' || event.type === 'like' || event.type === 'gift' || event.type === 'superchat' || event.type === 'guard') &&
    typeof event.timestamp === 'number' &&
    Number.isFinite(event.timestamp) &&
    typeof author?.id === 'string' &&
    author.id.trim().length > 0 &&
    typeof author.name === 'string'
  );
}

export function publishSimulatorEvent(event: LiveRoomEvent) {
  if (typeof BroadcastChannel === 'undefined') return false;
  const channel = new BroadcastChannel(SIMULATOR_EVENT_CHANNEL);
  channel.postMessage(event);
  channel.close();
  return true;
}
