import { describe, expect, it } from 'vitest';
import type { OutcomeEventV1, SoulDecisionV1 } from '../src/index.js';
import {
  applySoulOutcome,
  commitSoulDecision,
  hashSoulState,
  reserveSoulDecision,
} from '../src/index.js';
import { makeState, scope } from './fixtures.js';

function makeDecision(overrides: Partial<SoulDecisionV1> = {}): SoulDecisionV1 {
  const affect = makeState().affect;
  return {
    protocolVersion: '1.0',
    id: 'decision-1',
    eventId: 'event-1',
    scope,
    sourceStateVersion: 1,
    createdAt: 2_000,
    expiresAt: 10_000,
    action: 'invite-support',
    truthMode: 'literal',
    utterance: 'Stay if this was useful.',
    utility: 1,
    internalAffect: affect,
    expressedAffect: affect,
    goalsServed: ['be-recognized'],
    reasonCodes: ['test'],
    candidateScores: [],
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<OutcomeEventV1> = {}): OutcomeEventV1 {
  return {
    protocolVersion: '1.0',
    id: 'outcome-1',
    decisionId: 'decision-1',
    scope,
    occurredAt: 3_000,
    status: 'spoken',
    ...overrides,
  };
}

describe('delivery reservation semantics', () => {
  it('commits speech-side effects only after fully spoken delivery', () => {
    const decision = makeDecision();
    const reserved = reserveSoulDecision(makeState(), decision, 2_100);
    const queued = applySoulOutcome(
      reserved,
      decision,
      makeOutcome({ id: 'queued', status: 'queued', occurredAt: 2_200 }),
    );

    expect(queued.delivery.reservations[decision.id]).toBeDefined();
    expect(queued.ctaFatigue).toBe(0);
    expect(queued.lastActionAt).toBeUndefined();

    const spoken = applySoulOutcome(
      queued,
      decision,
      makeOutcome({ id: 'spoken', status: 'spoken' }),
    );

    expect(spoken.delivery.reservations[decision.id]).toBeUndefined();
    expect(spoken.delivery.committedDecisionIds).toContain(decision.id);
    expect(spoken.ctaFatigue).toBe(0.45);
    expect(spoken.lastActionAt).toBe(3_000);
  });

  it.each(['failed', 'interrupted', 'partial', 'skipped'] as const)(
    'rolls back a %s delivery without claiming the action happened',
    (status) => {
      const decision = makeDecision();
      const reserved = reserveSoulDecision(makeState(), decision, 2_100);

      const rolledBack = applySoulOutcome(
        reserved,
        decision,
        makeOutcome({
          status,
          deliveredFraction: status === 'partial' ? 0.4 : 0,
        }),
      );

      expect(rolledBack.delivery.reservations[decision.id]).toBeUndefined();
      expect(rolledBack.delivery.rolledBackDecisionIds).toContain(decision.id);
      expect(rolledBack.delivery.committedDecisionIds).not.toContain(
        decision.id,
      );
      expect(rolledBack.ctaFatigue).toBe(0);
      expect(rolledBack.lastActionAt).toBeUndefined();
    },
  );

  it('is idempotent for duplicate reservations and outcomes', () => {
    const decision = makeDecision();
    const once = reserveSoulDecision(makeState(), decision, 2_100);
    const twice = reserveSoulDecision(once, decision, 2_100);
    expect(hashSoulState(twice)).toBe(hashSoulState(once));

    const outcome = makeOutcome();
    const committed = applySoulOutcome(once, decision, outcome);
    const duplicate = applySoulOutcome(committed, decision, outcome);
    expect(hashSoulState(duplicate)).toBe(hashSoulState(committed));
  });

  it('refuses to commit an unreserved decision', () => {
    expect(() =>
      commitSoulDecision(makeState(), makeDecision(), makeOutcome()),
    ).toThrow('reserved');
  });
});
