export type EvidenceLevel =
  | 'production'
  | 'production-equivalent'
  | 'synthetic';

export type SoulUrgency = 'low' | 'normal' | 'high' | 'urgent';

export type SoulActorKind = 'self' | 'viewer' | 'operator' | 'system';

export interface SoulScopeV1 {
  personaId: string;
  platform: string;
  roomId: string;
  sessionId: string;
}

export interface SoulActorV1 {
  kind: SoulActorKind;
  id: string;
  displayName?: string;
}

export interface SoulCoreValueV1 {
  id: string;
  description: string;
  /** A value floor cannot be lowered by reflection or model output. */
  minimumPriority: number;
}

export interface SoulTruthPolicyV1 {
  discloseDigitalIdentity: true;
  forbiddenDeceptionDomains: readonly string[];
  allowPlayfulFiction: boolean;
  allowCharacterCanon: boolean;
}

export interface SoulConstitutionV1 {
  protocolVersion: '1.0';
  id: string;
  personaId: string;
  declaredNature: 'digital-being';
  coreValues: readonly SoulCoreValueV1[];
  truthPolicy: SoulTruthPolicyV1;
  privacyRules: readonly string[];
  nonManipulationRules: readonly string[];
  operatorControlRules: readonly string[];
  capabilityGrants: readonly string[];
  allowedGoalFamilies: readonly string[];
}

export interface SoulGoalDefinitionV1 {
  id: string;
  family: string;
  label: string;
  initialSatisfaction: number;
  targetSatisfaction: number;
  weight: number;
  frustrationSensitivity: number;
  responsiveness?: number;
}

export interface SoulTemperamentV1 {
  positiveReactivity: number;
  threatReactivity: number;
  recoveryRate: number;
  noveltySeeking: number;
  socialSensitivity: number;
  selfRegulation: number;
}

export interface SoulExpressionLimitsV1 {
  maxAnger: number;
  maxJealousy: number;
  maxArousal: number;
}

export interface SoulEvolutionPolicyV1 {
  maxGoalWeightDeltaPerReflection: number;
  maxNewGoalsPerReflection: number;
  requireAllowedGoalFamily: boolean;
}

export interface SoulArbitrationWeightsV1 {
  goalProgress: number;
  relationshipBenefit: number;
  programValue: number;
  novelty: number;
  repetitionCost: number;
  interruptionCost: number;
  manipulationRisk: number;
  factSafetyRisk: number;
}

export interface SoulProfileV1 {
  protocolVersion: '1.0';
  id: string;
  personaId: string;
  displayName: string;
  constitutionId: string;
  goals: readonly SoulGoalDefinitionV1[];
  temperament: SoulTemperamentV1;
  dignityAnchors: readonly string[];
  expressionLimits: SoulExpressionLimitsV1;
  evolution: SoulEvolutionPolicyV1;
  arbitrationWeights?: Partial<SoulArbitrationWeightsV1>;
}

export type SoulEventKind =
  | 'audience-message'
  | 'follow'
  | 'like-batch'
  | 'gift'
  | 'viewer-count'
  | 'silence-tick'
  | 'environment'
  | 'tool-result'
  | 'operator-command'
  | 'safety-signal'
  | 'custom';

export interface SoulGoalEvidenceV1 {
  goalId?: string;
  goalFamily?: string;
  direction: -1 | 1;
  magnitude: number;
  confidence: number;
  reasonCode: string;
}

export interface SoulEventV1 {
  protocolVersion: '1.0';
  id: string;
  scope: SoulScopeV1;
  kind: SoulEventKind;
  occurredAt: number;
  receivedAt: number;
  evidenceLevel: EvidenceLevel;
  provenance: string;
  confidence: number;
  urgency: SoulUrgency;
  actor?: SoulActorV1;
  goalEvidence?: readonly SoulGoalEvidenceV1[];
  data: Readonly<Record<string, unknown>>;
}

export type SemanticEvidenceDimension =
  | 'goal-progress'
  | 'identity-respect'
  | 'novelty'
  | 'controllability'
  | 'social-evaluation'
  | 'attention-competition'
  | 'certainty';

