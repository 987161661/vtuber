import { isLiveRoomEvent } from './types';
import type {
  LivePlatformEventAdapter,
  LiveRoomEvent,
  LiveRoomStatus,
} from './types';

/**
 * Adapter for any bridge that emits the same normalized SSE contract as the
 * built-in bridge: `room-event` and `status` events, plus `lastEventId`.
 */
export function createCustomSseEventAdapter(
  endpoint: string,
): LivePlatformEventAdapter<LiveRoomEvent, LiveRoomStatus> {
  const eventEndpoint = endpoint.trim() || '/api/custom-sse-disabled';
  return {
    id: 'custom-sse',
    eventEndpoint,
    cursorStorageKey: 'aituber-custom-sse-last-event-id',
    listenerLockName: 'aituber-custom-sse-listener',
    roomEventName: 'room-event',
    statusEventName: 'status',
    disconnectedStatus: {
      state: 'error',
      error: 'Unable to connect to the configured custom SSE event bridge.',
    },
    eventGuard: isLiveRoomEvent,
    createEventUrl(clientKey, lastEventId) {
      const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
      const url = new URL(eventEndpoint, baseUrl);
      url.searchParams.set('client', clientKey);
      if (lastEventId) url.searchParams.set('lastEventId', lastEventId);
      return url.toString();
    },
  };
}
