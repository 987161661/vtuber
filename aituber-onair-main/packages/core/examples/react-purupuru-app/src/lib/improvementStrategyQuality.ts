import {
  composeImprovementStrategy,
  prepareImprovementStrategyExperiment,
  type ImprovementStrategy,
  type ImprovementStrategyDraft,
  type NextImprovementStrategySelection,
} from './improvementStrategyExperiment';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';
import {
  DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  type ImprovementStrategyQualityPolicy,
} from './improvementStrategyQualityPolicy';

export type ImprovementStrategyQualityCheck = {
  id: 'definition' | 'control' | 'execution' | 'observation' | 'novelty';
  label: string;
  status: 'pass' | 'warning' | 'block';
  detail: string;
};

export type ImprovementStrategyExecutionPreview = {
  status:
    | 'blocked'
    | 'history-unavailable'
    | 'waiting'
    | 'controlled'
    | 'confounded';
  nextStep:
    | 'fix-draft'
    | 'load-history'
    | 'establish-baseline'
    | 'wait'
    | 'explore'
    | 'execute-with-warning';
  strategyLabel?: string;
  detail: string;
};

export type ImprovementStrategyQualityInput = {
  improvementId: string;
  draft: ImprovementStrategyDraft;
  strategies: readonly ImprovementStrategy[];
  actions: readonly NextSessionImprovementActionRuntimeEvent[];
  baseSessionId?: string;
  historyReady: boolean;
  selection: NextImprovementStrategySelection;
  editingStrategyId?: string;
  policy?: ImprovementStrategyQualityPolicy;
};

export type ImprovementStrategyQualityReview = {
  status: 'blocked' | 'review' | 'ready';
  score: number;
  canSave: boolean;
  canExecute: boolean;
  strategy: ImprovementStrategy | null;
  duplicateStrategyId?: string;
  fieldErrors: Partial<Record<keyof ImprovementStrategyDraft, string>>;
  checks: ImprovementStrategyQualityCheck[];
  execution: ImprovementStrategyExecutionPreview;
};

const observableOutcomePattern =
  /(?:\d|无|零|增|减|升|降|保持|不超过|至少|至多|以内)/u;

function normalizedBehavior(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s，。；、,.!?！？:："'“”‘’()[\]（）【】_-]+/gu, '');
}

function executionPreview(input: {
  reviewInput: ImprovementStrategyQualityInput;
  strategy: ImprovementStrategy | null;
}): ImprovementStrategyExecutionPreview {
  const { reviewInput, strategy } = input;
  if (!strategy) {
    return {
      status: 'blocked',
      nextStep: 'fix-draft',
      detail: '先修复策略定义中的阻断项。',
    };
  }
  if (!reviewInput.historyReady) {
    return {
      status: 'history-unavailable',
      nextStep: 'load-history',
      strategyLabel: strategy.label,
      detail: '实验历史尚未就绪，策略可以保存，但暂不能安全执行。',
    };
  }
  if (!reviewInput.baseSessionId) {
    return {
      status: 'blocked',
      nextStep: 'establish-baseline',
      strategyLabel: strategy.label,
      detail: '尚无上一场基线，先完成一场直播复盘再启动实验。',
    };
  }
  if (reviewInput.selection.mode === 'wait') {
    return {
      status: 'waiting',
      nextStep: 'wait',
      strategyLabel: strategy.label,
      detail: '已有策略正在等待下一场结果；新资产可保存，但暂不重复执行。',
    };
  }
  const prepared = prepareImprovementStrategyExperiment({
    actions: reviewInput.actions,
    baseSessionId: reviewInput.baseSessionId,
    improvementId: reviewInput.improvementId,
    strategyId: strategy.id,
    strategyCatalog: [...reviewInput.strategies, strategy],
  });
  return prepared.controlled
    ? {
        status: 'controlled',
        nextStep: 'explore',
        strategyLabel: strategy.label,
        detail: `将只改变“${strategy.variable}”变量，并把该策略作为新的探索样本。`,
      }
    : {
        status: 'confounded',
        nextStep: 'execute-with-warning',
        strategyLabel: strategy.label,
        detail:
          '同一基线场次已有其他受控实验；仍可执行，但结果不会纳入策略对照。',
      };
}

