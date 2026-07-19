import { describe, expect, it, vi } from 'vitest';
import {
  classifyOperatorGenerationFailure,
  recoverOperatorPreparation,
  type OperatorPreparationRecoveryPorts,
} from '../../examples/react-purupuru-app/src/lib/operatorPreparationRecovery';
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
    text: queueItem.text,
    createdAt: queueItem.createdAt,
  });
  return new Map([
    [queueItem.eventId, transitionTurn(pending, 'preparing', 1_500)],
  ]);
}

function ports(current: OperatorQueueItem | undefined) {
  const order: string[] = [];
  const effects: OperatorPreparationRecoveryPorts & { order: string[] } = {
    order,
    listQueue: vi.fn(async () => (current ? [current] : [])),
    mutateQueue: vi.fn(async (_eventId, action) => {
      order.push(`mutate:${action}`);
    }),
    recoverRuntime: vi.fn(() => order.push('recover-runtime')),
    wait: vi.fn(async (ms) => order.push(`wait:${ms}`)),
    emitRuntimeEvent: vi.fn(),
    dispatchLiveHostEvent: vi.fn(),
    incrementStaleCallbacks: vi.fn(),
    incrementCoordinatorRecoveries: vi.fn(),
  };
  return effects;
}

describe('operator preparation recovery', () => {
  it('classifies provider failures once at the recovery seam', () => {
    expect(
      classifyOperatorGenerationFailure(new Error('401 unauthorized api key')),
    ).toEqual({
      reason: 'generation_auth_failed',
      error: '401 unauthorized api key',
      retryable: false,
    });
    expect(
      classifyOperatorGenerationFailure(
        new Error('Assistant response remained truncated after continuation'),
      ),
    ).toEqual({
      reason: 'generation_truncated',
      error: 'Assistant response remained truncated after continuation',
      retryable: false,
    });
    expect(
      classifyOperatorGenerationFailure(new Error('provider disconnected')),
    ).toEqual({
      reason: 'generation_failed',
      error: 'provider disconnected',
      retryable: true,
    });
  });

  it('resets the runtime and retries only the owned attempt after the publication delay', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(queueItem);

    const result = await recoverOperatorPreparation(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        failure: { kind: 'no-draft', chatAccepted: true },
        now: () => 2_000,
      },
      effects,
    );

    expect(result).toEqual({
      status: 'retrying',
      reason: 'generation_completed_without_draft',
    });
    expect(effects.order).toEqual([
      'recover-runtime',
      'wait:750',
      'mutate:retry',
    ]);
    expect(effects.mutateQueue).toHaveBeenCalledWith('event-1', 'retry', {
      attemptId: 'event-1:attempt:1',
      ownerId: 'owner-1',
      reason: 'generation_completed_without_draft',
    });
    expect(turns.get('event-1')).toMatchObject({
      state: 'failed',
      outcomeReason: 'generation_completed_without_draft',
    });
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generation',
        eventId: 'event-1',
        stage: 'failed',
      }),
    );
    expect(effects.incrementCoordinatorRecoveries).toHaveBeenCalledOnce();
  });

  it('terminates a nonretryable generation failure without resetting the runtime', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(queueItem);

    const result = await recoverOperatorPreparation(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        failure: {
          kind: 'no-draft',
          chatAccepted: true,
          captured: {
            reason: 'generation_auth_failed',
            error: 'invalid api key',
            retryable: false,
          },
        },
      },
      effects,
    );

    expect(result).toEqual({
      status: 'failed',
      reason: 'generation_auth_failed',
    });
    expect(effects.mutateQueue).toHaveBeenCalledWith('event-1', 'fail', {
      attemptId: 'event-1:attempt:1',
      ownerId: 'owner-1',
      reason: 'generation_auth_failed',
    });
    expect(effects.recoverRuntime).not.toHaveBeenCalled();
    expect(effects.wait).not.toHaveBeenCalled();
    expect(turns.get('event-1')?.state).toBe('failed');
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledOnce();
  });

  it('ignores a no-draft callback after another attempt owns the queue item', async () => {
    const oldItem = item();
    const newerItem = item({
      attemptId: 'event-1:attempt:2',
      leaseOwnerId: 'owner-2',
    });
    const turns = turnStore(newerItem);
    const effects = ports(newerItem);

    const result = await recoverOperatorPreparation(
      {
        item: oldItem,
        ownerId: 'owner-1',
        turns,
        failure: { kind: 'no-draft', chatAccepted: false },
      },
      effects,
    );

    expect(result).toEqual({
      status: 'ignored',
      reason: 'stale_or_unowned_attempt',
    });
    expect(effects.mutateQueue).not.toHaveBeenCalled();
    expect(effects.recoverRuntime).not.toHaveBeenCalled();
    expect(effects.dispatchLiveHostEvent).not.toHaveBeenCalled();
    expect(turns.get('event-1')).toMatchObject({
      attemptId: 'event-1:attempt:2',
      state: 'preparing',
    });
  });

  it('classifies stale exceptions without releasing a newer coordinator turn', async () => {
    const queueItem = item();
    const effects = ports(queueItem);

    const result = await recoverOperatorPreparation(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns: turnStore(queueItem),
        failure: {
          kind: 'exception',
          error: new Error('stale queue retry attempt'),
        },
      },
      effects,
    );

    expect(result).toEqual({
      status: 'stale',
      reason: 'stale queue retry attempt',
    });
    expect(effects.incrementStaleCallbacks).toHaveBeenCalledOnce();
    expect(effects.emitRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'stale_callback' }),
    );
    expect(effects.listQueue).not.toHaveBeenCalled();
    expect(effects.mutateQueue).not.toHaveBeenCalled();
    expect(effects.dispatchLiveHostEvent).not.toHaveBeenCalled();
  });

  it('durably fails a genuine exception only while the exact attempt is owned', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(queueItem);

    const result = await recoverOperatorPreparation(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        failure: { kind: 'exception', error: new Error('provider exploded') },
        now: () => 2_500,
      },
      effects,
    );

    expect(result).toEqual({
      status: 'failed',
      reason: 'operator_prepare_failed',
    });
    expect(effects.mutateQueue).toHaveBeenCalledWith('event-1', 'fail', {
      attemptId: 'event-1:attempt:1',
      ownerId: 'owner-1',
      reason: 'operator_prepare_failed',
    });
    expect(turns.get('event-1')).toMatchObject({
      state: 'failed',
      outcomeReason: 'operator_prepare_failed',
    });
    expect(effects.emitRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'failed',
        reason: 'operator_prepare_failed',
        error: 'provider exploded',
      }),
    );
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledOnce();
  });

  it('does not release the coordinator when ownership changes during terminal failure', async () => {
    const queueItem = item();
    const turns = turnStore(queueItem);
    const effects = ports(queueItem);
    effects.mutateQueue = vi.fn(async () => {
      throw new Error('stale queue failure attempt');
    });

    const result = await recoverOperatorPreparation(
      {
        item: queueItem,
        ownerId: 'owner-1',
        turns,
        failure: { kind: 'exception', error: new Error('provider exploded') },
      },
      effects,
    );

    expect(result).toEqual({
      status: 'stale',
      reason: 'stale queue failure attempt',
    });
    expect(effects.incrementStaleCallbacks).toHaveBeenCalledOnce();
    expect(turns.get('event-1')?.state).toBe('preparing');
    expect(effects.dispatchLiveHostEvent).not.toHaveBeenCalled();
  });
});
