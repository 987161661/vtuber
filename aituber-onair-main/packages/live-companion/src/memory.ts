import {
  LIVE_MEMORY_DIMENSIONS,
  type LiveMemoryDimension,
  type LiveMemoryDraft,
  type LiveMemoryPromptOptions,
  type LiveMemoryQuery,
  type LiveMemoryRecord,
  type LiveMemoryRepository,
  type LiveMemoryRetriever,
} from './types.js';

const DEFAULT_PROMPT_BUDGETS: Record<LiveMemoryDimension, number> = {
  working: 900,
  episode: 1_200,
  viewer: 1_000,
  reflection: 800,
  persona: 1_000,
};

const DEFAULT_LIMITS: Record<LiveMemoryDimension, number> = {
  working: 80,
  episode: 200,
  viewer: 500,
  reflection: 100,
  persona: 100,
};

const DIMENSION_LABELS: Record<LiveMemoryDimension, string> = {
  working: 'Current live context',
  episode: 'Current stream timeline',
  viewer: 'Viewer continuity',
  reflection: 'Past stream reflections',
  persona: 'Character continuity',
};

export class InMemoryLiveMemoryRepository implements LiveMemoryRepository {
  private records = new Map<string, LiveMemoryRecord>();

  async upsert(record: LiveMemoryRecord): Promise<void> {
    this.records.set(record.id, cloneRecord(record));
  }

  async query(query: LiveMemoryQuery = {}): Promise<LiveMemoryRecord[]> {
    const now = query.now ?? Date.now();
    const includeGlobal = query.includeGlobal ?? true;
    const records = [...this.records.values()].filter((record) => {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        return false;
      }
      if (query.dimensions && !query.dimensions.includes(record.dimension)) {
        return false;
      }
      if (record.salience < (query.minSalience ?? 0)) return false;
      if (
        query.tagsAny?.length &&
        !query.tagsAny.some((tag) => record.tags.includes(tag))
      ) {
        return false;
      }

      if (record.scope.kind === 'global') return includeGlobal;
      const hasScopeFilter =
        query.streamId !== undefined || query.viewerId !== undefined;
      if (!hasScopeFilter) return true;
      if (record.scope.kind === 'stream') {
        return query.streamId === record.scope.streamId;
      }
      return query.viewerId === record.scope.viewerId;
    });

    return records
      .sort(compareMemoryRecords)
      .slice(0, query.limit)
      .map(cloneRecord);
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

export interface LiveMemoryManagerOptions {
  now?: () => number;
  idFactory?: () => string;
  defaultWorkingTtlMs?: number;
  maxRecordsPerDimension?: Partial<Record<LiveMemoryDimension, number>>;
  retriever?: LiveMemoryRetriever;
}

export class LiveMemoryManager {
  private sequence = 0;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly limits: Record<LiveMemoryDimension, number>;
  private readonly retriever?: LiveMemoryRetriever;
  private readonly defaultWorkingTtlMs: number;

  constructor(
    private readonly repository: LiveMemoryRepository,
    options: LiveMemoryManagerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.idFactory =
      options.idFactory ??
      (() => `live-memory-${this.now()}-${this.sequence++}`);
    this.limits = { ...DEFAULT_LIMITS, ...options.maxRecordsPerDimension };
    this.retriever = options.retriever;
    this.defaultWorkingTtlMs = options.defaultWorkingTtlMs ?? 15 * 60_000;
  }

  async remember(draft: LiveMemoryDraft): Promise<LiveMemoryRecord> {
    validateDraft(draft);
    const now = draft.createdAt ?? this.now();
    const record: LiveMemoryRecord = {
      id: draft.id ?? this.idFactory(),
      dimension: draft.dimension,
      content: draft.content.trim(),
      scope: draft.scope,
      source: draft.source,
      createdAt: now,
      updatedAt: now,
      expiresAt:
        draft.expiresAt ??
        (draft.dimension === 'working'
          ? now + this.defaultWorkingTtlMs
          : undefined),
      salience: clamp(draft.salience ?? 0.5, 0, 1),
      tags: [...new Set(draft.tags ?? [])],
      metadata: draft.metadata,
    };

    await this.repository.upsert(record);
    await this.enforceLimit(record.dimension);
    return cloneRecord(record);
  }

