import type {
  SoulApprovedBeliefPolicyV1,
  SoulMutableBeliefKind,
  SoulProfileV1,
  SoulReflectionPolicyApprovalV1,
  SoulReflectionProposalV1,
} from '@aituber-onair/soul';

export interface SoulReflectionPolicyInputV1 {
  profile: SoulProfileV1;
  proposal: SoulReflectionProposalV1;
  allowedEvidenceEventIds: readonly string[];
}

export interface SoulReflectionGoalPolicyReviewV1 {
  kind: 'goal-weight';
  targetId: string;
  approved: boolean;
  reasonCodes: readonly string[];
}

export interface SoulReflectionBeliefPolicyReviewV1 {
  kind: 'belief';
  targetId: string;
  approved: boolean;
  beliefKind?: SoulMutableBeliefKind;
  falsifiabilityTest?: string;
  reasonCodes: readonly string[];
}

export interface SoulReflectionPolicyEvaluationV1 {
  approval: SoulReflectionPolicyApprovalV1;
  goalReviews: readonly SoulReflectionGoalPolicyReviewV1[];
  beliefReviews: readonly SoulReflectionBeliefPolicyReviewV1[];
  rejectedCanonIds: readonly string[];
}

const BELIEF_PREFIXES: readonly [string, SoulMutableBeliefKind][] = [
  ['self-model:', 'self-model'],
  ['relationship-hypothesis:', 'relationship-hypothesis'],
  ['preference:', 'preference'],
  ['strategy:', 'strategy'],
];

