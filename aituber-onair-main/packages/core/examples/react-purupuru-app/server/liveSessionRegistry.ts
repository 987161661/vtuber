import { randomUUID } from 'node:crypto';
import type {
  LiveSessionBaseScope,
  LiveSessionRecord,
  LiveSessionState,
} from '../src/lib/liveSessionLifecycle';
import type { SerializedJsonStore } from './serializedJsonStore';

export interface PersistedLiveSessionRegistry {
  version: 1;
  scopes: Array<{
    scope: LiveSessionBaseScope;
    state: LiveSessionState;
  }>;
}

export interface LiveSessionRotation {
  state: LiveSessionState;
  rotated: boolean;
}

interface LiveSessionRegistryOptions {
  store: SerializedJsonStore<PersistedLiveSessionRegistry>;
  now?: () => number;
  createId?: () => string;
  onRestoreError?: (error: unknown) => void;
  onPersistenceError?: (error: unknown) => void;
}

const MAX_ID_LENGTH = 240;

function normalizeSegment(value: string): string {
  return value.trim() || 'unknown';
}

export function normalizeLiveSessionScope(
  scope: LiveSessionBaseScope,
): LiveSessionBaseScope {
  return {
    personaId: normalizeSegment(scope.personaId),
    platform: normalizeSegment(scope.platform),
    roomId: normalizeSegment(scope.roomId),
  };
}

export function liveSessionScopeKey(scope: LiveSessionBaseScope): string {
  const normalized = normalizeLiveSessionScope(scope);
  return JSON.stringify([
    normalized.personaId,
    normalized.platform,
    normalized.roomId,
  ]);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function sanitizeRecord(
  value: unknown,
  options: { allowEndedAt: boolean },
): LiveSessionRecord | undefined {
  const input = value as Partial<LiveSessionRecord> | undefined;
  if (
    !input ||
    typeof input.sessionId !== 'string' ||
    !input.sessionId.trim() ||
    input.sessionId.length > MAX_ID_LENGTH ||
    !validTimestamp(input.startedAt) ||
    typeof input.sequence !== 'number' ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1
  ) {
    return undefined;
  }
  if (
    input.endedAt !== undefined &&
    (!options.allowEndedAt ||
      !validTimestamp(input.endedAt) ||
      input.endedAt < input.startedAt)
  ) {
    return undefined;
  }
  return {
    sessionId: input.sessionId.trim(),
    startedAt: input.startedAt,
    sequence: input.sequence,
    ...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
  };
}

export function sanitizeLiveSessionState(
  value: unknown,
): LiveSessionState | undefined {
  const input = value as Partial<LiveSessionState> | undefined;
  if (!input || input.version !== 1) return undefined;
  const current = sanitizeRecord(input.current, { allowEndedAt: false });
  const previous =
    input.previous === undefined
      ? undefined
      : sanitizeRecord(input.previous, { allowEndedAt: true });
  if (!current || (input.previous !== undefined && !previous)) return undefined;
  if (previous && previous.sequence >= current.sequence) return undefined;
  return {
    version: 1,
    current,
    ...(previous ? { previous } : {}),
  };
}

export function isPersistedLiveSessionRegistry(
  value: unknown,
): value is PersistedLiveSessionRegistry {
  const input = value as Partial<PersistedLiveSessionRegistry> | undefined;
  return Boolean(
    input &&
      input.version === 1 &&
      Array.isArray(input.scopes) &&
      input.scopes.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof entry.scope?.personaId === 'string' &&
          typeof entry.scope?.platform === 'string' &&
          typeof entry.scope?.roomId === 'string' &&
          sanitizeLiveSessionState(entry.state),
      ),
  );
}

function cloneState(state: LiveSessionState): LiveSessionState {
  return {
    version: 1,
    current: { ...state.current },
    ...(state.previous ? { previous: { ...state.previous } } : {}),
  };
}

