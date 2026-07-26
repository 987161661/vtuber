import { describe, expect, it } from 'vitest';
import type {
  ImprovementStrategyQualityPolicyRevalidationConclusion,
  ImprovementStrategyQualityPolicyRevalidationRun,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyRevalidation';
import { projectImprovementStrategyQualityPolicyRevalidationAnalytics } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyRevalidationAnalytics';
import { governImprovementStrategyQualityPolicyTrend } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyTrendGovernance';

function conclusion(
  reason: ImprovementStrategyQualityPolicyRevalidationConclusion['reason'],
): ImprovementStrategyQualityPolicyRevalidationConclusion {
  return {
    reason,
    evidenceAt: 100,
    evidenceSummary: reason,
  };
}

function run(
  overrides: Partial<ImprovementStrategyQualityPolicyRevalidationRun>,
): ImprovementStrategyQualityPolicyRevalidationRun {
  return {
    runId: 'run',
    target: {
      field: 'warningPenalty',
      from: 15,
      to: 10,
    },
    status: 'completed',
    startedAt: 0,
    endedAt: 100,
    actions: ['measure', 'completed'],
    eventCount: 2,
    conclusion: conclusion('fresh-evidence-threshold-met'),
    ...overrides,
  };
}

describe('improvement strategy quality policy revalidation analytics', () => {
  it('separates evaluated outcomes from external interruptions', () => {
    const analytics =
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: [
          run({ runId: 'warning-completed' }),
          run({
            runId: 'warning-failed',
            status: 'failed',
            startedAt: 200,
            endedAt: 500,
            actions: ['measure', 'failed'],
            conclusion: conclusion('fresh-negative-evidence'),
          }),
          run({
            runId: 'warning-expired',
            status: 'expired',
            startedAt: 600,
            endedAt: 1_000,
            actions: ['measure', 'expired'],
            conclusion: conclusion('freshness-window-elapsed'),
          }),
          run({
            runId: 'clauses-completed',
            target: {
              field: 'maxInstructionClauses',
              from: 3,
              to: 2,
            },
            startedAt: 1_000,
            endedAt: 1_200,
          }),
          run({
            runId: 'clauses-context',
            target: {
              field: 'maxInstructionClauses',
              from: 3,
              to: 2,
            },
            status: 'context-changed',
            startedAt: 1_300,
            endedAt: 1_400,
            actions: ['measure', 'context-changed'],
            conclusion: conclusion('experiment-context-changed'),
          }),
          run({
            runId: 'active',
            status: 'active',
            startedAt: 1_500,
            endedAt: 1_500,
            actions: ['measure'],
            conclusion: null,
          }),
          run({
            runId: 'cancelled',
            status: 'cancelled',
            startedAt: 1_600,
            endedAt: 1_700,
            actions: ['measure', 'cancel'],
            conclusion: null,
          }),
        ],
      });

    expect(analytics.summary).toEqual({
      dataStatus: 'ready',
      totalRuns: 7,
      settledRuns: 5,
      evaluatedRuns: 4,
      completedRuns: 2,
      externalInterruptions: 1,
      successRate: 0.5,
      averageDurationMs: 220,
    });
    expect(analytics.failureReasons).toEqual([
      {
        reason: 'experiment-context-changed',
        count: 1,
        share: 1 / 3,
      },
      {
        reason: 'fresh-negative-evidence',
        count: 1,
        share: 1 / 3,
      },
      {
        reason: 'freshness-window-elapsed',
        count: 1,
        share: 1 / 3,
      },
    ]);
    expect(analytics.fieldRisks).toEqual([
      {
        field: 'warningPenalty',
        evaluatedRuns: 3,
        adverseRuns: 2,
        riskRate: 2 / 3,
        riskLevel: 'high',
      },
      {
        field: 'maxInstructionClauses',
        evaluatedRuns: 1,
        adverseRuns: 0,
        riskRate: 0,
        riskLevel: 'low',
      },
    ]);
  });

  it('reports empty and limited evidence without inventing rates', () => {
    expect(
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: [],
      }),
    ).toMatchObject({
      summary: {
        dataStatus: 'empty',
        successRate: null,
        averageDurationMs: null,
      },
      failureReasons: [],
      fieldRisks: [],
    });

    expect(
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: [run({ runId: 'only-run' })],
      }).summary,
    ).toMatchObject({
      dataStatus: 'limited',
      settledRuns: 1,
      successRate: 1,
    });
  });

  it('detects recent success, duration, and field-risk regressions', () => {
    const hour = 60 * 60_000;
    const baselineStatuses = [
      'completed',
      'completed',
      'completed',
      'completed',
      'failed',
    ] as const;
    const recentStatuses = [
      'completed',
      'failed',
      'failed',
      'completed',
      'failed',
    ] as const;
    const evaluatedRun = (
      index: number,
      status: 'completed' | 'failed',
      duration: number,
      field: 'warningPenalty' | 'maxInstructionClauses',
    ) => {
      const endedAt = (index + 1) * hour;
      return run({
        runId: `run-${index}`,
        target:
          field === 'warningPenalty'
            ? {
                field,
                from: 15,
                to: 10,
              }
            : {
                field,
                from: 3,
                to: 2,
              },
        status,
        startedAt: endedAt - duration,
        endedAt,
        actions: [
          'measure',
          status === 'completed' ? 'completed' : 'failed',
        ],
        conclusion:
          status === 'completed'
            ? conclusion('fresh-evidence-threshold-met')
            : conclusion('fresh-negative-evidence'),
      });
    };
    const analytics =
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: [
          ...baselineStatuses.map((status, index) =>
            evaluatedRun(
              index,
              status,
              hour,
              index < 3
                ? 'warningPenalty'
                : 'maxInstructionClauses',
            ),
          ),
          ...recentStatuses.map((status, offset) =>
            evaluatedRun(
              offset + 5,
              status,
              2 * hour,
              offset < 3
                ? 'warningPenalty'
                : 'maxInstructionClauses',
            ),
          ),
        ],
      });

    expect(analytics.trend).toMatchObject({
      dataStatus: 'ready',
      status: 'declining',
      windowSize: 5,
      recent: {
        runs: 5,
        successRate: 0.4,
        averageDurationMs: 2 * hour,
      },
      baseline: {
        runs: 5,
        successRate: 0.8,
        averageDurationMs: hour,
      },
      successRateDelta: -0.4,
    });
    expect(analytics.trend.alerts).toEqual([
      expect.objectContaining({
        kind: 'success-rate-drop',
        severity: 'high',
      }),
      expect.objectContaining({
        kind: 'duration-increase',
        severity: 'medium',
      }),
      expect.objectContaining({
        kind: 'field-risk-spike',
        severity: 'high',
        field: 'warningPenalty',
      }),
    ]);
    expect(
      governImprovementStrategyQualityPolicyTrend({
        trend: analytics.trend,
      }),
    ).toMatchObject({
      status: 'action-required',
      blockedFields: ['warningPenalty'],
      reviewRollback: true,
      recommendations: [
        { action: 'review-rollback', priority: 'high' },
        {
          action: 'pause-field-automation',
          priority: 'high',
          field: 'warningPenalty',
        },
        {
          action: 'prioritize-revalidation',
          priority: 'medium',
          field: 'warningPenalty',
        },
        { action: 'investigate-duration', priority: 'medium' },
      ],
    });
  });

  it('does not emit trend alerts before both windows have enough runs', () => {
    const analytics =
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: [
          run({ runId: 'one' }),
          run({
            runId: 'two',
            status: 'failed',
            startedAt: 200,
            endedAt: 300,
            actions: ['measure', 'failed'],
            conclusion: conclusion('fresh-negative-evidence'),
          }),
        ],
      });

    expect(analytics.trend).toMatchObject({
      dataStatus: 'insufficient',
      status: 'insufficient',
      alerts: [],
    });
  });

  it('recognizes improvement without emitting regression alerts', () => {
    const outcomes = [
      'failed',
      'failed',
      'completed',
      'completed',
      'completed',
      'completed',
    ] as const;
    const analytics =
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: outcomes.map((status, index) =>
          run({
            runId: `improving-${index}`,
            status,
            startedAt: index * 1_000,
            endedAt: index * 1_000 + 500,
            actions: [
              'measure',
              status === 'completed' ? 'completed' : 'failed',
            ],
            conclusion:
              status === 'completed'
                ? conclusion('fresh-evidence-threshold-met')
                : conclusion('fresh-negative-evidence'),
          }),
        ),
        trendWindowSize: 3,
        trendMinimumRuns: 3,
      });

    expect(analytics.trend).toMatchObject({
      dataStatus: 'ready',
      status: 'improving',
      alerts: [],
    });
    expect(analytics.trend.successRateDelta).toBeCloseTo(2 / 3);
    expect(
      governImprovementStrategyQualityPolicyTrend({
        trend: analytics.trend,
      }),
    ).toMatchObject({
      status: 'clear',
      blockedFields: [],
      reviewRollback: false,
      recommendations: [],
    });
  });
});
