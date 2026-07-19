import { describe, expect, it } from 'vitest';
import {
  createTurnEnvelopeV2,
  matchesTurnAttempt,
  transitionStoredTurn,
  transitionTurn,
} from '../../examples/react-purupuru-app/src/lib/turnEnvelope';

describe('TurnEnvelopeV2', () => {
  it('keeps late attempts from matching a new event attempt', () => {
    const turn = createTurnEnvelopeV2({
      eventId: 'city:beijing',
      attemptId: 'city:beijing:attempt:2',
      source: 'parent-message',
      text: '北京',
    });
    expect(matchesTurnAttempt(turn, turn.eventId, turn.attemptId)).toBe(true);
    expect(
      matchesTurnAttempt(turn, turn.eventId, 'city:beijing:attempt:1'),
    ).toBe(false);
    expect(matchesTurnAttempt(turn, 'city:nanjing', turn.attemptId)).toBe(
      false,
    );
  });

  it('records terminal reasons without mutating the reserved envelope', () => {
    const turn = createTurnEnvelopeV2({
      eventId: 'x',
      source: 'chat',
      text: 'hi',
      createdAt: 1,
    });
    const skipped = transitionTurn(turn, 'skipped', 2, 'llm_no_reply');
    expect(turn.state).toBe('pending');
    expect(skipped).toMatchObject({
      state: 'skipped',
      outcomeReason: 'llm_no_reply',
      updatedAt: 2,
    });
  });

  it('makes terminal outcomes immutable', () => {
    const pending = createTurnEnvelopeV2({
      eventId: 'chat:terminal',
      source: 'test',
      text: 'hello',
    });
    const failed = transitionTurn(pending, 'failed');
    expect(() => transitionTurn(failed, 'ready')).toThrow(
      'invalid_turn_transition:failed->ready',
    );
  });

  it('advances the current stored state instead of a stale pending snapshot', () => {
    const pending = createTurnEnvelopeV2({
      eventId: 'city:stored',
      attemptId: 'city:stored:attempt:1',
      source: 'parent-message',
      text: '惠州',
    });
    const store = new Map([[pending.eventId, pending]]);
    transitionStoredTurn(
      store,
      pending.eventId,
      pending.attemptId,
      'preparing',
      2,
    );
    const ready = transitionStoredTurn(
      store,
      pending.eventId,
      pending.attemptId,
      'ready',
      3,
    );
    expect(ready).toMatchObject({ state: 'ready', preparingAt: 2, readyAt: 3 });
    expect(store.get(pending.eventId)).toBe(ready);
  });
});
