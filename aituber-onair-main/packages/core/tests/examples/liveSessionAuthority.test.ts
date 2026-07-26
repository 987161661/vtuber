import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveSessionAuthority } from '../../examples/react-purupuru-app/src/lib/liveSessionAuthority';
import {
  createLiveSessionLifecycle,
  type LiveSessionStorage,
} from '../../examples/react-purupuru-app/src/lib/liveSessionLifecycle';

const scope = {
  personaId: 'host',
  platform: 'local',
  roomId: 'default-room',
};

function memoryStorage(): LiveSessionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('live session authority', () => {
  it('releases a suspended initial render when the server request hangs', async () => {
    vi.useFakeTimers();
    const cache = createLiveSessionLifecycle({
      storage: memoryStorage(),
      now: () => 1_000,
      createId: () => 'local-session',
    });
    const candidate = cache.current(scope);
    const authority = createLiveSessionAuthority({
      cache,
      fetcher: () => new Promise<Response>(() => undefined),
      requestTimeoutMs: 20,
    } as Parameters<typeof createLiveSessionAuthority>[0]);

    let suspended: Promise<void> | undefined;
    try {
      authority.read(scope, candidate);
    } catch (error) {
      suspended = error as Promise<void>;
    }

    expect(suspended).toBeInstanceOf(Promise);
    let released = false;
    void suspended!.then(() => {
      released = true;
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(released).toBe(true);
    expect(authority.read(scope, candidate)).toBe(candidate);
  });
});
