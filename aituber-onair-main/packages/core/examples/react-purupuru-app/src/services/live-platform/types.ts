/** A platform bridge only needs to expose a normalized SSE event stream. */
export interface LivePlatformEventAdapter<TEvent, TStatus> {
  id: string;
  eventEndpoint: string;
  cursorStorageKey: string;
  listenerLockName: string;
  roomEventName: string;
  statusEventName: string;
  disconnectedStatus: TStatus;
  eventGuard?: (payload: unknown) => payload is TEvent;
  createEventUrl(clientKey: string, lastEventId?: string): string;
}

export interface LivePlatformReply {
  message: string;
  idempotencyKey: string;
}

export interface LivePlatformReplyResult {
  ok: boolean;
  duplicate: boolean;
  chunksTotal: number;
  chunksSent: number;
  state?: 'delivered' | 'accepted' | 'skipped' | 'failed';
}

export interface LivePlatformReplyAdapter {
  id: string;
  send(reply: LivePlatformReply): Promise<LivePlatformReplyResult>;
}

export interface LiveRoomEvent {
  id: string;
  type: LiveRoomEventType;
  text: string;
  timestamp: number;
  author: { id: string; name: string; avatarUrl?: string };
  metadata?: Record<string, unknown>;
}

export type LiveRoomEventType =
  | 'comment'
  | 'superchat'
  | 'gift'
  | 'guard'
  | 'follow'
  | 'like'
  | 'entry';

const LIVE_ROOM_EVENT_TYPES = new Set<LiveRoomEventType>([
  'comment',
  'superchat',
  'gift',
  'guard',
  'follow',
  'like',
  'entry',
]);

export interface LiveRoomStatus {
  state: string;
  error?: string;
  isLive?: boolean;
  onlineCount?: number;
  roomId?: number;
  bridgeEngine?: string;
  ordinaryroadVersion?: string;
  connectedClients?: number;
  outbound?: {
    configured?: boolean;
    authenticated?: boolean;
  };
  connectorId?: string;
  platformId?: string;
  platforms?: Record<string, LivePlatformConnectionStatus>;
}

export interface LivePlatformConnectionStatus {
  platformId: string;
  roomId: string;
  state: string;
  error?: string;
  isLive?: boolean;
  onlineCount?: number;
  credentialState?: 'missing' | 'configured' | 'valid' | 'invalid' | 'unknown';
  inbound?: boolean;
  outbound?: boolean;
  normalizedEvents?: number;
  sentCount?: number;
  lastEventAt?: number | null;
  lastSentAt?: number | null;
}

export interface LiveConnectorDriver {
  id: string;
  discoverPlatforms?(): Promise<string[]>;
  getStatus(): Promise<LiveRoomStatus>;
  send(
    platformId: string,
    reply: LivePlatformReply,
  ): Promise<LivePlatformReplyResult>;
}

export function isLiveRoomEvent(payload: unknown): payload is LiveRoomEvent {
  if (!payload || typeof payload !== 'object') return false;
  const event = payload as Partial<LiveRoomEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.type === 'string' &&
    LIVE_ROOM_EVENT_TYPES.has(event.type as LiveRoomEventType) &&
    typeof event.text === 'string' &&
    typeof event.timestamp === 'number' &&
    !!event.author &&
    typeof event.author.id === 'string' &&
    typeof event.author.name === 'string'
  );
}

export function isLiveRoomStatus(payload: unknown): payload is LiveRoomStatus {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof (payload as Partial<LiveRoomStatus>).state === 'string'
  );
}
