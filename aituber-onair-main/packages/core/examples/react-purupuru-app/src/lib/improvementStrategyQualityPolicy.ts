import type { ImprovementStrategyQualityCalibration } from './improvementStrategyQualityCalibration';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

export type ImprovementStrategyQualityPolicy = {
  version: number;
  warningPenalty: number;
  maxInstructionClauses: number;
  confoundedExecution: 'warn' | 'block';
  source: 'default' | 'published';
};

export type ImprovementStrategyQualityPolicyField =
  | 'warningPenalty'
  | 'maxInstructionClauses'
  | 'confoundedExecution';

export type ImprovementStrategyQualityPolicyChange = {
  field: ImprovementStrategyQualityPolicyField;
  from: number | string;
  to: number | string;
  reason: string;
};

export type ImprovementStrategyQualityPolicyChangeEffect = {
  field: ImprovementStrategyQualityPolicyField;
  from: number | string;
  to: number | string;
  recommendation: 'prefer' | 'unproven' | 'neutral' | 'caution';
  priorityScore: number;
  influence: 'automatic' | 'advisory' | 'revalidate' | 'isolated';
  exactSamples: number;
  freshSamples: number;
};

export type ImprovementStrategyQualityPolicyRevalidationTarget = {
  field: ImprovementStrategyQualityPolicyField;
  from: number | string;
  to: number | string;
};

export type ImprovementStrategyQualityPolicyProposal = {
  trigger: 'calibration' | 'revalidation' | 'rollback';
  fromVersion: number;
  toVersion: number;
  calibrationStatus?: ImprovementStrategyQualityCalibration['status'];
  rollbackFromVersion?: number;
  revalidation?: {
    runId?: string;
    reason: 'expired' | 'sample-gap';
    phase: 'measure' | 'reset-baseline';
    target: ImprovementStrategyQualityPolicyRevalidationTarget;
    requiredFreshSamples: number;
    collectedFreshSamples: number;
    remainingFreshSamples: number;
  };
  policy: ImprovementStrategyQualityPolicy;
  changes: ImprovementStrategyQualityPolicyChange[];
  summary: string;
};

type QualityPolicyScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

export const DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY: ImprovementStrategyQualityPolicy =
  {
    version: 1,
    warningPenalty: 15,
    maxInstructionClauses: 3,
    confoundedExecution: 'warn',
    source: 'default',
  };

export const IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES =
  2;

export function createImprovementStrategyQualityPolicyRevalidationRunId(
  target: ImprovementStrategyQualityPolicyRevalidationTarget,
  at: number,
): string {
  return `quality-policy-revalidation:${target.field}:${encodeURIComponent(
    String(target.from),
  )}->${encodeURIComponent(String(target.to))}:${at}`;
}

