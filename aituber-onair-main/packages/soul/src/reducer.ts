import type {
  SemanticEvidenceDimension,
  SemanticProposalV1,
  SoulAffectCauseV1,
  SoulAffectStateV1,
  SoulAppraisalGoalImpactV1,
  SoulAppraisalV1,
  SoulConstitutionV1,
  SoulEventV1,
  SoulGoalEvidenceV1,
  SoulGoalStateV1,
  SoulProfileV1,
  SoulRelationshipStateV1,
  SoulScopeV1,
  SoulStateV1,
  SoulTransitionV1,
} from './contracts.js';
import {
  clamp,
  deepClone,
  deepFreeze,
  hashValue,
  mean,
  unique,
} from './utils.js';

export class SoulScopeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoulScopeMismatchError';
  }
}

export function createImmutableConstitution(
  constitution: SoulConstitutionV1,
): Readonly<SoulConstitutionV1> {
  validateConstitution(constitution);
  return deepFreeze(deepClone(constitution));
}

export function createInitialSoulState(
  constitution: SoulConstitutionV1,
  profile: SoulProfileV1,
  scope: SoulScopeV1,
  now: number,
): SoulStateV1 {
  validateConstitution(constitution);
  validateProfile(constitution, profile);
  if (scope.personaId !== profile.personaId) {
    throw new SoulScopeMismatchError(
      `Profile persona ${profile.personaId} does not match ${scope.personaId}`,
    );
  }

  const goals = Object.fromEntries(
    profile.goals.map((goal) => {
      const satisfaction = clamp(goal.initialSatisfaction);
      return [
        goal.id,
        {
          id: goal.id,
          family: goal.family,
          satisfaction,
          targetSatisfaction: clamp(goal.targetSatisfaction),
          weight: clamp(goal.weight),
          frustration: 0,
          tension: calculateGoalTension(
            satisfaction,
            goal.targetSatisfaction,
            0,
            goal.frustrationSensitivity,
          ),
          lastChangedAt: now,
        } satisfies SoulGoalStateV1,
      ];
    }),
  );

  return {
    protocolVersion: '1.0',
    scope: deepClone(scope),
    profileId: profile.id,
    profileHash: hashValue(profile),
    constitutionId: constitution.id,
    constitutionHash: hashValue(constitution),
    version: 0,
    createdAt: now,
    updatedAt: now,
    goals,
    affect: createNeutralAffect(),
    selfEsteem: 0.55,
    identityCoherence: 1,
    relationships: {},
    beliefs: {},
    commitments: {},
    focus: { since: now },
    ctaFatigue: 0,
    delivery: {
      reservations: {},
      committedDecisionIds: [],
      rolledBackDecisionIds: [],
      outcomeIds: [],
    },
    processedEventIds: [],
    processedReflectionIds: [],
  };
}

export function appraiseSoulEvent(
  state: SoulStateV1,
  profile: SoulProfileV1,
  event: SoulEventV1,
  proposal?: SemanticProposalV1,
): SoulAppraisalV1 {
  assertScope(state.scope, event.scope, 'event');
  if (proposal) {
    assertScope(event.scope, proposal.scope, 'semantic proposal');
    if (proposal.eventId !== event.id) {
      throw new Error('Semantic proposal eventId does not match the event');
    }
  }

  const goalImpacts = collectGoalImpacts(state, profile, event, proposal);
  const weightedCongruence = goalImpacts.map((impact) => {
    const goal = state.goals[impact.goalId];
    if (!goal) return 0;
    const saturationFactor =
      impact.direction > 0 ? 0.15 + goal.tension * 0.85 : 0.55;
    return (
      impact.direction *
      impact.magnitude *
      impact.confidence *
      saturationFactor *
      goal.weight
    );
  });
  const goalWeight = goalImpacts.reduce(
    (sum, impact) => sum + (state.goals[impact.goalId]?.weight ?? 0),
    0,
  );

  const identityRespect = semanticMean(proposal, 'identity-respect', 0, -1, 1);
  const novelty = semanticMean(
    proposal,
    'novelty',
    event.kind === 'silence-tick' ? 0 : 0.25,
  );
  const controllability = semanticMean(proposal, 'controllability', 0.5);
  const socialEvaluation = semanticMean(
    proposal,
    'social-evaluation',
    0,
    -1,
    1,
  );
  const attentionCompetition = semanticMean(
    proposal,
    'attention-competition',
    0,
  );
  const semanticCertainty = semanticMean(
    proposal,
    'certainty',
    proposal?.confidence ?? event.confidence,
  );

  return {
    protocolVersion: '1.0',
    id: `appraisal:${event.id}`,
    eventId: event.id,
    scope: deepClone(event.scope),
    occurredAt: event.occurredAt,
    goalImpacts,
    goalCongruence: clamp(
      goalWeight > 0
        ? weightedCongruence.reduce((sum, value) => sum + value, 0) / goalWeight
        : 0,
      -1,
      1,
    ),
    identityRespect,
    novelty,
    controllability,
    socialEvaluation,
    certainty: clamp(mean([event.confidence, semanticCertainty])),
    attentionCompetition,
    attribution: proposal?.attribution ?? 'unknown',
    reasonCodes: unique([
      ...goalImpacts.map((impact) => impact.reasonCode),
      ...(proposal?.evidence.map((item) => item.reasonCode) ?? []),
    ]),
  };
}

