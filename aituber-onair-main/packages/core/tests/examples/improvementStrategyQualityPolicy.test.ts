import { describe, expect, it } from 'vitest';
import type { ImprovementStrategyQualityCalibration } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityCalibration';
import {
  DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  createImprovementStrategyQualityPolicyRollbackProposal,
  createImprovementStrategyQualityPolicyEvent,
  projectImprovementStrategyQualityPolicy,
  projectImprovementStrategyQualityPolicyHistory,
  proposeImprovementStrategyQualityPolicy,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicy';

const scope = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
};

function calibration(
  status: ImprovementStrategyQualityCalibration['status'],
): ImprovementStrategyQualityCalibration {
  const evidence = {
    evaluated: 3,
    usable: status === 'too-permissive' ? 1 : 3,
    unusable: status === 'too-permissive' ? 2 : 0,
    pending: 0,
    usabilityRate: status === 'too-permissive' ? 33 : 100,
  };
  return {
    status,
    evidence,
    readyEvidence: evidence,
    reviewEvidence: evidence,
    warningSignals:
      status === 'too-strict'
        ? [
            {
              warningId: 'observation',
              evaluated: 3,
              usable: 3,
              usabilityRate: 100,
              assessment: 'consider-relaxing',
            },
          ]
        : [],
    recommendations: [],
    summary: status,
  };
}

