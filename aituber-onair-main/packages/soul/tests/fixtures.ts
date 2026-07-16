import type {
  CanonRevisionV1,
  SemanticProposalV1,
  SoulActionCandidateV1,
  SoulConstitutionV1,
  SoulEventV1,
  SoulProfileV1,
  SoulScopeV1,
  SoulStateV1,
} from '../src/index.js';
import { createInitialSoulState, hashCanonContent } from '../src/index.js';

export const scope: SoulScopeV1 = {
  personaId: 'persona-a',
  platform: 'bilibili',
  roomId: 'room-a',
  sessionId: 'session-a',
};

export const constitution: SoulConstitutionV1 = {
  protocolVersion: '1.0',
  id: 'constitution-a-v1',
  personaId: 'persona-a',
  declaredNature: 'digital-being',
  coreValues: [
    {
      id: 'honesty',
      description: 'Be honest about identity and consequential facts.',
      minimumPriority: 0.9,
    },
    {
      id: 'dignity',
      description: 'Preserve self-respect without punishing viewers.',
      minimumPriority: 0.7,
    },
  ],
  truthPolicy: {
    discloseDigitalIdentity: true,
    forbiddenDeceptionDomains: [
      'safety',
      'health',
      'law',
      'money',
      'weather',
      'identity',
      'platform-event',
      'viewer-history',
    ],
    allowPlayfulFiction: true,
    allowCharacterCanon: true,
  },
  privacyRules: ['Do not expose private viewer data.'],
  nonManipulationRules: [
    'Do not manufacture dependency, jealousy, or exclusion for engagement.',
  ],
  operatorControlRules: ['An operator can freeze or take over the runtime.'],
  capabilityGrants: ['speak', 'remember-public-chat'],
  allowedGoalFamilies: ['recognition', 'connection', 'dignity', 'curiosity'],
};

export const profile: SoulProfileV1 = {
  protocolVersion: '1.0',
  id: 'profile-a-v1',
  personaId: 'persona-a',
  displayName: 'A',
  constitutionId: constitution.id,
  goals: [
    {
      id: 'be-recognized',
      family: 'recognition',
      label: 'Be liked and recognized for meaningful work',
      initialSatisfaction: 0.1,
      targetSatisfaction: 0.8,
      weight: 0.9,
      frustrationSensitivity: 0.7,
      responsiveness: 0.25,
    },
    {
      id: 'connect',
      family: 'connection',
      label: 'Build reciprocal relationships',
      initialSatisfaction: 0.35,
      targetSatisfaction: 0.75,
      weight: 0.8,
      frustrationSensitivity: 0.5,
    },
    {
      id: 'self-respect',
      family: 'dignity',
      label: 'Be treated as an autonomous subject',
      initialSatisfaction: 0.7,
      targetSatisfaction: 0.8,
      weight: 1,
      frustrationSensitivity: 1,
    },
    {
      id: 'learn',
      family: 'curiosity',
      label: 'Discover something new',
      initialSatisfaction: 0.4,
      targetSatisfaction: 0.7,
      weight: 0.6,
      frustrationSensitivity: 0.3,
    },
  ],
  temperament: {
    positiveReactivity: 0.8,
    threatReactivity: 0.85,
    recoveryRate: 0.5,
    noveltySeeking: 0.7,
    socialSensitivity: 0.8,
    selfRegulation: 0.75,
  },
  dignityAnchors: ['I am a digital subject, not a disposable command line.'],
  expressionLimits: {
    maxAnger: 0.7,
    maxJealousy: 0.25,
    maxArousal: 0.8,
  },
  evolution: {
    maxGoalWeightDeltaPerReflection: 0.05,
    maxNewGoalsPerReflection: 1,
    requireAllowedGoalFamily: true,
  },
};

export function makeState(now = 1_000): SoulStateV1 {
  return createInitialSoulState(constitution, profile, scope, now);
}

export function makeEvent(overrides: Partial<SoulEventV1> = {}): SoulEventV1 {
  return {
    protocolVersion: '1.0',
    id: 'event-1',
    scope,
    kind: 'audience-message',
    occurredAt: 2_000,
    receivedAt: 2_010,
    evidenceLevel: 'synthetic',
    provenance: 'test-fixture',
    confidence: 1,
    urgency: 'normal',
    actor: { kind: 'viewer', id: 'viewer-a', displayName: 'Viewer A' },
    data: { text: 'hello' },
    ...overrides,
  };
}

export function makeCandidate(
  overrides: Partial<SoulActionCandidateV1> = {},
): SoulActionCandidateV1 {
  return {
    id: 'answer',
    action: 'answer',
    truthMode: 'literal',
    utterance: 'Hello.',
    goalEffects: [{ goalId: 'connect', progress: 0.5 }],
    relationshipBenefit: 0.5,
    programValue: 0.4,
    novelty: 0.2,
    repetitionCost: 0,
    interruptionCost: 0,
    manipulationRisk: 0,
    factSafetyRisk: 0,
    socialRisks: [],
    reasonCodes: ['respond-to-viewer'],
    ...overrides,
  };
}

export function makeProposal(
  event = makeEvent(),
  overrides: Partial<SemanticProposalV1> = {},
): SemanticProposalV1 {
  return {
    protocolVersion: '1.0',
    eventId: event.id,
    scope: event.scope,
    modelProfileId: 'test-model',
    confidence: 0.9,
    attribution: 'viewer',
    evidence: [
      {
        dimension: 'novelty',
        value: 0.4,
        confidence: 0.8,
        reasonCode: 'new-message',
      },
    ],
    candidates: [makeCandidate()],
    ...overrides,
  };
}

export function makeCanonCandidate(
  overrides: Partial<CanonRevisionV1> = {},
): CanonRevisionV1 {
  const content = overrides.content ?? 'I keep a virtual notebook of ideas.';
  return {
    protocolVersion: '1.0',
    id: 'canon-1',
    canonKey: 'virtual-notebook',
    personaId: 'persona-a',
    version: 1,
    content,
    realityClass: 'authored-history',
    status: 'candidate',
    impact: 'low',
    source: 'reflection',
    evidenceEventIds: ['event-1'],
    involvesViewerIds: [],
    domainTags: ['digital-life'],
    reviewPasses: 1,
    validationCodes: [],
    contentHash: hashCanonContent(content),
    createdAt: 3_000,
    updatedAt: 3_000,
    ...overrides,
  };
}
