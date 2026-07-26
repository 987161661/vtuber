import { describe, expect, it } from 'vitest';
import type { ImprovementStrategyQualityCalibration } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityCalibration';
import type { ImprovementStrategyQualityPolicyReleaseObservation } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyObservation';
import {
  DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  type ImprovementStrategyQualityPolicy,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicy';
import { governImprovementStrategyQualityPolicyChange } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyGovernance';
import type { ImprovementStrategyQualityPolicyTrendGovernance } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyTrendGovernance';

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
    warningSignals: [],
    recommendations: [],
    summary: status,
  };
}

function observation(
  status: ImprovementStrategyQualityPolicyReleaseObservation['status'],
): ImprovementStrategyQualityPolicyReleaseObservation {
  const baseline = {
    version: 1,
    reviewAttempts: 3,
    blockedReviews: 0,
    blockRate: 0,
    eligibleStrategies: 3,
    executedStrategies: 3,
    executionRate: 100,
    evidenceEvaluated: 3,
    usabilityRate: 100,
  };
  const current = {
    ...baseline,
    version: 2,
    reviewAttempts: status === 'insufficient' ? 2 : 3,
    evidenceEvaluated: status === 'insufficient' ? 1 : 3,
  };
  return {
    status,
    recommendRollback: status === 'rollback-recommended',
    baseline,
    current,
    delta: {
      blockRate: status === 'healthy' ? 0 : 30,
      executionRate: status === 'healthy' ? 0 : -30,
      usabilityRate: status === 'healthy' ? 0 : -40,
    },
    reasons: status === 'healthy' || status === 'insufficient' ? [] : ['退化'],
    summary: status,
  };
}

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

function trendGovernance(
  overrides: Partial<ImprovementStrategyQualityPolicyTrendGovernance> = {},
): ImprovementStrategyQualityPolicyTrendGovernance {
  return {
    status: 'clear',
    blockedFields: [],
    reviewRollback: false,
    recommendations: [],
    summary: 'clear',
    ...overrides,
  };
}

