import type { ImprovementStrategyQualityCalibration } from './improvementStrategyQualityCalibration';
import type { ImprovementStrategyQualityPolicyReleaseObservation } from './improvementStrategyQualityPolicyObservation';
import {
  proposeImprovementStrategyQualityPolicy,
  type ImprovementStrategyQualityPolicy,
  type ImprovementStrategyQualityPolicyChangeEffect,
  type ImprovementStrategyQualityPolicyField,
  type ImprovementStrategyQualityPolicyProposal,
  type ImprovementStrategyQualityPolicyRevalidationTarget,
} from './improvementStrategyQualityPolicy';
import type { ImprovementStrategyQualityPolicyTrendGovernance } from './improvementStrategyQualityPolicyTrendGovernance';

export type ImprovementStrategyQualityPolicyGovernance = {
  status:
    | 'no-change'
    | 'observation-pending'
    | 'regression-watch'
    | 'rollback-required'
    | 'historical-match'
    | 'revalidation-ready'
    | 'revalidation-blocked'
    | 'trend-rollback-review'
    | 'trend-field-blocked'
    | 'proposal-ready';
  proposal: ImprovementStrategyQualityPolicyProposal | null;
  restoreTarget: ImprovementStrategyQualityPolicy | null;
  summary: string;
};

function sameConfiguration(
  left: ImprovementStrategyQualityPolicy,
  right: ImprovementStrategyQualityPolicy,
): boolean {
  return (
    left.warningPenalty === right.warningPenalty &&
    left.maxInstructionClauses === right.maxInstructionClauses &&
    left.confoundedExecution === right.confoundedExecution
  );
}

export function governImprovementStrategyQualityPolicyChange(input: {
  current: ImprovementStrategyQualityPolicy;
  history: readonly ImprovementStrategyQualityPolicy[];
  calibration: ImprovementStrategyQualityCalibration;
  observation: ImprovementStrategyQualityPolicyReleaseObservation | null;
  fieldPriority?: readonly ImprovementStrategyQualityPolicyField[];
  changeEffects?: readonly ImprovementStrategyQualityPolicyChangeEffect[];
  revalidationTarget?: ImprovementStrategyQualityPolicyRevalidationTarget;
  revalidationRunId?: string;
  trendGovernance?: ImprovementStrategyQualityPolicyTrendGovernance;
}): ImprovementStrategyQualityPolicyGovernance {
  if (input.observation?.status === 'rollback-recommended') {
    const restoreTarget =
      input.history.find(
        ({ version }) =>
          version === input.observation?.baseline.version,
      ) ?? null;
    return {
      status: restoreTarget ? 'rollback-required' : 'regression-watch',
      proposal: null,
      restoreTarget,
      summary: restoreTarget
        ? `当前发布出现多项退化，暂停新提案并优先恢复 V${restoreTarget.version}。`
        : '当前发布出现多项退化，但历史恢复目标不可用；暂停新提案并继续人工复核。',
    };
  }
  if (input.observation?.status === 'insufficient') {
    return {
      status: 'observation-pending',
      proposal: null,
      restoreTarget: null,
      summary:
        '当前门禁仍在发布观察期；达到评审与结果样本要求前暂停生成下一版本。',
    };
  }
  if (input.observation?.status === 'watch') {
    return {
      status: 'regression-watch',
      proposal: null,
      restoreTarget: null,
      summary:
        '当前门禁仍有单项退化信号；观察结论转为健康或回滚建议前暂停新提案。',
    };
  }
  if (input.trendGovernance?.reviewRollback) {
    const restoreTarget =
      input.history.find(
        (policy) =>
          policy.version !== input.current.version &&
          !sameConfiguration(policy, input.current),
      ) ?? null;
    return {
      status: 'trend-rollback-review',
      proposal: null,
      restoreTarget,
      summary: restoreTarget
        ? `近期复验完成率显著下降；暂停自动校准，建议人工审查恢复 V${restoreTarget.version}。`
        : '近期复验完成率显著下降；暂停自动校准，但当前没有可用的历史恢复目标。',
    };
  }
  const proposal = proposeImprovementStrategyQualityPolicy({
    current: input.current,
    calibration: input.calibration,
    fieldPriority: input.fieldPriority,
    changeEffects: input.changeEffects,
    revalidationTarget: input.revalidationTarget,
    revalidationRunId: input.revalidationRunId,
  });
  if (!proposal) {
    if (input.revalidationTarget) {
      return {
        status: 'revalidation-blocked',
        proposal: null,
        restoreTarget: null,
        summary:
          '活动复验目标暂时无法形成下一阶段提案；继续保持目标锁，等待观察或效果证据更新。',
      };
    }
    return {
      status: 'no-change',
      proposal: null,
      restoreTarget: null,
      summary:
        input.calibration.status === 'insufficient'
          ? '校准证据不足，继续积累样本后再评估门禁变更。'
          : '当前校准结果不需要调整门禁配置。',
    };
  }
  const trendBlockedField = proposal.changes.find(
    ({ field }) =>
      proposal.trigger !== 'revalidation' &&
      input.trendGovernance?.blockedFields.includes(field),
  )?.field;
  if (trendBlockedField) {
    return {
      status: 'trend-field-blocked',
      proposal: null,
      restoreTarget: null,
      summary:
        `${trendBlockedField} 近期风险率突增，已暂停该字段自动校准；` +
        '下一次变更应优先通过人工批准的复验流程。',
    };
  }
  const historicalMatch =
    proposal.trigger === 'revalidation'
      ? null
      : input.history.find(
          (policy) =>
            policy.version !== input.current.version &&
            sameConfiguration(policy, proposal.policy),
        ) ?? null;
  if (historicalMatch) {
    return {
      status: 'historical-match',
      proposal: null,
      restoreTarget: historicalMatch,
      summary: `候选配置与历史版本 V${historicalMatch.version} 相同；停止创建重复提案，改为显式恢复历史版本。`,
    };
  }
  return {
    status:
      proposal.trigger === 'revalidation'
        ? 'revalidation-ready'
        : 'proposal-ready',
    proposal,
    restoreTarget: null,
    summary: proposal.summary,
  };
}
