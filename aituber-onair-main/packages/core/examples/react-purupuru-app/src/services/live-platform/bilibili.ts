import { isLiveRoomEvent } from './types';
import type {
  LivePlatformEventAdapter,
  LivePlatformReplyAdapter,
  LivePlatformReplyResult,
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

export const bilibiliReplyAdapter: LivePlatformReplyAdapter = {
  id: 'bilibili',
  async send(reply) {
    const response = await fetch(`${eventEndpoint}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reply),
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<
      LivePlatformReplyResult & { error: string }
    >;
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || `bilibili_send_http_${response.status}`);
    }
    return {
      ok: true,
      duplicate: payload.duplicate === true,
      chunksTotal: Number(payload.chunksTotal || 0),
      chunksSent: Number(payload.chunksSent || 0),
    };
  },
};