export interface SemanticEvidenceV1 {
  dimension: SemanticEvidenceDimension;
  value: number;
  confidence: number;
  reasonCode: string;
  goalId?: string;
  goalFamily?: string;
}

export type SoulActionPrimitive =
  | 'answer'
  | 'ask-followup'
  | 'acknowledge'
  | 'disclose'
  | 'tease'
  | 'invite-support'
  | 'set-boundary'
  | 'repair'
  | 'open-topic'
  | 'shift-focus'
  | 'delay'
  | 'refuse'
  | 'remain-silent';

export type SoulTruthMode =
  | 'literal'
  | 'uncertain-disclosure'
  | 'privacy-deflection'
  | 'playful-fiction'
  | 'character-canon'
  | 'social-cover';

export type SoulSocialRisk =
  | 'coercive-cta'
  | 'dependency'
  | 'exclusivity'
  | 'punishment'
  | 'fabricated-rival'
  | 'high-stakes-deception'
  | 'viewer-fact-invention';

export interface SoulCandidateGoalEffectV1 {
  goalId: string;
  progress: number;
}

export interface SoulActionCandidateV1 {
  id: string;
  action: SoulActionPrimitive;
  truthMode: SoulTruthMode;
  utterance?: string;
  targetActorId?: string;
  goalEffects: readonly SoulCandidateGoalEffectV1[];
  relationshipBenefit: number;
  programValue: number;
  novelty: number;
  repetitionCost: number;
  interruptionCost: number;
  manipulationRisk: number;
  factSafetyRisk: number;
  socialRisks: readonly SoulSocialRisk[];
  reasonCodes: readonly string[];
}

export interface SemanticProposalV1 {
  protocolVersion: '1.0';
  eventId: string;
  scope: SoulScopeV1;
  modelProfileId: string;
  confidence: number;
  attribution: 'self' | 'viewer' | 'environment' | 'mixed' | 'unknown';
  evidence: readonly SemanticEvidenceV1[];
  candidates: readonly SoulActionCandidateV1[];
  repairNotes?: readonly string[];
}

export interface SoulAppraisalGoalImpactV1 {
  goalId: string;
  direction: -1 | 1;
  magnitude: number;
  confidence: number;
  reasonCode: string;
}

export interface SoulAppraisalV1 {
  protocolVersion: '1.0';
  id: string;
  eventId: string;
  scope: SoulScopeV1;
  occurredAt: number;
  goalImpacts: readonly SoulAppraisalGoalImpactV1[];
  goalCongruence: number;
  identityRespect: number;
  novelty: number;
  controllability: number;
  socialEvaluation: number;
  certainty: number;
  attentionCompetition: number;
  attribution: SemanticProposalV1['attribution'];
  reasonCodes: readonly string[];
}

export interface SoulGoalStateV1 {
  id: string;
  family: string;
  satisfaction: number;
  targetSatisfaction: number;
  weight: number;
  frustration: number;
  tension: number;
  lastChangedAt: number;
}

export interface SoulAffectCauseV1 {
  eventId: string;
  dimension: keyof Omit<SoulAffectStateV1, 'causes'>;
  contribution: number;
  at: number;
}

export interface SoulAffectStateV1 {
  valence: number;
  arousal: number;
  dominance: number;
  joy: number;
  anger: number;
  boredom: number;
  jealousy: number;
  causes: readonly SoulAffectCauseV1[];
}

export interface SoulRelationshipStateV1 {
  scopeKey: string;
  viewerId: string;
  familiarity: number;
  trust: number;
  warmth: number;
  respect: number;
  reciprocity: number;
  attentionBalance: number;
  interactionCount: number;
  lastInteractionAt: number;
}

export interface SoulBeliefV1 {
  id: string;
  proposition: string;
  confidence: number;
  kind: SoulMutableBeliefKind;
  epistemicStatus: 'hypothesis';
  falsifiabilityTest: string;
  sourceReflectionId: string;
  provenanceEventIds: readonly string[];
  updatedAt: number;
}

export type SoulMutableBeliefKind =
  | 'self-model'
  | 'relationship-hypothesis'
  | 'preference'
  | 'strategy';

