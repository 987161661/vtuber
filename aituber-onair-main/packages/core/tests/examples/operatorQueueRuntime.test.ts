import { describe, expect, it, vi } from 'vitest';
import {
  createOperatorQueueRuntime,
  type OperatorQueueRuntimeStore,
} from '../../examples/react-purupuru-app/server/operatorQueueRuntime';
import type { OperatorQueueItem } from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function queueItem(
  overrides: Partial<OperatorQueueItem> = {},
): OperatorQueueItem {
  return {
    eventId: 'event-1',
    attemptId: 'event-1:attempt:1',
    turnVersion: 2,
    text: 'hello',
    source: 'test',
    sourcesSeen: ['test'],
    createdAt: 100,
    updatedAt: 100,
    order: 0,
    status: 'pending',
    skills: [],
    ...overrides,
  };
}

function memoryStore(saved?: OperatorQueueItem[]) {
  const writes: OperatorQueueItem[][] = [];
  const store: OperatorQueueRuntimeStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (items) => {
      writes.push(structuredClone(items));
    }),
  };
  return { store, writes };
}

describe('operator queue runtime', () => {
  it('ingests idempotently while preserving delivery state and merging evidence', async () => {
    const existing = queueItem({
      eventId: 'same-event',
      attemptId: 'same-event:attempt:1',
      sourcesSeen: ['bilibili'],
      status: 'speaking',
      preparedReply: 'in flight',
      roomContext: {
        totalCount: 1,
        participantCount: 1,
        catchup: false,
        mergedCount: 0,
        laneCounts: { chat: 1 },
        samples: [],
        conflictLevel: 'calm',
        ambiguous: false,
        clearOffenderIds: [],
        observedAt: 100,
      },
    });
    const incoming = queueItem({
      eventId: 'same-event',
      attemptId: 'same-event:attempt:1',
      sourcesSeen: ['relay'],
      status: 'pending',
      roomContext: {
        totalCount: 3,
        participantCount: 2,
        catchup: true,
        mergedCount: 1,
        laneCounts: { chat: 2, gift: 1 },
        samples: [],
        conflictLevel: 'friction',
        ambiguous: true,
        clearOffenderIds: ['viewer-b'],
        observedAt: 200,
      },
    });
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[existing.eventId, existing]]),
      store,
    });

    await runtime.execute({ action: 'ingest', item: incoming });

    expect(existing).toMatchObject({
      status: 'speaking',
      preparedReply: 'in flight',
      sourcesSeen: ['bilibili', 'relay'],
      roomContext: {
        totalCount: 3,
        participantCount: 2,
        catchup: true,
        laneCounts: { chat: 2, gift: 1 },
        conflictLevel: 'friction',
        ambiguous: true,
        clearOffenderIds: ['viewer-b'],
        observedAt: 200,
      },
    });
    expect(writes).toHaveLength(1);
  });

  it('records control-panel observation once and persists the batch', async () => {
    const testItem = queueItem({ eventId: 'test', testRunId: 'run-1' });
    const ordinaryItem = queueItem({ eventId: 'ordinary' });
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([
        [testItem.eventId, testItem],
        [ordinaryItem.eventId, ordinaryItem],
      ]),
      now: () => 7_000,
      store,
    });

    await expect(runtime.observeControlPanel()).resolves.toBe(1);
    await expect(runtime.observeControlPanel()).resolves.toBe(0);

    expect(testItem.panelObservedAt).toBe(7_000);
    expect(ordinaryItem.panelObservedAt).toBeUndefined();
    expect(writes).toHaveLength(1);
  });

  it('removes a complete stress run with one durable mutation', async () => {
    const first = queueItem({ eventId: 'first', testRunId: 'run-1' });
    const second = queueItem({ eventId: 'second', testRunId: 'run-1' });
    const retained = queueItem({ eventId: 'retained', testRunId: 'run-2' });
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([
        [first.eventId, first],
        [second.eventId, second],
        [retained.eventId, retained],
      ]),
      store,
    });

    await expect(runtime.removeTestRun('run-1')).resolves.toBe(2);

    expect(runtime.snapshot(false).map((item) => item.eventId)).toEqual([
      'retained',
    ]);
    expect(writes).toHaveLength(1);
  });

  it('returns read snapshots that cannot mutate authoritative state', () => {
    const item = queueItem();
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    const snapshot = runtime.snapshot(false);
    snapshot[0].status = 'failed';
    snapshot[0].sourcesSeen.push('outside');

    expect(runtime.get(item.eventId)).toMatchObject({
      status: 'pending',
      sourcesSeen: ['test'],
    });
  });

  it('executes the leased prepare-to-play lifecycle as one queue authority', async () => {
    let now = 1_000;
    const first = queueItem({
      eventId: 'first',
      attemptId: 'first:attempt:1',
    });
    const second = queueItem({
      eventId: 'second',
      attemptId: 'second:attempt:1',
      order: 1,
      preparedReply: 'second reply',
      status: 'ready',
    });
    const items = new Map<string, OperatorQueueItem>([
      [first.eventId, first],
      [second.eventId, second],
    ]);
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: items,
      maxRetries: 4,
      now: () => now,
      prepareLeaseMs: 120,
      speakLeaseMs: 60,
      store,
    });

    await runtime.execute({
      action: 'claim-prepare',
      eventId: 'first',
      ownerId: 'runtime-a',
    });
    expect(first).toMatchObject({
      status: 'preparing',
      leaseOwnerId: 'runtime-a',
      leaseExpiresAt: 1_120,
    });

    now = 1_010;
    await runtime.execute({
      action: 'ready',
      attemptId: 'first:attempt:1',
      eventId: 'first',
      reply: 'first reply',
      skills: ['conversation'],
    });
    expect(first).toMatchObject({
      status: 'ready',
      preparedReply: 'first reply',
      preparedAt: 1_010,
      beatCount: 1,
      completedBeatCount: 0,
      audioByteLength: 0,
      leaseOwnerId: undefined,
    });

    now = 1_020;
    await runtime.execute({
      action: 'claim-speak',
      attemptId: 'first:attempt:1',
      eventId: 'first',
      ownerId: 'runtime-a',
    });
    await expect(
      runtime.execute({
        action: 'claim-speak',
        attemptId: 'second:attempt:1',
        eventId: 'second',
        ownerId: 'runtime-b',
      }),
    ).rejects.toThrow('another queue item is already speaking');

    now = 1_030;
    await runtime.execute({
      action: 'done',
      attemptId: 'first:attempt:1',
      audioByteLength: 256,
      beatCount: 1,
      completedBeatCount: 1,
      eventId: 'first',
      ownerId: 'runtime-a',
      reason: 'played',
    });
    expect(first).toMatchObject({
      status: 'done',
      doneAt: 1_030,
      finishReason: 'played',
      leaseOwnerId: undefined,
    });
    expect(writes).toHaveLength(4);
  });

  it('rejects stale generation attempts without changing or persisting the item', async () => {
    const item = queueItem({ status: 'preparing' });
    const items = new Map([[item.eventId, item]]);
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({ initialItems: items, store });

    await expect(
      runtime.execute({
        action: 'ready',
        attemptId: 'event-1:attempt:old',
        eventId: 'event-1',
        reply: 'late reply',
      }),
    ).rejects.toThrow('stale queue generation attempt');

    expect(item.status).toBe('preparing');
    expect(item.preparedReply).toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  it('rejects a stale leased failure without terminating the current attempt', async () => {
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({ store });
    const queued = queueItem({ eventId: 'leased-failure' });
    await runtime.execute({ action: 'ingest', item: queued });
    await runtime.execute({
      action: 'claim-prepare',
      eventId: queued.eventId,
      ownerId: 'owner-1',
    });
    const staleAttemptId = queued.attemptId;
    await runtime.execute({
      action: 'retry',
      eventId: queued.eventId,
      attemptId: queued.attemptId,
      ownerId: 'owner-1',
      reason: 'controlled retry',
    });
    const retry = runtime.snapshot()[0];
    await runtime.execute({
      action: 'claim-prepare',
      eventId: queued.eventId,
      ownerId: 'owner-2',
    });

    await expect(
      runtime.execute({
        action: 'fail',
        eventId: queued.eventId,
        attemptId: staleAttemptId,
        ownerId: 'owner-1',
        reason: 'late callback',
      }),
    ).rejects.toThrow('stale queue failure attempt');

    expect(runtime.snapshot()[0]).toMatchObject({
      status: 'preparing',
      attemptId: retry.attemptId,
      leaseOwnerId: 'owner-2',
    });
  });

  it('allows only the active attempt owner to skip leased work', async () => {
    const item = queueItem({
      status: 'preparing',
      leaseOwnerId: 'owner-1',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    await expect(
      runtime.execute({
        action: 'skip',
        eventId: item.eventId,
        attemptId: 'stale-attempt',
        ownerId: 'owner-1',
        reason: 'llm_no_reply',
      }),
    ).rejects.toThrow('stale queue skip attempt');
    await expect(
      runtime.execute({
        action: 'skip',
        eventId: item.eventId,
        attemptId: item.attemptId,
        ownerId: 'owner-2',
        reason: 'llm_no_reply',
      }),
    ).rejects.toThrow('queue lease owner mismatch');
    await runtime.execute({
      action: 'skip',
      eventId: item.eventId,
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      reason: 'llm_no_reply',
    });
    expect(item).toMatchObject({
      status: 'skipped',
      finishReason: 'llm_no_reply',
    });
  });

  it('allows only the active attempt owner to retry leased work', async () => {
    const item = queueItem({
      status: 'preparing',
      leaseOwnerId: 'owner-1',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    await expect(
      runtime.execute({
        action: 'retry',
        eventId: item.eventId,
        attemptId: 'stale-attempt',
        ownerId: 'owner-1',
        reason: 'generation_core_rejected',
      }),
    ).rejects.toThrow('stale queue retry attempt');
    await expect(
      runtime.execute({
        action: 'retry',
        eventId: item.eventId,
        attemptId: item.attemptId,
        ownerId: 'owner-2',
        reason: 'generation_core_rejected',
      }),
    ).rejects.toThrow('queue lease owner mismatch');
    await runtime.execute({
      action: 'retry',
      eventId: item.eventId,
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      reason: 'generation_core_rejected',
    });
    expect(item).toMatchObject({
      status: 'pending',
      attemptId: 'event-1:attempt:2',
      retryCount: 1,
      leaseOwnerId: undefined,
    });
  });

  it('rejects a claimed terminal callback after its lease was already settled', async () => {
    const item = queueItem({
      status: 'speaking',
      leaseOwnerId: 'owner-1',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    await runtime.execute({
      action: 'fail',
      eventId: item.eventId,
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      reason: 'tts_progress_timeout',
    });
    await expect(
      runtime.execute({
        action: 'fail',
        eventId: item.eventId,
        attemptId: item.attemptId,
        ownerId: 'owner-1',
        reason: 'late_playback_error',
      }),
    ).rejects.toThrow('stale queue failure attempt');
    expect(item).toMatchObject({
      status: 'failed',
      finishReason: 'tts_progress_timeout',
    });
  });

  it('clears an obsolete prepared reply when generation returns no reply', async () => {
    const item = queueItem({
      preparedReply: 'obsolete reply',
      status: 'preparing',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    await runtime.execute({
      action: 'ready',
      attemptId: item.attemptId,
      eventId: item.eventId,
      reply: '',
    });

    expect(item.preparedReply).toBe('');
    expect(item.status).toBe('pending');
  });

  it('does not mutate delivery evidence when completion is rejected', async () => {
    const item = queueItem({
      audioByteLength: 10,
      beatCount: 2,
      completedBeatCount: 1,
      leaseOwnerId: 'runtime-a',
      status: 'speaking',
    });
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    await expect(
      runtime.execute({
        action: 'done',
        attemptId: item.attemptId,
        audioByteLength: 20,
        beatCount: 3,
        completedBeatCount: 2,
        eventId: item.eventId,
        ownerId: 'runtime-a',
      }),
    ).rejects.toThrow('cannot finish without complete audio evidence');

    expect(item).toMatchObject({
      audioByteLength: 10,
      beatCount: 2,
      completedBeatCount: 1,
      status: 'speaking',
    });
    expect(writes).toHaveLength(0);
  });

  it('owns retry safety and deletion tombstones', async () => {
    const partial = queueItem({
      eventId: 'partial',
      attemptId: 'partial:attempt:1',
      status: 'speaking',
      leaseOwnerId: 'owner-1',
      completedBeatCount: 1,
    });
    const removable = queueItem({
      eventId: 'removable',
      attemptId: 'removable:attempt:1',
      order: 1,
    });
    const items = new Map<string, OperatorQueueItem>([
      [partial.eventId, partial],
      [removable.eventId, removable],
    ]);
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: items,
      maxRetries: 4,
      store,
    });

    await runtime.execute({
      action: 'retry',
      eventId: 'partial',
      attemptId: partial.attemptId,
      ownerId: partial.leaseOwnerId,
    });
    expect(partial).toMatchObject({
      attemptId: 'partial:attempt:2',
      retryCount: 1,
      status: 'failed',
      finishReason: 'partial_playback_not_retried',
    });

    await runtime.execute({ action: 'delete', eventId: 'removable' });
    expect(removable.status).toBe('deleted');
    expect(runtime.snapshot(false)).toEqual([partial]);
    expect(writes).toHaveLength(2);
    expect(writes[1].map((item) => item.eventId)).toEqual(['partial']);
  });

  it('moves visible items with clamped normalized ordering', async () => {
    const first = queueItem({ eventId: 'first', attemptId: 'first:attempt:1' });
    const second = queueItem({
      eventId: 'second',
      attemptId: 'second:attempt:1',
      order: 1,
    });
    const third = queueItem({
      eventId: 'third',
      attemptId: 'third:attempt:1',
      order: 2,
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([
        [first.eventId, first],
        [second.eventId, second],
        [third.eventId, third],
      ]),
      store,
    });

    await runtime.execute({ action: 'move', eventId: 'first', order: 99 });

    expect(
      runtime.snapshot(false).map((item) => [item.eventId, item.order]),
    ).toEqual([
      ['second', 0],
      ['third', 1],
      ['first', 2],
    ]);
  });

  it('owns operator edits and terminal skip or failure cleanup', async () => {
    let now = 2_000;
    const item = queueItem({
      leaseOwnerId: 'runtime-a',
      leaseExpiresAt: 3_000,
      status: 'preparing',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      now: () => now,
      store,
    });

    await runtime.execute({
      action: 'edit-reply',
      eventId: item.eventId,
      reply: ' operator reply ',
    });
    expect(item).toMatchObject({
      preparedReply: 'operator reply',
      status: 'ready',
    });

    now = 2_010;
    await runtime.execute({ action: 'skip', eventId: item.eventId });
    expect(item).toMatchObject({
      status: 'skipped',
      skipReason: 'llm_no_reply',
      finishReason: 'llm_no_reply',
    });

    now = 2_020;
    await runtime.execute({ action: 'fail', eventId: item.eventId });
    expect(item).toMatchObject({
      status: 'failed',
      finishReason: 'runtime_failed',
      leaseOwnerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: 2_020,
    });
  });

  it('keeps beat progress monotonic unless a replacement plan is explicit', async () => {
    const item = queueItem({
      beatCount: 3,
      completedBeatCount: 2,
      status: 'speaking',
      leaseOwnerId: 'owner-1',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });

    await runtime.execute({
      action: 'beat-progress',
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      beatCount: 1,
      byteLength: 20,
      completedBeatCount: 1,
      eventId: item.eventId,
    });
    expect(item).toMatchObject({
      beatCount: 3,
      completedBeatCount: 2,
      audioByteLength: 20,
    });

    await runtime.execute({
      action: 'beat-progress',
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      beatCount: 1,
      byteLength: 5,
      completedBeatCount: 4,
      eventId: item.eventId,
      replaceBeatPlan: true,
    });
    expect(item).toMatchObject({
      beatCount: 1,
      completedBeatCount: 1,
      audioByteLength: 25,
    });
  });

  it('rejects stale lease, progress and completion callbacks from an older attempt', async () => {
    const item = queueItem({
      attemptId: 'event-1:attempt:2',
      status: 'speaking',
      leaseOwnerId: 'owner-1',
      beatCount: 1,
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });
    const staleClaim = {
      eventId: item.eventId,
      attemptId: 'event-1:attempt:1',
      ownerId: 'owner-1',
    };

    await expect(
      runtime.execute({ action: 'renew-lease', ...staleClaim }),
    ).rejects.toThrow('stale queue lease attempt');
    await expect(
      runtime.execute({
        action: 'beat-progress',
        ...staleClaim,
        beatCount: 1,
        completedBeatCount: 1,
        byteLength: 128,
      }),
    ).rejects.toThrow('stale queue speech progress attempt');
    await expect(
      runtime.execute({
        action: 'done',
        ...staleClaim,
        beatCount: 1,
        completedBeatCount: 1,
        audioByteLength: 128,
      }),
    ).rejects.toThrow('stale queue speech completion attempt');
    expect(item).toMatchObject({
      status: 'speaking',
      attemptId: 'event-1:attempt:2',
    });
    expect(item.completedBeatCount).toBeUndefined();
    expect(item.audioByteLength).toBeUndefined();
  });

  it('records observation metadata and restricts fault consumption to tests', async () => {
    const item = queueItem({
      status: 'preparing',
      leaseOwnerId: 'owner-1',
    });
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      now: () => 4_000,
      store,
    });

    await runtime.execute({
      action: 'claim-interaction-accounting',
      eventId: item.eventId,
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      claimId: 'claim-1',
      effects: ['relationship', 'engagement'],
    });
    await runtime.execute({
      action: 'record-interaction-metrics',
      eventId: item.eventId,
      claimId: 'claim-1',
      otherViewerRelationshipMutated: true,
      relationshipVisitDelta: 2,
    });
    await expect(
      runtime.execute({ action: 'consume-fault', eventId: item.eventId }),
    ).rejects.toThrow('faults are test-only');
    expect(item).toMatchObject({
      interactionObservedAt: 4_000,
      relationshipVisitDelta: 2,
      otherViewerRelationshipMutated: true,
      engagementAppliedAt: 4_000,
    });
    expect(writes).toHaveLength(2);

    item.testRunId = 'run-1';
    await runtime.execute({ action: 'consume-fault', eventId: item.eventId });
    expect(item.faultConsumed).toBe(true);
  });

  it('grants each interaction accounting effect to only one durable claim', async () => {
    const item = queueItem({
      status: 'preparing',
      leaseOwnerId: 'owner-1',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      now: () => 5_000,
      store,
    });

    await runtime.execute({
      action: 'claim-interaction-accounting',
      eventId: item.eventId,
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      claimId: 'claim-a',
      effects: ['relationship', 'engagement'],
    });
    await runtime.execute({
      action: 'claim-interaction-accounting',
      eventId: item.eventId,
      attemptId: item.attemptId,
      ownerId: 'owner-1',
      claimId: 'claim-b',
      effects: ['relationship', 'engagement'],
    });

    expect(item).toMatchObject({
      interactionObservedAt: 5_000,
      engagementAppliedAt: 5_000,
      interactionAccounting: {
        relationship: {
          claimId: 'claim-a',
          attemptId: item.attemptId,
          ownerId: 'owner-1',
          claimedAt: 5_000,
        },
        engagement: {
          claimId: 'claim-a',
          attemptId: item.attemptId,
          ownerId: 'owner-1',
          claimedAt: 5_000,
        },
      },
    });
  });

  it('rejects accounting claims from stale attempts or lease owners', async () => {
    const item = queueItem({
      status: 'preparing',
      leaseOwnerId: 'owner-1',
    });
    const { store } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: new Map([[item.eventId, item]]),
      store,
    });
    const command = {
      action: 'claim-interaction-accounting' as const,
      eventId: item.eventId,
      claimId: 'claim-a',
      effects: ['relationship'] as const,
    };

    await expect(
      runtime.execute({
        ...command,
        attemptId: 'stale-attempt',
        ownerId: 'owner-1',
      }),
    ).rejects.toThrow('stale queue accounting attempt');
    await expect(
      runtime.execute({
        ...command,
        attemptId: item.attemptId,
        ownerId: 'owner-2',
      }),
    ).rejects.toThrow('queue lease owner mismatch');
  });

  it('recovers interrupted work and normalizes legacy persisted order', async () => {
    const speaking = queueItem({
      eventId: 'speaking',
      attemptId: '',
      order: 9,
      status: 'speaking',
      preparedReply: 'prepared',
      retryCount: 2,
    });
    const preparing = queueItem({
      eventId: 'preparing',
      attemptId: '',
      createdAt: 50,
      order: 2,
      status: 'preparing',
    });
    const deleted = queueItem({ eventId: 'deleted' }) as OperatorQueueItem & {
      status: 'deleted';
    };
    deleted.status = 'deleted';
    const { store } = memoryStore([
      speaking,
      preparing,
      deleted as OperatorQueueItem,
    ]);
    const items = new Map<string, OperatorQueueItem>();
    const runtime = createOperatorQueueRuntime({ initialItems: items, store });

    await runtime.restore();

    expect(runtime.snapshot(false)).toMatchObject([
      {
        eventId: 'preparing',
        attemptId: 'preparing:attempt:1',
        order: 0,
        status: 'pending',
      },
      {
        eventId: 'speaking',
        attemptId: 'speaking:attempt:3',
        order: 1,
        status: 'ready',
      },
    ]);
    expect(runtime.get('deleted')).toBeUndefined();
  });

  it('requeues expired leases and persists the recovered snapshot', async () => {
    const now = 5_000;
    const items = new Map<string, OperatorQueueItem>([
      [
        'preparing',
        queueItem({
          eventId: 'preparing',
          order: 1,
          status: 'preparing',
          leaseOwnerId: 'worker-a',
          leaseExpiresAt: now - 1,
        }),
      ],
      [
        'speaking',
        queueItem({
          eventId: 'speaking',
          order: 0,
          status: 'speaking',
          preparedReply: 'ready again',
          leaseOwnerId: 'worker-b',
          leaseExpiresAt: now - 1,
        }),
      ],
    ]);
    const { store, writes } = memoryStore();
    const runtime = createOperatorQueueRuntime({
      initialItems: items,
      now: () => now,
      store,
    });

    expect(runtime.releaseExpiredLeases()).toBe(true);
    await runtime.flushPersistence();

    expect(items.get('preparing')).toMatchObject({
      status: 'pending',
      finishReason: 'lease_expired_requeued',
      leaseOwnerId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    expect(items.get('speaking')).toMatchObject({ status: 'ready' });
    expect(writes).toHaveLength(1);
    expect(writes[0].map((item) => item.eventId)).toEqual([
      'speaking',
      'preparing',
    ]);
  });

  it('reports persistence failures without poisoning later writes', async () => {
    const items = new Map<string, OperatorQueueItem>([
      ['event-1', queueItem()],
    ]);
    let attempt = 0;
    const store: OperatorQueueRuntimeStore = {
      read: async () => undefined,
      write: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('disk unavailable');
      },
    };
    const onPersistenceError = vi.fn();
    const runtime = createOperatorQueueRuntime({
      initialItems: items,
      onPersistenceError,
      store,
    });

    runtime.schedulePersistence();
    await runtime.flushPersistence();
    runtime.schedulePersistence();
    await runtime.flushPersistence();

    expect(onPersistenceError).toHaveBeenCalledOnce();
    expect(attempt).toBe(2);
  });
});
