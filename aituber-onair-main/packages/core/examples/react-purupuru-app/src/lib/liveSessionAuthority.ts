import type {
  LiveSessionBaseScope,
  LiveSessionState,
  createLiveSessionLifecycle,
} from './liveSessionLifecycle';

type LiveSessionCache = ReturnType<typeof createLiveSessionLifecycle>;
type FetchLike = typeof fetch;

interface AuthorityEntry {
  state?: LiveSessionState;
  pending?: Promise<void>;
}

interface LiveSessionAuthorityOptions {
  cache: LiveSessionCache;
  fetcher?: FetchLike;
  createEventSource?: (url: string) => EventSource;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function scopeKey(scope: LiveSessionBaseScope): string {
  return JSON.stringify([
    scope.personaId.trim(),
    scope.platform.trim(),
    scope.roomId.trim(),
  ]);
}

function sameState(left: LiveSessionState, right: LiveSessionState): boolean {
  return (
    left.current.sessionId === right.current.sessionId &&
    left.current.startedAt === right.current.startedAt &&
    left.current.sequence === right.current.sequence &&
    left.previous?.sessionId === right.previous?.sessionId &&
    left.previous?.endedAt === right.previous?.endedAt
  );
}

export function createLiveSessionAuthority(
  options: LiveSessionAuthorityOptions,
) {
  const fetcher = options.fetcher ?? fetch;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const createEventSource =
    options.createEventSource ?? ((url: string) => new EventSource(url));
  const entries = new Map<string, AuthorityEntry>();

  const request = async (
    action: 'resolve' | 'rotate',
    scope: LiveSessionBaseScope,
    payload: {
      candidate?: LiveSessionState;
      expectedSessionId?: string;
    } = {},
  ): Promise<{ state: LiveSessionState; rotated?: boolean }> => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('live session request timed out'));
      }, requestTimeoutMs);
    });
    let response: Response;
    try {
      response = await Promise.race([
        fetcher('/api/live-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, scope, ...payload }),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`live session request failed (${response.status})`);
    }
    return (await response.json()) as {
      state: LiveSessionState;
      rotated?: boolean;
    };
  };

  const read = (
    scope: LiveSessionBaseScope,
    candidate: LiveSessionState,
  ): LiveSessionState => {
    const key = scopeKey(scope);
    let entry = entries.get(key);
    if (!entry) {
      entry = {};
      entries.set(key, entry);
    }
    if (entry.state) return entry.state;
    if (!entry.pending) {
      entry.pending = request('resolve', scope, { candidate })
        .then(({ state }) => {
          entry!.state = options.cache.replace(scope, state);
        })
        .catch(() => {
          // The local candidate is an explicit degraded-mode fallback. It
          // keeps the control room usable when the development server is
          // temporarily unavailable, without committing a provisional scope
          // while a healthy server request is still pending.
          entry!.state = candidate;
        });
    }
    throw entry.pending;
  };

  const refresh = async (scope: LiveSessionBaseScope): Promise<boolean> => {
    const key = scopeKey(scope);
    const entry = entries.get(key);
    if (!entry?.state) return false;
    const { state } = await request('resolve', scope);
    if (sameState(entry.state, state)) return false;
    entry.state = options.cache.replace(scope, state);
    return true;
  };

  const rotate = async (
    scope: LiveSessionBaseScope,
    expectedSessionId: string,
  ) => {
    const result = await request('rotate', scope, { expectedSessionId });
    const key = scopeKey(scope);
    const entry = entries.get(key) ?? {};
    entry.state = options.cache.replace(scope, result.state);
    entries.set(key, entry);
    return result;
  };

  const subscribe = (
    scope: LiveSessionBaseScope,
    onChange: () => void,
  ): (() => void) => {
    const query = new URLSearchParams({
      personaId: scope.personaId,
      platform: scope.platform,
      roomId: scope.roomId,
    });
    const source = createEventSource(
      `/api/live-sessions/events?${query.toString()}`,
    );
    source.onmessage = (event) => {
      try {
        const state = JSON.parse(event.data) as LiveSessionState;
        const key = scopeKey(scope);
        const entry = entries.get(key);
        if (!entry?.state || sameState(entry.state, state)) return;
        entry.state = options.cache.replace(scope, state);
        onChange();
      } catch {
        // EventSource reconnects automatically; malformed frames are ignored.
      }
    };
    return () => source.close();
  };

  return { read, refresh, rotate, subscribe };
}
