import { isLiveRoomEvent } from './types';
import type {
  LivePlatformEventAdapter,
  LiveRoomEvent,
  LiveRoomStatus,
} from './types';

const eventEndpoint =
  import.meta.env.VITE_BILIBILI_EVENT_ENDPOINT?.replace(/\/$/, '') ||
  '/api/bilibili';

export const bilibiliEventAdapter: LivePlatformEventAdapter<
  LiveRoomEvent,
  LiveRoomStatus
> = {
  id: 'bilibili',
  eventEndpoint,
  cursorStorageKey: 'aituber-bilibili-last-event-id',
  listenerLockName: 'aituber-bilibili-comment-listener',
  roomEventName: 'room-event',
  statusEventName: 'status',
  disconnectedStatus: {
    state: 'error',
    error: 'Unable to connect to the configured Bilibili event bridge.',
  },
  eventGuard: isLiveRoomEvent,
  createEventUrl(clientKey, lastEventId) {
    const query = new URLSearchParams({ client: clientKey });
    if (lastEventId) query.set('lastEventId', lastEventId);
    return `${eventEndpoint}/events?${query.toString()}`;
  },
};
