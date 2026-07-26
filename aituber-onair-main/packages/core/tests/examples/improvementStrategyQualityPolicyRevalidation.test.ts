import { describe, expect, it } from 'vitest';
import type { ImprovementStrategyQualityPolicyEffectLedger } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyEffectLedger';
import {
  createImprovementStrategyQualityPolicyRevalidationControlEvent,
  createImprovementStrategyQualityPolicyRevalidationTerminalEvent,
  projectImprovementStrategyQualityPolicyRevalidationHistory,
  projectImprovementStrategyQualityPolicyRevalidationLifecycle,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyRevalidation';
import type { NextSessionImprovementActionRuntimeEvent } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';

const scope = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
};

function directionEffect(
  overrides: Partial<
    ImprovementStrategyQualityPolicyEffectLedger['directionEffects'][number]
  > = {},
): ImprovementStrategyQualityPolicyEffectLedger['directionEffects'][number] {
  return {
    field: 'warningPenalty',
    from: 15,
    to: 10,
    samples: 1,
    exactSamples: 1,
    legacySamples: 0,
    excludedContextSamples: 0,
    freshSamples: 1,
    staleSamples: 0,
    latestEvidenceAt: 120,
    freshness: 'fresh',
    improved: 1,
    neutral: 0,
    tradeoff: 0,
    regressed: 0,
    confidence: 'low',
    recommendation: 'prefer',
    influence: 'advisory',
    effectScore: 2,
    priorityScore: 2,
    ...overrides,
  };
}

function ledger(
  effect = directionEffect(),
): ImprovementStrategyQualityPolicyEffectLedger {
  return {
    experiments: [],
    effects: [],
    directionEffects: [effect],
    recommendedFieldOrder: [
      'confoundedExecution',
      'maxInstructionClauses',
      'warningPenalty',
    ],
  };
}

function event(
  overrides: Partial<NextSessionImprovementActionRuntimeEvent> = {},
): NextSessionImprovementActionRuntimeEvent {
  return {
    stage: 'operator_next_session_improvement_quality_policy',
    at: 100,
    strategyQualityPolicyVersion: 4,
    strategyQualityPolicyTrigger: 'revalidation',
    strategyQualityPolicyRevalidationReason: 'sample-gap',
    strategyQualityPolicyRevalidationPhase: 'measure',
    strategyQualityPolicyRevalidationTargetField: 'warningPenalty',
    strategyQualityPolicyRevalidationTargetFrom: 15,
    strategyQualityPolicyRevalidationTargetTo: 10,
    strategyQualityPolicyRevalidationRequiredSamples: 2,
    strategyQualityPolicyRevalidationCollectedSamples: 0,
    strategyQualityPolicyRevalidationRemainingSamples: 2,
    strategyQualityPolicyRevalidationRunId: 'run-1',
    experimentContextId: 'experiment-v1-context-a',
    experimentContextLabel: 'model-a · voice-a · auto',
    ...scope,
    ...overrides,
  };
}