export function applySoulEvent(
  state: SoulStateV1,
  profile: SoulProfileV1,
  event: SoulEventV1,
  proposal?: SemanticProposalV1,
): SoulTransitionV1 {
  const appraisal = appraiseSoulEvent(state, profile, event, proposal);
  if (state.processedEventIds.includes(event.id)) {
    return { applied: false, state: deepClone(state), appraisal };
  }
  return {
    applied: true,
    state: reduceSoulAppraisal(state, profile, event, appraisal),
    appraisal,
  };
}

export function reduceSoulAppraisal(
  state: SoulStateV1,
  profile: SoulProfileV1,
  event: SoulEventV1,
  appraisal: SoulAppraisalV1,
): SoulStateV1 {
  assertScope(state.scope, event.scope, 'event');
  assertScope(event.scope, appraisal.scope, 'appraisal');
  if (appraisal.eventId !== event.id) {
    throw new Error('Appraisal eventId does not match the event');
  }
  if (state.processedEventIds.includes(event.id)) return deepClone(state);

  const elapsedMs = Math.max(0, event.occurredAt - state.updatedAt);
  const next = deepClone(state);
  const goalDefinitions = new Map(
    profile.goals.map((definition) => [definition.id, definition]),
  );

  for (const impact of appraisal.goalImpacts) {
    const goal = next.goals[impact.goalId];
    const definition = goalDefinitions.get(impact.goalId);
    if (!goal || !definition) continue;
    const confidence = clamp(impact.confidence);
    const signedMagnitude = impact.direction * impact.magnitude * confidence;
    const responsiveness = clamp(definition.responsiveness ?? 0.25, 0.05, 1);
    goal.satisfaction = clamp(
      goal.satisfaction + signedMagnitude * responsiveness,
    );
    goal.frustration = clamp(
      impact.direction < 0
        ? goal.frustration +
            impact.magnitude *
              confidence *
              definition.frustrationSensitivity *
              0.2
        : goal.frustration - impact.magnitude * confidence * 0.15,
    );
    goal.tension = calculateGoalTension(
      goal.satisfaction,
      goal.targetSatisfaction,
      goal.frustration,
      definition.frustrationSensitivity,
    );
    goal.lastChangedAt = event.occurredAt;
  }

  next.affect = reduceAffect(state, profile, event, appraisal, elapsedMs);
  next.selfEsteem = clamp(
    state.selfEsteem +
      appraisal.identityRespect * 0.08 +
      appraisal.socialEvaluation * 0.04,
  );
  next.identityCoherence = clamp(
    state.identityCoherence +
      Math.min(0, appraisal.identityRespect) * 0.035 +
      Math.max(0, appraisal.identityRespect) * 0.01,
  );

  if (event.actor?.kind === 'viewer') {
    const key = relationshipScopeKey(event.scope, event.actor.id);
    next.relationships = {
      ...next.relationships,
      [key]: reduceRelationship(
        next.relationships[key],
        key,
        event.actor.id,
        event.occurredAt,
        appraisal,
      ),
    };
  }

  next.ctaFatigue = clamp(
    state.ctaFatigue - Math.min(elapsedMs / 1_800_000, 1) * 0.25,
  );
  next.version = state.version + 1;
  next.updatedAt = Math.max(state.updatedAt, event.occurredAt);
  next.lastAppraisal = deepClone(appraisal);
  next.processedEventIds = [...state.processedEventIds, event.id];
  return next;
}

export function relationshipScopeKey(
  scope: SoulScopeV1,
  viewerId: string,
): string {
  return [scope.personaId, scope.platform, viewerId]
    .map((value) => encodeURIComponent(value))
    .join('|');
}

export function hashSoulState(state: SoulStateV1): string {
  return hashValue(state);
}

export function calculateGoalTension(
  satisfaction: number,
  targetSatisfaction: number,
  frustration: number,
  frustrationSensitivity = 1,
): number {
  return clamp(
    clamp(targetSatisfaction) -
      clamp(satisfaction) +
      clamp(frustration) * clamp(frustrationSensitivity),
  );
}

