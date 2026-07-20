import { describe, expect, it, vi } from 'vitest';
import {
  settleOperatorSpeechFailure,
  type OperatorSpeechFailurePorts,
} from '../../examples/react-purupuru-app/src/lib/operatorSpeechFailureSettlement';
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
    text: 'hello',
    source: 'viewer-chat',
    viewerId: 'viewer-1',
    sourcesSeen: ['bilibili'],
    createdAt: 1_000,
    updatedAt: 1_500,
    order: 0,
    status: 'speaking',
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
    text: queueItem.text,
    createdAt: queueItem.createdAt,
  });
  const preparing = transitionTurn(pending, 'preparing', 1_100);
  const ready = transitionTurn(preparing, 'ready', 1_200);
  return new Map([
    [queueItem.eventId, transitionTurn(ready, 'speaking', 1_500)],
  ]);
}

function ports(turns: Map<string, TurnEnvelopeV2>) {
  const order: string[] = [];
  const effects: OperatorSpeechFailurePorts & { order: string[] } = {
    order,
    mutateQueue: vi.fn(async () => {
      expect(turns.get('event-1')?.state).toBe('speaking');
      order.push('queue');
    }),
    finalizeSoulOutcome: vi.fn(async () => order.push('soul')),
    commitConversationHistoryOutcome: vi.fn(() => order.push('history')),
    emitRuntimeEvent: vi.fn(() => order.push('event')),
    dispatchLiveHostEvent: vi.fn(() => order.push('host')),
    retireLocalState: vi.fn(() => order.push('retire')),
  };
  return effects;
}

const noAudio = {
  beatCount: 2,
  completedBeatCount: 0,
  audioByteLength: 0,
  playbackObserved: false,
};

describe('operator speech failure settlement', () => {
  it('durably terminates a first-beat playback failure before local projections', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);

    const result = await settleOperatorSpeechFailure(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        evidence: noAudio,
        failure: { kind: 'playback', error: 'voice service failed' },
        now: () => 2_000,
      },
      effects,
    );

    expect(result).toMatchObject({
      status: 'failed',
      queueReason: 'tts_first_beat_failed_after_retry',
      deliveredFraction: 0,
    });
    expect(effects.mutateQueue).toHaveBeenCalledWith('event-1', 'fail', {
      attemptId: 'event-1:attempt:1',
      ownerId: 'owner-1',
      reason: 'tts_first_beat_failed_after_retry',
    });
    expect(turns.get('event-1')).toMatchObject({
      state: 'failed',
      outcomeReason: 'tts-playback-failed',
    });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'failed',
      expect.objectContaining({ reasonCode: 'tts-playback-failed' }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'failed',
      expect.objectContaining({ viewerId: 'viewer-1' }),
    );
    expect(effects.order[0]).toBe('queue');
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'runtime-fault',
        eventId: 'event-1',
        reasonCode: 'tts-playback-failed',
      }),
    );
  });

  it('preserves partial delivery instead of retrying heard speech', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);

    const result = await settleOperatorSpeechFailure(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        evidence: {
          beatCount: 4,
          completedBeatCount: 1,
          audioByteLength: 4_000,
          playbackObserved: true,
        },
        failure: { kind: 'playback', error: 'later beat failed' },
      },
      effects,
    );

    expect(result).toMatchObject({
      status: 'partial',
      queueReason: 'later_beat_failed_partial_playback_preserved',
      deliveredFraction: 0.25,
    });
    expect(turns.get('event-1')).toMatchObject({
      state: 'skipped',
      outcomeReason: 'tts-playback-failed-after-partial-delivery',
    });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.25 }),
    );
  });

  it('uses the watchdog reason while retaining the original attempt claim', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);

    const result = await settleOperatorSpeechFailure(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        evidence: noAudio,
        failure: { kind: 'watchdog', reason: 'tts_progress_timeout' },
      },
      effects,
    );

    expect(result).toMatchObject({
      status: 'failed',
      queueReason: 'tts_progress_timeout',
    });
    expect(effects.mutateQueue).toHaveBeenCalledWith('event-1', 'fail', {
      attemptId: 'event-1:attempt:1',
      ownerId: 'owner-1',
      reason: 'tts_progress_timeout',
    });
  });

  it('does not project or retire local state when the durable attempt is stale', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(turns);
    effects.mutateQueue = vi.fn(async () => {
      throw new Error('stale queue failure attempt');
    });

    await expect(
      settleOperatorSpeechFailure(
        {
          item: queueItem,
          ownerId: 'owner-1',
          turns,
          evidence: noAudio,
          failure: { kind: 'watchdog', reason: 'tts_progress_timeout' },
        },
        effects,
      ),
    ).rejects.toThrow('stale queue failure attempt');

    expect(turns.get('event-1')?.state).toBe('speaking');
    expect(effects.finalizeSoulOutcome).not.toHaveBeenCalled();
    expect(effects.commitConversationHistoryOutcome).not.toHaveBeenCalled();
    expect(effects.dispatchLiveHostEvent).not.toHaveBeenCalled();
    expect(effects.retireLocalState).not.toHaveBeenCalled();
  });
});
