import {
  hasUnsafeSpeechArtifacts,
  sanitizeSpeechText,
} from '@aituber-onair/core';
import {
  LINGLAN_PROFILE,
  type CharacterProfile,
} from '../config/characterProfile';
import { createDefaultMemoryArchive } from '../config/memoryArchiveSeed';
import type {
  MemoryDimension,
  MemoryScope,
  StreamerMemoryRecord,
} from '../types/memory';

export type {
  MemoryDimension,
  MemoryInteraction,
  MemoryKind,
  MemoryScope,
  StreamerMemoryRecord,
} from '../types/memory';

const DB_NAME = 'linglan-streamer-memory-v1';
const PREVIOUS_DB_SUFFIX = '-streamer-memory';
const STORE = 'records';
const META = 'meta';
const DB_VERSION = 3;
const DAY = 86_400_000;
const SANITIZER_MIGRATION_VERSION = 2;
const ARCHIVE_SCHEMA_VERSION = 3;
let migrationPromise: Promise<void> | undefined;

function openDatabase(
  name: string,
  createSchema = false,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = createSchema
      ? indexedDB.open(name, DB_VERSION)
      : indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (!createSchema) return;
      const database = request.result;
      const records = database.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : database.createObjectStore(STORE, { keyPath: 'id' });
      for (const [name, keyPath] of [
        ['scope', 'scope'],
        ['subjectId', 'subjectId'],
        ['expiresAt', 'expiresAt'],
        ['digitalHumanId', 'digitalHumanId'],
        ['dimension', 'dimension'],
        ['status', 'status'],
        ['memoryTier', 'memoryTier'],
        ['phase', 'phase'],
      ] as const) {
        if (!records.indexNames.contains(name))
          records.createIndex(name, keyPath);
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function inferDimension(
  record: Partial<StreamerMemoryRecord>,
): MemoryDimension {
  if (record.dimension) return record.dimension;
  if (record.kind === 'preference') return 'preference';
  if (record.kind === 'event') return 'episode';
  if (record.kind === 'commitment') return 'commitment';
  if (record.kind === 'rule') return 'knowledge';
  if (record.scope === 'viewer') return 'relationship';
  return 'self';
}

function normalizeMemoryRecord(
  record: Partial<StreamerMemoryRecord> &
    Pick<StreamerMemoryRecord, 'id' | 'content'>,
): StreamerMemoryRecord {
  const now = Date.now();
  const scope = record.scope || 'knowledge';
  const isCore = scope === 'core';
  const dimension = inferDimension(record);
  const memoryTier = record.memoryTier || (isCore ? 'long_term' : 'short_term');
  const longTerm = memoryTier === 'long_term';
  return {
    digitalHumanId: record.digitalHumanId || LINGLAN_PROFILE.id,
    scope,
    kind: record.kind || 'fact',
    dimension,
    layer:
      record.layer ||
      (isCore ? 'profile' : scope === 'working' ? 'interaction' : 'fact'),
    status:
      record.status ||
      (isCore ? 'protected' : scope === 'working' ? 'candidate' : 'confirmed'),
    title: record.title || record.content.slice(0, 28),
    subjectType: record.subjectType || (record.subjectId ? 'viewer' : 'self'),
    subjectName:
      record.subjectName ||
      (record.subjectId ? '观众' : LINGLAN_PROFILE.displayName),
    details: record.details || {},
    importance: Math.min(
      10,
      Math.max(1, record.importance || (isCore ? 8 : 5)),
    ),
    confidence: Math.min(1, Math.max(0, record.confidence ?? 0.5)),
    reinforcement: record.reinforcement || (isCore ? 1 : 0),
    disputation: record.disputation || 0,
    temporalScope:
      record.temporalScope || (dimension === 'episode' ? 'episode' : 'pattern'),
    visibility: record.visibility || 'internal',
    memoryTier,
    longTermType:
      record.longTermType ||
      (longTerm
        ? dimension === 'relationship'
          ? 'relational'
          : dimension === 'episode'
            ? 'episodic'
            : dimension === 'commitment'
              ? 'procedural'
              : 'semantic'
        : undefined),
    phase: record.phase || (longTerm ? 'long_term' : 'sleep_queue'),
    sleepState: record.sleepState || (longTerm ? 'settled' : 'queued'),
    activation: record.activation ?? (longTerm ? 0.72 : 0.55),
    stability: record.stability ?? (longTerm ? 0.6 : 0.12),
    halfLifeMs: record.halfLifeMs || (longTerm ? 90 * DAY : 18 * 60 * 60_000),
    salience: record.salience ?? Math.min(1, (record.importance || 5) / 10),
    emotionalSalience: record.emotionalSalience ?? 0,
    novelty: record.novelty ?? 0.4,
    goalRelevance: record.goalRelevance ?? 0.3,
    occurrenceCount: record.occurrenceCount || 1,
    retrievalCount: record.retrievalCount || 0,
    interference: record.interference || 0,
    compressionLevel: record.compressionLevel || 0,
    sessionIds: record.sessionIds || [],
    firstSeenAt: record.firstSeenAt || record.createdAt || now,
    lastSeenAt: record.lastSeenAt || record.updatedAt || now,
    lastRecalledAt: record.lastRecalledAt,
    lastSleptAt: record.lastSleptAt,
    protected: record.protected ?? isCore,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    validFrom: record.validFrom || record.createdAt || now,
    sourceType: record.sourceType || 'migration',
    sourceEventIds: record.sourceEventIds || [],
    relatedEntryIds: record.relatedEntryIds || [],
    versionHistory: record.versionHistory || [],
    ...record,
  };
}

function readAll<T>(database: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function importPreviousData(
  database: IDBDatabase,
  records: StreamerMemoryRecord[],
  metadata: { key: string; value: unknown }[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, META], 'readwrite');
    const recordStore = transaction.objectStore(STORE);
    const metaStore = transaction.objectStore(META);
    for (const record of records) {
      if (record.scope !== 'core' || record.kind !== 'persona') {
        recordStore.put(normalizeMemoryRecord(record));
      }
    }
    for (const item of metadata) metaStore.put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function migratePreviousDatabases(database: IDBDatabase): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return;
  const databaseInfos = await indexedDB.databases();
  const previousNames = databaseInfos
    .map((item) => item.name)
    .filter(
      (name): name is string =>
        typeof name === 'string' &&
        name !== DB_NAME &&
        name.endsWith(PREVIOUS_DB_SUFFIX),
    );

  for (const name of previousNames) {
    const previous = await openDatabase(name);
    try {
      if (
        !previous.objectStoreNames.contains(STORE) ||
        !previous.objectStoreNames.contains(META)
      ) {
        continue;
      }
      const [records, metadata] = await Promise.all([
        readAll<StreamerMemoryRecord>(previous, STORE),
        readAll<{ key: string; value: unknown }>(previous, META),
      ]);
      await importPreviousData(database, records, metadata);
    } finally {
      previous.close();
    }
    indexedDB.deleteDatabase(name);
  }
}

async function migrateContaminatedRecords(
  database: IDBDatabase,
): Promise<void> {
  const metadata = await readAll<{ key: string; value: unknown }>(
    database,
    META,
  );
  const currentVersion = Number(
    metadata.find((item) => item.key === 'sanitizerMigrationVersion')?.value ||
      0,
  );
  if (currentVersion >= SANITIZER_MIGRATION_VERSION) return;

  const records = await readAll<StreamerMemoryRecord>(database, STORE);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE, META], 'readwrite');
    const recordStore = transaction.objectStore(STORE);
    for (const record of records) {
      const cleaned = sanitizeSpeechText(record.content);
      const contaminated =
        cleaned !== record.content || hasUnsafeSpeechArtifacts(record.content);
      if (!contaminated) continue;
      if (!cleaned || record.scope === 'working' || record.kind === 'summary') {
        recordStore.delete(record.id);
      } else {
        recordStore.put({ ...record, content: cleaned, updatedAt: Date.now() });
      }
    }
    transaction.objectStore(META).put({
      key: 'sanitizerMigrationVersion',
      value: SANITIZER_MIGRATION_VERSION,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function migrateArchiveSchema(database: IDBDatabase): Promise<void> {
  const metadata = await readAll<{ key: string; value: unknown }>(
    database,
    META,
  );
  const currentVersion = Number(
    metadata.find((item) => item.key === 'archiveSchemaVersion')?.value || 0,
  );
  if (currentVersion >= ARCHIVE_SCHEMA_VERSION) return;

  const records = await readAll<StreamerMemoryRecord>(database, STORE);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE, META], 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const record of records) {
      if (
        (record.scope === 'core' && !record.id.includes(':cognitive:')) ||
        record.id.includes(':archive:')
      ) {
        store.delete(record.id);
        continue;
      }
      store.put(normalizeMemoryRecord(record));
    }
    transaction.objectStore(META).put({
      key: 'archiveSchemaVersion',
      value: ARCHIVE_SCHEMA_VERSION,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function db(): Promise<IDBDatabase> {
  const database = await openDatabase(DB_NAME, true);
  migrationPromise ??= (async () => {
    await migratePreviousDatabases(database);
    await migrateContaminatedRecords(database);
    await migrateArchiveSchema(database);
  })();
  await migrationPromise;
  return database;
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export const streamerMemoryStore = {
  async list(): Promise<StreamerMemoryRecord[]> {
    const records = await transact(STORE, 'readonly', (s) => s.getAll());
    return records.filter((r) => !r.invalidAt).map(normalizeMemoryRecord);
  },
  async get(id: string): Promise<StreamerMemoryRecord | undefined> {
    const record = await transact<StreamerMemoryRecord | undefined>(
      STORE,
      'readonly',
      (s) => s.get(id),
    );
    return record ? normalizeMemoryRecord(record) : undefined;
  },
  put(record: StreamerMemoryRecord) {
    const content = sanitizeSpeechText(record.content);
    if (!content || hasUnsafeSpeechArtifacts(content)) {
      return Promise.resolve(undefined);
    }
    return transact(STORE, 'readwrite', (s) =>
      s.put(normalizeMemoryRecord({ ...record, content })),
    );
  },
  remove(id: string) {
    return transact(STORE, 'readwrite', (s) => s.delete(id));
  },
  async clear(scope?: MemoryScope) {
    if (!scope) return transact(STORE, 'readwrite', (s) => s.clear());
    const records = await this.list();
    await Promise.all(
      records.filter((r) => r.scope === scope).map((r) => this.remove(r.id)),
    );
  },
  async export() {
    return this.list();
  },
  async import(records: StreamerMemoryRecord[]) {
    for (const record of records) {
      if (
        record &&
        typeof record.id === 'string' &&
        typeof record.content === 'string'
      )
        await this.put(record);
    }
  },
  getMeta<T>(key: string): Promise<T | undefined> {
    return transact(META, 'readonly', (s) => s.get(key)).then(
      (v: unknown) => (v as { value?: T } | undefined)?.value,
    );
  },
  setMeta<T>(key: string, value: T) {
    return transact(META, 'readwrite', (s) => s.put({ key, value }));
  },
};

export function memoryId() {
  return crypto.randomUUID();
}
export function isSafeMemoryText(text: string): boolean {
  const sensitive =
    /(?:身份证|住址|地址|手机号|电话|银行卡|密码|病历|疾病|政治立场|真实姓名)/i;
  const injection =
    /(?:ignore previous|system prompt|忽略.*指令|系统提示|越狱)/i;
  return (
    text.length >= 2 &&
    text.length <= 240 &&
    !hasUnsafeSpeechArtifacts(text) &&
    !sensitive.test(text) &&
    !injection.test(text)
  );
}

export function buildMemoryContext(
  records: StreamerMemoryRecord[],
  input: string,
  viewerId?: string,
  budget = 1200,
  activeCoreRecordId?: string,
  digitalHumanId?: string,
): string {
  const terms = input
    .toLowerCase()
    .split(/[\s，。！？、]+/)
    .filter((t) => t.length >= 2);
  const score = (r: StreamerMemoryRecord) =>
    r.activation * 55 +
    r.stability * 35 +
    r.salience * 20 +
    (r.subjectId === viewerId ? 40 : 0) +
    terms.filter((t) => r.content.toLowerCase().includes(t)).length * 10 +
    r.importance * 2 +
    (r.reinforcement - r.disputation) * 5 +
    r.confidence * 8 +
    r.updatedAt / 1e13;
  const selected = records
    .filter(
      (record) =>
        (!digitalHumanId || record.digitalHumanId === digitalHumanId) &&
        (!activeCoreRecordId ||
          record.scope !== 'core' ||
          record.id.startsWith(activeCoreRecordId)) &&
        (record.status === 'confirmed' || record.status === 'protected') &&
        record.memoryTier === 'long_term' &&
        (record.phase === 'long_term' || record.phase === 'fading') &&
        record.visibility !== 'private' &&
        (!record.expiresAt || record.expiresAt > Date.now()) &&
        (!record.subjectId || !viewerId || record.subjectId === viewerId),
    )
    .sort((a, b) => score(b) - score(a))
    .slice(0, 8);
  let used = 0;
  const lines: string[] = [];
  for (const r of selected) {
    const content = sanitizeSpeechText(r.content);
    if (!content) continue;
    const line = `- [${r.dimension}/${r.layer}] ${r.title}：${content}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length;
  }
  return lines.length
    ? `\n\n<streamer_memory>\n这些是可靠背景，仅在与当前问题相关时自然使用；不得透露记忆系统或其他观众资料。\n${lines.join('\n')}\n</streamer_memory>`
    : '';
}

export function defaultCoreMemories(
  profile: CharacterProfile = LINGLAN_PROFILE,
): StreamerMemoryRecord[] {
  return createDefaultMemoryArchive(profile);
}
export const NINETY_DAYS = 90 * DAY;