  async recall(query: LiveMemoryQuery = {}): Promise<LiveMemoryRecord[]> {
    return this.repository.query({ ...query, now: query.now ?? this.now() });
  }

  async retrieve(
    queryText: string,
    query: LiveMemoryQuery = {},
    limit = 10,
  ): Promise<LiveMemoryRecord[]> {
    const records = await this.recall({ ...query, limit: undefined });
    if (!this.retriever) return records.slice(0, limit);
    return this.retriever.retrieve(records, queryText, limit);
  }

  async buildPromptContext(
    options: LiveMemoryPromptOptions = {},
  ): Promise<string> {
    const records = await this.recall({
      streamId: options.streamId,
      viewerId: options.viewerId,
      includeGlobal: true,
      now: options.now,
    });
    const perDimension = options.maxRecordsPerDimension ?? 8;
    const budgets = {
      ...DEFAULT_PROMPT_BUDGETS,
      ...options.characterBudgetPerDimension,
    };

    return LIVE_MEMORY_DIMENSIONS.map((dimension) => {
      const selected = records
        .filter((record) => record.dimension === dimension)
        .slice(0, perDimension);
      if (selected.length === 0) return '';
      const lines = selected.map((record) => `- ${record.content}`);
      return `[${DIMENSION_LABELS[dimension]}]\n${fitLines(
        lines,
        budgets[dimension],
      )}`;
    })
      .filter(Boolean)
      .join('\n\n');
  }

  async removeExpired(now = this.now()): Promise<number> {
    const records = await this.repository.query({
      includeGlobal: true,
      now: Number.NEGATIVE_INFINITY,
    });
    const expiredIds = records
      .filter(
        (record) => record.expiresAt !== undefined && record.expiresAt <= now,
      )
      .map((record) => record.id);
    await this.repository.remove(expiredIds);
    return expiredIds.length;
  }

  private async enforceLimit(dimension: LiveMemoryDimension): Promise<void> {
    const records = await this.repository.query({
      dimensions: [dimension],
      includeGlobal: true,
      now: Number.NEGATIVE_INFINITY,
    });
    const limit = this.limits[dimension];
    if (records.length <= limit) return;
    const overflow = records
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, records.length - limit)
      .map((record) => record.id);
    await this.repository.remove(overflow);
  }
}

function validateDraft(draft: LiveMemoryDraft): void {
  if (!draft.content.trim()) throw new Error('Memory content cannot be empty');
  if (draft.dimension === 'viewer' && draft.scope.kind !== 'viewer') {
    throw new Error('Viewer memory requires a viewer scope');
  }
  if (draft.dimension === 'persona' && draft.scope.kind !== 'global') {
    throw new Error('Persona memory requires a global scope');
  }
  if (
    (draft.dimension === 'working' || draft.dimension === 'episode') &&
    draft.scope.kind !== 'stream'
  ) {
    throw new Error(`${draft.dimension} memory requires a stream scope`);
  }
}

function compareMemoryRecords(
  left: LiveMemoryRecord,
  right: LiveMemoryRecord,
): number {
  if (left.salience !== right.salience) return right.salience - left.salience;
  return right.updatedAt - left.updatedAt;
}

function cloneRecord(record: LiveMemoryRecord): LiveMemoryRecord {
  return {
    ...record,
    scope: { ...record.scope },
    tags: [...record.tags],
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function fitLines(lines: string[], budget: number): string {
  let output = '';
  for (const line of lines) {
    const candidate = output ? `${output}\n${line}` : line;
    if (candidate.length > budget) break;
    output = candidate;
  }
  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
