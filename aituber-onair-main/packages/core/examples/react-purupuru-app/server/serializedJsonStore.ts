import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SerializedTextStoreAdapter {
  read(): Promise<string | undefined>;
  writeAtomically(value: string): Promise<void>;
}

export interface SerializedJsonStore<T> {
  read(): Promise<T | undefined>;
  write(value: T): Promise<void>;
}

export function createSerializedJsonStore<T>(options: {
  adapter: SerializedTextStoreAdapter;
  validate?: (value: unknown) => value is T;
}): SerializedJsonStore<T> {
  let writeTail: Promise<void> = Promise.resolve();

  return {
    async read() {
      const serialized = await options.adapter.read();
      if (serialized === undefined) return undefined;
      const value: unknown = JSON.parse(serialized);
      if (options.validate && !options.validate(value)) {
        throw new Error('invalid_serialized_json_store_value');
      }
      return value as T;
    },
    write(value) {
      // Freeze the submitted snapshot before it enters the queue. Callers may
      // continue mutating their in-memory state while an older write is active.
      const serialized = JSON.stringify(value);
      const operation = writeTail.then(() =>
        options.adapter.writeAtomically(serialized),
      );
      // Keep the queue usable after a failed disk operation while preserving
      // the rejection on the operation returned to that caller.
      writeTail = operation.catch(() => undefined);
      return operation;
    },
  };
}

export function createAtomicJsonFileAdapter(
  path: string,
): SerializedTextStoreAdapter {
  return {
    async read() {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) return undefined;
        throw error;
      }
    },
    async writeAtomically(value) {
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, value, {
          encoding: 'utf8',
          flag: 'wx',
        });
        await rename(temporaryPath, path);
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    },
  };
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