function collectGoalImpacts(
  state: SoulStateV1,
  profile: SoulProfileV1,
  event: SoulEventV1,
  proposal?: SemanticProposalV1,
): SoulAppraisalGoalImpactV1[] {
  const evidence: SoulGoalEvidenceV1[] = [
    ...(event.goalEvidence ?? []),
    ...(proposal?.evidence
      .filter((item) => item.dimension === 'goal-progress')
      .map((item) => ({
        goalId: item.goalId,
        goalFamily: item.goalFamily,
        direction: item.value >= 0 ? (1 as const) : (-1 as const),
        magnitude: Math.abs(item.value),
        confidence: item.confidence,
        reasonCode: item.reasonCode,
      })) ?? []),
  ];

  const impacts: SoulAppraisalGoalImpactV1[] = [];
  for (const item of evidence) {
    const goals = profile.goals.filter(
      (goal) =>
        (item.goalId !== undefined && goal.id === item.goalId) ||
        (item.goalId === undefined &&
          item.goalFamily !== undefined &&
          goal.family === item.goalFamily),
    );
    for (const goal of goals) {
      if (!state.goals[goal.id]) continue;
      impacts.push({
        goalId: goal.id,
        direction: item.direction,
        magnitude: clamp(item.magnitude),
        confidence: clamp(item.confidence * event.confidence),
        reasonCode: item.reasonCode,
      });
    }
  }
  return impacts;
}

function semanticMean(
  proposal: SemanticProposalV1 | undefined,
  dimension: SemanticEvidenceDimension,
  fallback: number,
  min = 0,
  max = 1,
): number {
  const matching =
    proposal?.evidence.filter((item) => item.dimension === dimension) ?? [];
  if (matching.length === 0) return clamp(fallback, min, max);
  const confidenceTotal = matching.reduce(
    (sum, item) => sum + clamp(item.confidence),
    0,
  );
  if (confidenceTotal === 0) return clamp(fallback, min, max);
  return clamp(
    matching.reduce(
      (sum, item) => sum + item.value * clamp(item.confidence),
      0,
    ) / confidenceTotal,
    min,
    max,
  );
}

function reduceAffect(
  state: SoulStateV1,
  profile: SoulProfileV1,
  event: SoulEventV1,
  appraisal: SoulAppraisalV1,
  elapsedMs: number,
): SoulAffectStateV1 {
  const recovery =
    Math.min(elapsedMs / 600_000, 1) * profile.temperament.recoveryRate;
  const retain = 1 - recovery * 0.6;
  const positive = Math.max(0, appraisal.goalCongruence);
  const negative = Math.max(0, -appraisal.goalCongruence);
  const identityThreat = Math.max(0, -appraisal.identityRespect);
  const positiveSocial = Math.max(0, appraisal.socialEvaluation);
  const negativeSocial = Math.max(0, -appraisal.socialEvaluation);
  const isSilence = event.kind === 'silence-tick';
  const durationMs = numberFromData(event.data, 'durationMs', elapsedMs);
  const selfDirectedEngagement = booleanFromData(
    event.data,
    'selfDirectedEngagement',
  );
  const focusBuffer = selfDirectedEngagement ? 0.2 : 1;
  const boredomTarget = isSilence
    ? Math.min(durationMs / 60_000, 10) * 0.025 * (1 - positive) * focusBuffer
    : 0;
  const socialRelief = isSilence ? 0 : appraisal.novelty * 0.3;
  const boredomDelta = isSilence
    ? (boredomTarget - state.affect.boredom) * 0.5
    : -socialRelief;
  const jealousyGain =
    appraisal.attentionCompetition *
    profile.temperament.socialSensitivity *
    0.25;
  const angerGain =
    (identityThreat * profile.temperament.threatReactivity + negative * 0.25) *
    (1 - profile.temperament.selfRegulation * 0.35);
  const joyGain =
    (positive * 0.65 + positiveSocial * 0.2) *
    profile.temperament.positiveReactivity;

  const affect: SoulAffectStateV1 = {
    valence: clamp(
      state.affect.valence * retain +
        joyGain -
        angerGain -
        negativeSocial * 0.2,
      -1,
      1,
    ),
    arousal: clamp(
      state.affect.arousal * retain +
        Math.abs(appraisal.goalCongruence) * 0.2 +
        identityThreat * 0.25,
    ),
    dominance: clamp(
      state.affect.dominance * retain +
        appraisal.controllability * 0.08 -
        identityThreat * 0.05,
    ),
    joy: clamp(state.affect.joy * retain + joyGain),
    anger: clamp(state.affect.anger * retain + angerGain),
    // `durationMs` is cumulative quiet time, not a new dose. Move toward a
    // duration-derived target so repeated awareness polls converge instead of
    // adding the same silence over and over.
    boredom: clamp(state.affect.boredom + boredomDelta),
    jealousy: clamp(state.affect.jealousy * retain + jealousyGain),
    causes: [],
  };
  affect.causes = [
    ...state.affect.causes.slice(-7),
    ...createAffectCauses(event.id, event.occurredAt, {
      joy: joyGain,
      anger: angerGain,
      boredom: boredomDelta,
      jealousy: jealousyGain,
      valence: joyGain - angerGain - negativeSocial * 0.2,
    }),
  ].slice(-12);
  return affect;
}

