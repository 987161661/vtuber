import { describe, expect, it } from 'vitest';
import {
  createSerializedJsonStore,
  type SerializedTextStoreAdapter,
} from '../../examples/react-purupuru-app/server/serializedJsonStore';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

describe('serialized JSON store', () => {
  it('persists overlapping snapshots in submission order', async () => {
    const firstWrite = deferred();
    const writes: string[] = [];
    const adapter: SerializedTextStoreAdapter = {
      read: async () => undefined,
      writeAtomically: async (value) => {
        writes.push(value);
        if (writes.length === 1) await firstWrite.promise;
      },
    };
    const store = createSerializedJsonStore<{ version: number }>({ adapter });

    const first = store.write({ version: 1 });
    const second = store.write({ version: 2 });
    await Promise.resolve();

    expect(writes).toEqual(['{"version":1}']);
    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(writes).toEqual(['{"version":1}', '{"version":2}']);
  });

  it('continues with newer snapshots after a failed write', async () => {
    let attempt = 0;
    const adapter: SerializedTextStoreAdapter = {
      read: async () => undefined,
      writeAtomically: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('disk unavailable');
      },
    };
    const store = createSerializedJsonStore<{ version: number }>({ adapter });

    const first = store.write({ version: 1 });
    const second = store.write({ version: 2 });

    await expect(first).rejects.toThrow('disk unavailable');
    await expect(second).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });
});