function eventTimestamp(
  event: NextSessionImprovementActionRuntimeEvent,
): number {
  const value = event.at ?? event.serverReceivedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function policyFromEvent(
  event: NextSessionImprovementActionRuntimeEvent,
): ImprovementStrategyQualityPolicy | null {
  const version = event.strategyQualityPolicyVersion;
  const warningPenalty = event.strategyQualityWarningPenalty;
  const maxInstructionClauses =
    event.strategyQualityMaxInstructionClauses;
  const confoundedExecution =
    event.strategyQualityConfoundedExecution;
  if (
    event.stage !== 'operator_next_session_improvement_quality_policy' ||
    !Number.isInteger(version) ||
    (version ?? 0) < 2 ||
    !Number.isInteger(warningPenalty) ||
    (warningPenalty ?? 0) < 5 ||
    (warningPenalty ?? 0) > 30 ||
    !Number.isInteger(maxInstructionClauses) ||
    (maxInstructionClauses ?? 0) < 1 ||
    (maxInstructionClauses ?? 0) > 6 ||
    (confoundedExecution !== 'warn' &&
      confoundedExecution !== 'block')
  ) {
    return null;
  }
  return {
    version: version as number,
    warningPenalty: warningPenalty as number,
    maxInstructionClauses: maxInstructionClauses as number,
    confoundedExecution,
    source: 'published',
  };
}

export function projectImprovementStrategyQualityPolicy(input: {
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  scope: QualityPolicyScope;
}): ImprovementStrategyQualityPolicy {
  return projectImprovementStrategyQualityPolicyHistory(input)[0];
}

export function projectImprovementStrategyQualityPolicyHistory(input: {
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  scope: QualityPolicyScope;
}): ImprovementStrategyQualityPolicy[] {
  const selectedByVersion = new Map<
    number,
    { policy: ImprovementStrategyQualityPolicy; at: number }
  >();
  for (const event of input.events) {
    if (
      event.personaId !== input.scope.personaId ||
      event.platform !== input.scope.platform ||
      event.roomId !== input.scope.roomId
    ) {
      continue;
    }
    const policy = policyFromEvent(event);
    if (!policy) continue;
    const at = eventTimestamp(event);
    const selected = selectedByVersion.get(policy.version);
    if (
      !selected ||
      at >= selected.at
    ) {
      selectedByVersion.set(policy.version, { policy, at });
    }
  }
  return [
    ...[...selectedByVersion.values()]
      .map(({ policy }) => policy)
      .sort((left, right) => right.version - left.version),
    DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  ];
}

export function proposeImprovementStrategyQualityPolicy(input: {
  current: ImprovementStrategyQualityPolicy;
  calibration: ImprovementStrategyQualityCalibration;
  fieldPriority?: readonly ImprovementStrategyQualityPolicyField[];
  changeEffects?: readonly ImprovementStrategyQualityPolicyChangeEffect[];
  revalidationTarget?: ImprovementStrategyQualityPolicyRevalidationTarget;
  revalidationRunId?: string;
}): ImprovementStrategyQualityPolicyProposal | null {
  const defaultPriority: readonly ImprovementStrategyQualityPolicyField[] = [
    'confoundedExecution',
    'maxInstructionClauses',
    'warningPenalty',
  ];
  const priority = input.fieldPriority ?? defaultPriority;
  const priorityRank = (field: ImprovementStrategyQualityPolicyField) => {
    const learnedRank = priority.indexOf(field);
    return learnedRank >= 0
      ? learnedRank
      : priority.length + defaultPriority.indexOf(field);
  };
  const currentValue = (
    field: ImprovementStrategyQualityPolicyField,
  ): number | string => input.current[field];
  const needsRevalidation = (
    effect: ImprovementStrategyQualityPolicyChangeEffect | undefined,
  ) =>
    effect?.recommendation === 'prefer' &&
    effect.exactSamples > 0 &&
    effect.freshSamples <
      IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES &&
    (effect.influence === 'revalidate' ||
      effect.influence === 'advisory');
  const scheduledRevalidation = [...(input.changeEffects ?? [])]
    .filter(needsRevalidation)
    .filter(
      (effect) =>
        !input.revalidationTarget ||
        (effect.field === input.revalidationTarget.field &&
          effect.from === input.revalidationTarget.from &&
          effect.to === input.revalidationTarget.to),
    )
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        priorityRank(left.field) - priorityRank(right.field),
    )
    .map((effect) =>
      currentValue(effect.field) === effect.to
        ? { effect, phase: 'reset-baseline' as const }
        : currentValue(effect.field) === effect.from
          ? { effect, phase: 'measure' as const }
          : null,
    )
    .find(
      (
        candidate,
      ): candidate is {
        effect: ImprovementStrategyQualityPolicyChangeEffect;
        phase: 'measure' | 'reset-baseline';
      } => candidate !== null,
    );
  if (input.revalidationTarget && !scheduledRevalidation) {
    return null;
  }
  if (
    !scheduledRevalidation &&
    (input.calibration.status === 'aligned' ||
      input.calibration.status === 'insufficient')
  ) {
    return null;
  }
  const next: ImprovementStrategyQualityPolicy = {
    ...input.current,
    version: input.current.version + 1,
    source: 'published',
  };
  const candidateChanges: ImprovementStrategyQualityPolicyChange[] = [];
  if (scheduledRevalidation) {
    const { effect, phase } = scheduledRevalidation;
    candidateChanges.push({
      field: effect.field,
      from: phase === 'measure' ? effect.from : effect.to,
      to: phase === 'measure' ? effect.to : effect.from,
      reason:
        phase === 'measure'
          ? '按原方向重新测量，补齐当前上下文的新鲜精确样本。'
          : '恢复目标方向的测量基线，完成观察后再执行下一次同方向复验。',
    });
  } else if (
    input.calibration.status === 'too-permissive' ||
    input.calibration.status === 'mixed'
  ) {
    if (input.current.confoundedExecution === 'warn') {
      candidateChanges.push({
        field: 'confoundedExecution',
        from: 'warn',
        to: 'block',
        reason: '高分策略仍产生过多不可归因证据，收紧同场混杂实验执行。',
      });
    } else if (input.current.maxInstructionClauses > 1) {
      candidateChanges.push({
        field: 'maxInstructionClauses',
        from: input.current.maxInstructionClauses,
        to: input.current.maxInstructionClauses - 1,
        reason: '高分策略证据可用率仍偏低，进一步收窄单次执行范围。',
      });
    }
  }
  if (
    !scheduledRevalidation &&
    (input.calibration.status === 'too-strict' ||
      input.calibration.status === 'mixed')
  ) {
    const nextPenalty = Math.max(5, input.current.warningPenalty - 5);
    if (nextPenalty !== input.current.warningPenalty) {
      candidateChanges.push({
        field: 'warningPenalty',
        from: input.current.warningPenalty,
        to: nextPenalty,
        reason: '带警告策略仍持续产生可用证据，降低警告对质量分的影响。',
      });
    }
  }
  const matchingEffect = (
    change: ImprovementStrategyQualityPolicyChange,
  ) =>
    input.changeEffects?.find(
      (effect) =>
        effect.field === change.field &&
        effect.from === change.from &&
        effect.to === change.to,
    );
  const evidenceRank = (
    effect: ImprovementStrategyQualityPolicyChangeEffect | undefined,
  ) => {
    if (effect?.influence === 'automatic') {
      return {
        prefer: 0,
        unproven: 2,
        neutral: 3,
        caution: 4,
      }[effect.recommendation];
    }
    return needsRevalidation(effect) ? 1 : 2;
  };
  const evidencePriority = (
    effect: ImprovementStrategyQualityPolicyChangeEffect | undefined,
  ) =>
    effect?.influence === 'automatic' ||
    needsRevalidation(effect)
      ? effect?.priorityScore ?? 0
      : 0;
  const selectedChange = scheduledRevalidation
    ? candidateChanges[0]
    : [...candidateChanges].sort(
    (left, right) => {
      const leftEffect = matchingEffect(left);
      const rightEffect = matchingEffect(right);
      return (
        evidenceRank(leftEffect) - evidenceRank(rightEffect) ||
        evidencePriority(rightEffect) -
          evidencePriority(leftEffect) ||
        priorityRank(left.field) - priorityRank(right.field)
      );
    },
      )[0];
  if (!selectedChange) return null;
  if (selectedChange.field === 'confoundedExecution') {
    next.confoundedExecution =
      selectedChange.to as ImprovementStrategyQualityPolicy['confoundedExecution'];
  } else if (selectedChange.field === 'maxInstructionClauses') {
    next.maxInstructionClauses = selectedChange.to as number;
  } else {
    next.warningPenalty = selectedChange.to as number;
  }
  const changes = [selectedChange];
  const selectedEffect =
    scheduledRevalidation?.effect ?? matchingEffect(selectedChange);
  const revalidation = needsRevalidation(selectedEffect)
    ? {
        runId: input.revalidationRunId,
        reason:
          selectedEffect?.influence === 'revalidate'
            ? ('expired' as const)
            : ('sample-gap' as const),
        phase:
          scheduledRevalidation?.phase ?? ('measure' as const),
        target: {
          field: selectedEffect!.field,
          from: selectedEffect!.from,
          to: selectedEffect!.to,
        },
        requiredFreshSamples:
          IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES,
        collectedFreshSamples: Math.min(
          selectedEffect?.freshSamples ?? 0,
          IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES,
        ),
        remainingFreshSamples: Math.max(
          0,
          IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES -
            (selectedEffect?.freshSamples ?? 0),
        ),
      }
    : undefined;
  return {
    trigger: revalidation ? 'revalidation' : 'calibration',
    fromVersion: input.current.version,
    toVersion: next.version,
    calibrationStatus: input.calibration.status,
    policy: next,
    changes,
    revalidation,
    summary: revalidation
      ? revalidation.phase === 'reset-baseline'
        ? `建议以 V${next.version} 恢复复验基线；完成观察后，再按目标方向补齐 ${revalidation.remainingFreshSamples} 个新鲜精确样本。`
        : `建议以 V${next.version} 复验已验证方向，补齐 ${revalidation.remainingFreshSamples} 个新鲜精确样本后再恢复自动影响。`
      : `建议将质量门禁从 V${input.current.version} 升级到 V${next.version}，包含 ${changes.length} 项可审计变更。`,
  };
}