export function createLiveSessionRegistry(options: LiveSessionRegistryOptions) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => `soul-session:${randomUUID()}`);
  const entries = new Map<
    string,
    { scope: LiveSessionBaseScope; state: LiveSessionState }
  >();
  const subscribers = new Map<string, Set<(state: LiveSessionState) => void>>();
  let restorePromise: Promise<void> | undefined;
  let mutationTail: Promise<unknown> = Promise.resolve();

  const restore = () => {
    restorePromise ??= options.store
      .read()
      .then((snapshot) => {
        if (!snapshot) return;
        for (const entry of snapshot.scopes) {
          const scope = normalizeLiveSessionScope(entry.scope);
          const state = sanitizeLiveSessionState(entry.state);
          if (state) entries.set(liveSessionScopeKey(scope), { scope, state });
        }
      })
      .catch((error) => {
        options.onRestoreError?.(error);
      });
    return restorePromise;
  };

  const persist = async () => {
    const snapshot: PersistedLiveSessionRegistry = {
      version: 1,
      scopes: [...entries.values()].map(({ scope, state }) => ({
        scope: { ...scope },
        state: cloneState(state),
      })),
    };
    try {
      await options.store.write(snapshot);
    } catch (error) {
      options.onPersistenceError?.(error);
      throw error;
    }
  };

  const publish = (scope: LiveSessionBaseScope, state: LiveSessionState) => {
    for (const subscriber of subscribers.get(liveSessionScopeKey(scope)) ??
      []) {
      subscriber(cloneState(state));
    }
  };

  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail
      .catch(() => undefined)
      .then(restore)
      .then(operation);
    mutationTail = result;
    return result;
  };

  const resolve = (
    scopeInput: LiveSessionBaseScope,
    candidate?: unknown,
  ): Promise<LiveSessionState> =>
    mutate(async () => {
      const scope = normalizeLiveSessionScope(scopeInput);
      const key = liveSessionScopeKey(scope);
      const existing = entries.get(key);
      if (existing) return cloneState(existing.state);

      const state =
        sanitizeLiveSessionState(candidate) ??
        ({
          version: 1,
          current: {
            sessionId: createId(),
            startedAt: now(),
            sequence: 1,
          },
        } satisfies LiveSessionState);
      entries.set(key, { scope, state });
      await persist();
      publish(scope, state);
      return cloneState(state);
    });

  const rotate = (
    scopeInput: LiveSessionBaseScope,
    expectedSessionId?: string,
  ): Promise<LiveSessionRotation> =>
    mutate(async () => {
      const scope = normalizeLiveSessionScope(scopeInput);
      const key = liveSessionScopeKey(scope);
      let entry = entries.get(key);
      if (!entry) {
        const state: LiveSessionState = {
          version: 1,
          current: {
            sessionId: createId(),
            startedAt: now(),
            sequence: 1,
          },
        };
        entry = { scope, state };
        entries.set(key, entry);
      }
      if (
        expectedSessionId &&
        entry.state.current.sessionId !== expectedSessionId
      ) {
        return { state: cloneState(entry.state), rotated: false };
      }

      const transitionAt = now();
      const nextState: LiveSessionState = {
        version: 1,
        previous: {
          ...entry.state.current,
          endedAt: transitionAt,
        },
        current: {
          sessionId: createId(),
          startedAt: transitionAt,
          sequence: entry.state.current.sequence + 1,
        },
      };
      entry.state = nextState;
      await persist();
      publish(scope, nextState);
      return { state: cloneState(nextState), rotated: true };
    });

  const subscribe = (
    scopeInput: LiveSessionBaseScope,
    subscriber: (state: LiveSessionState) => void,
  ) => {
    const key = liveSessionScopeKey(scopeInput);
    const scopedSubscribers = subscribers.get(key) ?? new Set();
    scopedSubscribers.add(subscriber);
    subscribers.set(key, scopedSubscribers);
    return () => {
      scopedSubscribers.delete(subscriber);
      if (scopedSubscribers.size === 0) subscribers.delete(key);
    };
  };

  return { resolve, rotate, restore, subscribe };
}