describe('improvement strategy quality policy revalidation lifecycle', () => {
  it('reconstructs an active target and completes it from fresh exact evidence', () => {
    const active =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event()],
        ledger: ledger(),
        scope,
        now: 150,
        freshnessWindowMs: 1_000,
      });

    expect(active).toMatchObject({
      status: 'active',
      runId: 'run-1',
      target: {
        field: 'warningPenalty',
        from: 15,
        to: 10,
      },
      phase: 'measure',
      progress: {
        collectedFreshSamples: 1,
        requiredFreshSamples: 2,
        remainingFreshSamples: 1,
      },
    });

    const continued =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [
          event(),
          event({
            at: 130,
            strategyQualityPolicyVersion: 5,
            strategyQualityPolicyRevalidationPhase: 'reset-baseline',
          }),
        ],
        ledger: ledger(),
        scope,
        now: 150,
        freshnessWindowMs: 1_000,
      });
    expect(continued).toMatchObject({
      status: 'active',
      runId: 'run-1',
      startedAt: 100,
      phase: 'reset-baseline',
    });

    const completed =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event()],
        ledger: ledger(
          directionEffect({
            samples: 2,
            exactSamples: 2,
            freshSamples: 2,
            improved: 2,
            confidence: 'medium',
            influence: 'automatic',
          }),
        ),
        scope,
        now: 150,
        freshnessWindowMs: 1_000,
      });

    expect(completed).toMatchObject({
      status: 'completed',
      conclusion: {
        reason: 'fresh-evidence-threshold-met',
        evidenceAt: 120,
        evidenceSummary: expect.stringContaining('2/2'),
      },
    });
  });

  it('marks a run failed on fresh negative evidence and interrupted by a later release', () => {
    const failed =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event()],
        ledger: ledger(
          directionEffect({
            improved: 0,
            regressed: 1,
            recommendation: 'caution',
            influence: 'advisory',
            effectScore: -2,
            priorityScore: -2,
          }),
        ),
        scope,
        now: 150,
        freshnessWindowMs: 1_000,
      });
    expect(failed).toMatchObject({
      status: 'failed',
      conclusion: {
        reason: 'fresh-negative-evidence',
        evidenceAt: 120,
        evidenceSummary: expect.stringContaining('退化 1'),
      },
    });

    const interrupted =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [
          event(),
          event({
            at: 200,
            strategyQualityPolicyVersion: 5,
            strategyQualityPolicyTrigger: 'rollback',
            strategyQualityPolicyRevalidationReason: undefined,
            strategyQualityPolicyRevalidationPhase: undefined,
            strategyQualityPolicyRevalidationTargetField: undefined,
            strategyQualityPolicyRevalidationTargetFrom: undefined,
            strategyQualityPolicyRevalidationTargetTo: undefined,
          }),
        ],
        ledger: ledger(),
        scope,
        now: 250,
        freshnessWindowMs: 1_000,
      });
    expect(interrupted).toMatchObject({
      status: 'interrupted',
      conclusion: {
        reason: 'policy-release-interrupted',
        evidenceAt: 200,
        evidenceSummary: expect.stringContaining('V5'),
      },
    });

    const contextChanged =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event()],
        ledger: ledger(),
        scope,
        context: {
          id: 'experiment-v1-context-b',
          label: 'model-b · voice-b · auto',
        },
        now: 150,
        freshnessWindowMs: 1_000,
      });
    expect(contextChanged).toMatchObject({
      status: 'context-changed',
      conclusion: {
        reason: 'experiment-context-changed',
        evidenceAt: 150,
        evidenceSummary: expect.stringContaining(
          'experiment-v1-context-b',
        ),
      },
    });
  });

  it('cancels and restarts the same target through scoped audit events', () => {
    const target = {
      field: 'warningPenalty' as const,
      from: 15,
      to: 10,
    };
    const cancel =
      createImprovementStrategyQualityPolicyRevalidationControlEvent({
        operation: 'cancel',
        target,
        scope,
        context: {
          id: 'experiment-v1-context-a',
          label: 'model-a · voice-a · auto',
        },
        progress: {
          collectedFreshSamples: 1,
          requiredFreshSamples: 2,
        },
        runId: 'run-1',
        at: 150,
      });
    expect(cancel).toMatchObject({
      stage:
        'operator_next_session_improvement_quality_policy_revalidation_control',
      strategyQualityPolicyRevalidationOperation: 'cancel',
      strategyQualityPolicyRevalidationRunId: 'run-1',
      strategyQualityPolicyRevalidationTargetField: 'warningPenalty',
      strategyQualityPolicyRevalidationTargetFrom: 15,
      strategyQualityPolicyRevalidationTargetTo: 10,
      experimentContextId: 'experiment-v1-context-a',
    });

    const cancelled =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event(), cancel],
        ledger: ledger(),
        scope,
        context: {
          id: 'experiment-v1-context-a',
          label: 'model-a · voice-a · auto',
        },
        now: 160,
        freshnessWindowMs: 1_000,
      });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      startedAt: 100,
      target,
    });

    const restart =
      createImprovementStrategyQualityPolicyRevalidationControlEvent({
        operation: 'restart',
        target,
        scope,
        context: {
          id: 'experiment-v1-context-a',
          label: 'model-a · voice-a · auto',
        },
        progress: cancelled.progress,
        runId: cancelled.runId ?? undefined,
        at: 200,
      });
    expect(restart.strategyQualityPolicyRevalidationRunId).not.toBe(
      'run-1',
    );
    const restartedRunId =
      restart.strategyQualityPolicyRevalidationRunId;
    const restarted =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event(), cancel, restart],
        ledger: ledger(),
        scope,
        context: {
          id: 'experiment-v1-context-a',
          label: 'model-a · voice-a · auto',
        },
        now: 220,
        freshnessWindowMs: 1_000,
      });
    expect(restarted).toMatchObject({
      status: 'active',
      startedAt: 200,
      target,
      runId: restartedRunId,
    });

    const ignoredOtherScope =
      createImprovementStrategyQualityPolicyRevalidationControlEvent({
        operation: 'cancel',
        target,
        scope: { ...scope, roomId: 'room-2' },
        at: 250,
      });
    expect(
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event(), cancel, restart, ignoredOtherScope],
        ledger: ledger(),
        scope,
        now: 260,
        freshnessWindowMs: 1_000,
      }).status,
    ).toBe('active');

    const secondMeasurement = event({
      at: 220,
      strategyQualityPolicyVersion: 5,
      strategyQualityPolicyRevalidationRunId: restartedRunId,
    });
    const history =
      projectImprovementStrategyQualityPolicyRevalidationHistory({
        events: [event(), cancel, restart, secondMeasurement],
        current: restarted,
        scope,
      });

    expect(history.runs).toEqual([
      expect.objectContaining({
        runId: restartedRunId,
        status: 'active',
        actions: ['restart', 'measure'],
      }),
      expect.objectContaining({
        runId: 'run-1',
        status: 'cancelled',
        actions: ['measure', 'cancel'],
      }),
    ]);
  });

  it('creates an idempotent terminal snapshot and keeps that conclusion stable', () => {
    const target = {
      field: 'warningPenalty' as const,
      from: 15,
      to: 10,
    };
    const terminalLifecycle = {
      status: 'completed' as const,
      target,
      runId: 'run-1',
      phase: 'measure' as const,
      startedAt: 100,
      progress: {
        collectedFreshSamples: 2,
        requiredFreshSamples: 2,
        remainingFreshSamples: 0,
      },
      conclusion: {
        reason: 'fresh-evidence-threshold-met' as const,
        evidenceAt: 120,
        evidenceSummary: '新鲜精准样本 2/2；影响级别 automatic。',
      },
      summary: 'completed',
    };
    const terminal =
      createImprovementStrategyQualityPolicyRevalidationTerminalEvent({
        lifecycle: terminalLifecycle,
        scope,
        context: {
          id: 'experiment-v1-context-a',
          label: 'model-a / voice-a / auto',
        },
        at: 150,
      });
    const retried =
      createImprovementStrategyQualityPolicyRevalidationTerminalEvent({
        lifecycle: terminalLifecycle,
        scope,
        at: 180,
      });

    expect(terminal).toMatchObject({
      eventId:
        'improvement-strategy-quality-policy-revalidation:terminal:run-1:completed',
      stage:
        'operator_next_session_improvement_quality_policy_revalidation_control',
      strategyQualityPolicyRevalidationTerminalStatus: 'completed',
      strategyQualityPolicyRevalidationRunId: 'run-1',
      strategyQualityPolicyRevalidationTargetField: 'warningPenalty',
      strategyQualityPolicyRevalidationCollectedSamples: 2,
      strategyQualityPolicyRevalidationRemainingSamples: 0,
      strategyQualityPolicyRevalidationTerminalReason:
        'fresh-evidence-threshold-met',
      strategyQualityPolicyRevalidationEvidenceAt: 120,
      strategyQualityPolicyRevalidationEvidenceSummary:
        '新鲜精准样本 2/2；影响级别 automatic。',
      experimentContextId: 'experiment-v1-context-a',
      at: 150,
    });
    expect(retried.eventId).toBe(terminal.eventId);
    expect(retried.at).toBe(180);

    const projected =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event(), terminal],
        ledger: ledger(
          directionEffect({
            freshSamples: 0,
            staleSamples: 2,
            freshness: 'stale',
            influence: 'unproven',
            recommendation: 'observe',
          }),
        ),
        scope,
        now: 10_000,
        freshnessWindowMs: 1_000,
      });

    expect(projected).toMatchObject({
      status: 'completed',
      runId: 'run-1',
      startedAt: 100,
      progress: terminalLifecycle.progress,
      conclusion: terminalLifecycle.conclusion,
    });
  });

  it('retains a previous run terminal status after a new run starts', () => {
    const completed =
      createImprovementStrategyQualityPolicyRevalidationTerminalEvent({
        lifecycle: {
          status: 'completed',
          target: {
            field: 'warningPenalty',
            from: 15,
            to: 10,
          },
          runId: 'run-1',
          phase: 'measure',
          startedAt: 100,
          progress: {
            collectedFreshSamples: 2,
            requiredFreshSamples: 2,
            remainingFreshSamples: 0,
          },
          conclusion: {
            reason: 'fresh-evidence-threshold-met',
            evidenceAt: 120,
            evidenceSummary: '新鲜精准样本 2/2；影响级别 automatic。',
          },
          summary: 'completed',
        },
        scope,
        at: 150,
      });
    const restart =
      createImprovementStrategyQualityPolicyRevalidationControlEvent({
        operation: 'restart',
        target: {
          field: 'warningPenalty',
          from: 15,
          to: 10,
        },
        scope,
        at: 200,
      });
    const current =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event(), completed, restart],
        ledger: ledger(),
        scope,
        now: 220,
        freshnessWindowMs: 1_000,
      });

    const history =
      projectImprovementStrategyQualityPolicyRevalidationHistory({
        events: [event(), completed, restart],
        current,
        scope,
      });

    expect(history.runs).toEqual([
      expect.objectContaining({
        runId: restart.strategyQualityPolicyRevalidationRunId,
        status: 'active',
        actions: ['restart'],
      }),
      expect.objectContaining({
        runId: 'run-1',
        status: 'completed',
        actions: ['measure', 'completed'],
        conclusion: {
          reason: 'fresh-evidence-threshold-met',
          evidenceAt: 120,
          evidenceSummary: '新鲜精准样本 2/2；影响级别 automatic。',
        },
      }),
    ]);
  });

  it('explains expiration with the observed sample gap', () => {
    const expired =
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: [event()],
        ledger: ledger(),
        scope,
        now: 1_101,
        freshnessWindowMs: 1_000,
      });

    expect(expired).toMatchObject({
      status: 'expired',
      conclusion: {
        reason: 'freshness-window-elapsed',
        evidenceAt: 1_101,
        evidenceSummary: expect.stringContaining('仍缺 1'),
      },
    });
  });
});
