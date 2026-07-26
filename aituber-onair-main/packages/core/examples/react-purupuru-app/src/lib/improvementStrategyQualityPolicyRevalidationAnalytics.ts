import type { ImprovementStrategyQualityPolicyField } from './improvementStrategyQualityPolicy';
import type {
  ImprovementStrategyQualityPolicyRevalidationRun,
  ImprovementStrategyQualityPolicyRevalidationTerminalReason,
} from './improvementStrategyQualityPolicyRevalidation';

type SettledStatus =
  | 'completed'
  | 'failed'
  | 'expired'
  | 'context-changed'
  | 'interrupted';

type EvaluatedStatus = Extract<
  SettledStatus,
  'completed' | 'failed' | 'expired'
>;

export type ImprovementStrategyQualityPolicyRevalidationTrend = {
  dataStatus: 'insufficient' | 'ready';
  status: 'insufficient' | 'stable' | 'improving' | 'declining';
  windowSize: number;
  minimumWindowRuns: number;
  recent: {
    runs: number;
    successRate: number | null;
    averageDurationMs: number | null;
  };
  baseline: {
    runs: number;
    successRate: number | null;
    averageDurationMs: number | null;
  };
  successRateDelta: number | null;
  alerts: Array<
    | {
        kind: 'success-rate-drop';
        severity: 'high';
        delta: number;
        summary: string;
      }
    | {
        kind: 'duration-increase';
        severity: 'medium';
        delta: number;
        summary: string;
      }
    | {
        kind: 'field-risk-spike';
        severity: 'high';
        field: ImprovementStrategyQualityPolicyField;
        delta: number;
        summary: string;
      }
  >;
};

