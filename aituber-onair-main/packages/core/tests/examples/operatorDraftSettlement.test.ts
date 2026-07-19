import { describe, expect, it, vi } from 'vitest';
import {
  settleOperatorDraft,
  type OperatorDraftSettlementPorts,
} from '../../examples/react-purupuru-app/src/lib/operatorDraftSettlement';
import type { OperatorQueueItem } from '../../examples/react-purupuru-app/src/lib/operatorQueue';
import {
  createTurnEnvelopeV2,
  transitionTurn,
  type TurnEnvelopeV2,
} from '../../examples/react-purupuru-app/src/lib/turnEnvelope';

function item(overrides: Partial<OperatorQueueItem> = {}): OperatorQueueItem {
  return {
    eventId: 'event-1',
    attemptId: 'event-1:attempt:1',
    turnVersion: 2,
    text: '你好',
    source: 'viewer-chat',
    sourceLabel: '直播间',
    viewerId: 'viewer-a',
    viewerName: '小雨',
    sourcesSeen: ['bilibili'],
    createdAt: 1_000,
    updatedAt: 1_500,
    order: 0,
    status: 'preparing',
    leaseOwnerId: 'owner-1',
    skills: [],
    ...overrides,
  };
}

function turnStore(queueItem: OperatorQueueItem): Map<string, TurnEnvelopeV2> {
  const pending = createTurnEnvelopeV2({
    eventId: queueItem.eventId,
    attemptId: queueItem.attemptId,
    source: queueItem.source,
    viewerId: queueItem.viewerId,
    viewerName: queueItem.viewerName,
    text: queueItem.text,
    createdAt: queueItem.createdAt,
  });
  return new Map([
    [queueItem.eventId, transitionTurn(pending, 'preparing', 1_500)],
  ]);
}

function ports(
  store: Map<string, TurnEnvelopeV2>,
): OperatorDraftSettlementPorts & {
  mutations: Array<{
    eventId: string;
    action: string;
    extra?: Record<string, unknown>;
  }>;
  runtimeEvents: Array<Record<string, unknown>>;
} {
  const mutations: Array<{
    eventId: string;
    action: string;
    extra?: Record<string, unknown>;
  }> = [];
  const runtimeEvents: Array<Record<string, unknown>> = [];
  return {
    mutations,
    runtimeEvents,
    mutateQueue: vi.fn(async (eventId, action, extra) => {
      expect(store.get(eventId)?.state).toBe('preparing');
      mutations.push({ eventId, action, extra });
    }),
    refreshQueue: vi.fn(async () => undefined),
    emitRuntimeEvent: vi.fn((event) => runtimeEvents.push(event)),
    dispatchLiveHostEvent: vi.fn(),
    incrementCoordinatorRecoveries: vi.fn(),
  };
}

