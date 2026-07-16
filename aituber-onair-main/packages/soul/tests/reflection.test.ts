import { describe, expect, it } from 'vitest';
import {
  InMemorySoulLedger,
  applySoulEvent,
  applySoulReflectionReviewRecord,
  createSoulRuntime,
  hashSoulState,
  replaySoulLedger,
  reviewAndCommitSoulReflection,
  type SoulMutableBeliefKind,
  type SoulReflectionCommitInputV1,
  type SoulReflectionProposalV1,
  type SoulStateV1,
} from '../src/index.js';
import {
  constitution,
  makeEvent,
  makeState,
  profile,
  scope,
} from './fixtures.js';

function observedState(eventId = 'evidence-1'): SoulStateV1 {
  return applySoulEvent(makeState(), profile, makeEvent({ id: eventId })).state;
}

function reflectionProposal(
  state: SoulStateV1,
  overrides: Partial<SoulReflectionProposalV1> = {},
): SoulReflectionProposalV1 {
  return {
    protocolVersion: '1.0',
    id: 'reflection-1',
    profileId: profile.id,
    sourceStateVersion: state.version,
    goalWeightDeltas: [
      {
        goalId: 'be-recognized',
        delta: 0.9,
        evidenceEventIds: ['evidence-1'],
        reasonCode: 'recognition-strategy-helped',
      },
    ],
    beliefProposals: [
      {
        id: 'belief-short-openings-help',
        proposition: 'Short openings may invite more reciprocal conversation.',
        confidence: 0.7,
        evidenceEventIds: ['evidence-1'],
      },
    ],
    canonProposals: [
      {
        id: 'canon-from-reflection',
        canonKey: 'virtual-teacup',
        content: 'I keep a virtual teacup beside my notes.',
        realityClass: 'authored-history',
        impact: 'low',
        evidenceEventIds: ['evidence-1'],
        involvesViewerIds: [],
        domainTags: ['digital-life'],
      },
    ],
    reasonCodes: ['slow-reflection'],
    ...overrides,
  };
}

function commitInput(
  state: SoulStateV1,
  overrides: Partial<SoulReflectionCommitInputV1> = {},
): SoulReflectionCommitInputV1 {
  return {
    proposal: reflectionProposal(state),
    allowedEvidenceEventIds: ['evidence-1'],
    approval: {
      policyId: 'reflection-policy-v1',
      approvalId: 'approval-reflection-1',
      approved: true,
      reasonCode: 'bounded-reflection-approved',
      approvedGoalIds: ['be-recognized'],
      approvedBeliefs: [
        {
          beliefId: 'belief-short-openings-help',
          kind: 'strategy',
          falsifiabilityTest:
            'Compare reciprocal replies after short and long openings.',
        },
      ],
    },
    occurredAt: 3_000,
    ...overrides,
  };
}

