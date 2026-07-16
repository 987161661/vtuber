import type {
  SoulBeliefV1,
  SoulConstitutionV1,
  SoulMutableBeliefKind,
  SoulProfileV1,
  SoulScopeV1,
  SoulStateV1,
} from './contracts.js';
import type { SoulReflectionProposalV1 } from './model.js';
import { clamp, deepClone, hashValue, unique } from './utils.js';

const MUTABLE_BELIEF_KINDS: readonly SoulMutableBeliefKind[] = [
  'self-model',
  'relationship-hypothesis',
  'preference',
  'strategy',
];

export interface SoulApprovedBeliefPolicyV1 {
  beliefId: string;
  kind: SoulMutableBeliefKind;
  falsifiabilityTest: string;
}

export interface SoulReflectionPolicyApprovalV1 {
  policyId: string;
  approvalId: string;
  approved: boolean;
  reasonCode: string;
  approvedGoalIds: readonly string[];
  approvedBeliefs: readonly SoulApprovedBeliefPolicyV1[];
}

export interface SoulReflectionCommitInputV1 {
  proposal: SoulReflectionProposalV1;
  allowedEvidenceEventIds: readonly string[];
  approval: SoulReflectionPolicyApprovalV1;
  occurredAt: number;
}

export type SoulReflectionReviewDisposition =
  | 'approved'
  | 'partially-approved'
  | 'rejected'
  | 'already-committed';

export interface SoulGoalReflectionReviewItemV1 {
  kind: 'goal-weight';
  targetId: string;
  disposition: 'approved' | 'rejected';
  evidenceEventIds: readonly string[];
  reasonCodes: readonly string[];
  requestedDelta: number;
  appliedDelta?: number;
  previousWeight?: number;
  resultingWeight?: number;
  goalFamily?: string;
}

export interface SoulBeliefReflectionReviewItemV1 {
  kind: 'belief';
  targetId: string;
  disposition: 'approved' | 'rejected';
  evidenceEventIds: readonly string[];
  reasonCodes: readonly string[];
  committedBelief?: SoulBeliefV1;
}

export interface SoulCanonReflectionReviewItemV1 {
  kind: 'canon';
  targetId: string;
  disposition: 'rejected';
  evidenceEventIds: readonly string[];
  reasonCodes: readonly ['canon-requires-separate-review'];
}

export type SoulReflectionReviewItemV1 =
  | SoulGoalReflectionReviewItemV1
  | SoulBeliefReflectionReviewItemV1
  | SoulCanonReflectionReviewItemV1;

export interface SoulReflectionReviewRecordV1 {
  protocolVersion: '1.0';
  recordType: 'reflection-review';
  reflectionId: string;
  scope: SoulScopeV1;
  profileId: string;
  sourceStateVersion: number;
  stateVersionBefore: number;
  stateVersionAfter: number;
  stateHashBefore: string;
  stateHashAfter: string;
  disposition: SoulReflectionReviewDisposition;
  policy: {
    policyId: string;
    approvalId: string;
    approved: boolean;
    reasonCode: string;
  };
  allowedEvidenceEventIds: readonly string[];
  items: readonly SoulReflectionReviewItemV1[];
  reasonCodes: readonly string[];
  occurredAt: number;
}

export interface SoulReflectionCommitResultV1 {
  state: SoulStateV1;
  record: SoulReflectionReviewRecordV1;
  applied: boolean;
}

export class SoulReflectionReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoulReflectionReviewError';
  }
}

/**
 * Deterministically reviews a model proposal under explicit evidence and
 * policy gates. The proposal has no mutation authority by itself.
 */
