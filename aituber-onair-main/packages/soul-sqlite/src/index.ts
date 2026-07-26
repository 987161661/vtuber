import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import {
  hashValue,
  stableStringify,
  type SoulLedgerEntryV1,
  type SoulLedgerExportV1,
  type SoulLedgerInputV1,
  type SoulLedgerQueryV1,
  type SoulLedgerStore,
  type SoulScopeV1,
} from '@aituber-onair/soul';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type OutboxStatusV1 = 'pending' | 'leased' | 'delivered';

export interface OutboxMessageInputV1 {
  protocolVersion: '1.0';
  id: string;
  topic: string;
  key?: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: number;
  availableAt?: number;
}

export interface OutboxMessageV1 extends OutboxMessageInputV1 {
  status: OutboxStatusV1;
  availableAt: number;
  attemptCount: number;
  leaseOwner?: string;
  leaseUntil?: number;
  deliveredAt?: number;
  lastError?: string;
}

export interface SoulStoreCommitV1 {
  entries?: readonly SoulLedgerInputV1[];
  outbox?: readonly OutboxMessageInputV1[];
}

export interface SoulStoreCommitResultV1 {
  entries: readonly SoulLedgerEntryV1[];
  outbox: readonly OutboxMessageV1[];
}

export interface OutboxQueryV1 {
  statuses?: readonly OutboxStatusV1[];
  topics?: readonly string[];
}

export interface OutboxLeaseRequestV1 {
  owner: string;
  now: number;
  leaseMs: number;
  limit: number;
  topics?: readonly string[];
}

export interface OutboxRetryV1 {
  now: number;
  retryAt: number;
  error: string;
}

export interface SqliteSoulStoreOptions {
  filename: string;
  busyTimeoutMs?: number;
}

interface LedgerRow {
  sequence: number;
  id: string;
  kind: SoulLedgerEntryV1['kind'];
  scope_json: string;
  occurred_at: number;
  payload_json: string;
  previous_hash: string;
  hash: string;
}

interface OutboxRow {
  protocol_version: '1.0';
  id: string;
  topic: string;
  message_key: string | null;
  payload_json: string;
  created_at: number;
  available_at: number;
  status: OutboxStatusV1;
  attempt_count: number;
  lease_owner: string | null;
  lease_until: number | null;
  delivered_at: number | null;
  last_error: string | null;
}

/**
 * Node-only durable adapter. Ledger and outbox records share one immediate
 * SQLite transaction so an externally visible action can never exist without
 * its causal audit record (or vice versa).
 */
export class SqliteSoulStore implements SoulLedgerStore {
  private readonly database: DatabaseSyncType;
  private closed = false;

