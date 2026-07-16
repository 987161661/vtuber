export const RADAR_CITY_EVENT_CHANNEL = 'aituber-radar-city-event-v1';
const CITY_COMMAND = /^@([\u3400-\u9fff]{2,16})[\s,，。！？!？、:：;；#]?$/;

function normalizeViewerName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

export function isRadarCityCommand(text: string) {
  return CITY_COMMAND.test(text.trim());
}

/**
 * Resolves the otherwise ambiguous whole-message `@中文名` syntax against the
 * bounded set of viewers actually observed in the current room. A known
 * viewer always wins over the legacy radar-city shorthand.
 */
export function createRadarCityCommandRouter(options?: {
  now?: () => number;
  ttlMs?: number;
  maxViewers?: number;
}) {
  const now = options?.now ?? Date.now;
  const ttlMs = Math.max(60_000, options?.ttlMs ?? 30 * 60_000);
  const maxViewers = Math.max(1, options?.maxViewers ?? 2_000);
  const viewers = new Map<string, { viewerId: string; observedAt: number }>();

  const prune = (at: number) => {
    for (const [name, viewer] of viewers) {
      if (at - viewer.observedAt > ttlMs) viewers.delete(name);
    }
    while (viewers.size > maxViewers) {
      const oldest = viewers.keys().next().value as string | undefined;
      if (!oldest) break;
      viewers.delete(oldest);
    }
  };

  return {
    observeViewer(viewer: { id: string; name: string }, observedAt = now()) {
      const name = normalizeViewerName(viewer.name);
      if (!name || !viewer.id.trim()) return;
      // Refresh insertion order so the bounded map evicts the least-recently
      // observed viewer first.
      viewers.delete(name);
      viewers.set(name, { viewerId: viewer.id.trim(), observedAt });
      prune(observedAt);
    },
    shouldRoute(text: string, at = now()): boolean {
      const match = CITY_COMMAND.exec(text.trim());
      if (!match) return false;
      prune(at);
      return !viewers.has(normalizeViewerName(match[1]));
    },
    size(at = now()): number {
      prune(at);
      return viewers.size;
    },
  };
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