describe('improvement strategy quality policy', () => {
  it('starts from an explicit versioned default policy', () => {
    expect(
      projectImprovementStrategyQualityPolicy({ events: [], scope }),
    ).toEqual(DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY);
    expect(DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY).toEqual({
      version: 1,
      warningPenalty: 15,
      maxInstructionClauses: 3,
      confoundedExecution: 'warn',
      source: 'default',
    });
  });

  it('proposes stricter execution handling when calibration is too permissive', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('too-permissive'),
    });

    expect(proposal).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      policy: {
        version: 2,
        confoundedExecution: 'block',
        warningPenalty: 15,
      },
      changes: [
        expect.objectContaining({
          field: 'confoundedExecution',
          from: 'warn',
          to: 'block',
        }),
      ],
    });
  });

  it('proposes a lower warning penalty when review warnings are too strict', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('too-strict'),
    });

    expect(proposal).toMatchObject({
      policy: {
        version: 2,
        warningPenalty: 10,
        confoundedExecution: 'warn',
      },
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
          from: 15,
          to: 10,
        }),
      ],
    });
  });

  it('changes only the highest-priority safety variable when calibration signals are mixed', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
    });

    expect(proposal).toMatchObject({
      policy: {
        version: 2,
        confoundedExecution: 'block',
        warningPenalty: 15,
        maxInstructionClauses: 3,
      },
      changes: [
        expect.objectContaining({
          field: 'confoundedExecution',
        }),
      ],
    });
    expect(proposal?.changes).toHaveLength(1);
  });

  it('uses learned field priority when more than one single-variable change is eligible', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
      fieldPriority: [
        'warningPenalty',
        'confoundedExecution',
        'maxInstructionClauses',
      ],
    });

    expect(proposal).toMatchObject({
      policy: {
        warningPenalty: 10,
        confoundedExecution: 'warn',
      },
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
        }),
      ],
    });
  });

  it('prefers matching directional evidence over a field-only priority', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
      fieldPriority: [
        'confoundedExecution',
        'warningPenalty',
        'maxInstructionClauses',
      ],
      changeEffects: [
        {
          field: 'confoundedExecution',
          from: 'warn',
          to: 'block',
          recommendation: 'caution',
          priorityScore: -6,
          influence: 'automatic',
          exactSamples: 2,
          freshSamples: 2,
        },
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 4,
          influence: 'automatic',
          exactSamples: 2,
          freshSamples: 2,
        },
      ],
    });

    expect(proposal).toMatchObject({
      policy: {
        warningPenalty: 10,
        confoundedExecution: 'warn',
      },
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
        }),
      ],
    });
  });

  it('keeps legacy-only directional evidence advisory', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
      changeEffects: [
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 2,
          influence: 'advisory',
          exactSamples: 0,
          freshSamples: 1,
        },
      ],
    });

    expect(proposal).toMatchObject({
      policy: {
        warningPenalty: 15,
        confoundedExecution: 'block',
      },
      changes: [
        expect.objectContaining({
          field: 'confoundedExecution',
        }),
      ],
    });
  });

  it('turns expired positive evidence into an explicit revalidation proposal', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
      changeEffects: [
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 6,
          influence: 'revalidate',
          exactSamples: 2,
          freshSamples: 0,
        },
      ],
    });

    expect(proposal).toMatchObject({
      trigger: 'revalidation',
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
        }),
      ],
      revalidation: {
        reason: 'expired',
        phase: 'measure',
        requiredFreshSamples: 2,
        collectedFreshSamples: 0,
        remainingFreshSamples: 2,
      },
    });
    expect(
      createImprovementStrategyQualityPolicyEvent({
        proposal: proposal!,
        scope,
        at: 500,
      }),
    ).toMatchObject({
      strategyQualityPolicyTrigger: 'revalidation',
      strategyQualityPolicyRevalidationReason: 'expired',
      strategyQualityPolicyRevalidationPhase: 'measure',
      strategyQualityPolicyRevalidationTargetField: 'warningPenalty',
      strategyQualityPolicyRevalidationTargetFrom: 15,
      strategyQualityPolicyRevalidationTargetTo: 10,
      strategyQualityPolicyRevalidationRequiredSamples: 2,
      strategyQualityPolicyRevalidationCollectedSamples: 0,
      strategyQualityPolicyRevalidationRemainingSamples: 2,
      strategyQualityPolicyRevalidationRunId: expect.stringContaining(
        'quality-policy-revalidation:',
      ),
    });
  });

  it('schedules the remaining exact sample without promoting advisory evidence', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
      changeEffects: [
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 2,
          influence: 'advisory',
          exactSamples: 1,
          freshSamples: 1,
        },
      ],
    });

    expect(proposal).toMatchObject({
      trigger: 'revalidation',
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
        }),
      ],
      revalidation: {
        reason: 'sample-gap',
        phase: 'measure',
        collectedFreshSamples: 1,
        remainingFreshSamples: 1,
      },
    });
  });

  it('restores the measurement baseline before collecting the next exact sample', () => {
    const current: ImprovementStrategyQualityPolicy = {
      ...DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      version: 4,
      source: 'published',
      warningPenalty: 10,
    };
    const proposal = proposeImprovementStrategyQualityPolicy({
      current,
      calibration: calibration('aligned'),
      changeEffects: [
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 2,
          influence: 'advisory',
          exactSamples: 3,
          freshSamples: 1,
        },
      ],
    });

    expect(proposal).toMatchObject({
      trigger: 'revalidation',
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
          from: 10,
          to: 15,
        }),
      ],
      revalidation: {
        reason: 'sample-gap',
        phase: 'reset-baseline',
        target: {
          field: 'warningPenalty',
          from: 15,
          to: 10,
        },
        collectedFreshSamples: 1,
        remainingFreshSamples: 1,
      },
    });
  });

  it('keeps an active revalidation target ahead of competing directions', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('mixed'),
      revalidationTarget: {
        field: 'warningPenalty',
        from: 15,
        to: 10,
      },
      revalidationRunId: 'run-locked',
      changeEffects: [
        {
          field: 'confoundedExecution',
          from: 'warn',
          to: 'block',
          recommendation: 'prefer',
          priorityScore: 20,
          influence: 'revalidate',
          exactSamples: 4,
          freshSamples: 0,
        },
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 2,
          influence: 'advisory',
          exactSamples: 1,
          freshSamples: 1,
        },
      ],
    });

    expect(proposal).toMatchObject({
      trigger: 'revalidation',
      changes: [
        expect.objectContaining({
          field: 'warningPenalty',
        }),
      ],
      revalidation: {
        runId: 'run-locked',
        target: {
          field: 'warningPenalty',
          from: 15,
          to: 10,
        },
      },
    });
  });

  it('does not propose silent churn for aligned or insufficient calibration', () => {
    expect(
      proposeImprovementStrategyQualityPolicy({
        current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        calibration: calibration('aligned'),
      }),
    ).toBeNull();
    expect(
      proposeImprovementStrategyQualityPolicy({
        current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        calibration: calibration('insufficient'),
      }),
    ).toBeNull();
  });

  it('publishes and restores the latest valid policy within operator scope', () => {
    const proposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('too-permissive'),
    });
    expect(proposal).not.toBeNull();
    const event = createImprovementStrategyQualityPolicyEvent({
      proposal: proposal!,
      scope,
      context: {
        id: 'experiment-v1-context-a',
        label: 'model-a · voice-a · auto',
      },
      at: 100,
    });

    expect(event).toMatchObject({
      stage: 'operator_next_session_improvement_quality_policy',
      strategyQualityPolicyVersion: 2,
      experimentContextId: 'experiment-v1-context-a',
      experimentContextLabel: 'model-a · voice-a · auto',
      strategyQualityWarningPenalty: 15,
      strategyQualityMaxInstructionClauses: 3,
      strategyQualityConfoundedExecution: 'block',
      strategyQualityPolicyChangedFields: ['confoundedExecution'],
    });
    expect(
      projectImprovementStrategyQualityPolicy({ events: [event], scope }),
    ).toEqual({
      version: 2,
      warningPenalty: 15,
      maxInstructionClauses: 3,
      confoundedExecution: 'block',
      source: 'published',
    });
    expect(
      projectImprovementStrategyQualityPolicy({
        events: [event],
        scope: { ...scope, roomId: 'another-room' },
      }),
    ).toEqual(DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY);
  });

  it('keeps scoped policy history and rolls back by publishing a new auditable version', () => {
    const stricterProposal = proposeImprovementStrategyQualityPolicy({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      calibration: calibration('too-permissive'),
    });
    expect(stricterProposal).not.toBeNull();
    const stricterEvent = createImprovementStrategyQualityPolicyEvent({
      proposal: stricterProposal!,
      scope,
      at: 100,
    });
    const rollbackProposal =
      createImprovementStrategyQualityPolicyRollbackProposal({
        current: stricterProposal!.policy,
        target: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      });
    const rollbackEvent = createImprovementStrategyQualityPolicyEvent({
      proposal: rollbackProposal,
      scope,
      at: 200,
    });

    expect(rollbackProposal).toMatchObject({
      trigger: 'rollback',
      fromVersion: 2,
      toVersion: 3,
      rollbackFromVersion: 1,
      policy: {
        version: 3,
        warningPenalty: 15,
        maxInstructionClauses: 3,
        confoundedExecution: 'warn',
      },
    });
    expect(rollbackEvent).toMatchObject({
      strategyQualityPolicyVersion: 3,
      strategyQualityPolicyRollbackFromVersion: 1,
    });
    expect(
      projectImprovementStrategyQualityPolicyHistory({
        events: [rollbackEvent, stricterEvent],
        scope,
      }).map(({ version }) => version),
    ).toEqual([3, 2, 1]);
    expect(
      projectImprovementStrategyQualityPolicy({
        events: [rollbackEvent, stricterEvent],
        scope,
      }),
    ).toMatchObject({
      version: 3,
      confoundedExecution: 'warn',
    });
  });
});