  constructor(options: SqliteSoulStoreOptions) {
    this.database = new DatabaseSync(options.filename);
    this.database.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5_000}`);
    this.database.exec('PRAGMA foreign_keys = ON');
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec('PRAGMA synchronous = FULL');
    this.migrate();
  }

  async append(input: SoulLedgerInputV1): Promise<SoulLedgerEntryV1> {
    const result = await this.commit({ entries: [input] });
    const entry = result.entries[0];
    if (!entry) throw new Error('SQLite ledger append produced no entry');
    return entry;
  }

  async commit(input: SoulStoreCommitV1): Promise<SoulStoreCommitResultV1> {
    this.assertOpen();
    return clone(
      this.inImmediateTransaction((): SoulStoreCommitResultV1 => ({
        entries: (input.entries ?? []).map((entry) =>
          this.appendLedgerInTransaction(entry),
        ),
        outbox: (input.outbox ?? []).map((message) =>
          this.insertOutboxInTransaction(message),
        ),
      })),
    );
  }

  async list(query: SoulLedgerQueryV1 = {}): Promise<SoulLedgerEntryV1[]> {
    this.assertOpen();
    const entries = (
      this.database.prepare('SELECT * FROM soul_ledger ORDER BY sequence').all() as unknown as LedgerRow[]
    ).map(toLedgerEntry);
    return entries.filter((entry) => {
      if (query.kinds && !query.kinds.includes(entry.kind)) return false;
      if (query.afterSequence !== undefined && entry.sequence <= query.afterSequence) return false;
      if (!query.scope) return true;
      return Object.entries(query.scope).every(
        ([key, value]) =>
          value === undefined || entry.scope[key as keyof SoulScopeV1] === value,
      );
    });
  }

  async head(): Promise<SoulLedgerEntryV1 | undefined> {
    this.assertOpen();
    const row = this.database
      .prepare('SELECT * FROM soul_ledger ORDER BY sequence DESC LIMIT 1')
      .get() as LedgerRow | undefined;
    return row ? toLedgerEntry(row) : undefined;
  }

  async export(): Promise<SoulLedgerExportV1> {
    const entries = await this.list();
    return {
      protocolVersion: '1.0',
      entries,
      headHash: entries[entries.length - 1]?.hash ?? 'genesis',
    };
  }

  async listOutbox(query: OutboxQueryV1 = {}): Promise<OutboxMessageV1[]> {
    this.assertOpen();
    const messages = (
      this.database.prepare('SELECT * FROM soul_outbox ORDER BY created_at, id').all() as unknown as OutboxRow[]
    ).map(toOutboxMessage);
    return messages.filter(
      (message) =>
        (!query.statuses || query.statuses.includes(message.status)) &&
        (!query.topics || query.topics.includes(message.topic)),
    );
  }

  async leaseOutbox(request: OutboxLeaseRequestV1): Promise<OutboxMessageV1[]> {
    this.assertOpen();
    assertPositiveInteger(request.limit, 'Outbox lease limit');
    if (!Number.isFinite(request.leaseMs) || request.leaseMs <= 0) {
      throw new Error('Outbox lease duration must be positive');
    }
    return clone(
      this.inImmediateTransaction((): OutboxMessageV1[] => {
        const lease = request;
        const topicSql = lease.topics?.length
          ? ` AND topic IN (${lease.topics.map(() => '?').join(',')})`
          : '';
        const rows = this.database
          .prepare(
            `SELECT * FROM soul_outbox
             WHERE available_at <= ?
               AND (status = 'pending' OR (status = 'leased' AND lease_until <= ?))
               ${topicSql}
             ORDER BY created_at, id
             LIMIT ?`,
          )
          .all(lease.now, lease.now, ...(lease.topics ?? []), lease.limit) as unknown as OutboxRow[];
        const update = this.database.prepare(
          `UPDATE soul_outbox
           SET status = 'leased', lease_owner = ?, lease_until = ?,
               attempt_count = attempt_count + 1
           WHERE id = ?`,
        );
        return rows.map((row) => {
          update.run(lease.owner, lease.now + lease.leaseMs, row.id);
          return toOutboxMessage({
            ...row,
            status: 'leased',
            lease_owner: lease.owner,
            lease_until: lease.now + lease.leaseMs,
            attempt_count: row.attempt_count + 1,
          });
        });
      }),
    );
  }

  async acknowledgeOutbox(id: string, owner: string, deliveredAt: number): Promise<void> {
    this.assertOpen();
    const result = this.database
      .prepare(
        `UPDATE soul_outbox
         SET status = 'delivered', delivered_at = ?, lease_owner = NULL,
             lease_until = NULL, last_error = NULL
         WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
      )
      .run(deliveredAt, id, owner);
    if (result.changes !== 1) throw new Error(`Outbox lease is not owned by ${owner}: ${id}`);
  }

  async retryOutbox(id: string, owner: string, retry: OutboxRetryV1): Promise<void> {
    this.assertOpen();
    const result = this.database
      .prepare(
        `UPDATE soul_outbox
         SET status = 'pending', available_at = ?, lease_owner = NULL,
             lease_until = NULL, last_error = ?
         WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
      )
      .run(retry.retryAt, retry.error, id, owner);
    if (result.changes !== 1) throw new Error(`Outbox lease is not owned by ${owner}: ${id}`);
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private appendLedgerInTransaction(input: SoulLedgerInputV1): SoulLedgerEntryV1 {
    const existing = this.database
      .prepare('SELECT * FROM soul_ledger WHERE id = ?')
      .get(input.id) as LedgerRow | undefined;
    if (existing) {
      const entry = toLedgerEntry(existing);
      const comparable = {
        id: entry.id,
        kind: entry.kind,
        scope: entry.scope,
        occurredAt: entry.occurredAt,
        payload: entry.payload,
      };
      if (stableStringify(comparable) !== stableStringify(input)) {
        throw new Error(`Conflicting append for ledger id ${input.id}`);
      }
      return entry;
    }

    const head = this.database
      .prepare('SELECT sequence, hash FROM soul_ledger ORDER BY sequence DESC LIMIT 1')
      .get() as Pick<LedgerRow, 'sequence' | 'hash'> | undefined;
    const entryWithoutHash = {
      protocolVersion: '1.0' as const,
      sequence: (head?.sequence ?? 0) + 1,
      ...clone(input),
      previousHash: head?.hash ?? 'genesis',
    };
    const entry: SoulLedgerEntryV1 = {
      ...entryWithoutHash,
      hash: hashValue(entryWithoutHash),
    };
    this.database
      .prepare(
        `INSERT INTO soul_ledger
         (sequence, id, kind, scope_json, occurred_at, payload_json, previous_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.sequence,
        entry.id,
        entry.kind,
        stableStringify(entry.scope),
        entry.occurredAt,
        stableStringify(entry.payload),
        entry.previousHash,
        entry.hash,
      );
    return entry;
  }

  private insertOutboxInTransaction(input: OutboxMessageInputV1): OutboxMessageV1 {
    const existing = this.database
      .prepare('SELECT * FROM soul_outbox WHERE id = ?')
      .get(input.id) as OutboxRow | undefined;
    if (existing) {
      const message = toOutboxMessage(existing);
      const comparable: OutboxMessageInputV1 = {
        protocolVersion: message.protocolVersion,
        id: message.id,
        topic: message.topic,
        ...(message.key === undefined ? {} : { key: message.key }),
        payload: message.payload,
        createdAt: message.createdAt,
        ...(input.availableAt === undefined ? {} : { availableAt: message.availableAt }),
      };
      if (stableStringify(comparable) !== stableStringify(input)) {
        throw new Error(`Conflicting outbox append for id ${input.id}`);
      }
      return message;
    }
    const availableAt = input.availableAt ?? input.createdAt;
    this.database
      .prepare(
        `INSERT INTO soul_outbox
         (protocol_version, id, topic, message_key, payload_json, created_at,
          available_at, status, attempt_count)
         VALUES ('1.0', ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      )
      .run(
        input.id,
        input.topic,
        input.key ?? null,
        stableStringify(input.payload),
        input.createdAt,
        availableAt,
      );
    return {
      ...clone(input),
      availableAt,
      status: 'pending',
      attemptCount: 0,
    };
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS soul_ledger (
        sequence INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS soul_ledger_kind_sequence
        ON soul_ledger(kind, sequence);

      CREATE TABLE IF NOT EXISTS soul_outbox (
        protocol_version TEXT NOT NULL,
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        message_key TEXT,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        available_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'leased', 'delivered')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_until INTEGER,
        delivered_at INTEGER,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS soul_outbox_delivery
        ON soul_outbox(status, available_at, created_at);
    `);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SQLite soul store is closed');
  }

  private inImmediateTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function toLedgerEntry(row: LedgerRow): SoulLedgerEntryV1 {
  return {
    protocolVersion: '1.0',
    sequence: row.sequence,
    id: row.id,
    kind: row.kind,
    scope: JSON.parse(row.scope_json) as SoulScopeV1,
    occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload_json) as SoulLedgerEntryV1['payload'],
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

function toOutboxMessage(row: OutboxRow): OutboxMessageV1 {
  return {
    protocolVersion: row.protocol_version,
    id: row.id,
    topic: row.topic,
    ...(row.message_key === null ? {} : { key: row.message_key }),
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
    availableAt: row.available_at,
    status: row.status,
    attemptCount: row.attempt_count,
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_until === null ? {} : { leaseUntil: row.lease_until }),
    ...(row.delivered_at === null ? {} : { deliveredAt: row.delivered_at }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}
