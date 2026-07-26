import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LiveHostCoordinator, type LiveHostEvent } from '../src/index.js';

type Operation = {
  kind:
    | 'audience'
    | 'quiet'
    | 'generation-started'
    | 'generation-completed'
    | 'generation-failed'
    | 'speech-started'
    | 'speech-completed'
    | 'speech-failed'
    | 'takeover'
    | 'resume'
    | 'fault';
  slot: number;
  advanceMs: number;
};

class VirtualClock {
  now = 0;

  advance(milliseconds: number): number {
    this.now += milliseconds;
    return this.now;
  }
}

const operationArbitrary: fc.Arbitrary<Operation> = fc.record({
  kind: fc.constantFrom(
    'audience',
    'quiet',
    'generation-started',
    'generation-completed',
    'generation-failed',
    'speech-started',
    'speech-completed',
    'speech-failed',
    'takeover',
    'resume',
    'fault',
  ),
  slot: fc.integer({ min: 0, max: 7 }),
  advanceMs: fc.integer({ min: 0, max: 180_000 }),
});

describe('LiveHostCoordinator state-machine properties', () => {
  it('preserves safety and queue invariants across generated event histories', () => {
    fc.assert(
      fc.property(
        fc.array(operationArbitrary, { minLength: 1, maxLength: 200 }),
        (operations) => {
          const maxProactiveTurns = 5;
          const coordinator = new LiveHostCoordinator({
            quietThresholdMs: 0,
            proactiveCooldownMs: 0,
            maxProactiveTurns,
          });
          const clock = new VirtualClock();
          coordinator.dispatch({ type: 'stream-state', at: clock.now, isLive: true });

          operations.forEach((operation, index) => {
            const at = clock.advance(operation.advanceMs);
            const eventId = `turn-${operation.slot}`;
            const event = toEvent(operation, eventId, at, index);
            const actions = coordinator.dispatch(event);
            const snapshot = coordinator.snapshot();

            expect(snapshot.pendingTurnCount ?? 0).toBeGreaterThanOrEqual(0);
            expect(new Set(snapshot.readyTurnIds ?? []).size).toBe(
              (snapshot.readyTurnIds ?? []).length,
            );
            expect(snapshot.proactiveDeliveredCount).toBeGreaterThanOrEqual(0);
            expect(snapshot.proactiveDeliveredCount).toBeLessThanOrEqual(
              maxProactiveTurns,
            );
            expect(snapshot.proactiveRemaining).toBe(
              maxProactiveTurns - snapshot.proactiveDeliveredCount,
            );
            if (snapshot.phase === 'offline') {
              expect(snapshot.activeTurn).toBeUndefined();
              expect(snapshot.pendingTurnCount ?? 0).toBe(0);
            }
            if (snapshot.phase === 'speaking') {
              expect(snapshot.activeTurn).toBeDefined();
            }
            expect(new Set(actions.map((action) => action.actionId)).size).toBe(
              actions.length,
            );
            expect(actions.every((action) => action.issuedAt === at)).toBe(true);
          });
        },
      ),
      { numRuns: 250, endOnFailure: true },
    );
  });
});

function toEvent(
  operation: Operation,
  eventId: string,
  at: number,
  index: number,
): LiveHostEvent {
  const turn = {
    eventId,
    kind: 'viewer' as const,
    priority: 'normal' as const,
    createdAt: Math.max(0, at - operation.advanceMs),
  };
  switch (operation.kind) {
    case 'audience':
      return { type: 'audience-message', at, eventId };
    case 'quiet':
      return {
        type: 'quiet-candidate',
        at,
        eventId,
        opportunityId: `opportunity-${index}`,
        source: 'property-test',
        prompt: 'bounded generated prompt',
        busy: false,
      };
    case 'generation-started':
    case 'generation-completed':
    case 'generation-failed':
      return {
        type: 'generation',
        at,
        eventId,
        stage: operation.kind.replace('generation-', '') as
          | 'started'
          | 'completed'
          | 'failed',
        turn,
      };
    case 'speech-started':
    case 'speech-completed':
    case 'speech-failed':
      return {
        type: 'speech',
        at,
        eventId,
        stage: operation.kind.replace('speech-', '') as
          | 'started'
          | 'completed'
          | 'failed',
      };
    case 'takeover':
      return { type: 'operator-command', at, command: 'takeover' };
    case 'resume':
      return { type: 'operator-command', at, command: 'resume', isLive: true };
    case 'fault':
      return { type: 'runtime-fault', at, eventId, reasonCode: 'injected-fault' };
  }
}
