export const RADAR_CITY_EVENT_CHANNEL = 'aituber-radar-city-event-v1';
const CITY_COMMAND = /^@[\u3400-\u9fff]{2,16}[\s,，。！？!？、:：;；#]?$/;

export function isRadarCityCommand(text: string) {
  return CITY_COMMAND.test(text.trim());
}

export type RadarCityCommentEvent = {
  type: 'aituber:live-comment';
  version: 1;
  id: string;
  text: string;
  viewerId: string;
  viewerName: string;
  platform: string;
  receivedAt: number;
  followEvidence: 'observed' | 'unknown';
  followObservedAt?: number;
};

export function isRadarCityCommentEvent(
  value: unknown,
): value is RadarCityCommentEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<RadarCityCommentEvent>;
  return (
    event.type === 'aituber:live-comment' &&
    event.version === 1 &&
    typeof event.id === 'string' &&
    typeof event.text === 'string' &&
    typeof event.viewerId === 'string' &&
    typeof event.viewerName === 'string' &&
    typeof event.platform === 'string' &&
    typeof event.receivedAt === 'number' &&
    Number.isFinite(event.receivedAt) &&
    (event.followEvidence === 'observed' || event.followEvidence === 'unknown')
  );
}

/**
 * The SSE listener is deliberately single-owner. Broadcast city commands so
 * the radar overlay can forward them even when another dashboard owns it.
 */
export function publishRadarCityComment(event: RadarCityCommentEvent) {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(RADAR_CITY_EVENT_CHANNEL);
  channel.postMessage(event);
  channel.close();
}

/**
 * The server relay crosses localhost/127.0.0.1 origin boundaries that a
 * BroadcastChannel cannot cross. It is intentionally best-effort: direct
 * iframe postMessage remains the low-latency path.
 */
export async function relayRadarCityComment(event: RadarCityCommentEvent) {
  publishRadarCityComment(event);
  await fetch('/api/radar-city-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

export async function readRelayedRadarCityComments(after: number | 'latest' = 0) {
  const response = await fetch(`/api/radar-city-events?after=${after}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`radar_city_relay_${response.status}`);
  const payload = (await response.json()) as {
    events?: Array<{ sequence?: unknown; event?: unknown }>;
    latestSequence?: unknown;
  };
  return {
    latestSequence:
      typeof payload.latestSequence === 'number' ? payload.latestSequence : 0,
    events: (payload.events || []).flatMap(({ sequence, event }) =>
      typeof sequence === 'number' && isRadarCityCommentEvent(event)
        ? [{ sequence, event }]
        : [],
    ),
  };
}