function createAffectCauses(
  eventId: string,
  at: number,
  contributions: Partial<Record<SoulAffectCauseV1['dimension'], number>>,
): SoulAffectCauseV1[] {
  return Object.entries(contributions)
    .filter(([, contribution]) => Math.abs(contribution ?? 0) > 0.0001)
    .map(([dimension, contribution]) => ({
      eventId,
      dimension: dimension as SoulAffectCauseV1['dimension'],
      contribution: contribution ?? 0,
      at,
    }));
}

function reduceRelationship(
  current: SoulRelationshipStateV1 | undefined,
  scopeKey: string,
  viewerId: string,
  at: number,
  appraisal: SoulAppraisalV1,
): SoulRelationshipStateV1 {
  const base =
    current ??
    ({
      scopeKey,
      viewerId,
      familiarity: 0,
      trust: 0.5,
      warmth: 0.5,
      respect: 0.5,
      reciprocity: 0.5,
      attentionBalance: 0.5,
      interactionCount: 0,
      lastInteractionAt: at,
    } satisfies SoulRelationshipStateV1);
  return {
    ...base,
    familiarity: clamp(base.familiarity + 0.03 * appraisal.certainty),
    trust: clamp(
      base.trust + appraisal.socialEvaluation * appraisal.certainty * 0.03,
    ),
    warmth: clamp(base.warmth + appraisal.goalCongruence * 0.04),
    respect: clamp(base.respect + appraisal.identityRespect * 0.08),
    reciprocity: clamp(base.reciprocity + appraisal.socialEvaluation * 0.025),
    attentionBalance: clamp(
      base.attentionBalance - appraisal.attentionCompetition * 0.04,
    ),
    interactionCount: base.interactionCount + 1,
    lastInteractionAt: at,
  };
}

function createNeutralAffect(): SoulAffectStateV1 {
  return {
    valence: 0,
    arousal: 0.2,
    dominance: 0.5,
    joy: 0,
    anger: 0,
    boredom: 0,
    jealousy: 0,
    causes: [],
  };
}

function validateConstitution(constitution: SoulConstitutionV1): void {
  if (constitution.declaredNature !== 'digital-being') {
    throw new Error('Soul constitution must disclose a digital identity');
  }
  if (!constitution.truthPolicy.discloseDigitalIdentity) {
    throw new Error('Digital identity disclosure cannot be disabled');
  }
  if (!constitution.id || !constitution.personaId) {
    throw new Error('Soul constitution requires stable identifiers');
  }
  if (constitution.coreValues.length === 0) {
    throw new Error('Soul constitution requires at least one core value');
  }
}

function validateProfile(
  constitution: SoulConstitutionV1,
  profile: SoulProfileV1,
): void {
  if (profile.personaId !== constitution.personaId) {
    throw new Error('Soul profile and constitution personaId must match');
  }
  if (profile.constitutionId !== constitution.id) {
    throw new Error('Soul profile references the wrong constitution');
  }
  const ids = new Set<string>();
  for (const goal of profile.goals) {
    if (ids.has(goal.id)) throw new Error(`Duplicate goal id: ${goal.id}`);
    ids.add(goal.id);
    if (!constitution.allowedGoalFamilies.includes(goal.family)) {
      throw new Error(
        `Goal family is not constitutionally allowed: ${goal.family}`,
      );
    }
  }
}

function assertScope(
  expected: SoulScopeV1,
  actual: SoulScopeV1,
  label: string,
): void {
  const fields: (keyof SoulScopeV1)[] = [
    'personaId',
    'platform',
    'roomId',
    'sessionId',
  ];
  for (const field of fields) {
    if (expected[field] !== actual[field]) {
      throw new SoulScopeMismatchError(
        `${label} ${field} ${actual[field]} does not match ${expected[field]}`,
      );
    }
  }
}

function numberFromData(
  data: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanFromData(
  data: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return data[key] === true;
}
