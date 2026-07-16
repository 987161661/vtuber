import { createHash, randomUUID } from 'node:crypto';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourcePath = resolve(process.argv[2] || '.runtime/soul/ledger.jsonl');
const raw = await readFile(sourcePath, 'utf8');
const records = raw
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`ledger_json_invalid_at_line_${index + 1}`);
    }
  });

const byId = new Map();
const ordered = [];
for (const record of records) {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.kind !== 'string' ||
    !record.scope ||
    typeof record.scope !== 'object' ||
    typeof record.occurredAt !== 'number' ||
    !record.payload ||
    typeof record.payload !== 'object'
  ) {
    throw new Error('ledger_record_shape_invalid');
  }
  const input = {
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    occurredAt: record.occurredAt,
    payload: record.payload,
  };
  const comparable = stableStringify(input);
  const prior = byId.get(record.id);
  if (prior) {
    if (prior !== comparable) throw new Error(`ledger_id_conflict:${record.id}`);
    continue;
  }
  byId.set(record.id, comparable);
  ordered.push(input);
}

let previousHash = 'genesis';
const repaired = ordered.map((input, index) => {
  const withoutHash = {
    protocolVersion: '1.0',
    sequence: index + 1,
    ...input,
    previousHash,
  };
  const hash = `sha256:${createHash('sha256')
    .update(stableStringify(withoutHash))
    .digest('hex')}`;
  previousHash = hash;
  return { ...withoutHash, hash };
});

const suffix = new Date().toISOString().replace(/[:.]/gu, '-');
const backupPath = `${sourcePath}.corrupt-${suffix}.bak`;
const temporaryPath = `${sourcePath}.${process.pid}.${randomUUID()}.repair`;
await copyFile(sourcePath, backupPath, 1);
await writeFile(
  temporaryPath,
  `${repaired.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  { encoding: 'utf8', flag: 'wx' },
);
await rename(temporaryPath, sourcePath);

process.stdout.write(
  `${JSON.stringify({
    sourcePath,
    backupPath,
    inputRecords: records.length,
    repairedRecords: repaired.length,
    duplicateIdsRemoved: records.length - repaired.length,
    finalSequence: repaired.at(-1)?.sequence ?? 0,
  })}\n`,
);

function stableStringify(value) {
  return JSON.stringify(sortForSerialization(value));
}

function sortForSerialization(value) {
  if (Array.isArray(value)) return value.map(sortForSerialization);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForSerialization(child)]),
    );
  }
  return value;
}