describe('improvement strategy quality policy governance', () => {
  it('allows the initial calibrated proposal before any release observation exists', () => {
    const result = governImprovementStrategyQualityPolicyChange({
      current: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      history: [DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('too-permissive'),
      observation: null,
    });

    expect(result).toMatchObject({
      status: 'proposal-ready',
      proposal: {
        fromVersion: 1,
        toVersion: 2,
      },
    });
  });

  it.each([
    ['insufficient', 'observation-pending'],
    ['watch', 'regression-watch'],
  ] as const)(
    'holds a new proposal while the current release is %s',
    (observationStatus, expectedStatus) => {
      const current = policy(2, { confoundedExecution: 'block' });
      const result = governImprovementStrategyQualityPolicyChange({
        current,
        history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
        calibration: calibration('too-permissive'),
        observation: observation(observationStatus),
      });

      expect(result).toMatchObject({
        status: expectedStatus,
        proposal: null,
      });
    },
  );

  it('prioritizes a rollback recommendation over another calibration change', () => {
    const current = policy(2, { confoundedExecution: 'block' });
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('too-permissive'),
      observation: observation('rollback-recommended'),
    });

    expect(result).toMatchObject({
      status: 'rollback-required',
      proposal: null,
      restoreTarget: {
        version: 1,
      },
    });
  });

  it('turns a repeated candidate configuration into an explicit historical restore', () => {
    const historical = policy(2, {
      warningPenalty: 5,
      confoundedExecution: 'block',
    });
    const current = policy(3, {
      warningPenalty: 10,
      confoundedExecution: 'block',
    });
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, historical, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('too-strict'),
      observation: {
        ...observation('healthy'),
        current: { ...observation('healthy').current, version: 3 },
        baseline: { ...observation('healthy').baseline, version: 2 },
      },
    });

    expect(result).toMatchObject({
      status: 'historical-match',
      proposal: null,
      restoreTarget: {
        version: 2,
        warningPenalty: 5,
      },
    });
    expect(result.summary).toContain('历史版本');
  });

  it('allows a novel proposal only after the release observation is healthy', () => {
    const current = policy(2, { confoundedExecution: 'block' });
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('too-permissive'),
      observation: observation('healthy'),
    });

    expect(result).toMatchObject({
      status: 'proposal-ready',
      proposal: {
        policy: {
          version: 3,
          maxInstructionClauses: 2,
        },
      },
      restoreTarget: null,
    });
  });

  it('forwards learned field priority into the governed proposal', () => {
    const current = policy(2);
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('mixed'),
      observation: observation('healthy'),
      fieldPriority: [
        'warningPenalty',
        'confoundedExecution',
        'maxInstructionClauses',
      ],
    });

    expect(result).toMatchObject({
      status: 'proposal-ready',
      proposal: {
        changes: [
          expect.objectContaining({
            field: 'warningPenalty',
          }),
        ],
      },
    });
  });

  it('forwards direction-specific evidence into the governed proposal', () => {
    const current = policy(2);
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('mixed'),
      observation: observation('healthy'),
      changeEffects: [
        {
          field: 'confoundedExecution',
          from: 'warn',
          to: 'block',
          recommendation: 'caution',
          priorityScore: -2,
          influence: 'automatic',
          exactSamples: 2,
          freshSamples: 2,
        },
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 2,
          influence: 'automatic',
          exactSamples: 2,
          freshSamples: 2,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'proposal-ready',
      proposal: {
        changes: [
          expect.objectContaining({
            field: 'warningPenalty',
          }),
        ],
      },
    });
  });

  it('surfaces expired positive evidence as a human-reviewed revalidation', () => {
    const current = policy(2);
    const previousMatchingConfiguration = {
      ...policy(1),
      version: 1,
      warningPenalty: 10,
    };
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [
        current,
        previousMatchingConfiguration,
        DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      ],
      calibration: calibration('mixed'),
      observation: observation('healthy'),
      revalidationTarget: {
        field: 'warningPenalty',
        from: 15,
        to: 10,
      },
      revalidationRunId: 'run-active',
      changeEffects: [
        {
          field: 'warningPenalty',
          from: 15,
          to: 10,
          recommendation: 'prefer',
          priorityScore: 4,
          influence: 'revalidate',
          exactSamples: 2,
          freshSamples: 0,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'revalidation-ready',
      proposal: {
        trigger: 'revalidation',
        policy: {
          warningPenalty: 10,
        },
        revalidation: {
          runId: 'run-active',
          remainingFreshSamples: 2,
        },
      },
    });
  });

  it('holds an active revalidation lock when its next phase is not actionable', () => {
    const current = policy(2);
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('mixed'),
      observation: observation('healthy'),
      revalidationTarget: {
        field: 'warningPenalty',
        from: 15,
        to: 10,
      },
      revalidationRunId: 'run-active',
      changeEffects: [],
    });

    expect(result).toMatchObject({
      status: 'revalidation-blocked',
      proposal: null,
      restoreTarget: null,
    });
  });

  it('turns a trend-wide success regression into a human rollback review', () => {
    const current = policy(2, { warningPenalty: 10 });
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('mixed'),
      observation: observation('healthy'),
      trendGovernance: trendGovernance({
        status: 'action-required',
        reviewRollback: true,
        recommendations: [
          {
            action: 'review-rollback',
            priority: 'high',
            summary: 'review rollback',
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'trend-rollback-review',
      proposal: null,
      restoreTarget: {
        version: 1,
      },
    });
  });

  it('blocks automatic calibration for a field with a trend risk spike', () => {
    const current = policy(2);
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('mixed'),
      observation: observation('healthy'),
      fieldPriority: [
        'warningPenalty',
        'confoundedExecution',
        'maxInstructionClauses',
      ],
      trendGovernance: trendGovernance({
        status: 'action-required',
        blockedFields: ['warningPenalty'],
      }),
    });

    expect(result).toMatchObject({
      status: 'trend-field-blocked',
      proposal: null,
      restoreTarget: null,
    });
    expect(result.summary).toContain('warningPenalty');
  });

  it('allows a proposal that does not touch the trend-blocked field', () => {
    const current = policy(2);
    const result = governImprovementStrategyQualityPolicyChange({
      current,
      history: [current, DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY],
      calibration: calibration('too-permissive'),
      observation: observation('healthy'),
      trendGovernance: trendGovernance({
        status: 'action-required',
        blockedFields: ['warningPenalty'],
      }),
    });

    expect(result).toMatchObject({
      status: 'proposal-ready',
      proposal: {
        changes: [
          {
            field: 'confoundedExecution',
          },
        ],
      },
    });
  });
});