export type ImprovementStrategyQualityPolicyRevalidationAnalytics = {
  summary: {
    dataStatus: 'empty' | 'limited' | 'ready';
    totalRuns: number;
    settledRuns: number;
    evaluatedRuns: number;
    completedRuns: number;
    externalInterruptions: number;
    successRate: number | null;
    averageDurationMs: number | null;
  };
  failureReasons: Array<{
    reason: ImprovementStrategyQualityPolicyRevalidationTerminalReason;
    count: number;
    share: number;
  }>;
  fieldRisks: Array<{
    field: ImprovementStrategyQualityPolicyField;
    evaluatedRuns: number;
    adverseRuns: number;
    riskRate: number;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
  trend: ImprovementStrategyQualityPolicyRevalidationTrend;
};

export const IMPROVEMENT_STRATEGY_REVALIDATION_TREND_WINDOW_SIZE = 5;
export const IMPROVEMENT_STRATEGY_REVALIDATION_TREND_MINIMUM_RUNS = 3;

const fallbackFailureReason: Record<
  SettledStatus,
  ImprovementStrategyQualityPolicyRevalidationTerminalReason
> = {
  completed: 'fresh-evidence-threshold-met',
  failed: 'fresh-negative-evidence',
  expired: 'freshness-window-elapsed',
  'context-changed': 'experiment-context-changed',
  interrupted: 'policy-release-interrupted',
};

function isSettledRun(
  run: ImprovementStrategyQualityPolicyRevalidationRun,
): run is ImprovementStrategyQualityPolicyRevalidationRun & {
  status: SettledStatus;
} {
  return (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'expired' ||
    run.status === 'context-changed' ||
    run.status === 'interrupted'
  );
}

function isEvaluatedRun(
  run: ImprovementStrategyQualityPolicyRevalidationRun,
): run is ImprovementStrategyQualityPolicyRevalidationRun & {
  status: EvaluatedStatus;
} {
  return (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'expired'
  );
}

function summarizeTrendWindow(
  runs: readonly (ImprovementStrategyQualityPolicyRevalidationRun & {
    status: EvaluatedStatus;
  })[],
): {
  runs: number;
  successRate: number | null;
  averageDurationMs: number | null;
} {
  if (runs.length === 0) {
    return {
      runs: 0,
      successRate: null,
      averageDurationMs: null,
    };
  }
  return {
    runs: runs.length,
    successRate:
      runs.filter(({ status }) => status === 'completed').length /
      runs.length,
    averageDurationMs:
      runs.reduce(
        (total, run) =>
          total + Math.max(0, run.endedAt - run.startedAt),
        0,
      ) / runs.length,
  };
}

function fieldRiskRates(
  runs: readonly (ImprovementStrategyQualityPolicyRevalidationRun & {
    status: EvaluatedStatus;
  })[],
): Map<
  ImprovementStrategyQualityPolicyField,
  { runs: number; riskRate: number }
> {
  const counts = new Map<
    ImprovementStrategyQualityPolicyField,
    { runs: number; adverse: number }
  >();
  for (const run of runs) {
    const count = counts.get(run.target.field) ?? {
      runs: 0,
      adverse: 0,
    };
    count.runs += 1;
    if (run.status === 'failed' || run.status === 'expired') {
      count.adverse += 1;
    }
    counts.set(run.target.field, count);
  }
  return new Map(
    [...counts.entries()].map(([field, count]) => [
      field,
      {
        runs: count.runs,
        riskRate: count.adverse / count.runs,
      },
    ]),
  );
}

export function projectImprovementStrategyQualityPolicyRevalidationAnalytics(
  input: {
    runs: readonly ImprovementStrategyQualityPolicyRevalidationRun[];
    trendWindowSize?: number;
    trendMinimumRuns?: number;
  },
): ImprovementStrategyQualityPolicyRevalidationAnalytics {
  const settled = input.runs.filter(isSettledRun);
  const evaluated = settled.filter(isEvaluatedRun);
  const completedRuns = evaluated.filter(
    ({ status }) => status === 'completed',
  ).length;
  const externalInterruptions = settled.filter(
    ({ status }) =>
      status === 'context-changed' || status === 'interrupted',
  ).length;
  const averageDurationMs = settled.length
    ? settled.reduce(
        (total, run) =>
          total + Math.max(0, run.endedAt - run.startedAt),
        0,
      ) / settled.length
    : null;

  const failedRuns = settled.filter(
    ({ status }) => status !== 'completed',
  );
  const reasonCounts = new Map<
    ImprovementStrategyQualityPolicyRevalidationTerminalReason,
    number
  >();
  for (const run of failedRuns) {
    const reason =
      run.conclusion?.reason ?? fallbackFailureReason[run.status];
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const failureReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      share: count / failedRuns.length,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.reason.localeCompare(right.reason),
    );

  const fieldGroups = new Map<
    ImprovementStrategyQualityPolicyField,
    { evaluatedRuns: number; adverseRuns: number }
  >();
  for (const run of evaluated) {
    const group = fieldGroups.get(run.target.field) ?? {
      evaluatedRuns: 0,
      adverseRuns: 0,
    };
    group.evaluatedRuns += 1;
    if (run.status === 'failed' || run.status === 'expired') {
      group.adverseRuns += 1;
    }
    fieldGroups.set(run.target.field, group);
  }
  const fieldRisks = [...fieldGroups.entries()]
    .map(([field, group]) => {
      const riskRate = group.adverseRuns / group.evaluatedRuns;
      const riskLevel: 'low' | 'medium' | 'high' =
        group.evaluatedRuns >= 3 && riskRate >= 0.5
          ? 'high'
          : group.adverseRuns > 0
            ? 'medium'
            : 'low';
      return {
        field,
        ...group,
        riskRate,
        riskLevel,
      };
    })
    .sort(
      (left, right) =>
        right.riskRate - left.riskRate ||
        right.adverseRuns - left.adverseRuns ||
        right.evaluatedRuns - left.evaluatedRuns ||
        left.field.localeCompare(right.field),
    );

  const trendWindowSize = Math.max(
    1,
    Math.floor(
      input.trendWindowSize ??
        IMPROVEMENT_STRATEGY_REVALIDATION_TREND_WINDOW_SIZE,
    ),
  );
  const trendMinimumRuns = Math.max(
    1,
    Math.min(
      trendWindowSize,
      Math.floor(
        input.trendMinimumRuns ??
          IMPROVEMENT_STRATEGY_REVALIDATION_TREND_MINIMUM_RUNS,
      ),
    ),
  );
  const evaluatedByRecency = [...evaluated].sort(
    (left, right) => right.endedAt - left.endedAt,
  );
  const recentRuns = evaluatedByRecency.slice(0, trendWindowSize);
  const baselineRuns = evaluatedByRecency.slice(
    trendWindowSize,
    trendWindowSize * 2,
  );
  const recentTrend = summarizeTrendWindow(recentRuns);
  const baselineTrend = summarizeTrendWindow(baselineRuns);
  const trendReady =
    recentRuns.length >= trendMinimumRuns &&
    baselineRuns.length >= trendMinimumRuns;
  const successRateDelta =
    recentTrend.successRate !== null &&
    baselineTrend.successRate !== null
      ? recentTrend.successRate - baselineTrend.successRate
      : null;
  const trendAlerts: ImprovementStrategyQualityPolicyRevalidationTrend['alerts'] =
    [];
  if (
    trendReady &&
    successRateDelta !== null &&
    successRateDelta <= -0.2
  ) {
    trendAlerts.push({
      kind: 'success-rate-drop',
      severity: 'high',
      delta: successRateDelta,
      summary: `近期完成率下降 ${Math.round(Math.abs(successRateDelta) * 100)} 个百分点。`,
    });
  }
  if (
    trendReady &&
    recentTrend.averageDurationMs !== null &&
    baselineTrend.averageDurationMs !== null &&
    baselineTrend.averageDurationMs > 0 &&
    recentTrend.averageDurationMs - baselineTrend.averageDurationMs >=
      30 * 60_000 &&
    recentTrend.averageDurationMs >=
      baselineTrend.averageDurationMs * 1.5
  ) {
    trendAlerts.push({
      kind: 'duration-increase',
      severity: 'medium',
      delta:
        recentTrend.averageDurationMs /
        baselineTrend.averageDurationMs,
      summary: '近期平均复验耗时达到前一窗口的 1.5 倍以上。',
    });
  }
  if (trendReady) {
    const recentFieldRisks = fieldRiskRates(recentRuns);
    const baselineFieldRisks = fieldRiskRates(baselineRuns);
    for (const [field, recentRisk] of recentFieldRisks) {
      const baselineRisk = baselineFieldRisks.get(field);
      if (
        recentRisk.runs >= 2 &&
        baselineRisk &&
        baselineRisk.runs >= 2 &&
        recentRisk.riskRate - baselineRisk.riskRate >= 0.5
      ) {
        trendAlerts.push({
          kind: 'field-risk-spike',
          severity: 'high',
          field,
          delta: recentRisk.riskRate - baselineRisk.riskRate,
          summary: `${field} 近期风险率上升 ${Math.round(
            (recentRisk.riskRate - baselineRisk.riskRate) * 100,
          )} 个百分点。`,
        });
      }
    }
  }
  const trendStatus:
    | ImprovementStrategyQualityPolicyRevalidationTrend['status'] =
    !trendReady
      ? 'insufficient'
      : trendAlerts.length > 0
        ? 'declining'
        : successRateDelta !== null && successRateDelta >= 0.2
          ? 'improving'
          : 'stable';

  return {
    summary: {
      dataStatus:
        settled.length === 0
          ? 'empty'
          : settled.length >= 5
            ? 'ready'
            : 'limited',
      totalRuns: input.runs.length,
      settledRuns: settled.length,
      evaluatedRuns: evaluated.length,
      completedRuns,
      externalInterruptions,
      successRate:
        evaluated.length > 0 ? completedRuns / evaluated.length : null,
      averageDurationMs,
    },
    failureReasons,
    fieldRisks,
    trend: {
      dataStatus: trendReady ? 'ready' : 'insufficient',
      status: trendStatus,
      windowSize: trendWindowSize,
      minimumWindowRuns: trendMinimumRuns,
      recent: recentTrend,
      baseline: baselineTrend,
      successRateDelta,
      alerts: trendAlerts,
    },
  };
}
