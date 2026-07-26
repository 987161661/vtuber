import type { ImprovementStrategyQualityPolicyReleaseObservation } from './improvementStrategyQualityPolicyObservation';
import type {
  ImprovementStrategyQualityPolicy,
  ImprovementStrategyQualityPolicyField,
} from './improvementStrategyQualityPolicy';

export type ImprovementStrategyQualityPolicyAttribution = {
  status:
    | 'insufficient'
    | 'improved'
    | 'neutral'
    | 'tradeoff'
    | 'regressed'
    | 'unattributable';
  changedField: ImprovementStrategyQualityPolicyField | null;
  from: number | string | null;
  to: number | string | null;
  positiveSignals: number;
  negativeSignals: number;
  summary: string;
};

const fieldLabels: Record<ImprovementStrategyQualityPolicyField, string> = {
  warningPenalty: '警告扣分',
  maxInstructionClauses: '指令步骤上限',
  confoundedExecution: '混杂实验处理',
};

function changedFields(
  baseline: ImprovementStrategyQualityPolicy,
  current: ImprovementStrategyQualityPolicy,
): ImprovementStrategyQualityPolicyField[] {
  return (
    [
      'warningPenalty',
      'maxInstructionClauses',
      'confoundedExecution',
    ] as const
  ).filter((field) => baseline[field] !== current[field]);
}

export function attributeImprovementStrategyQualityPolicyRelease(input: {
  baseline: ImprovementStrategyQualityPolicy;
  current: ImprovementStrategyQualityPolicy;
  observation: ImprovementStrategyQualityPolicyReleaseObservation;
}): ImprovementStrategyQualityPolicyAttribution {
  const fields = changedFields(input.baseline, input.current);
  if (fields.length !== 1) {
    return {
      status: 'unattributable',
      changedField: null,
      from: null,
      to: null,
      positiveSignals: 0,
      negativeSignals: 0,
      summary:
        fields.length > 1
          ? `V${input.current.version} 同时改变了 ${fields.length} 个参数，不能做单变量影响归因。`
          : `V${input.current.version} 与基准配置相同，没有可归因的参数变化。`,
    };
  }
  const changedField = fields[0];
  const from = input.baseline[changedField];
  const to = input.current[changedField];
  if (input.observation.status === 'insufficient') {
    return {
      status: 'insufficient',
      changedField,
      from,
      to,
      positiveSignals: 0,
      negativeSignals: 0,
      summary: `${fieldLabels[changedField]}的观察窗尚未完成，暂不判断参数影响。`,
    };
  }
  const { blockRate, executionRate, usabilityRate } =
    input.observation.delta;
  const positiveSignals = [
    (usabilityRate ?? 0) >= 10,
    (blockRate ?? 0) <= -10,
    (executionRate ?? 0) >= 10,
  ].filter(Boolean).length;
  const negativeSignals = [
    (usabilityRate ?? 0) <= -10,
    (blockRate ?? 0) >= 10,
    (executionRate ?? 0) <= -10,
  ].filter(Boolean).length;
  const status: ImprovementStrategyQualityPolicyAttribution['status'] =
    input.observation.recommendRollback
      ? 'regressed'
      : positiveSignals && negativeSignals
        ? 'tradeoff'
        : positiveSignals
          ? 'improved'
          : negativeSignals
            ? 'regressed'
            : 'neutral';
  const summary =
    status === 'improved'
      ? `${fieldLabels[changedField]}的单变量调整改善了证据可用率或运行护栏，未发现显著反向信号。`
      : status === 'tradeoff'
        ? `${fieldLabels[changedField]}同时带来改善与代价，需要结合目标优先级人工判断。`
        : status === 'regressed'
          ? `${fieldLabels[changedField]}产生显著退化信号，应优先考虑恢复基准配置。`
          : `${fieldLabels[changedField]}尚未产生超过 10 个百分点的显著影响。`;
  return {
    status,
    changedField,
    from,
    to,
    positiveSignals,
    negativeSignals,
    summary,
  };
}