export function createImprovementStrategyQualityPolicyRollbackProposal(input: {
  current: ImprovementStrategyQualityPolicy;
  target: ImprovementStrategyQualityPolicy;
}): ImprovementStrategyQualityPolicyProposal {
  const policy: ImprovementStrategyQualityPolicy = {
    ...input.target,
    version: input.current.version + 1,
    source: 'published',
  };
  const changes: ImprovementStrategyQualityPolicyChange[] = [];
  const fields: Array<
    keyof Pick<
      ImprovementStrategyQualityPolicy,
      'warningPenalty' | 'maxInstructionClauses' | 'confoundedExecution'
    >
  > = [
    'warningPenalty',
    'maxInstructionClauses',
    'confoundedExecution',
  ];
  for (const field of fields) {
    if (input.current[field] === input.target[field]) continue;
    changes.push({
      field,
      from: input.current[field],
      to: input.target[field],
      reason: `恢复 V${input.target.version} 的已验证配置。`,
    });
  }
  return {
    trigger: 'rollback',
    fromVersion: input.current.version,
    toVersion: policy.version,
    rollbackFromVersion: input.target.version,
    policy,
    changes,
    summary: `将 V${input.target.version} 的门禁配置作为新版本 V${policy.version} 发布，保留完整版本轨迹。`,
  };
}

