import { describe, expect, it } from 'vitest';
import { createImprovementStrategyAssetEvent } from '../../examples/react-purupuru-app/src/lib/improvementStrategyAssets';
import type {
  ImprovementStrategy,
  ImprovementStrategyExperimentRecord,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';
import {
  DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  type ImprovementStrategyQualityPolicy,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicy';
import { projectImprovementStrategyQualityPolicyEffectLedger } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyEffectLedger';
import type { NextSessionImprovementActionRuntimeEvent } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';

const scope = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
};

function policy(
  version: number,
  overrides: Partial<ImprovementStrategyQualityPolicy> = {},
): ImprovementStrategyQualityPolicy {
  return {
    ...DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
    version,
    source: version === 1 ? 'default' : 'published',
    ...overrides,
  };
}

function strategy(id: string): ImprovementStrategy {
  return {
    id,
    label: id,
    variable: 'method',
    instruction: `只改变 ${id} 的执行方法。`,
    successSignal: '互动率提升 10%',
    origin: 'custom',
    improvementId: 'engagement',
  };
}

function saved(
  id: string,
  gateVersion: number,
  at: number,
): NextSessionImprovementActionRuntimeEvent {
  return createImprovementStrategyAssetEvent({
    operation: 'save',
    strategy: strategy(id),
    scope,
    quality: {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion,
    },
    at,
  });
}

function record(
  id: string,
  gateVersion: number,
  outcome: ImprovementStrategyExperimentRecord['outcome'],
  index: number,
): ImprovementStrategyExperimentRecord {
  return {
    improvementId: 'engagement',
    strategyId: id,
    strategyLabel: id,
    baseSessionId: `session-${gateVersion}-${index}`,
    qualityGateVersion: gateVersion,
    outcome,
  };
}

function releaseEvent(input: {
  version: number;
  changedFields: string[];
  rollbackFromVersion?: number;
  revalidationPhase?: 'measure' | 'reset-baseline';
  context?: { id: string; label: string };
  at: number;
}): NextSessionImprovementActionRuntimeEvent {
  return {
    stage: 'operator_next_session_improvement_quality_policy',
    at: input.at,
    strategyQualityPolicyVersion: input.version,
    strategyQualityPolicyChangedFields: input.changedFields,
    strategyQualityPolicyRollbackFromVersion: input.rollbackFromVersion,
    strategyQualityPolicyRevalidationPhase: input.revalidationPhase,
    experimentContextId: input.context?.id,
    experimentContextLabel: input.context?.label,
    ...scope,
  };
}

describe('improvement strategy quality policy effect ledger', () => {
  it('starts with an explicit unproven ordering when no release evidence exists', () => {
    const ledger = projectImprovementStrategyQualityPolicyEffectLedger({
      policies: [DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      events: [],
      records: [],
      scope,
    });

    expect(ledger.recommendedFieldOrder).toEqual([
      'confoundedExecution',
      'maxInstructionClauses',
      'warningPenalty',
    ]);
    expect(ledger.effects).toEqual([
      expect.objectContaining({
        field: 'confoundedExecution',
        samples: 0,
        recommendation: 'unproven',
      }),
      expect.objectContaining({
        field: 'maxInstructionClauses',
        samples: 0,
        recommendation: 'unproven',
      }),
      expect.objectContaining({
        field: 'warningPenalty',
        samples: 0,
        recommendation: 'unproven',
      }),
    ]);
  });

  it('learns from automatic single-variable releases and excludes rollback versions', () => {
    const versionTwo = policy(2, { confoundedExecution: 'block' });
    const versionThree = policy(3, {
      confoundedExecution: 'block',
      maxInstructionClauses: 2,
    });
    const rollbackVersion = policy(4);
    const resetBaselineVersion = policy(5, { warningPenalty: 10 });
    const events: NextSessionImprovementActionRuntimeEvent[] = [
      releaseEvent({
        version: 2,
        changedFields: ['confoundedExecution'],
        at: 100,
      }),
      releaseEvent({
        version: 3,
        changedFields: ['maxInstructionClauses'],
        at: 200,
      }),
      releaseEvent({
        version: 4,
        changedFields: [
          'maxInstructionClauses',
          'confoundedExecution',
        ],
        rollbackFromVersion: 1,
        at: 300,
      }),
      releaseEvent({
        version: 5,
        changedFields: ['warningPenalty'],
        revalidationPhase: 'reset-baseline',
        at: 400,
      }),
      saved('v1-a', 1, 10),
      saved('v1-b', 1, 20),
      saved('v1-c', 1, 30),
      saved('v2-a', 2, 110),
      saved('v2-b', 2, 120),
      saved('v2-c', 2, 130),
      saved('v3-a', 3, 210),
      saved('v3-b', 3, 220),
      saved('v3-c', 3, 230),
    ];
    const records = [
      record('v1-a', 1, 'stable', 1),
      record('v1-b', 1, 'confounded', 2),
      record('v1-c', 1, 'context-changed', 3),
      record('v2-a', 2, 'stable', 4),
      record('v2-b', 2, 'improved', 5),
      record('v2-c', 2, 'declined', 6),
      record('v3-a', 3, 'stable', 7),
      record('v3-b', 3, 'confounded', 8),
      record('v3-c', 3, 'context-changed', 9),
    ];

    const ledger = projectImprovementStrategyQualityPolicyEffectLedger({
      policies: [
        resetBaselineVersion,
        rollbackVersion,
        versionThree,
        versionTwo,
        DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      ],
      events,
      records,
      scope,
      context: {
        id: 'experiment-v1-current',
        label: 'current model · current voice · auto',
      },
      now: 400,
      freshnessWindowMs: 1_000,
    });

    expect(
      ledger.experiments.map(({ toVersion, field, status }) => ({
        toVersion,
        field,
        status,
      })),
    ).toEqual([
      {
        toVersion: 2,
        field: 'confoundedExecution',
        status: 'improved',
      },
      {
        toVersion: 3,
        field: 'maxInstructionClauses',
        status: 'regressed',
      },
    ]);
    expect(ledger.recommendedFieldOrder).toEqual([
      'confoundedExecution',
      'warningPenalty',
      'maxInstructionClauses',
    ]);
    expect(ledger.effects).toEqual([
      expect.objectContaining({
        field: 'confoundedExecution',
        samples: 1,
        improved: 1,
        confidence: 'low',
        recommendation: 'prefer',
      }),
      expect.objectContaining({
        field: 'warningPenalty',
        samples: 0,
        recommendation: 'unproven',
      }),
      expect.objectContaining({
        field: 'maxInstructionClauses',
        samples: 1,
        regressed: 1,
        recommendation: 'caution',
      }),
    ]);
    expect(ledger.directionEffects[0]).toMatchObject({
      field: 'confoundedExecution',
      from: 'warn',
      to: 'block',
      exactSamples: 0,
      legacySamples: 1,
      confidence: 'low',
      recommendation: 'prefer',
      influence: 'advisory',
    });
  });

  it('segments effects by change direction and isolates other runtime contexts', () => {
    const contextA = {
      id: 'experiment-v1-context-a',
      label: 'model-a · voice-a · auto',
    };
    const contextB = {
      id: 'experiment-v1-context-b',
      label: 'model-b · voice-b · auto',
    };
    const versionTwo = policy(2, { confoundedExecution: 'block' });
    const versionThree = policy(3, { confoundedExecution: 'warn' });
    const versionFour = policy(4, { confoundedExecution: 'block' });
    const events: NextSessionImprovementActionRuntimeEvent[] = [
      releaseEvent({
        version: 2,
        changedFields: ['confoundedExecution'],
        context: contextA,
        at: 100,
      }),
      releaseEvent({
        version: 3,
        changedFields: ['confoundedExecution'],
        context: contextA,
        at: 200,
      }),
      releaseEvent({
        version: 4,
        changedFields: ['confoundedExecution'],
        context: contextB,
        at: 300,
      }),
      saved('v1-a', 1, 10),
      saved('v1-b', 1, 20),
      saved('v1-c', 1, 30),
      saved('v2-a', 2, 110),
      saved('v2-b', 2, 120),
      saved('v2-c', 2, 130),
      saved('v3-a', 3, 210),
      saved('v3-b', 3, 220),
      saved('v3-c', 3, 230),
      saved('v4-a', 4, 310),
      saved('v4-b', 4, 320),
      saved('v4-c', 4, 330),
    ];
    const records = [
      record('v1-a', 1, 'stable', 1),
      record('v1-b', 1, 'confounded', 2),
      record('v1-c', 1, 'context-changed', 3),
      record('v2-a', 2, 'stable', 4),
      record('v2-b', 2, 'improved', 5),
      record('v2-c', 2, 'declined', 6),
      record('v3-a', 3, 'stable', 7),
      record('v3-b', 3, 'confounded', 8),
      record('v3-c', 3, 'context-changed', 9),
      record('v4-a', 4, 'stable', 10),
      record('v4-b', 4, 'improved', 11),
      record('v4-c', 4, 'declined', 12),
    ];

    const ledger = projectImprovementStrategyQualityPolicyEffectLedger({
      policies: [
        versionFour,
        versionThree,
        versionTwo,
        DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      ],
      events,
      records,
      scope,
      context: contextA,
      now: 350,
      freshnessWindowMs: 1_000,
    });

    expect(ledger.directionEffects).toEqual([
      expect.objectContaining({
        field: 'confoundedExecution',
        from: 'warn',
        to: 'block',
        exactSamples: 1,
        excludedContextSamples: 1,
        improved: 1,
        recommendation: 'prefer',
        influence: 'advisory',
      }),
      expect.objectContaining({
        field: 'confoundedExecution',
        from: 'block',
        to: 'warn',
        exactSamples: 1,
        excludedContextSamples: 0,
        regressed: 1,
        recommendation: 'caution',
        influence: 'advisory',
      }),
    ]);

    const isolatedLedger =
      projectImprovementStrategyQualityPolicyEffectLedger({
        policies: [
          versionFour,
          versionThree,
          versionTwo,
          DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        ],
        events,
        records,
        scope,
        context: {
          id: 'experiment-v1-context-c',
          label: 'model-c · voice-c · manual',
        },
        now: 350,
        freshnessWindowMs: 1_000,
      });

    expect(isolatedLedger.directionEffects[0]).toMatchObject({
      field: 'confoundedExecution',
      from: 'warn',
      to: 'block',
      samples: 0,
      exactSamples: 0,
      excludedContextSamples: 2,
      confidence: 'low',
      recommendation: 'unproven',
      influence: 'isolated',
    });

    const promotedEvents = events.map((event) =>
      event.stage ===
        'operator_next_session_improvement_quality_policy' &&
      event.strategyQualityPolicyVersion === 4
        ? {
            ...event,
            experimentContextId: contextA.id,
            experimentContextLabel: contextA.label,
          }
        : event,
    );
    const promotedLedger =
      projectImprovementStrategyQualityPolicyEffectLedger({
        policies: [
          versionFour,
          versionThree,
          versionTwo,
          DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        ],
        events: promotedEvents,
        records,
        scope,
        context: contextA,
        now: 350,
        freshnessWindowMs: 300,
      });

    expect(promotedLedger.directionEffects[0]).toMatchObject({
      field: 'confoundedExecution',
      from: 'warn',
      to: 'block',
      samples: 2,
      exactSamples: 2,
      improved: 2,
      confidence: 'medium',
      recommendation: 'prefer',
      influence: 'automatic',
      freshness: 'fresh',
      freshSamples: 2,
      staleSamples: 0,
    });

    const staleLedger =
      projectImprovementStrategyQualityPolicyEffectLedger({
        policies: [
          versionFour,
          versionThree,
          versionTwo,
          DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        ],
        events: promotedEvents,
        records,
        scope,
        context: contextA,
        now: 1_000,
        freshnessWindowMs: 100,
      });

    expect(staleLedger.directionEffects[0]).toMatchObject({
      field: 'confoundedExecution',
      from: 'warn',
      to: 'block',
      samples: 2,
      freshSamples: 0,
      staleSamples: 2,
      freshness: 'stale',
      recommendation: 'prefer',
      influence: 'revalidate',
    });
  });
});