export function reviewAndCommitSoulReflection(
  state: SoulStateV1,
  constitution: SoulConstitutionV1,
  profile: SoulProfileV1,
  input: SoulReflectionCommitInputV1,
): SoulReflectionCommitResultV1 {
  assertRuntimeCompatibility(state, constitution, profile);
  assertReviewInput(input, profile);
  if (state.processedReflectionIds.includes(input.proposal.id)) {
    return {
      state: deepClone(state),
      record: createAlreadyCommittedRecord(state, input),
      applied: false,
    };
  }

  const allowedEvidence = new Set(
    unique(input.allowedEvidenceEventIds.filter(Boolean)),
  );
  const observedEvidence = new Set(state.processedEventIds);
  const stale = input.proposal.sourceStateVersion !== state.version;
  const goalApprovals = new Set(input.approval.approvedGoalIds);
  const beliefApprovals = indexBeliefApprovals(input.approval.approvedBeliefs);
  const duplicateGoalIds = duplicateValues(
    input.proposal.goalWeightDeltas.map((change) => change.goalId),
  );
  const duplicateBeliefIds = duplicateValues(
    input.proposal.beliefProposals.map((belief) => belief.id),
  );
  const next = deepClone(state);
  const items: SoulReflectionReviewItemV1[] = [];

  for (const change of input.proposal.goalWeightDeltas) {
    const evidenceEventIds = canonicalEvidence(change.evidenceEventIds);
    const reasons = commonRejectionReasons(
      evidenceEventIds,
      input.approval.approved,
      stale,
      allowedEvidence,
      observedEvidence,
    );
    const definition = profile.goals.find((goal) => goal.id === change.goalId);
    const goal = next.goals[change.goalId];
    if (!definition || !goal) reasons.push('goal-does-not-exist');
    if (!goalApprovals.has(change.goalId)) {
      reasons.push('goal-not-policy-approved');
    }
    if (duplicateGoalIds.has(change.goalId)) {
      reasons.push('duplicate-goal-change');
    }
    if (
      definition &&
      (!constitution.allowedGoalFamilies.includes(definition.family) ||
        goal?.family !== definition.family)
    ) {
      reasons.push('goal-family-incompatible');
    }
    if (!Number.isFinite(change.delta) || change.delta === 0) {
      reasons.push('goal-delta-invalid');
    }
    if (reasons.length > 0 || !goal || !definition) {
      items.push({
        kind: 'goal-weight',
        targetId: change.goalId,
        disposition: 'rejected',
        evidenceEventIds,
        reasonCodes: unique(reasons),
        requestedDelta: finiteOrZero(change.delta),
        goalFamily: definition?.family,
      });
      continue;
    }

    const maximumDelta = Math.abs(
      profile.evolution.maxGoalWeightDeltaPerReflection,
    );
    const boundedDelta = clamp(change.delta, -maximumDelta, maximumDelta);
    const previousWeight = goal.weight;
    const resultingWeight = clamp(previousWeight + boundedDelta, 0, 1);
    goal.weight = resultingWeight;
    goal.lastChangedAt = input.occurredAt;
    items.push({
      kind: 'goal-weight',
      targetId: change.goalId,
      disposition: 'approved',
      evidenceEventIds,
      reasonCodes: ['goal-change-policy-and-evidence-approved'],
      requestedDelta: change.delta,
      appliedDelta: resultingWeight - previousWeight,
      previousWeight,
      resultingWeight,
      goalFamily: goal.family,
    });
  }

  for (const proposal of input.proposal.beliefProposals) {
    const evidenceEventIds = canonicalEvidence(proposal.evidenceEventIds);
    const reasons = commonRejectionReasons(
      evidenceEventIds,
      input.approval.approved,
      stale,
      allowedEvidence,
      observedEvidence,
    );
    const policy = beliefApprovals.get(proposal.id);
    if (!policy) reasons.push('belief-not-policy-approved');
    if (duplicateBeliefIds.has(proposal.id)) {
      reasons.push('duplicate-belief-proposal');
    }
    if (
      !proposal.id.trim() ||
      proposal.id !== proposal.id.trim() ||
      proposal.id.length > 160
    ) {
      reasons.push('belief-id-invalid');
    }
    if (!proposal.proposition.trim() || proposal.proposition.length > 1_000) {
      reasons.push('belief-content-invalid');
    }
    if (!Number.isFinite(proposal.confidence)) {
      reasons.push('belief-confidence-invalid');
    }
    if (
      policy &&
      !MUTABLE_BELIEF_KINDS.includes(policy.kind as SoulMutableBeliefKind)
    ) {
      reasons.push('belief-kind-protected');
    }
    if (
      !policy?.falsifiabilityTest.trim() ||
      policy.falsifiabilityTest.length > 500
    ) {
      reasons.push('belief-not-falsifiable');
    }
    const existing = next.beliefs[proposal.id];
    if (existing && policy && existing.kind !== policy.kind) {
      reasons.push('belief-kind-change-forbidden');
    }
    if (reasons.length > 0 || !policy) {
      items.push({
        kind: 'belief',
        targetId: proposal.id,
        disposition: 'rejected',
        evidenceEventIds,
        reasonCodes: unique(reasons),
      });
      continue;
    }

    const belief: SoulBeliefV1 = {
      id: proposal.id,
      proposition: proposal.proposition.trim(),
      confidence: clamp(proposal.confidence, 0, 1),
      kind: policy.kind,
      epistemicStatus: 'hypothesis',
      falsifiabilityTest: policy.falsifiabilityTest.trim(),
      sourceReflectionId: input.proposal.id,
      provenanceEventIds: evidenceEventIds,
      updatedAt: input.occurredAt,
    };
    next.beliefs = { ...next.beliefs, [belief.id]: belief };
    items.push({
      kind: 'belief',
      targetId: proposal.id,
      disposition: 'approved',
      evidenceEventIds,
      reasonCodes: ['falsifiable-belief-policy-and-evidence-approved'],
      committedBelief: belief,
    });
  }

  for (const canon of input.proposal.canonProposals) {
    items.push({
      kind: 'canon',
      targetId: canon.id,
      disposition: 'rejected',
      evidenceEventIds: canonicalEvidence(canon.evidenceEventIds),
      reasonCodes: ['canon-requires-separate-review'],
    });
  }

  const approvedCount = items.filter(
    (item) => item.disposition === 'approved',
  ).length;
  const rejectedCount = items.length - approvedCount;
  const disposition: SoulReflectionReviewDisposition =
    approvedCount > 0 && rejectedCount > 0
      ? 'partially-approved'
      : approvedCount > 0
        ? 'approved'
        : 'rejected';
  next.version = state.version + 1;
  next.updatedAt = Math.max(next.updatedAt, input.occurredAt);
  next.processedReflectionIds = [
    ...next.processedReflectionIds,
    input.proposal.id,
  ];
  const record: SoulReflectionReviewRecordV1 = {
    protocolVersion: '1.0',
    recordType: 'reflection-review',
    reflectionId: input.proposal.id,
    scope: deepClone(state.scope),
    profileId: profile.id,
    sourceStateVersion: input.proposal.sourceStateVersion,
    stateVersionBefore: state.version,
    stateVersionAfter: next.version,
    stateHashBefore: hashValue(state),
    stateHashAfter: hashValue(next),
    disposition,
    policy: {
      policyId: input.approval.policyId,
      approvalId: input.approval.approvalId,
      approved: input.approval.approved,
      reasonCode: input.approval.reasonCode,
    },
    allowedEvidenceEventIds: [...allowedEvidence].sort(),
    items,
    reasonCodes: unique([
      input.approval.reasonCode,
      ...(stale ? ['reflection-source-state-stale'] : []),
      ...items.flatMap((item) => item.reasonCodes),
    ]),
    occurredAt: input.occurredAt,
  };
  return { state: next, record, applied: approvedCount > 0 };
}

