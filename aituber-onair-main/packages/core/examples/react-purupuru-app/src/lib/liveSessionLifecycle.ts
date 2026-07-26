export interface LiveSessionBaseScope {
  personaId: string;
  platform: string;
  roomId: string;
}

export interface LiveSessionRecord {
  sessionId: string;
  startedAt: number;
  sequence: number;
  endedAt?: number;
}

export interface LiveSessionState {
  version: 1;
  current: LiveSessionRecord;
  previous?: LiveSessionRecord;
}

export interface LiveSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface LiveSessionLifecycleOptions {
  storage: LiveSessionStorage;
  now?: () => number;
  createId?: () => string;
}

const STORAGE_PREFIX = 'aituber:live-session:v1';
const LEGACY_STORAGE_PREFIX = 'aituber:soul-session';

function scopeSegment(value: string): string {
  return encodeURIComponent(value.trim() || 'unknown');
}

export function liveSessionStorageKey(scope: LiveSessionBaseScope): string {
  return [
    STORAGE_PREFIX,
    scopeSegment(scope.personaId),
    scopeSegment(scope.platform),
    scopeSegment(scope.roomId),
  ].join(':');
}

function legacyStorageKey(scope: LiveSessionBaseScope): string {
  return [
    LEGACY_STORAGE_PREFIX,
    scope.personaId,
    scope.platform,
    scope.roomId,
  ].join(':');
}

function isRecord(value: unknown): value is LiveSessionRecord {
  const record = value as Partial<LiveSessionRecord> | undefined;
  return Boolean(
    record &&
      typeof record.sessionId === 'string' &&
      record.sessionId.trim() &&
      typeof record.startedAt === 'number' &&
      Number.isFinite(record.startedAt) &&
      typeof record.sequence === 'number' &&
      Number.isInteger(record.sequence) &&
      record.sequence > 0,
  );
}

function parseState(raw: string | null): LiveSessionState | undefined {
  if (!raw) return undefined;
  try {
    const input = JSON.parse(raw) as Partial<LiveSessionState>;
    if (input.version !== 1 || !isRecord(input.current)) return undefined;
    return {
      version: 1,
      current: input.current,
      previous: isRecord(input.previous) ? input.previous : undefined,
    };
  } catch {
    return undefined;
  }
}

export function createLiveSessionLifecycle(
  options: LiveSessionLifecycleOptions,
) {
  const now = options.now ?? Date.now;
  const createId =
    options.createId ?? (() => `soul-session:${crypto.randomUUID()}`);
  const volatileStates = new Map<string, LiveSessionState>();

  const write = (
    scope: LiveSessionBaseScope,
    state: LiveSessionState,
  ): LiveSessionState => {
    const key = liveSessionStorageKey(scope);
    volatileStates.set(key, state);
    try {
      options.storage.setItem(key, JSON.stringify(state));
    } catch {
      // Private browsing and embedded overlays may deny storage access. The
      // in-memory state still keeps this page internally consistent.
    }
    return state;
  };

  const current = (scope: LiveSessionBaseScope): LiveSessionState => {
    const key = liveSessionStorageKey(scope);
    const volatile = volatileStates.get(key);
    if (volatile) return volatile;

    let restored: LiveSessionState | undefined;
    let legacySessionId = '';
    try {
      restored = parseState(options.storage.getItem(key));
      legacySessionId =
        options.storage.getItem(legacyStorageKey(scope))?.trim() ?? '';
    } catch {
      // Fall through to an in-memory session.
    }
    if (restored) {
      volatileStates.set(key, restored);
      return restored;
    }

    return write(scope, {
      version: 1,
      current: {
        sessionId: legacySessionId || createId(),
        startedAt: now(),
        sequence: 1,
      },
    });
  };

  const rotate = (scope: LiveSessionBaseScope): LiveSessionState => {
    const previousState = current(scope);
    const transitionAt = now();
    return write(scope, {
      version: 1,
      previous: {
        ...previousState.current,
        endedAt: transitionAt,
      },
      current: {
        sessionId: createId(),
        startedAt: transitionAt,
        sequence: previousState.current.sequence + 1,
      },
    });
  };

  const replace = (
    scope: LiveSessionBaseScope,
    state: LiveSessionState,
  ): LiveSessionState => write(scope, state);

  return { current, rotate, replace };
}
