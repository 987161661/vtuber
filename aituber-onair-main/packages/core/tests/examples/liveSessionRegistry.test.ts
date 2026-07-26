import { describe, expect, it } from 'vitest';
import {
  createLiveSessionRegistry,
  type PersistedLiveSessionRegistry,
} from '../../examples/react-purupuru-app/server/liveSessionRegistry';
import type { SerializedJsonStore } from '../../examples/react-purupuru-app/server/serializedJsonStore';

const scope = {
  personaId: ' host/one ',
  platform: 'bilibili',
  roomId: 'room:42',
};

function memoryStore(seed?: PersistedLiveSessionRegistry): {
  store: SerializedJsonStore<PersistedLiveSessionRegistry>;
  read: () => PersistedLiveSessionRegistry | undefined;
} {
  let snapshot = seed;
  return {
    store: {
      read: async () => snapshot,
      write: async (value) => {
        snapshot = structuredClone(value);
      },
    },
    read: () => snapshot,
  };
}

describe('server live session registry', () => {
  it('adopts the first browser candidate and rejects divergent origin state', async () => {
    const persisted = memoryStore();
    const registry = createLiveSessionRegistry({
      store: persisted.store,
      createId: () => 'server-generated',
    });
    const firstCandidate = {
      version: 1 as const,
      current: { sessionId: 'localhost-session', startedAt: 100, sequence: 3 },
    };
    const divergentCandidate = {
      version: 1 as const,
      current: { sessionId: '127-session', startedAt: 200, sequence: 1 },
    };

    await expect(registry.resolve(scope, firstCandidate)).resolves.toEqual(
      firstCandidate,
    );
    await expect(registry.resolve(scope, divergentCandidate)).resolves.toEqual(
      firstCandidate,
    );
    expect(persisted.read()?.scopes[0]?.scope.personaId).toBe('host/one');
  });

  it('rotates exactly once when two pages submit the same expected session', async () => {
    const persisted = memoryStore();
    let at = 1_000;
    let id = 0;
    const registry = createLiveSessionRegistry({
      store: persisted.store,
      now: () => at,
      createId: () => `session-${++id}`,
    });
    const initial = await registry.resolve(scope);
    at = 4_000;

    const [left, right] = await Promise.all([
      registry.rotate(scope, initial.current.sessionId),
      registry.rotate(scope, initial.current.sessionId),
    ]);

    expect([left.rotated, right.rotated].sort()).toEqual([false, true]);
    expect(left.state.current.sessionId).toBe('session-2');
    expect(right.state.current.sessionId).toBe('session-2');
    expect(left.state.current.sequence).toBe(2);
  });

  it('restores the durable authority after a server restart', async () => {
    const persisted = memoryStore();
    const first = createLiveSessionRegistry({
      store: persisted.store,
      now: () => 1_000,
      createId: () => 'durable-session',
    });
    await first.resolve(scope);

    const restored = createLiveSessionRegistry({
      store: persisted.store,
      now: () => 9_000,
      createId: () => 'must-not-be-used',
    });
    await expect(restored.resolve(scope)).resolves.toMatchObject({
      current: { sessionId: 'durable-session', startedAt: 1_000 },
    });
  });

  it('ignores malformed migration candidates', async () => {
    const persisted = memoryStore();
    const registry = createLiveSessionRegistry({
      store: persisted.store,
      now: () => 500,
      createId: () => 'safe-session',
    });

    await expect(
      registry.resolve(scope, {
        version: 1,
        current: {
          sessionId: '',
          startedAt: Number.NaN,
          sequence: 0,
        },
      }),
    ).resolves.toEqual({
      version: 1,
      current: {
        sessionId: 'safe-session',
        startedAt: 500,
        sequence: 1,
      },
    });
  });

  it('pushes one authoritative update to every subscribed page', async () => {
    const persisted = memoryStore();
    let id = 0;
    const registry = createLiveSessionRegistry({
      store: persisted.store,
      createId: () => `session-${++id}`,
    });
    const initial = await registry.resolve(scope);
    const received: string[] = [];
    const unsubscribe = registry.subscribe(scope, (state) => {
      received.push(state.current.sessionId);
    });

    await registry.rotate(scope, initial.current.sessionId);
    unsubscribe();
    await registry.rotate(scope, 'session-2');

    expect(received).toEqual(['session-2']);
  });
});