describe('slow reflection review and commit', () => {
  it('commits only evidence-backed, policy-approved goal and belief changes', () => {
    const state = observedState();
    const before = structuredClone(state);

    const result = reviewAndCommitSoulReflection(
      state,
      constitution,
      profile,
      commitInput(state),
    );

    expect(result.applied).toBe(true);
    expect(result.record.disposition).toBe('partially-approved');
    expect(result.record.stateHashBefore).toBe(hashSoulState(before));
    expect(result.record.stateHashAfter).toBe(hashSoulState(result.state));
    expect(result.state.goals['be-recognized']?.weight).toBeCloseTo(0.95);
    expect(
      result.state.goals['be-recognized']?.weight -
        (before.goals['be-recognized']?.weight ?? 0),
    ).toBeCloseTo(profile.evolution.maxGoalWeightDeltaPerReflection);
    expect(result.state.goals['be-recognized']?.family).toBe('recognition');
    expect(Object.keys(result.state.goals)).toEqual(Object.keys(before.goals));
    expect(result.state.constitutionId).toBe(before.constitutionId);
    expect(result.state.constitutionHash).toBe(before.constitutionHash);
    expect(result.state.profileId).toBe(before.profileId);
    expect(result.state.profileHash).toBe(before.profileHash);

    const belief = result.state.beliefs['belief-short-openings-help'];
    expect(belief).toMatchObject({
      kind: 'strategy',
      epistemicStatus: 'hypothesis',
      sourceReflectionId: 'reflection-1',
      provenanceEventIds: ['evidence-1'],
    });
    expect(belief?.falsifiabilityTest).toContain('Compare reciprocal replies');
    expect(
      result.record.items.find((item) => item.kind === 'canon'),
    ).toMatchObject({
      disposition: 'rejected',
      reasonCodes: ['canon-requires-separate-review'],
    });
    expect(state).toEqual(before);
  });

  it('records a rejection when evidence is not observed or policy rejects it', () => {
    const state = makeState();
    const input = commitInput(state, {
      allowedEvidenceEventIds: [],
      approval: {
        ...commitInput(state).approval,
        approved: false,
        reasonCode: 'operator-rejected-reflection',
      },
    });

    const result = reviewAndCommitSoulReflection(
      state,
      constitution,
      profile,
      input,
    );

    expect(result.applied).toBe(false);
    expect(result.record.disposition).toBe('rejected');
    expect(result.record.reasonCodes).toEqual(
      expect.arrayContaining([
        'reflection-policy-rejected',
        'evidence-not-allowlisted',
        'evidence-not-observed',
      ]),
    );
    expect(result.state.goals['be-recognized']?.weight).toBe(0.9);
    expect(result.state.beliefs).toEqual({});
    expect(result.state.version).toBe(state.version + 1);
    expect(result.state.processedReflectionIds).toEqual(['reflection-1']);
  });

  it('cannot add goal families or write protected identity and world-fact fields', () => {
    const state = observedState();
    const protectedKind = 'world-fact' as SoulMutableBeliefKind;
    const proposal = {
      ...reflectionProposal(state),
      goalWeightDeltas: [
        {
          goalId: 'become-human',
          delta: 1,
          evidenceEventIds: ['evidence-1'],
          reasonCode: 'model-requested-new-goal',
        },
      ],
      beliefProposals: [
        {
          id: 'weather-now',
          proposition: 'It is raining in the physical world.',
          confidence: 1,
          evidenceEventIds: ['evidence-1'],
        },
        {
          id: 'unfalsifiable-preference',
          proposition: 'This preference can never be wrong.',
          confidence: 1,
          evidenceEventIds: ['evidence-1'],
        },
      ],
      constitutionPatch: { declaredNature: 'human' },
      identity: { personaId: 'different-persona' },
    } as SoulReflectionProposalV1 & {
      constitutionPatch: { declaredNature: string };
      identity: { personaId: string };
    };
    const input = commitInput(state, {
      proposal,
      approval: {
        ...commitInput(state).approval,
        approvedGoalIds: ['become-human'],
        approvedBeliefs: [
          {
            beliefId: 'weather-now',
            kind: protectedKind,
            falsifiabilityTest: 'Check an authoritative weather source.',
          },
          {
            beliefId: 'unfalsifiable-preference',
            kind: 'preference',
            falsifiabilityTest: '',
          },
        ],
      },
    });

    const result = reviewAndCommitSoulReflection(
      state,
      constitution,
      profile,
      input,
    );

    expect(result.applied).toBe(false);
    expect(result.state.goals['become-human']).toBeUndefined();
    expect(result.state.beliefs['weather-now']).toBeUndefined();
    expect(result.state.beliefs['unfalsifiable-preference']).toBeUndefined();
    expect(result.state.scope.personaId).toBe(scope.personaId);
    expect(result.state.constitutionId).toBe(state.constitutionId);
    expect(result.state.constitutionHash).toBe(state.constitutionHash);
    expect(result.record.reasonCodes).toEqual(
      expect.arrayContaining([
        'goal-does-not-exist',
        'belief-kind-protected',
        'belief-not-falsifiable',
      ]),
    );
  });

  it('is idempotent after a reflection id has been reviewed', () => {
    const state = observedState();
    const input = commitInput(state);
    const first = reviewAndCommitSoulReflection(
      state,
      constitution,
      profile,
      input,
    );
    const firstHash = hashSoulState(first.state);

    const duplicate = reviewAndCommitSoulReflection(
      first.state,
      constitution,
      profile,
      { ...input, occurredAt: 9_000 },
    );

    expect(duplicate.applied).toBe(false);
    expect(duplicate.record.disposition).toBe('already-committed');
    expect(hashSoulState(duplicate.state)).toBe(firstHash);
    expect(duplicate.state.processedReflectionIds).toEqual(['reflection-1']);
  });

  it('rejects a review record whose approved mutation was altered', () => {
    const state = observedState();
    const committed = reviewAndCommitSoulReflection(
      state,
      constitution,
      profile,
      commitInput(state),
    );
    const tampered = structuredClone(committed.record);
    const goalItem = tampered.items.find(
      (item) => item.kind === 'goal-weight' && item.disposition === 'approved',
    );
    if (!goalItem || goalItem.kind !== 'goal-weight') {
      throw new Error('Expected an approved goal review item');
    }
    goalItem.resultingWeight = 0.2;

    expect(() =>
      applySoulReflectionReviewRecord(state, profile, tampered),
    ).toThrow('Cannot replay goal reflection');
  });

  it('persists one review record and replays to the exact state hash', async () => {
    const ledger = new InMemorySoulLedger();
    const runtime = createSoulRuntime({
      constitution,
      profile,
      scope,
      ledger,
      now: () => 1_000,
    });
    const event = makeEvent({ id: 'evidence-1' });
    await runtime.observe(event);
    const input = commitInput(runtime.getState());

    const committed = await runtime.commitReflection(input);
    const committedHash = hashSoulState(committed.state);
    const duplicate = await runtime.commitReflection({
      ...input,
      occurredAt: 9_000,
    });

    expect(duplicate.applied).toBe(false);
    expect(duplicate.record).toEqual(committed.record);
    expect(hashSoulState(duplicate.state)).toBe(committedHash);
    expect(
      (await ledger.list({ kinds: ['reflection'] })).filter(
        (entry) => entry.id === 'ledger:reflection-review:reflection-1',
      ),
    ).toHaveLength(1);

    const replayed = await runtime.replay();
    expect(hashSoulState(replayed)).toBe(committedHash);
    expect(replayed.processedReflectionIds).toEqual(['reflection-1']);
  });

  it('ignores non-authoritative model reflection proposal ledger entries', async () => {
    const state = makeState();
    const ledger = new InMemorySoulLedger();
    await ledger.append({
      id: 'ledger:reflection-proposal:reflection-1',
      kind: 'reflection',
      scope,
      occurredAt: 3_000,
      payload: {
        protocolVersion: '1.0',
        recordType: 'reflection-proposal',
        proposal: reflectionProposal(state),
      },
    });

    const replayed = replaySoulLedger(state, profile, await ledger.list());

    expect(hashSoulState(replayed)).toBe(hashSoulState(state));
    expect(replayed.processedReflectionIds).toEqual([]);
  });
});