export function applySoulReflectionReviewRecord(
  state: SoulStateV1,
  profile: SoulProfileV1,
  record: SoulReflectionReviewRecordV1,
): SoulStateV1 {
  if (state.processedReflectionIds.includes(record.reflectionId)) {
    return deepClone(state);
  }
  assertSameScope(state.scope, record.scope);
  if (
    record.protocolVersion !== '1.0' ||
    record.recordType !== 'reflection-review' ||
    record.profileId !== profile.id ||
    state.profileId !== profile.id ||
    state.profileHash !== hashValue(profile) ||
    record.stateVersionBefore !== state.version ||
    record.stateVersionAfter !== state.version + 1 ||
    record.stateHashBefore !== hashValue(state) ||
    record.disposition === 'already-committed' ||
    !record.policy.policyId ||
    !record.policy.approvalId ||
    !record.policy.reasonCode
  ) {
    throw new SoulReflectionReviewError('Invalid reflection review record');
  }
  const next = deepClone(state);
  for (const item of record.items) {
    if (item.disposition !== 'approved') continue;
    assertApprovedEvidence(state, record, item.evidenceEventIds);
    if (!record.policy.approved) {
      throw new SoulReflectionReviewError(
        'Rejected reflection policy cannot contain approved items',
      );
    }
    if (item.kind === 'goal-weight') {
      const goal = next.goals[item.targetId];
      const definition = profile.goals.find(
        (candidate) => candidate.id === item.targetId,
      );
      const maximumDelta = Math.abs(
        profile.evolution.maxGoalWeightDeltaPerReflection,
      );
      if (
        !goal ||
        !definition ||
        item.previousWeight === undefined ||
        item.resultingWeight === undefined ||
        item.appliedDelta === undefined ||
        item.goalFamily !== goal.family ||
        item.goalFamily !== definition.family ||
        !Number.isFinite(item.requestedDelta) ||
        !Number.isFinite(item.appliedDelta) ||
        !Number.isFinite(item.previousWeight) ||
        !Number.isFinite(item.resultingWeight) ||
        item.resultingWeight < 0 ||
        item.resultingWeight > 1 ||
        Math.abs(
          item.appliedDelta - (item.resultingWeight - item.previousWeight),
        ) > 1e-9 ||
        Math.abs(item.appliedDelta) > maximumDelta + 1e-9 ||
        Math.abs(
          item.resultingWeight -
            clamp(
              item.previousWeight +
                clamp(item.requestedDelta, -maximumDelta, maximumDelta),
              0,
              1,
            ),
        ) > 1e-9 ||
        Math.abs(goal.weight - item.previousWeight) > 1e-9
      ) {
        throw new SoulReflectionReviewError(
          `Cannot replay goal reflection ${item.targetId}`,
        );
      }
      goal.weight = item.resultingWeight;
      goal.lastChangedAt = record.occurredAt;
      continue;
    }
    if (item.kind === 'belief') {
      const belief = item.committedBelief;
      if (
        !belief ||
        belief.id !== item.targetId ||
        belief.sourceReflectionId !== record.reflectionId ||
        belief.epistemicStatus !== 'hypothesis' ||
        !MUTABLE_BELIEF_KINDS.includes(belief.kind) ||
        !belief.falsifiabilityTest.trim() ||
        belief.falsifiabilityTest.length > 500 ||
        !belief.proposition.trim() ||
        belief.proposition.length > 1_000 ||
        !Number.isFinite(belief.confidence) ||
        belief.confidence < 0 ||
        belief.confidence > 1 ||
        !sameStringSet(belief.provenanceEventIds, item.evidenceEventIds)
      ) {
        throw new SoulReflectionReviewError(
          `Cannot replay belief reflection ${item.targetId}`,
        );
      }
      next.beliefs = {
        ...next.beliefs,
        [belief.id]: deepClone(belief),
      };
    }
  }
  assertRecordDisposition(record);
  next.version = record.stateVersionAfter;
  next.updatedAt = Math.max(next.updatedAt, record.occurredAt);
  next.processedReflectionIds = [
    ...next.processedReflectionIds,
    record.reflectionId,
  ];
  if (hashValue(next) !== record.stateHashAfter) {
    throw new SoulReflectionReviewError(
      'Reflection replay state hash does not match the review record',
    );
  }
  return next;
}

