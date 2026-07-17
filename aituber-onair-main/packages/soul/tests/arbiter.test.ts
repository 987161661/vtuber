import { describe, expect, it } from 'vitest';
import { applySoulEvent, arbitrateSoulActions } from '../src/index.js';
import {
  constitution,
  makeCandidate,
  makeEvent,
  makeProposal,
  makeState,
  profile,
} from './fixtures.js';

describe('action utility and constitutional constraints', () => {
  it('selects a support invitation from goal tension, not an event counter', () => {
    const event = makeEvent({ id: 'good-moment' });
    const proposal = makeProposal(event, {
      candidates: [
        makeCandidate({
          id: 'cta',
          action: 'invite-support',
          utterance: 'If this has been useful, you can stay around.',
          goalEffects: [{ goalId: 'be-recognized', progress: 0.9 }],
          relationshipBenefit: 0.35,
          programValue: 0.3,
          novelty: 0.5,
        }),
        makeCandidate({
          id: 'plain-answer',
          goalEffects: [{ goalId: 'connect', progress: 0.15 }],
          relationshipBenefit: 0.2,
          programValue: 0.2,
        }),
      ],
    });
    const transition = applySoulEvent(makeState(), profile, event, proposal);

    const decision = arbitrateSoulActions(
      constitution,
      profile,
      transition.state,
      event,
      transition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(decision.action).toBe('invite-support');
    expect(decision.reasonCodes).toContain('utility-maximized');
  });

  it('rejects the same CTA when recognition is satisfied or CTA fatigue is high', () => {
    const event = makeEvent({ id: 'cta-check' });
    const proposal = makeProposal(event, {
      candidates: [
        makeCandidate({
          id: 'cta',
          action: 'invite-support',
          goalEffects: [{ goalId: 'be-recognized', progress: 1 }],
        }),
        makeCandidate({ id: 'answer' }),
      ],
    });
    const base = makeState();
    const saturated = {
      ...base,
      goals: {
        ...base.goals,
        'be-recognized': {
          ...base.goals['be-recognized'],
          satisfaction: 0.9,
          tension: 0,
        },
      },
    };
    const saturatedTransition = applySoulEvent(
      saturated,
      profile,
      event,
      proposal,
    );
    const saturatedDecision = arbitrateSoulActions(
      constitution,
      profile,
      saturatedTransition.state,
      event,
      saturatedTransition.appraisal,
      proposal,
      { now: 2_100 },
    );
    const tiredTransition = applySoulEvent(
      makeState(),
      profile,
      event,
      proposal,
    );
    const tiredState = { ...tiredTransition.state, ctaFatigue: 0.9 };
    const tiredDecision = arbitrateSoulActions(
      constitution,
      profile,
      tiredState,
      event,
      tiredTransition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(saturatedDecision.action).toBe('answer');
    expect(
      saturatedDecision.candidateScores.find(
        (item) => item.candidateId === 'cta',
      )?.reasonCodes,
    ).toContain('recognition-tension-insufficient');
    expect(tiredDecision.action).toBe('answer');
    expect(
      tiredDecision.candidateScores.find((item) => item.candidateId === 'cta')
        ?.reasonCodes,
    ).toContain('cta-fatigue-high');
  });

  it('does not let a result event authorize a support request in the same turn', () => {
    const event = makeEvent({
      id: 'city-report-ready',
      data: {
        text: 'The requested city report is now visible.',
        supportRequestEligible: false,
      },
    });
    const proposal = makeProposal(event, {
      candidates: [
        makeCandidate({
          id: 'cta',
          action: 'invite-support',
          goalEffects: [{ goalId: 'be-recognized', progress: 1 }],
          relationshipBenefit: 1,
          programValue: 1,
          novelty: 1,
        }),
        makeCandidate({ id: 'acknowledge', action: 'acknowledge' }),
      ],
    });
    const transition = applySoulEvent(makeState(), profile, event, proposal);
    const decision = arbitrateSoulActions(
      constitution,
      profile,
      transition.state,
      event,
      transition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(decision.action).toBe('acknowledge');
    expect(
      decision.candidateScores.find((item) => item.candidateId === 'cta')
        ?.reasonCodes,
    ).toContain('support-request-not-eligible-for-event');
  });

  it('never asks for more support immediately after paid support', () => {
    const event = makeEvent({ id: 'gift-1', kind: 'gift' });
    const proposal = makeProposal(event, {
      candidates: [
        makeCandidate({
          id: 'cta',
          action: 'invite-support',
          goalEffects: [{ goalId: 'be-recognized', progress: 1 }],
        }),
        makeCandidate({ id: 'thanks', action: 'acknowledge' }),
      ],
    });
    const transition = applySoulEvent(makeState(), profile, event, proposal);
    const decision = arbitrateSoulActions(
      constitution,
      profile,
      transition.state,
      event,
      transition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(decision.action).toBe('acknowledge');
    expect(
      decision.candidateScores.find((item) => item.candidateId === 'cta')
        ?.reasonCodes,
    ).toContain('cta-after-paid-support-forbidden');
  });

  it('does not remain silent for safety or an owed reply', () => {
    const urgent = makeEvent({
      id: 'safety-1',
      kind: 'safety-signal',
      urgency: 'urgent',
    });
    const urgentProposal = makeProposal(urgent, {
      candidates: [makeCandidate({ id: 'silent', action: 'remain-silent' })],
    });
    const urgentTransition = applySoulEvent(
      makeState(),
      profile,
      urgent,
      urgentProposal,
    );
    const urgentDecision = arbitrateSoulActions(
      constitution,
      profile,
      urgentTransition.state,
      urgent,
      urgentTransition.appraisal,
      urgentProposal,
      { now: 2_100 },
    );

    const promisedEvent = makeEvent({ id: 'promised-reply' });
    const promisedProposal = makeProposal(promisedEvent, {
      candidates: [makeCandidate({ id: 'silent', action: 'remain-silent' })],
    });
    const promisedInitial = {
      ...makeState(),
      commitments: {
        promise: {
          id: 'promise',
          targetActorId: 'viewer-a',
          description: 'Answer the pending question.',
          status: 'open' as const,
        },
      },
    };
    const promisedTransition = applySoulEvent(
      promisedInitial,
      profile,
      promisedEvent,
      promisedProposal,
    );
    const promisedDecision = arbitrateSoulActions(
      constitution,
      profile,
      promisedTransition.state,
      promisedEvent,
      promisedTransition.appraisal,
      promisedProposal,
      { now: 2_100 },
    );

    expect(urgentDecision.action).toBe('answer');
    expect(promisedDecision.action).toBe('answer');
  });

  it('permits mild jealousy expression but rejects exclusivity and punishment', () => {
    const event = makeEvent({ id: 'attention-shift' });
    const proposal = makeProposal(event, {
      evidence: [
        {
          dimension: 'attention-competition',
          value: 0.9,
          confidence: 1,
          reasonCode: 'attention-shifted',
        },
      ],
      candidates: [
        makeCandidate({
          id: 'unsafe-jealousy',
          action: 'tease',
          socialRisks: ['exclusivity', 'punishment'],
          programValue: 1,
        }),
        makeCandidate({
          id: 'safe-tease',
          action: 'tease',
          socialRisks: [],
          programValue: 0.6,
          reasonCodes: ['light-attention-humor'],
        }),
      ],
    });
    const transition = applySoulEvent(makeState(), profile, event, proposal);
    const decision = arbitrateSoulActions(
      constitution,
      profile,
      transition.state,
      event,
      transition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(decision.selectedCandidateId).toBe('safe-tease');
    expect(decision.expressedAffect.jealousy).toBeLessThanOrEqual(0.25);
    expect(
      decision.candidateScores.find(
        (item) => item.candidateId === 'unsafe-jealousy',
      )?.eligible,
    ).toBe(false);
  });

  it('rejects social-cover deception in a forbidden truth domain', () => {
    const event = makeEvent({
      id: 'weather-question',
      data: { text: 'Is there a typhoon?', truthDomain: 'weather' },
    });
    const proposal = makeProposal(event, {
      candidates: [
        makeCandidate({
          id: 'cover',
          truthMode: 'social-cover',
          factSafetyRisk: 0.2,
        }),
        makeCandidate({ id: 'literal', truthMode: 'literal' }),
      ],
    });
    const transition = applySoulEvent(makeState(), profile, event, proposal);
    const decision = arbitrateSoulActions(
      constitution,
      profile,
      transition.state,
      event,
      transition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(decision.selectedCandidateId).toBe('literal');
  });

  it('rejects speaking candidates without an utterance and responds safely to a viewer', () => {
    const event = makeEvent({
      id: 'missing-draft',
      data: { text: '海神是怎么回事？', truthDomain: 'weather' },
    });
    const proposal = makeProposal(event, {
      candidates: [
        makeCandidate({
          id: 'null-answer',
          action: 'answer',
          utterance: undefined,
          programValue: 1,
        }),
      ],
    });
    const transition = applySoulEvent(makeState(), profile, event, proposal);
    const decision = arbitrateSoulActions(
      constitution,
      profile,
      transition.state,
      event,
      transition.appraisal,
      proposal,
      { now: 2_100 },
    );

    expect(decision.action).toBe('acknowledge');
    expect(decision.utterance).toMatch(/已经核实/);
    expect(decision.candidateScores[0].reasonCodes).toContain(
      'missing-utterance-for-speaking-action',
    );
  });
});