export function createImprovementStrategyQualityPolicyEvent(input: {
  proposal: ImprovementStrategyQualityPolicyProposal;
  scope: QualityPolicyScope;
  context?: { id: string; label: string };
  at?: number;
}): NextSessionImprovementActionRuntimeEvent {
  const at = input.at ?? Date.now();
  const revalidationRunId = input.proposal.revalidation
    ? input.proposal.revalidation.runId ??
      createImprovementStrategyQualityPolicyRevalidationRunId(
        input.proposal.revalidation.target,
        at,
      )
    : undefined;
  return {
    eventId: `improvement-strategy-quality-policy:${input.proposal.toVersion}:${at}`,
    stage: 'operator_next_session_improvement_quality_policy',
    at,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    strategyQualityPolicyVersion: input.proposal.policy.version,
    strategyQualityWarningPenalty:
      input.proposal.policy.warningPenalty,
    strategyQualityMaxInstructionClauses:
      input.proposal.policy.maxInstructionClauses,
    strategyQualityConfoundedExecution:
      input.proposal.policy.confoundedExecution,
    strategyQualityPolicyReason: input.proposal.summary,
    strategyQualityPolicyChangedFields: input.proposal.changes.map(
      ({ field }) => field,
    ),
    strategyQualityPolicyRollbackFromVersion:
      input.proposal.rollbackFromVersion,
    strategyQualityPolicyTrigger: input.proposal.trigger,
    strategyQualityPolicyRevalidationReason:
      input.proposal.revalidation?.reason,
    strategyQualityPolicyRevalidationPhase:
      input.proposal.revalidation?.phase,
    strategyQualityPolicyRevalidationTargetField:
      input.proposal.revalidation?.target.field,
    strategyQualityPolicyRevalidationTargetFrom:
      input.proposal.revalidation?.target.from,
    strategyQualityPolicyRevalidationTargetTo:
      input.proposal.revalidation?.target.to,
    strategyQualityPolicyRevalidationRequiredSamples:
      input.proposal.revalidation?.requiredFreshSamples,
    strategyQualityPolicyRevalidationCollectedSamples:
      input.proposal.revalidation?.collectedFreshSamples,
    strategyQualityPolicyRevalidationRemainingSamples:
      input.proposal.revalidation?.remainingFreshSamples,
    strategyQualityPolicyRevalidationRunId: revalidationRunId,
    experimentContextId: input.context?.id,
    experimentContextLabel: input.context?.label,
  };
}