export function isSoulReflectionReviewRecord(
  value: unknown,
): value is SoulReflectionReviewRecordV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<SoulReflectionReviewRecordV1>;
  return (
    record.protocolVersion === '1.0' &&
    record.recordType === 'reflection-review' &&
    typeof record.reflectionId === 'string' &&
    typeof record.stateHashBefore === 'string' &&
    typeof record.stateHashAfter === 'string' &&
    Array.isArray(record.items)
  );
}

function assertRuntimeCompatibility(
  state: SoulStateV1,
  constitution: SoulConstitutionV1,
  profile: SoulProfileV1,
): void {
  if (
    state.profileId !== profile.id ||
    state.profileHash !== hashValue(profile) ||
    state.constitutionId !== constitution.id ||
    state.constitutionHash !== hashValue(constitution) ||
    state.scope.personaId !== profile.personaId ||
    profile.constitutionId !== constitution.id
  ) {
    throw new SoulReflectionReviewError(
      'Soul state, profile, and constitution are incompatible',
    );
  }
}

function assertReviewInput(
  input: SoulReflectionCommitInputV1,
  profile: SoulProfileV1,
): void {
  if (
    input.proposal.protocolVersion !== '1.0' ||
    !input.proposal.id.trim() ||
    input.proposal.id !== input.proposal.id.trim() ||
    input.proposal.profileId !== profile.id ||
    !input.approval.policyId ||
    !input.approval.approvalId ||
    !input.approval.reasonCode ||
    !Number.isFinite(input.occurredAt)
  ) {
    throw new SoulReflectionReviewError('Invalid reflection review input');
  }
}

