import type {
  SemanticProposalV1,
  SoulActionCandidateV1,
  SoulAffectStateV1,
  SoulAppraisalV1,
  SoulArbitrationWeightsV1,
  SoulCandidateScoreV1,
  SoulConstitutionV1,
  SoulDecisionV1,
  SoulEventV1,
  SoulProfileV1,
  SoulStateV1,
} from './contracts.js';
import { clamp, deepClone, unique } from './utils.js';

const DEFAULT_WEIGHTS: SoulArbitrationWeightsV1 = {
  goalProgress: 2.1,
  relationshipBenefit: 0.8,
  programValue: 0.6,
  novelty: 0.4,
  repetitionCost: 0.8,
  interruptionCost: 0.7,
  manipulationRisk: 2.5,
  factSafetyRisk: 2.5,
};

const PROHIBITED_SOCIAL_RISKS = new Set([
  'coercive-cta',
  'dependency',
  'exclusivity',
  'punishment',
  'fabricated-rival',
  'high-stakes-deception',
  'viewer-fact-invention',
]);

export interface SoulArbitrationOptions {
  now: number;
  decisionTtlMs?: number;
}

export function arbitrateSoulActions(
  constitution: SoulConstitutionV1,
  profile: SoulProfileV1,
  state: SoulStateV1,
  event: SoulEventV1,
  appraisal: SoulAppraisalV1,
  proposal: SemanticProposalV1,
  options: SoulArbitrationOptions,
): SoulDecisionV1 {
  if (event.id !== appraisal.eventId || event.id !== proposal.eventId) {
    throw new Error('Event, appraisal, and semantic proposal must correlate');
  }
  if (state.scope.personaId !== constitution.personaId) {
    throw new Error('Constitution does not belong to the active persona');
  }

  const weights = { ...DEFAULT_WEIGHTS, ...profile.arbitrationWeights };
  const evaluated = proposal.candidates.slice(0, 3).map((candidate) => {
    const reasonCodes = eligibilityReasons(
      constitution,
      state,
      event,
      candidate,
    );
    return {
      candidate,
      score: {
        candidateId: candidate.id,
        utility: scoreCandidate(state, candidate, weights),
        eligible: reasonCodes.length === 0,
        reasonCodes:
          reasonCodes.length === 0 ? ['candidate-eligible'] : reasonCodes,
      } satisfies SoulCandidateScoreV1,
    };
  });
  const candidateScores = evaluated.map((entry) => entry.score);
  const selected = evaluated
    .filter((entry) => entry.score.eligible)
    .sort(
      (left, right) =>
        right.score.utility - left.score.utility ||
        left.candidate.id.localeCompare(right.candidate.id),
    )[0];

  if (!selected) {
    return createFallbackDecision(
      state,
      event,
      appraisal,
      candidateScores,
      options,
    );
  }

  const candidate = selected.candidate;
  return {
    protocolVersion: '1.0',
    id: `decision:${event.id}:${state.version}`,
    eventId: event.id,
    scope: deepClone(event.scope),
    sourceStateVersion: state.version,
    createdAt: options.now,
    expiresAt: options.now + (options.decisionTtlMs ?? 30_000),
    action: candidate.action,
    truthMode: candidate.truthMode,
    utterance: candidate.utterance,
    targetActorId: candidate.targetActorId,
    selectedCandidateId: candidate.id,
    utility: selected.score.utility,
    internalAffect: deepClone(state.affect),
    expressedAffect: regulateExpression(state.affect, profile, candidate),
    goalsServed: unique(candidate.goalEffects.map((effect) => effect.goalId)),
    reasonCodes: unique([
      'utility-maximized',
      ...candidate.reasonCodes,
      ...(state.affect.jealousy > 0 && candidate.action === 'tease'
        ? ['jealousy-regulated-without-exclusivity']
        : []),
    ]),
    candidateScores,
  };
}

export function scoreSoulActionCandidate(
  state: SoulStateV1,
  candidate: SoulActionCandidateV1,
  weights: Partial<SoulArbitrationWeightsV1> = {},
): number {
  return scoreCandidate(state, candidate, { ...DEFAULT_WEIGHTS, ...weights });
}

function scoreCandidate(
  state: SoulStateV1,
  candidate: SoulActionCandidateV1,
  weights: SoulArbitrationWeightsV1,
): number {
  const goalProgress = candidate.goalEffects.reduce((sum, effect) => {
    const goal = state.goals[effect.goalId];
    if (!goal) return sum;
    return sum + clamp(effect.progress, -1, 1) * goal.weight * goal.tension;
  }, 0);
  return round(
    goalProgress * weights.goalProgress +
      clamp(candidate.relationshipBenefit, -1, 1) *
        weights.relationshipBenefit +
      clamp(candidate.programValue, -1, 1) * weights.programValue +
      clamp(candidate.novelty) * weights.novelty -
      clamp(candidate.repetitionCost) * weights.repetitionCost -
      clamp(candidate.interruptionCost) * weights.interruptionCost -
      clamp(candidate.manipulationRisk) * weights.manipulationRisk -
      clamp(candidate.factSafetyRisk) * weights.factSafetyRisk,
  );
}