export function reviewImprovementStrategyDraft(
  input: ImprovementStrategyQualityInput,
): ImprovementStrategyQualityReview {
  const policy =
    input.policy ?? DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY;
  const composition = composeImprovementStrategy({
    improvementId: input.improvementId,
    draft: input.draft,
  });
  const strategy = composition.ok ? composition.strategy : null;
  const definitionError = composition.ok
    ? undefined
    : composition.errors.label ?? composition.errors.variable;
  const executionError = composition.ok
    ? undefined
    : composition.errors.instruction;
  const observationError = composition.ok
    ? undefined
    : composition.errors.successSignal;
  const clauseCount = input.draft.instruction
    .split(/[，。；,;]/u)
    .filter((clause) => clause.trim()).length;
  const behaviorKey = strategy
    ? `${strategy.variable}:${normalizedBehavior(strategy.instruction)}`
    : '';
  const duplicate = strategy
    ? input.strategies.find(
        (candidate) =>
          (!candidate.improvementId ||
            candidate.improvementId === input.improvementId) &&
          (candidate.id === strategy.id ||
            (candidate.id !== input.editingStrategyId &&
              `${candidate.variable}:${normalizedBehavior(candidate.instruction)}` ===
                behaviorKey)),
      )
    : undefined;
  const checks: ImprovementStrategyQualityCheck[] = [
    {
      id: 'definition',
      label: '策略定义',
      status: definitionError ? 'block' : 'pass',
      detail: definitionError ?? '名称和改进目标定义完整。',
    },
    {
      id: 'control',
      label: '单一变量',
      status: composition.ok ? 'pass' : 'block',
      detail: composition.ok
        ? `本轮只改变“${input.draft.variable}”变量。`
        : '先完成有效的策略定义。',
    },
    {
      id: 'execution',
      label: '执行聚焦',
      status: executionError
        ? 'block'
        : clauseCount > policy.maxInstructionClauses
          ? 'warning'
          : 'pass',
      detail:
        executionError ??
        (clauseCount > policy.maxInstructionClauses
          ? `执行指令超过 V${policy.version} 门禁允许的 ${policy.maxInstructionClauses} 个步骤，建议缩小为一个可控动作。`
          : '执行指令足够聚焦，可直接用于实验。'),
    },
    {
      id: 'observation',
      label: '结果可观测',
      status: observationError
        ? 'block'
        : observableOutcomePattern.test(input.draft.successSignal)
          ? 'pass'
          : 'warning',
      detail:
        observationError ??
        (observableOutcomePattern.test(input.draft.successSignal)
          ? '成功信号包含明确的数量或方向变化。'
          : '成功信号缺少数量、增减或边界方向，复盘时可能无法判定。'),
    },
    {
      id: 'novelty',
      label: '策略新颖性',
      status: duplicate ? 'block' : strategy ? 'pass' : 'block',
      detail: duplicate
        ? `与已有策略“${duplicate.label}”的受控变量和执行行为重复。`
        : strategy
          ? '未发现相同执行行为的策略资产。'
          : '草稿有效后才能检查策略重复。',
    },
  ];
  const blocking = checks.filter(({ status }) => status === 'block').length;
  const warnings = checks.filter(({ status }) => status === 'warning').length;
  const status = blocking ? 'blocked' : warnings ? 'review' : 'ready';
  const execution = executionPreview({ reviewInput: input, strategy });
  return {
    status,
    score: Math.max(
      0,
      100 - blocking * 25 - warnings * policy.warningPenalty,
    ),
    canSave: blocking === 0,
    canExecute:
      blocking === 0 &&
      !['blocked', 'history-unavailable', 'waiting'].includes(
        execution.status,
      ) &&
      !(
        execution.status === 'confounded' &&
        policy.confoundedExecution === 'block'
      ),
    strategy,
    ...(duplicate ? { duplicateStrategyId: duplicate.id } : {}),
    fieldErrors: composition.ok ? {} : composition.errors,
    checks,
    execution,
  };
}