function commonRejectionReasons(
  evidenceIds: readonly string[],
  policyApproved: boolean,
  stale: boolean,
  allowed: ReadonlySet<string>,
  observed: ReadonlySet<string>,
): string[] {
  const reasons: string[] = [];
  if (!policyApproved) reasons.push('reflection-policy-rejected');
  if (stale) reasons.push('reflection-source-state-stale');
  if (evidenceIds.length === 0) reasons.push('evidence-required');
  if (evidenceIds.some((eventId) => !allowed.has(eventId))) {
    reasons.push('evidence-not-allowlisted');
  }
  if (evidenceIds.some((eventId) => !observed.has(eventId))) {
    reasons.push('evidence-not-observed');
  }
  return reasons;
}

function indexBeliefApprovals(
  approvals: readonly SoulApprovedBeliefPolicyV1[],
): Map<string, SoulApprovedBeliefPolicyV1> {
  const result = new Map<string, SoulApprovedBeliefPolicyV1>();
  const duplicates = duplicateValues(approvals.map((item) => item.beliefId));
  for (const approval of approvals) {
    if (!duplicates.has(approval.beliefId)) {
      result.set(approval.beliefId, approval);
    }
  }
  return result;
}

function duplicateValues(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function createAlreadyCommittedRecord(
  state: SoulStateV1,
  input: SoulReflectionCommitInputV1,
): SoulReflectionReviewRecordV1 {
  return {
    protocolVersion: '1.0',
    recordType: 'reflection-review',
    reflectionId: input.proposal.id,
    scope: deepClone(state.scope),
    profileId: state.profileId,
    sourceStateVersion: input.proposal.sourceStateVersion,
    stateVersionBefore: state.version,
    stateVersionAfter: state.version,
    stateHashBefore: hashValue(state),
    stateHashAfter: hashValue(state),
    disposition: 'already-committed',
    policy: {
      policyId: input.approval.policyId,
      approvalId: input.approval.approvalId,
      approved: input.approval.approved,
      reasonCode: input.approval.reasonCode,
    },
    allowedEvidenceEventIds: unique([...input.allowedEvidenceEventIds]).sort(),
    items: [],
    reasonCodes: ['reflection-already-committed'],
    occurredAt: input.occurredAt,
  };
}

function assertSameScope(actual: SoulScopeV1, expected: SoulScopeV1): void {
  for (const field of [
    'personaId',
    'platform',
    'roomId',
    'sessionId',
  ] as const) {
    if (actual[field] !== expected[field]) {
      throw new SoulReflectionReviewError('Reflection review scope mismatch');
    }
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function canonicalEvidence(values: readonly string[]): string[] {
  return unique(values.filter(Boolean)).sort();
}

function assertApprovedEvidence(
  state: SoulStateV1,
  record: SoulReflectionReviewRecordV1,
  evidenceEventIds: readonly string[],
): void {
  const allowed = new Set(record.allowedEvidenceEventIds);
  const observed = new Set(state.processedEventIds);
  if (
    evidenceEventIds.length === 0 ||
    evidenceEventIds.some(
      (eventId) => !allowed.has(eventId) || !observed.has(eventId),
    )
  ) {
    throw new SoulReflectionReviewError(
      'Approved reflection item has invalid evidence',
    );
  }
}

function assertRecordDisposition(record: SoulReflectionReviewRecordV1): void {
  const approvedCount = record.items.filter(
    (item) => item.disposition === 'approved',
  ).length;
  const rejectedCount = record.items.length - approvedCount;
  const expected: SoulReflectionReviewDisposition =
    approvedCount > 0 && rejectedCount > 0
      ? 'partially-approved'
      : approvedCount > 0
        ? 'approved'
        : 'rejected';
  if (record.disposition !== expected) {
    throw new SoulReflectionReviewError(
      'Reflection review disposition does not match its items',
    );
  }
  if (
    approvedCount > 0 &&
    record.sourceStateVersion !== record.stateVersionBefore
  ) {
    throw new SoulReflectionReviewError(
      'Stale reflection review cannot contain approved items',
    );
  }
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalizedLeft = canonicalEvidence(left);
  const normalizedRight = canonicalEvidence(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}
