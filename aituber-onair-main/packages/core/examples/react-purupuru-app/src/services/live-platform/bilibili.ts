import { isLiveRoomEvent, isLiveRoomStatus } from './types';
import type {
  LivePlatformEventAdapter,
  LivePlatformReplyAdapter,
  LivePlatformReplyResult,
  LiveRoomEvent,
  LiveRoomStatus,
} from './types';

const defaultEventEndpoint =
  import.meta.env.VITE_BILIBILI_EVENT_ENDPOINT?.replace(/\/$/, '') ||
  '/api/bilibili';

function normalizeEndpoint(endpoint?: string): string {
  return endpoint?.trim().replace(/\/$/, '') || defaultEventEndpoint;
}

export function createBilibiliEventAdapter(
  endpoint = defaultEventEndpoint,
): LivePlatformEventAdapter<LiveRoomEvent, LiveRoomStatus> {
  const eventEndpoint = normalizeEndpoint(endpoint);
  return {
    id: 'ordinaryroad-bilibili',
    eventEndpoint,
    cursorStorageKey: 'aituber-bilibili-last-event-id',
    listenerLockName: 'aituber-bilibili-comment-listener',
    roomEventName: 'room-event',
    statusEventName: 'status',
    disconnectedStatus: {
      state: 'error',
      error: 'Unable to connect to the configured OrdinaryRoad gateway.',
    },
    eventGuard: isLiveRoomEvent,
    createEventUrl(clientKey, lastEventId) {
      const query = new URLSearchParams({ client: clientKey });
      if (lastEventId) query.set('lastEventId', lastEventId);
      return `${eventEndpoint}/events?${query.toString()}`;
    },
  };
}

export const bilibiliEventAdapter = createBilibiliEventAdapter();

export async function fetchBilibiliGatewayStatus(
  endpoint = defaultEventEndpoint,
): Promise<LiveRoomStatus> {
  const response = await fetch(`${normalizeEndpoint(endpoint)}/health`, {
    cache: 'no-store',
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isLiveRoomStatus(payload)) {
    throw new Error(`ordinaryroad_health_http_${response.status}`);
  }
  return payload;
}

export function createBilibiliReplyAdapter(
  endpoint = defaultEventEndpoint,
): LivePlatformReplyAdapter {
  const eventEndpoint = normalizeEndpoint(endpoint);
  return {
    id: 'ordinaryroad-bilibili',
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
        throw new Error(
          payload.error || `bilibili_send_http_${response.status}`,
        );
      }
      return {
        ok: true,
        duplicate: payload.duplicate === true,
        chunksTotal: Number(payload.chunksTotal || 0),
        chunksSent: Number(payload.chunksSent || 0),
      };
    },
  };
}

export const bilibiliReplyAdapter = createBilibiliReplyAdapter();