describe('operator draft settlement', () => {
  it('commits a ready draft durably before exposing the local ready state', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);

    const result = await settleOperatorDraft(
      {
        item: queueItem,
        ownerId: 'owner-1',
        reply: '晚上好，小雨。',
        skills: ['conversation'],
        speechPlan: { version: 2, beats: [{ text: '晚上好，小雨。' }] },
        scopeIsCurrent: true,
        turns,
        now: () => 2_000,
      },
      effects,
    );

    expect(result).toEqual({ status: 'ready' });
    expect(effects.mutations).toEqual([
      {
        eventId: 'event-1',
        action: 'ready',
        extra: {
          attemptId: 'event-1:attempt:1',
          reply: '晚上好，小雨。',
          skills: ['conversation'],
          speechPlan: {
            version: 2,
            beats: [{ text: '晚上好，小雨。' }],
          },
        },
      },
    ]);
    expect(turns.get('event-1')?.state).toBe('ready');
    expect(effects.runtimeEvents).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        attemptId: 'event-1:attempt:1',
        stage: 'generated',
        preparedReply: '晚上好，小雨。',
      }),
    ]);
  });

  it('turns a no-reply draft into an attempt-owned terminal skip', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);

    const result = await settleOperatorDraft(
      {
        item: queueItem,
        ownerId: 'owner-1',
        reply: '[[NO_REPLY]]',
        noReplyToken: '[[NO_REPLY]]',
        skills: [],
        scopeIsCurrent: true,
        turns,
        now: () => 2_100,
      },
      effects,
    );

    expect(result).toEqual({ status: 'skipped' });
    expect(effects.mutations).toEqual([
      {
        eventId: 'event-1',
        action: 'skip',
        extra: {
          attemptId: 'event-1:attempt:1',
          ownerId: 'owner-1',
          reason: 'llm_no_reply',
        },
      },
    ]);
    expect(turns.get('event-1')).toMatchObject({
      state: 'skipped',
      outcomeReason: 'llm_no_reply',
    });
    expect(effects.runtimeEvents).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        attemptId: 'event-1:attempt:1',
        stage: 'dropped',
        reason: 'llm_no_reply',
      }),
    ]);
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generation',
        eventId: 'event-1',
        stage: 'failed',
      }),
    );
    expect(effects.incrementCoordinatorRecoveries).toHaveBeenCalledOnce();
  });

  it('rejects a draft after its Soul scope changes and releases the turn', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);

    const result = await settleOperatorDraft(
      {
        item: queueItem,
        ownerId: 'owner-1',
        reply: '迟到的回复',
        skills: [],
        scopeIsCurrent: false,
        turns,
        now: () => 2_200,
      },
      effects,
    );

    expect(result).toEqual({ status: 'scope-rejected' });
    expect(effects.mutations).toEqual([
      {
        eventId: 'event-1',
        action: 'fail',
        extra: {
          attemptId: 'event-1:attempt:1',
          ownerId: 'owner-1',
          reason: 'scope_changed_before_draft_commit',
        },
      },
    ]);
    expect(turns.get('event-1')).toMatchObject({
      state: 'failed',
      outcomeReason: 'scope_changed_before_draft_commit',
    });
    expect(effects.runtimeEvents).toEqual([
      expect.objectContaining({
        stage: 'failed',
        reason: 'scope_changed_before_draft_commit',
      }),
    ]);
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generation',
        eventId: 'event-1',
        stage: 'failed',
      }),
    );
  });

  it('keeps the local turn preparing when the durable commit rejects a stale attempt', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);
    effects.mutateQueue = vi.fn(async () => {
      throw new Error('stale queue generation attempt');
    });

    await expect(
      settleOperatorDraft(
        {
          item: queueItem,
          ownerId: 'owner-1',
          reply: '迟到的回复',
          skills: [],
          scopeIsCurrent: true,
          turns,
        },
        effects,
      ),
    ).rejects.toThrow('stale queue generation attempt');

    expect(turns.get('event-1')?.state).toBe('preparing');
    expect(effects.runtimeEvents).toEqual([]);
    expect(effects.dispatchLiveHostEvent).not.toHaveBeenCalled();
  });

  it('keeps a successful durable commit authoritative when the local projection is stale', async () => {
    const queueItem = item();
    const newerItem = item({ attemptId: 'event-1:attempt:2' });
    const turns = turnStore(newerItem);
    const effects = ports(turns);

    const result = await settleOperatorDraft(
      {
        item: queueItem,
        ownerId: 'owner-1',
        reply: '已持久化的回复',
        skills: [],
        scopeIsCurrent: true,
        turns,
        now: () => 2_300,
      },
      effects,
    );

    expect(result).toEqual({ status: 'ready' });
    expect(turns.get('event-1')).toMatchObject({
      attemptId: 'event-1:attempt:2',
      state: 'preparing',
    });
    expect(effects.runtimeEvents).toEqual([
      expect.objectContaining({
        stage: 'turn_projection_failed',
        reason: 'stale_turn_attempt:event-1:event-1:attempt:1',
      }),
      expect.objectContaining({ stage: 'generated' }),
    ]);
  });
});
