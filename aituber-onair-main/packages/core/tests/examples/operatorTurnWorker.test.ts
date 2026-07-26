import { describe, expect, it } from 'vitest';
import {
  coordinatorGenerationStagesForReadyTurn,
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
  it('completes generation for a ready turn already selected by the coordinator', () => {
    expect(
      coordinatorGenerationStagesForReadyTurn('proactive-1', 'proactive-1'),
    ).toEqual(['completed']);
  });

  it('starts and completes generation when the ready turn is not active yet', () => {
    expect(
      coordinatorGenerationStagesForReadyTurn('viewer-1', 'gift-1'),
    ).toEqual(['started', 'completed']);
    expect(
      coordinatorGenerationStagesForReadyTurn(undefined, 'gift-1'),
    ).toEqual(['started', 'completed']);
  });

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

  it('recovers a recent unclaimed pending turn after the runtime reconnects', () => {
    const interrupted = item('interrupted-viewer-turn', 'pending', {
      createdAt: 500,
      updatedAt: 900,
      scope: {
        personaId: 'linglan-queen',
        platform: 'bilibili',
        roomId: 'default-room',
        sessionId: 'session-1',
      },
    });

    expect(
      planOperatorTurnWork([interrupted], runtime, 120_000).prepare?.eventId,
    ).toBe('interrupted-viewer-turn');
  });

  it('does not replay an obsolete pending turn after a runtime reconnect', () => {
    const obsolete = item('obsolete-viewer-turn', 'pending', {
      createdAt: 500,
      updatedAt: 900,
      scope: {
        personaId: 'linglan-queen',
        platform: 'bilibili',
        roomId: 'default-room',
        sessionId: 'session-1',
      },
    });

    expect(
      planOperatorTurnWork([obsolete], runtime, 1_000_000).prepare,
    ).toBeNull();
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

  it('settles stale scoped speech left ready before a runtime reconnect', () => {
    const interruptedReady = item('interrupted-ready', 'ready', {
      createdAt: 500,
      preparedReply: 'old generated reply',
      scope: {
        personaId: 'linglan-queen',
        platform: 'bilibili',
        roomId: 'default-room',
        sessionId: 'session-1',
      },
    });

    expect(
      planOperatorTurnWork([interruptedReady], runtime, 60_000).staleReady
        ?.eventId,
    ).toBe('interrupted-ready');
  });

  it('speaks a reply freshly prepared after reconnect even when its chat is old', () => {
    const recoveredReady = item('recovered-ready', 'ready', {
      createdAt: 500,
      updatedAt: 59_000,
      preparedAt: 59_000,
      preparedReply: 'freshly recovered reply',
      scope: {
        personaId: 'linglan-queen',
        platform: 'bilibili',
        roomId: 'default-room',
        sessionId: 'session-1',
      },
    });

    const plan = planOperatorTurnWork([recoveredReady], runtime, 60_000);

    expect(plan.staleReady).toBeNull();
    expect(plan.speak?.eventId).toBe('recovered-ready');
  });

  it('still expires a reply that was prepared before the reconnect', () => {
    const obsoleteReady = item('obsolete-ready', 'ready', {
      createdAt: 500,
      updatedAt: 800,
      preparedAt: 800,
      preparedReply: 'obsolete reply',
      scope: {
        personaId: 'linglan-queen',
        platform: 'bilibili',
        roomId: 'default-room',
        sessionId: 'session-1',
      },
    });

    expect(
      planOperatorTurnWork([obsoleteReady], runtime, 60_000).staleReady
        ?.eventId,
    ).toBe('obsolete-ready');
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
