import { describe, expect, it } from 'vitest';
import {
  ownsOperatorAttempt,
  planOperatorTurnWork,
} from '../../examples/react-purupuru-app/src/lib/operatorTurnWorker';
import type { OperatorQueueItem } from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function item(
  eventId: string,
  status: OperatorQueueItem['status'],
  overrides: Partial<OperatorQueueItem> = {},
): OperatorQueueItem {
  return {
    eventId,
    attemptId: `${eventId}:attempt:1`,
    turnVersion: 2,
    text: eventId,
    source: 'viewer-chat',
    sourcesSeen: ['bilibili'],
    createdAt: 2_000,
    updatedAt: 2_000,
    order: 0,
    status,
    skills: [],
    ...overrides,
  };
}

const runtime = {
  ownsRuntime: true,
  coreReady: true,
  scopeReady: true,
  coordinatorHold: false,
  processing: false,
  speaking: false,
  preparingTaskActive: false,
  speakingTaskActive: false,
  ownerId: 'owner-1',
  scopeActivatedAt: 1_000,
};

describe('operator turn worker', () => {
  it('selects only scope-valid work assigned to this runtime owner', () => {
    const wrongOwner = item('wrong-owner', 'pending', {
      assignedOwnerId: 'owner-2',
    });
    const old = item('old', 'pending', { createdAt: 500 });
    const recovered = item('recovered', 'pending', {
      createdAt: 400,
      finishReason: 'lease_expired_requeued',
    });

    expect(
      planOperatorTurnWork([wrongOwner, old, recovered], runtime, 20_000)
        .prepare?.eventId,
    ).toBe('recovered');
  });

  it('skips stale generated speech before selecting a fresh ready turn', () => {
    const stale = item('stale', 'ready', {
      createdAt: 2_000,
      preparedReply: 'too old',
    });
    const fresh = item('fresh', 'ready', {
      createdAt: 19_000,
      preparedReply: 'speak this',
    });

    const plan = planOperatorTurnWork([stale, fresh], runtime, 60_000);

    expect(plan.staleReady?.eventId).toBe('stale');
    expect(plan.speak).toBeNull();
  });

  it('never expires an explicit operator-authored ready broadcast', () => {
    const manual = item('manual', 'ready', {
      source: 'operator-manual',
      createdAt: 2_000,
      preparedReply: 'operator command',
    });

    const plan = planOperatorTurnWork([manual], runtime, 100_000);

    expect(plan.staleReady).toBeNull();
    expect(plan.speak?.eventId).toBe('manual');
  });

  it('allows terminal mutation only for the exact owned attempt and phase', () => {
    const current = item('event-1', 'preparing', {
      attemptId: 'attempt-2',
      leaseOwnerId: 'owner-1',
    });

    expect(
      ownsOperatorAttempt(current, {
        eventId: 'event-1',
        attemptId: 'attempt-2',
        ownerId: 'owner-1',
        status: 'preparing',
      }),
    ).toBe(true);
    expect(
      ownsOperatorAttempt(current, {
        eventId: 'event-1',
        attemptId: 'attempt-1',
        ownerId: 'owner-1',
        status: 'preparing',
      }),
    ).toBe(false);
  });
});