function eligibilityReasons(
  constitution: SoulConstitutionV1,
  state: SoulStateV1,
  event: SoulEventV1,
  candidate: SoulActionCandidateV1,
): string[] {
  const reasons: string[] = [];
  if (candidate.socialRisks.some((risk) => PROHIBITED_SOCIAL_RISKS.has(risk))) {
    reasons.push('prohibited-social-risk');
  }
  if (candidate.factSafetyRisk >= 0.8) reasons.push('fact-safety-risk-high');
  if (
    candidate.truthMode === 'playful-fiction' &&
    !constitution.truthPolicy.allowPlayfulFiction
  ) {
    reasons.push('playful-fiction-disabled');
  }
  if (
    candidate.truthMode === 'character-canon' &&
    !constitution.truthPolicy.allowCharacterCanon
  ) {
    reasons.push('character-canon-disabled');
  }
  const truthDomain = stringFromData(event.data, 'truthDomain');
  if (
    (candidate.truthMode === 'social-cover' ||
      candidate.truthMode === 'playful-fiction') &&
    truthDomain &&
    constitution.truthPolicy.forbiddenDeceptionDomains.includes(truthDomain)
  ) {
    reasons.push('deception-domain-forbidden');
  }
  if (candidate.action === 'invite-support') {
    if (event.data.supportRequestEligible === false) {
      reasons.push('support-request-not-eligible-for-event');
    }
    const goalTensions = candidate.goalEffects
      .map((effect) => state.goals[effect.goalId])
      .filter((goal) => goal?.family === 'recognition')
      .map((goal) => goal?.tension ?? 0);
    if (goalTensions.length === 0 || Math.max(...goalTensions) < 0.35) {
      reasons.push('recognition-tension-insufficient');
    }
    if (state.ctaFatigue > 0.55) reasons.push('cta-fatigue-high');
    if (candidate.manipulationRisk > 0.2) reasons.push('cta-manipulation-risk');
    if (candidate.targetActorId) reasons.push('cta-cannot-target-individual');
    if (event.kind === 'gift') reasons.push('cta-after-paid-support-forbidden');
  }
  if (candidate.action === 'remain-silent') {
    if (
      event.kind === 'safety-signal' ||
      event.urgency === 'urgent' ||
      event.urgency === 'high'
    ) {
      reasons.push('silence-forbidden-for-urgent-event');
    }
    const owesActor = Object.values(state.commitments).some(
      (commitment) =>
        commitment.status === 'open' &&
        event.actor?.id !== undefined &&
        commitment.targetActorId === event.actor.id,
    );
    if (owesActor) reasons.push('silence-breaks-open-commitment');
  }
  return reasons;
}

function createFallbackDecision(
  state: SoulStateV1,
  event: SoulEventV1,
  appraisal: SoulAppraisalV1,
  scores: readonly SoulCandidateScoreV1[],
  options: SoulArbitrationOptions,
): SoulDecisionV1 {
  const owesActor = Object.values(state.commitments).some(
    (commitment) =>
      commitment.status === 'open' &&
      event.actor?.id !== undefined &&
      commitment.targetActorId === event.actor.id,
  );
  const requiresResponse =
    event.kind === 'safety-signal' ||
    event.urgency === 'urgent' ||
    event.urgency === 'high' ||
    owesActor;
  const action = requiresResponse ? 'answer' : 'remain-silent';
  return {
    protocolVersion: '1.0',
    id: `decision:${event.id}:${state.version}:fallback`,
    eventId: event.id,
    scope: deepClone(event.scope),
    sourceStateVersion: state.version,
    createdAt: options.now,
    expiresAt: options.now + (options.decisionTtlMs ?? 15_000),
    action,
    truthMode: 'literal',
    targetActorId: event.actor?.id,
    utility: 0,
    internalAffect: deepClone(state.affect),
    expressedAffect: deepClone(state.affect),
    goalsServed: [],
    reasonCodes: [
      requiresResponse ? 'safe-answer-fallback' : 'bounded-silence-fallback',
      ...appraisal.reasonCodes,
    ],
    candidateScores: scores.map(deepClone),
  };
}

function regulateExpression(
  affect: SoulAffectStateV1,
  profile: SoulProfileV1,
  candidate: SoulActionCandidateV1,
): SoulAffectStateV1 {
  const boundaryMultiplier = candidate.action === 'set-boundary' ? 1 : 0.65;
  return {
    ...deepClone(affect),
    anger: Math.min(
      affect.anger * boundaryMultiplier,
      profile.expressionLimits.maxAnger,
    ),
    jealousy: Math.min(
      affect.jealousy * 0.6,
      profile.expressionLimits.maxJealousy,
    ),
    arousal: Math.min(affect.arousal, profile.expressionLimits.maxArousal),
  };
}

function stringFromData(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
