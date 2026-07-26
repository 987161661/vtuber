import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SoulLedgerInputV1 } from '@aituber-onair/soul';
import { SqliteSoulStore } from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'soul-sqlite-'));
  roots.push(root);
  return join(root, 'runtime.sqlite');
}

function ledgerInput(id: string, occurredAt = 1_000): SoulLedgerInputV1 {
  const scope = {
    personaId: 'linglan',
    platform: 'bilibili',
    roomId: 'room-1',
    sessionId: 'session-1',
  };
  return {
    id,
    kind: 'event',
    scope,
    occurredAt,
    payload: {
      protocolVersion: '1.0',
      id: id.replace('ledger:', ''),
      kind: 'viewer-message',
      scope,
      occurredAt,
    },
  };
}

describe('SqliteSoulStore', () => {
  it('atomically commits a hash-chained ledger entry and its outbox message', async () => {
    const filename = await databasePath();
    const store = new SqliteSoulStore({ filename });

    const result = await store.commit({
      entries: [ledgerInput('ledger:event-1')],
      outbox: [{
        protocolVersion: '1.0',
        id: 'speech:event-1',
        topic: 'speech.render',
        key: 'session-1',
        payload: { text: '你好' },
        createdAt: 1_000,
      }],
    });

    expect(result.entries[0]?.sequence).toBe(1);
    expect(result.entries[0]?.hash).toMatch(/^sha256:/);
    expect(result.outbox[0]?.status).toBe('pending');
    store.close();

    const reopened = new SqliteSoulStore({ filename });
    expect((await reopened.export()).entries).toHaveLength(1);
    expect(await reopened.listOutbox({ statuses: ['pending'] })).toHaveLength(1);
    reopened.close();
  });

  it('rolls back outbox insertion when a ledger append conflicts', async () => {
    const store = new SqliteSoulStore({ filename: await databasePath() });
    await store.append(ledgerInput('ledger:event-1'));

    await expect(store.commit({
      entries: [ledgerInput('ledger:event-1', 2_000)],
      outbox: [{
        protocolVersion: '1.0',
        id: 'must-not-exist',
        topic: 'platform.reply',
        payload: { text: 'conflict' },
        createdAt: 2_000,
      }],
    })).rejects.toThrow('Conflicting append');

    expect(await store.listOutbox()).toEqual([]);
    store.close();
  });

  it('leases, retries, and acknowledges deliveries without duplicate ownership', async () => {
    const store = new SqliteSoulStore({ filename: await databasePath() });
    await store.commit({
      entries: [ledgerInput('ledger:event-1')],
      outbox: [{
        protocolVersion: '1.0',
        id: 'reply:event-1',
        topic: 'platform.reply',
        payload: { text: '收到' },
        createdAt: 1_000,
      }],
    });

    const firstLease = await store.leaseOutbox({ owner: 'worker-a', now: 2_000, leaseMs: 500, limit: 10 });
    const competingLease = await store.leaseOutbox({ owner: 'worker-b', now: 2_100, leaseMs: 500, limit: 10 });
    expect(firstLease.map((message) => message.id)).toEqual(['reply:event-1']);
    expect(competingLease).toEqual([]);

    await store.retryOutbox('reply:event-1', 'worker-a', { now: 2_200, retryAt: 3_000, error: 'temporary' });
    expect(await store.leaseOutbox({ owner: 'worker-b', now: 2_999, leaseMs: 500, limit: 10 })).toEqual([]);
    const retryLease = await store.leaseOutbox({ owner: 'worker-b', now: 3_000, leaseMs: 500, limit: 10 });
    expect(retryLease[0]?.attemptCount).toBe(2);

    await store.acknowledgeOutbox('reply:event-1', 'worker-b', 3_100);
    expect((await store.listOutbox({ statuses: ['delivered'] }))[0]?.deliveredAt).toBe(3_100);
    store.close();
  });

  it('assigns a deterministic sequence under concurrent appends', async () => {
    const store = new SqliteSoulStore({ filename: await databasePath() });
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.append(ledgerInput(`ledger:event-${index}`, 1_000 + index)),
      ),
    );

    expect((await store.list()).map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    store.close();
  });
});