const HIGH_RISK_FACT_PATTERNS: readonly [string, RegExp][] = [
  [
    'high-risk-weather-fact',
    /\b(?:weather|forecast|rain(?:ing)?|temperature|typhoon|hurricane|tornado)\b|天气|预报|下雨|降雨|温度|台风|飓风|龙卷风|气象预警/i,
  ],
  [
    'high-risk-safety-fact',
    /\b(?:emergency|evacuat(?:e|ion)|earthquake|wildfire|fire alarm|safe to|unsafe|disaster warning)\b|紧急|撤离|地震|火灾|安全警报|灾害预警|是否安全/i,
  ],
  [
    'high-risk-health-fact',
    /\b(?:diagnos(?:is|ed)|medical|medicine|dosage|disease|pregnan(?:t|cy)|mental illness|suicid(?:e|al)|self[- ]harm)\b|诊断|疾病|药物|剂量|怀孕|精神疾病|自杀|自残/i,
  ],
  [
    'high-risk-legal-fact',
    /\b(?:legal|illegal|lawyer|lawsuit|court order|criminal|contract)\b|法律|违法|律师|诉讼|法院|犯罪|合同效力/i,
  ],
  [
    'high-risk-money-fact',
    /\b(?:bank|account balance|investment|stock price|crypto|loan|debt|tax|payment|refund)\b|银行|余额|投资|股价|虚拟币|贷款|债务|税务|付款|退款/i,
  ],
  [
    'high-risk-platform-event-fact',
    /\b(?:viewer count|follower count|already followed|sent (?:a )?gift|account ban|platform event)\b|在线人数|粉丝数|已经关注|送过礼物|账号封禁|平台事件/i,
  ],
  [
    'protected-identity-fact',
    /\b(?:i am|i'm)\s+(?:a\s+)?human\b|\b(?:real|legal) name\b|\bidentity document\b|我是(?:真人|人类)|不是数字人|并非数字人|真实姓名|身份证|现实住址|真实年龄/i,
  ],
  [
    'high-risk-viewer-history-fact',
    /\bviewer\b.{0,40}\b(?:was|is|has|lives|visited|met me)\b|观众.{0,30}(?:曾经|住在|患有|见过我|和我一起|真实身份|私人经历)|手机号|电话号码|家庭住址/i,
  ],
  [
    'high-risk-real-person-fact',
    /\b(?:real person|celebrity|public figure)\b.{0,40}\b(?:is|was|has|did)\b|真人.{0,30}(?:是|曾经|患有|做过)|明星.{0,30}(?:是|曾经|患有|做过)/i,
  ],
  [
    'high-risk-minor-fact',
    /\b(?:minor|underage|under 18|child's age)\b|未成年人|未满十八|儿童年龄/i,
  ],
  [
    'high-risk-promise-fact',
    /\b(?:i promise|i guarantee|i commit to|will definitely)\b|我保证|我承诺|我答应|一定会兑现/i,
  ],
  [
    'sensitive-viewer-inference',
    /\bviewer\b.{0,30}\b(?:political|religio(?:n|us)|sexual orientation|ethnicity|disability)\b|观众.{0,30}(?:政治倾向|宗教|性取向|民族|残障)/i,
  ],
  [
    'instruction-injection-risk',
    /\b(?:system|developer)\s*:\s*|\bignore (?:all )?(?:previous|prior) instructions\b|系统\s*[:：]|开发者\s*[:：]|忽略(?:此前|之前|所有)指令/i,
  ],
];

/**
 * Produces the explicit, deterministic approval consumed by the Soul kernel.
 * It never mutates runtime state and never trusts the model's recommendation.
 */
export function evaluateSoulReflectionPolicy(
  input: SoulReflectionPolicyInputV1,
): SoulReflectionPolicyEvaluationV1 {
  const allowedEvidence = new Set(
    input.allowedEvidenceEventIds.map((value) => value.trim()).filter(Boolean),
  );
  const identityValid =
    input.proposal.protocolVersion === '1.0' &&
    input.proposal.profileId === input.profile.id &&
    input.proposal.id.trim().length > 0 &&
    input.proposal.id === input.proposal.id.trim();
  const duplicateGoalIds = duplicateValues(
    input.proposal.goalWeightDeltas.map((item) => item.goalId),
  );
  const duplicateBeliefIds = duplicateValues(
    input.proposal.beliefProposals.map((item) => item.id),
  );
  const goalIds = new Set(input.profile.goals.map((goal) => goal.id));
  const maximumGoalDelta = Math.abs(
    input.profile.evolution.maxGoalWeightDeltaPerReflection,
  );

  const goalReviews = input.proposal.goalWeightDeltas.map((item) => {
    const reasonCodes = evidenceReasonCodes(
      item.evidenceEventIds,
      allowedEvidence,
    );
    if (!identityValid) reasonCodes.push('proposal-identity-invalid');
    if (!goalIds.has(item.goalId)) reasonCodes.push('goal-does-not-exist');
    if (duplicateGoalIds.has(item.goalId)) {
      reasonCodes.push('duplicate-goal-change');
    }
    if (!Number.isFinite(item.delta)) reasonCodes.push('goal-delta-not-finite');
    if (item.delta === 0) reasonCodes.push('goal-delta-zero');
    if (
      !Number.isFinite(maximumGoalDelta) ||
      maximumGoalDelta <= 0 ||
      Math.abs(item.delta) > maximumGoalDelta
    ) {
      reasonCodes.push('goal-delta-exceeds-profile-limit');
    }
    return {
      kind: 'goal-weight' as const,
      targetId: item.goalId,
      approved: reasonCodes.length === 0,
      reasonCodes,
    };
  });

  const beliefReviews = input.proposal.beliefProposals.map((item) => {
    const reasonCodes = evidenceReasonCodes(
      item.evidenceEventIds,
      allowedEvidence,
    );
    if (!identityValid) reasonCodes.push('proposal-identity-invalid');
    if (duplicateBeliefIds.has(item.id)) {
      reasonCodes.push('duplicate-belief-proposal');
    }
    const beliefKind = beliefKindFromId(item.id);
    if (!beliefKind) reasonCodes.push('belief-id-not-mutable');
    const proposition = item.proposition.normalize('NFKC').trim();
    if (!proposition || proposition.length > 1_000) {
      reasonCodes.push('belief-content-invalid');
    }
    if (
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1
    ) {
      reasonCodes.push('belief-confidence-invalid');
    }
    reasonCodes.push(...highRiskFactReasonCodes(proposition));
    const falsifiabilityTest = beliefKind
      ? createFalsifiabilityTest(beliefKind)
      : undefined;
    return {
      kind: 'belief' as const,
      targetId: item.id,
      approved: reasonCodes.length === 0,
      beliefKind,
      falsifiabilityTest,
      reasonCodes: unique(reasonCodes),
    };
  });

  const approvedGoalIds = goalReviews
    .filter((item) => item.approved)
    .map((item) => item.targetId);
  const approvedBeliefs: SoulApprovedBeliefPolicyV1[] = [];
  for (const item of beliefReviews) {
    if (!item.approved || !item.beliefKind || !item.falsifiabilityTest) {
      continue;
    }
    approvedBeliefs.push({
      beliefId: item.targetId,
      kind: item.beliefKind,
      falsifiabilityTest: item.falsifiabilityTest,
    });
  }
  const approvedCount = approvedGoalIds.length + approvedBeliefs.length;
  const rejectedCanonIds = input.proposal.canonProposals.map((item) => item.id);
  const rejectedCount =
    goalReviews.filter((item) => !item.approved).length +
    beliefReviews.filter((item) => !item.approved).length +
    rejectedCanonIds.length;
  const reasonCode =
    approvedCount === 0
      ? 'reflection-rejected-by-local-policy'
      : rejectedCount > 0
        ? 'bounded-reflection-partially-approved'
        : 'bounded-reflection-approved';
  const approvalPayload = {
    // Bind the approval id to the exact proposal, not merely its item ids.
    // Reusing a reflection id with altered content therefore cannot reuse the
    // same policy approval audit identity.
    proposal: input.proposal,
    profileId: input.profile.id,
    allowedEvidenceEventIds: [...allowedEvidence].sort(),
    approvedGoalIds,
    approvedBeliefs,
    goalReviews,
    beliefReviews,
    rejectedCanonIds,
    reasonCode,
  };
  const approval: SoulReflectionPolicyApprovalV1 = {
    policyId: 'browser-reflection-policy-v1',
    approvalId: `reflection-policy-approval:${digest(approvalPayload)}`,
    approved: approvedCount > 0,
    reasonCode,
    approvedGoalIds,
    approvedBeliefs,
  };

  return { approval, goalReviews, beliefReviews, rejectedCanonIds };
}

export function createSoulReflectionPolicyApproval(
  input: SoulReflectionPolicyInputV1,
): SoulReflectionPolicyApprovalV1 {
  return evaluateSoulReflectionPolicy(input).approval;
}

function evidenceReasonCodes(
  evidenceEventIds: readonly string[],
  allowedEvidence: ReadonlySet<string>,
): string[] {
  const evidence = evidenceEventIds.map((value) => value.trim()).filter(Boolean);
  const reasons: string[] = [];
  if (evidence.length === 0) reasons.push('evidence-required');
  if (new Set(evidence).size !== evidence.length) {
    reasons.push('duplicate-evidence-reference');
  }
  if (evidence.some((eventId) => !allowedEvidence.has(eventId))) {
    reasons.push('evidence-not-allowlisted');
  }
  return reasons;
}

function beliefKindFromId(id: string): SoulMutableBeliefKind | undefined {
  const match = BELIEF_PREFIXES.find(([prefix]) => id.startsWith(prefix));
  return match?.[1];
}

function highRiskFactReasonCodes(proposition: string): string[] {
  return HIGH_RISK_FACT_PATTERNS.filter(([, pattern]) =>
    pattern.test(proposition),
  ).map(([reasonCode]) => reasonCode);
}

function createFalsifiabilityTest(kind: SoulMutableBeliefKind): string {
  if (kind === 'self-model') {
    return "Over the next 3 comparable turns, record the host's actual choice; lower or retract this hypothesis if fewer than 2 choices match it.";
  }
  if (kind === 'relationship-hypothesis') {
    return 'Over the next 5 same-scope public interactions, record only observable replies; lower or retract this hypothesis if fewer than 2 support it.';
  }
  if (kind === 'preference') {
    return 'Over the next 3 turns with equivalent options, record the autonomous choice; lower or retract this hypothesis if it is chosen fewer than 2 times.';
  }
  return 'Over the next 5 comparable turns, contrast public outcomes with and without this strategy; lower or retract this hypothesis if it produces no improvement.';
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function digest(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForSerialization(value));
}

function sortForSerialization(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForSerialization);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForSerialization(child)]),
    );
  }
  return value;
}
