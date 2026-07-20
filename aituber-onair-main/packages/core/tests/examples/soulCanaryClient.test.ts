import { describe, expect, it, vi } from 'vitest';
import { createSoulCanaryClient } from '../../examples/react-purupuru-app/src/lib/soulCanaryClient';

const scope = {
  personaId: 'linglan-queen',
  platform: 'bilibili',
  roomId: 'room-1',
  sessionId: 'session-1',
};
const operatorToken = 'a'.repeat(64);
const eventToken = 'b'.repeat(64);

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('soul canary client', () => {
  it('starts a canary and persists only the validated operator credential', async () => {
    const { storage, values } = createStorage();
    const request = vi.fn(async () =>
      jsonResponse({
        runId: 'run-1',
        operatorToken,
        scope,
        startedAt: 1_000,
      }),
    );
    const client = createSoulCanaryClient({ request, storage });

    const credential = await client.start(scope);

    expect(credential).toEqual({
      version: 1,
      runId: 'run-1',
      operatorToken,
      scope,
      startedAt: 1_000,
    });
    expect(client.readOperatorCredential()).toEqual(credential);
    expect([...values.values()][0]).not.toContain(eventToken);
    expect(request).toHaveBeenCalledWith(
      '/api/acceptance-ledger',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Runtime-Settings-Role': 'producer',
        }),
      }),
    );
  });

  it('claims the matching active scope and returns private runtime headers', async () => {
    const { storage } = createStorage();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          activeCanaries: [
            {
              runId: 'other-run',
              scope: { ...scope, roomId: 'other-room' },
              startedAt: 500,
            },
            { runId: 'run-1', scope, startedAt: 1_000 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ runId: 'run-1', eventToken, scope, startedAt: 1_000 }),
      );
    const client = createSoulCanaryClient({ request, storage });

    const credential = await client.claimRuntimeForScope(scope, 'owner-1');

    expect(credential).toEqual({
      runId: 'run-1',
      eventToken,
      scope,
      startedAt: 1_000,
      ownerId: 'owner-1',
    });
    expect(client.runtimeEventHeaders(credential, scope, 'owner-1')).toEqual({
      'X-Soul-Canary-Run': 'run-1',
      'X-Soul-Canary-Token': eventToken,
      'X-Runtime-Owner-Id': 'owner-1',
    });
    expect(request).toHaveBeenLastCalledWith(
      '/api/acceptance-ledger',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Runtime-Owner-Id': 'owner-1',
        }),
      }),
    );
  });

  it('finishes with the operator token and clears persisted authority', async () => {
    const { storage } = createStorage();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          runId: 'run-1',
          operatorToken,
          scope,
          startedAt: 1_000,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createSoulCanaryClient({ request, storage });
    const credential = await client.start(scope);

    await client.finish(credential);

    expect(client.readOperatorCredential()).toBeNull();
    expect(request).toHaveBeenLastCalledWith(
      '/api/acceptance-ledger',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Soul-Canary-Operator-Token': operatorToken,
        }),
        body: JSON.stringify({
          action: 'finish-soul-canary',
          runId: 'run-1',
        }),
      }),
    );
  });

  it('rejects malformed private credentials without persisting them', async () => {
    const { storage, values } = createStorage();
    const client = createSoulCanaryClient({
      request: async () =>
        jsonResponse({
          runId: 'run-1',
          operatorToken: 'too-short',
          scope,
          startedAt: 1_000,
        }),
      storage,
    });

    await expect(client.start(scope)).rejects.toThrow(
      'soul_canary_start_failed',
    );
    expect(values.size).toBe(0);
  });

  it('reports active-list transport failures instead of treating them as no active run', async () => {
    const { storage } = createStorage();
    const client = createSoulCanaryClient({
      request: async () => jsonResponse({ error: 'ledger_unavailable' }, 503),
      storage,
    });

    await expect(client.listActive()).rejects.toThrow('ledger_unavailable');
  });

  it('keeps server authority usable when session storage is unavailable', async () => {
    const storage = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => {
        throw new Error('storage blocked');
      },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          runId: 'run-1',
          operatorToken,
          scope,
          startedAt: 1_000,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createSoulCanaryClient({ request, storage });

    expect(client.readOperatorCredential()).toBeNull();
    const credential = await client.start(scope);
    await expect(client.finish(credential)).resolves.toBeUndefined();
  });
});
