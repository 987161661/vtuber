import { describe, expect, it, vi } from 'vitest';
import { settleScopeTransitionTerminals } from '../../examples/react-purupuru-app/src/lib/scopeTransitionSettlement';
import type { OperatorQueueItem } from '../../examples/react-purupuru-app/src/lib/operatorQueue';
import {
  createTurnEnvelopeV2,
  transitionTurn,
  type TurnEnvelopeV2,
} from '../../examples/react-purupuru-app/src/lib/turnEnvelope';

function turn(
  eventId: string,
  state: 'ready' | 'speaking',
): TurnEnvelopeV2 {
  const pending = createTurnEnvelopeV2({
    eventId,
    attemptId: `${eventId}:attempt:1`,
    source: 'viewer-chat',
    viewerId: `${eventId}-viewer`,
    text: 'hello',
    createdAt: 1_000,
  });
  const preparing = transitionTurn(pending, 'preparing', 1_100);
  const ready = transitionTurn(preparing, 'ready', 1_200);
  return state === 'ready' ? ready : transitionTurn(ready, 'speaking', 1_500);
}

function queueItem(
  eventId: string,
  status: OperatorQueueItem['status'],
): OperatorQueueItem {
  return {
    eventId,
    attemptId: `${eventId}:attempt:1`,
    turnVersion: 2,
    text: 'hello',
    source: 'viewer-chat',
    viewerId: `${eventId}-viewer`,
    sourcesSeen: ['bilibili'],
    createdAt: 1_000,
    updatedAt: 1_500,
    order: 0,
    status,
    leaseOwnerId: 'owner-1',
    skills: [],
  };
}

describe('scope transition settlement', () => {
  it('preserves active partial delivery while skipping an old ready response', async () => {
    const turns = new Map<string, TurnEnvelopeV2>([
      ['active', turn('active', 'speaking')],
      ['ready', turn('ready', 'ready')],
    ]);
    const finalizeSoulOutcome = vi.fn(async () => undefined);
    const commitConversationHistoryOutcome = vi.fn();
    const mutateQueue = vi.fn(async () => undefined);

    const result = await settleScopeTransitionTerminals(
      {
        active: {
          eventId: 'active',
          attemptId: 'active:attempt:1',
          viewerId: 'active-viewer',
          ttsStartAt: 1_600,
        },
        evidence: {
          beatCount: 2,
          completedBeatCount: 1,
          audioByteLength: 512,
          playbackObserved: true,
        },
        capturedEventIds: new Set(['active', 'ready']),
        oldSoulEventIds: ['active', 'ready'],
        oldQueueItems: [
          queueItem('active', 'speaking'),
          queueItem('ready', 'ready'),
        ],
        ownerId: 'owner-1',
        turns,
        at: 2_000,
      },
      {
        mutateQueue,
        finalizeSoulOutcome,
        commitConversationHistoryOutcome,
        emitRuntimeEvent: vi.fn(),
      },
    );

    expect(result.settledEventIds).toEqual(new Set(['active', 'ready']));
    expect(mutateQueue).toHaveBeenCalledWith('active', 'fail', {
      attemptId: 'active:attempt:1',
      ownerId: 'owner-1',
      reason: 'scope_changed_before_delivery',
    });
    expect(mutateQueue).toHaveBeenCalledWith('ready', 'skip', {
      attemptId: 'ready:attempt:1',
      ownerId: 'owner-1',
      reason: 'scope_changed_before_delivery',
    });
    expect(turns.get('active')).toMatchObject({
      state: 'skipped',
      outcomeReason: 'scope-switch-interrupted-delivery',
    });
    expect(turns.get('ready')).toMatchObject({
      state: 'skipped',
      outcomeReason: 'scope-switch-before-delivery',
    });
    expect(finalizeSoulOutcome).toHaveBeenCalledWith(
      'active',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.5 }),
    );
    expect(finalizeSoulOutcome).toHaveBeenCalledWith(
      'ready',
      'skipped',
      expect.objectContaining({ deliveredFraction: 0 }),
    );
    expect(commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'ready',
      'skipped',
      expect.objectContaining({ ttsEndAt: 2_000 }),
    );
  });
});
