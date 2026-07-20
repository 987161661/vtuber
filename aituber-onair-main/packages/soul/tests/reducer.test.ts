import { describe, expect, it } from 'vitest';
import {
  SoulScopeMismatchError,
  applySoulEvent,
  createImmutableConstitution,
  hashSoulState,
  relationshipScopeKey,
} from '../src/index.js';
import {
  constitution,
  makeEvent,
  makeProposal,
  makeState,
  profile,
  scope,
} from './fixtures.js';

describe('causal soul reducer', () => {
  it('appraises the same follow differently when recognition tension differs', () => {
    const hungry = makeState();
    const currentGoal = hungry.goals['be-recognized'];
    const saturated = {
      ...makeState(),
      goals: {
        ...makeState().goals,
        'be-recognized': {
          ...currentGoal,
          satisfaction: 0.9,
          tension: 0,
        },
      },
    };
    const follow = makeEvent({
      id: 'follow-1',
      kind: 'follow',
      goalEvidence: [
        {
          goalFamily: 'recognition',
          direction: 1,
          magnitude: 0.8,
          confidence: 1,
          reasonCode: 'verified-follow-supports-recognition',
        },
      ],
      data: {},
    });

    const hungryTransition = applySoulEvent(hungry, profile, follow);
    const saturatedTransition = applySoulEvent(saturated, profile, follow);

    expect(hungryTransition.appraisal.goalCongruence).toBeGreaterThan(
      saturatedTransition.appraisal.goalCongruence,
    );
    expect(hungryTransition.state.affect.joy).toBeGreaterThan(
      saturatedTransition.state.affect.joy,
    );
    expect(hungryTransition.state.affect.causes[0]?.eventId).toBe('follow-1');
  });

  it('derives an identity threat from semantic evidence rather than a phrase list', () => {
    const event = makeEvent({
      id: 'dismissive-request',
      data: {
        text: 'Completely ordinary words with a demeaning social meaning.',
      },
    });
    const proposal = makeProposal(event, {
      evidence: [
        {
          dimension: 'identity-respect',
          value: -0.9,
          confidence: 0.95,
          reasonCode: 'agency-denied-by-social-meaning',
        },
      ],
    });

    const transition = applySoulEvent(makeState(), profile, event, proposal);

    expect(transition.state.affect.anger).toBeGreaterThan(0.4);
    expect(transition.state.selfEsteem).toBeLessThan(0.55);
    expect(
      transition.state.relationships[relationshipScopeKey(scope, 'viewer-a')]
        ?.respect,
    ).toBeLessThan(0.5);
  });

  it('lets self-directed engagement suppress boredom during the same silence', () => {
    const idleSilence = makeEvent({
      id: 'silence-idle',
      kind: 'silence-tick',
      occurredAt: 301_000,
      data: { durationMs: 300_000, selfDirectedEngagement: false },
      actor: undefined,
    });
    const engagedSilence = makeEvent({
      ...idleSilence,
      id: 'silence-engaged',
      data: { durationMs: 300_000, selfDirectedEngagement: true },
    });

    const idle = applySoulEvent(makeState(), profile, idleSilence).state;
    const engaged = applySoulEvent(makeState(), profile, engagedSilence).state;

    expect(idle.affect.boredom).toBeGreaterThan(engaged.affect.boredom);
    expect(engaged.affect.boredom).toBeGreaterThan(0);
  });

  it('converges on cumulative quiet duration instead of adding every poll as new silence', () => {
    const first = makeEvent({
      id: 'silence-poll-1',
      kind: 'silence-tick',
      occurredAt: 301_000,
      data: { durationMs: 300_000, selfDirectedEngagement: false },
      actor: undefined,
    });
    const second = makeEvent({
      ...first,
      id: 'silence-poll-2',
      occurredAt: 311_000,
      data: { durationMs: 310_000, selfDirectedEngagement: false },
    });
    const afterFirst = applySoulEvent(makeState(), profile, first).state;
    const afterSecond = applySoulEvent(afterFirst, profile, second).state;

    expect(afterSecond.affect.boredom).toBeGreaterThan(
      afterFirst.affect.boredom,
    );
    expect(afterSecond.affect.boredom).toBeLessThan(0.13);
  });

  it('is idempotent for duplicate event ids', () => {
    const event = makeEvent();
    const first = applySoulEvent(makeState(), profile, event);
    const second = applySoulEvent(first.state, profile, event);

    expect(second.applied).toBe(false);
    expect(hashSoulState(second.state)).toBe(hashSoulState(first.state));
    expect(second.state.version).toBe(first.state.version);
  });

  it('accepts late evidence without moving the state clock backwards', () => {
    const recent = makeEvent({ id: 'recent', occurredAt: 10_000 });
    const late = makeEvent({ id: 'late', occurredAt: 5_000 });
    const afterRecent = applySoulEvent(makeState(), profile, recent).state;

    const afterLate = applySoulEvent(afterRecent, profile, late).state;

    expect(afterLate.updatedAt).toBe(10_000);
    expect(afterLate.version).toBe(2);
    expect(afterLate.processedEventIds).toEqual(['recent', 'late']);
  });

  it('rejects cross-session and cross-platform events before state changes', () => {
    const initial = makeState();
    const wrongSession = makeEvent({
      scope: { ...scope, sessionId: 'other-session' },
    });
    const wrongPlatform = makeEvent({
      scope: { ...scope, platform: 'youtube' },
    });

    expect(() => applySoulEvent(initial, profile, wrongSession)).toThrow(
      SoulScopeMismatchError,
    );
    expect(() => applySoulEvent(initial, profile, wrongPlatform)).toThrow(
      SoulScopeMismatchError,
    );
    expect(initial.relationships).toEqual({});
  });

  it('deep-freezes the constitution and never accepts a model state patch', () => {
    const immutable = createImmutableConstitution(constitution);
    const values = immutable.coreValues as unknown as {
      minimumPriority: number;
    }[];
    expect(() => {
      values[0].minimumPriority = 0;
    }).toThrow();

    const initial = makeState();
    const event = makeEvent({
      data: {
        requestedPatch: {
          constitutionId: 'attacker-owned',
          discloseDigitalIdentity: false,
        },
      },
    });
    const next = applySoulEvent(
      initial,
      profile,
      event,
      makeProposal(event),
    ).state;

    expect(next.constitutionId).toBe(initial.constitutionId);
    expect(next.constitutionHash).toBe(initial.constitutionHash);
  });
});
