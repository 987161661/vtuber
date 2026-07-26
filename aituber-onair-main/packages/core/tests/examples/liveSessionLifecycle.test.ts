import { describe, expect, it } from 'vitest';
import {
  createLiveSessionLifecycle,
  liveSessionStorageKey,
  type LiveSessionStorage,
} from '../../examples/react-purupuru-app/src/lib/liveSessionLifecycle';

const scope = {
  personaId: 'host/one',
  platform: 'bilibili',
  roomId: 'room:42',
};

function memoryStorage(seed: Record<string, string> = {}): LiveSessionStorage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('live session lifecycle', () => {
  it('creates and restores one durable current session', () => {
    const storage = memoryStorage();
    const first = createLiveSessionLifecycle({
      storage,
      now: () => 1_000,
      createId: () => 'session-1',
    });

    expect(first.current(scope)).toEqual({
      version: 1,
      current: {
        sessionId: 'session-1',
        startedAt: 1_000,
        sequence: 1,
      },
    });

    const restored = createLiveSessionLifecycle({
      storage,
      now: () => 9_000,
      createId: () => 'must-not-be-used',
    });
    expect(restored.current(scope).current.sessionId).toBe('session-1');
  });

  it('rotates atomically and retains the previous session for recap', () => {
    const storage = memoryStorage();
    let at = 1_000;
    let id = 0;
    const lifecycle = createLiveSessionLifecycle({
      storage,
      now: () => at,
      createId: () => `session-${++id}`,
    });
    lifecycle.current(scope);
    at = 4_000;

    expect(lifecycle.rotate(scope)).toEqual({
      version: 1,
      previous: {
        sessionId: 'session-1',
        startedAt: 1_000,
        endedAt: 4_000,
        sequence: 1,
      },
      current: {
        sessionId: 'session-2',
        startedAt: 4_000,
        sequence: 2,
      },
    });
  });

  it('migrates the legacy soul session identity without losing continuity', () => {
    const storage = memoryStorage({
      'aituber:soul-session:host/one:bilibili:room:42': 'legacy-session',
    });
    const lifecycle = createLiveSessionLifecycle({
      storage,
      now: () => 2_000,
      createId: () => 'new-session',
    });

    expect(lifecycle.current(scope).current.sessionId).toBe('legacy-session');
  });

  it('encodes scope segments in the durable storage key', () => {
    expect(liveSessionStorageKey(scope)).toBe(
      'aituber:live-session:v1:host%2Fone:bilibili:room%3A42',
    );
  });

  it('continues in memory when browser storage is unavailable', () => {
    const lifecycle = createLiveSessionLifecycle({
      storage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
      now: () => 3_000,
      createId: () => 'volatile-session',
    });

    const first = lifecycle.current(scope);
    const second = lifecycle.current(scope);
    expect(second).toBe(first);
  });

  it('caches the server-authoritative state for the next page load', () => {
    const storage = memoryStorage();
    const lifecycle = createLiveSessionLifecycle({
      storage,
      now: () => 3_000,
      createId: () => 'local-session',
    });
    const authoritative = {
      version: 1 as const,
      current: {
        sessionId: 'server-session',
        startedAt: 2_000,
        sequence: 4,
      },
    };

    lifecycle.replace(scope, authoritative);

    const restored = createLiveSessionLifecycle({
      storage,
      createId: () => 'must-not-be-used',
    });
    expect(restored.current(scope)).toEqual(authoritative);
  });
});