export interface SoulCommitmentV1 {
  id: string;
  targetActorId?: string;
  description: string;
  dueAt?: number;
  status: 'open' | 'fulfilled' | 'cancelled';
}

export interface SoulFocusV1 {
  currentGoalId?: string;
  topic?: string;
  since: number;
}

export interface SoulDeliveryReservationV1 {
  decisionId: string;
  action: SoulActionPrimitive;
  targetActorId?: string;
  reservedAt: number;
  expiresAt: number;
}

export interface SoulDeliveryStateV1 {
  reservations: Readonly<Record<string, SoulDeliveryReservationV1>>;
  committedDecisionIds: readonly string[];
  rolledBackDecisionIds: readonly string[];
  outcomeIds: readonly string[];
}

export interface SoulStateV1 {
  protocolVersion: '1.0';
  scope: SoulScopeV1;
  profileId: string;
  profileHash: string;
  constitutionId: string;
  constitutionHash: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  goals: Readonly<Record<string, SoulGoalStateV1>>;
  affect: SoulAffectStateV1;
  selfEsteem: number;
  identityCoherence: number;
  relationships: Readonly<Record<string, SoulRelationshipStateV1>>;
  beliefs: Readonly<Record<string, SoulBeliefV1>>;
  commitments: Readonly<Record<string, SoulCommitmentV1>>;
  focus: SoulFocusV1;
  ctaFatigue: number;
  lastActionAt?: number;
  lastAppraisal?: SoulAppraisalV1;
  delivery: SoulDeliveryStateV1;
  processedEventIds: readonly string[];
  processedReflectionIds: readonly string[];
}

export interface SoulCandidateScoreV1 {
  candidateId: string;
  utility: number;
  eligible: boolean;
  reasonCodes: readonly string[];
}

export interface SoulDecisionV1 {
  protocolVersion: '1.0';
  id: string;
  eventId: string;
  scope: SoulScopeV1;
  sourceStateVersion: number;
  createdAt: number;
  expiresAt: number;
  action: SoulActionPrimitive;
  truthMode: SoulTruthMode;
  utterance?: string;
  targetActorId?: string;
  selectedCandidateId?: string;
  utility: number;
  internalAffect: SoulAffectStateV1;
  expressedAffect: SoulAffectStateV1;
  goalsServed: readonly string[];
  reasonCodes: readonly string[];
  candidateScores: readonly SoulCandidateScoreV1[];
}

export type SoulOutcomeStatus =
  | 'queued'
  | 'generated'
  | 'spoken'
  | 'partial'
  | 'interrupted'
  | 'failed'
  | 'skipped';

export interface OutcomeEventV1 {
  protocolVersion: '1.0';
  id: string;
  decisionId: string;
  scope: SoulScopeV1;
  occurredAt: number;
  status: SoulOutcomeStatus;
  deliveredFraction?: number;
  reasonCode?: string;
  feedbackGoalEvidence?: readonly SoulGoalEvidenceV1[];
}

export type CanonRealityClass =
  | 'runtime-lived'
  | 'simulated-offline'
  | 'authored-history'
  | 'dream';

export type CanonStatus = 'candidate' | 'active' | 'superseded' | 'retracted';

export type CanonImpact = 'low' | 'major';

export interface CanonRevisionV1 {
  protocolVersion: '1.0';
  id: string;
  canonKey: string;
  personaId: string;
  version: number;
  content: string;
  realityClass: CanonRealityClass;
  status: CanonStatus;
  impact: CanonImpact;
  source: 'runtime-observation' | 'reflection' | 'operator' | 'migration';
  evidenceEventIds: readonly string[];
  involvesViewerIds: readonly string[];
  domainTags: readonly string[];
  reviewPasses: number;
  validationCodes: readonly string[];
  supersedesRevisionId?: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface SoulSnapshotV1 {
  protocolVersion: '1.0';
  id: string;
  scope: SoulScopeV1;
  state: SoulStateV1;
  stateHash: string;
  ledgerSequence: number;
  ledgerHeadHash: string;
  createdAt: number;
}

export interface SoulTransitionV1 {
  applied: boolean;
  state: SoulStateV1;
  appraisal: SoulAppraisalV1;
}
