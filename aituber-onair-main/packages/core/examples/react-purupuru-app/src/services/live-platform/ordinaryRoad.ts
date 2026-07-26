import { isLiveRoomEvent, isLiveRoomStatus } from './types';
import type {
  LivePlatformEventAdapter,
  LivePlatformReply,
  LivePlatformReplyResult,
  LiveRoomEvent,
  LiveRoomStatus,
} from './types';

const DEFAULT_ENDPOINT = '/api/live-connectors/ordinaryroad';
const DEFAULT_PLATFORM_QR_AUTH_ENDPOINT =
  '/api/live-connectors/platform-auth';

export type PlatformQrAuthState =
  | 'idle'
  | 'waiting-scan'
  | 'waiting-confirmation'
  | 'authenticated'
  | 'expired'
  | 'error';

export interface PlatformQrAuthSession {
  id?: string;
  platformId?: string;
  platformLabel?: string;
  state: PlatformQrAuthState;
  qrDataUrl?: string;
  expiresAt?: number;
  detail?: string;
}

function endpoint(value?: string) {
  return value?.trim().replace(/\/$/, '') || DEFAULT_ENDPOINT;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `ordinaryroad_http_${response.status}`,
    );
  }
  return payload as T;
}

export function createOrdinaryRoadEventAdapter(
  gatewayUrl = DEFAULT_ENDPOINT,
): LivePlatformEventAdapter<LiveRoomEvent, LiveRoomStatus> {
  const eventEndpoint = endpoint(gatewayUrl);
  return {
    id: 'ordinaryroad',
    eventEndpoint,
    cursorStorageKey: 'aituber-ordinaryroad-last-event-id',
    listenerLockName: 'aituber-ordinaryroad-event-listener',
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

export async function fetchOrdinaryRoadStatus(gatewayUrl = DEFAULT_ENDPOINT) {
  const payload = await request<unknown>(`${endpoint(gatewayUrl)}/status`);
  if (!isLiveRoomStatus(payload)) throw new Error('ordinaryroad_status_invalid');
  return payload;
}

export async function saveOrdinaryRoadPlatformConfig(
  gatewayUrl: string,
  platformId: string,
  config: { enabled: boolean; roomId: string },
) {
  return request<LiveRoomStatus>(
    `${endpoint(gatewayUrl)}/platforms/${encodeURIComponent(platformId)}/config`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    },
  );
}

export async function saveOrdinaryRoadCredential(
  gatewayUrl: string,
  platformId: string,
  cookie: string,
) {
  await request(
    `${endpoint(gatewayUrl)}/platforms/${encodeURIComponent(platformId)}/credential`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie }),
    },
  );
}

export async function clearOrdinaryRoadCredential(
  gatewayUrl: string,
  platformId: string,
) {
  await request(
    `${endpoint(gatewayUrl)}/platforms/${encodeURIComponent(platformId)}/credential`,
    { method: 'DELETE' },
  );
}

async function requestPlatformQrAuth(
  platformId: string,
  path: string,
  init?: RequestInit,
): Promise<PlatformQrAuthSession> {
  const response = await fetch(
    `${DEFAULT_PLATFORM_QR_AUTH_ENDPOINT}/platforms/${encodeURIComponent(platformId)}${path}`,
    { cache: 'no-store', ...init },
  );
  const payload = (await response.json().catch(() => null)) as
    | PlatformQrAuthSession
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.detail || `bilibili_qr_auth_http_${response.status}`);
  }
  return payload;
}

export function startPlatformQrAuth(platformId: string) {
  return requestPlatformQrAuth(platformId, '/start', { method: 'POST' });
}

export function fetchPlatformQrAuthStatus(platformId: string) {
  return requestPlatformQrAuth(platformId, '/status');
}

export function cancelPlatformQrAuth(platformId: string) {
  return requestPlatformQrAuth(platformId, '/cancel', { method: 'DELETE' });
}

export async function sendOrdinaryRoadReply(
  gatewayUrl: string,
  platformId: string,
  reply: LivePlatformReply,
): Promise<LivePlatformReplyResult> {
  return request(`${endpoint(gatewayUrl)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platformId, ...reply }),
  });
}
