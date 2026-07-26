import type { ImprovementStrategyQualityPolicyField } from './improvementStrategyQualityPolicy';
import type { ImprovementStrategyQualityPolicyRevalidationTrend } from './improvementStrategyQualityPolicyRevalidationAnalytics';

export type ImprovementStrategyQualityPolicyTrendGovernance = {
  status: 'insufficient' | 'clear' | 'watch' | 'action-required';
  blockedFields: ImprovementStrategyQualityPolicyField[];
  reviewRollback: boolean;
  recommendations: Array<
    | {
        action: 'review-rollback';
        priority: 'high';
        summary: string;
      }
    | {
        action: 'pause-field-automation';
        priority: 'high';
        field: ImprovementStrategyQualityPolicyField;
        summary: string;
      }
    | {
        action: 'prioritize-revalidation';
        priority: 'medium';
        field: ImprovementStrategyQualityPolicyField;
        summary: string;
      }
    | {
        action: 'investigate-duration';
        priority: 'medium';
        summary: string;
      }
  >;
  summary: string;
};

export function governImprovementStrategyQualityPolicyTrend(input: {
  trend: ImprovementStrategyQualityPolicyRevalidationTrend;
}): ImprovementStrategyQualityPolicyTrendGovernance {
  if (input.trend.dataStatus === 'insufficient') {
    return {
      status: 'insufficient',
      blockedFields: [],
      reviewRollback: false,
      recommendations: [],
      summary: '趋势样本不足，不改变现有质量门禁治理。',
    };
  }

  const successDrop = input.trend.alerts.find(
    ({ kind }) => kind === 'success-rate-drop',
  );
  const durationIncrease = input.trend.alerts.find(
    ({ kind }) => kind === 'duration-increase',
  );
  const riskFields = [
    ...new Set(
      input.trend.alerts
        .filter(
          (
            alert,
          ): alert is Extract<
            ImprovementStrategyQualityPolicyRevalidationTrend['alerts'][number],
            { kind: 'field-risk-spike' }
          > => alert.kind === 'field-risk-spike',
        )
        .map(({ field }) => field),
    ),
  ];
  const recommendations: ImprovementStrategyQualityPolicyTrendGovernance['recommendations'] =
    [];
  if (successDrop) {
    recommendations.push({
      action: 'review-rollback',
      priority: 'high',
      summary:
        '近期完成率显著下降；暂停生成新的自动校准提案，优先人工审查上一稳定版本。',
    });
  }
  for (const field of riskFields) {
    recommendations.push({
      action: 'pause-field-automation',
      priority: 'high',
      field,
      summary: `${field} 近期风险突增，暂停该字段的自动校准晋升。`,
    });
    recommendations.push({
      action: 'prioritize-revalidation',
      priority: 'medium',
      field,
      summary: `${field} 下一次变更应优先走人工批准的复验流程。`,
    });
  }
  if (durationIncrease) {
    recommendations.push({
      action: 'investigate-duration',
      priority: 'medium',
      summary:
        '近期复验耗时显著增加，建议检查样本采集、上下文稳定性与阶段切换。',
    });
  }

  const hasHighPriority = recommendations.some(
    ({ priority }) => priority === 'high',
  );
  return {
    status:
      recommendations.length === 0
        ? 'clear'
        : hasHighPriority
          ? 'action-required'
          : 'watch',
    blockedFields: riskFields,
    reviewRollback: Boolean(successDrop),
    recommendations,
    summary:
      recommendations.length === 0
        ? '近期趋势未触发额外治理动作。'
        : `趋势治理生成 ${recommendations.length} 项建议，其中 ${riskFields.length} 个字段暂停自动晋升。`,
  };
}
