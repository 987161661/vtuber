import { describe, expect, it } from 'vitest';
import type { ImprovementStrategyQualityPolicyReleaseObservation } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyObservation';
import {
  DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  type ImprovementStrategyQualityPolicy,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicy';
import { attributeImprovementStrategyQualityPolicyRelease } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyAttribution';

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

function observation(input: {
  status?: ImprovementStrategyQualityPolicyReleaseObservation['status'];
  blockRate?: number | null;
  executionRate?: number | null;
  usabilityRate?: number | null;
} = {}): ImprovementStrategyQualityPolicyReleaseObservation {
  const status = input.status ?? 'healthy';
  return {
    status,
    recommendRollback: status === 'rollback-recommended',
    baseline: {
      version: 1,
      reviewAttempts: 3,
      blockedReviews: 0,
      blockRate: 10,
      eligibleStrategies: 3,
      executedStrategies: 2,
      executionRate: 60,
      evidenceEvaluated: 3,
      usabilityRate: 60,
    },
    current: {
      version: 2,
      reviewAttempts: 3,
      blockedReviews: 0,
      blockRate: 10 + (input.blockRate ?? 0),
      eligibleStrategies: 3,
      executedStrategies: 2,
      executionRate: 60 + (input.executionRate ?? 0),
      evidenceEvaluated: status === 'insufficient' ? 1 : 3,
      usabilityRate: 60 + (input.usabilityRate ?? 0),
    },
    delta: {
      blockRate: input.blockRate ?? 0,
      executionRate: input.executionRate ?? 0,
      usabilityRate: input.usabilityRate ?? 0,
    },
    reasons: [],
    summary: status,
  };
}

describe('improvement strategy quality policy attribution', () => {
  it('attributes an improvement when one parameter improves evidence without guardrail regression', () => {
    const result = attributeImprovementStrategyQualityPolicyRelease({
      baseline: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      current: policy(2, { confoundedExecution: 'block' }),
      observation: observation({
        usabilityRate: 20,
        blockRate: 5,
        executionRate: -5,
      }),
    });

    expect(result).toMatchObject({
      status: 'improved',
      changedField: 'confoundedExecution',
      from: 'warn',
      to: 'block',
    });
    expect(result.summary).toContain('证据可用率');
  });

  it('reports a tradeoff when evidence improves but blocking and execution regress', () => {
    expect(
      attributeImprovementStrategyQualityPolicyRelease({
        baseline: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        current: policy(2, { confoundedExecution: 'block' }),
        observation: observation({
          usabilityRate: 30,
          blockRate: 25,
          executionRate: -20,
        }),
      }),
    ).toMatchObject({
      status: 'tradeoff',
      changedField: 'confoundedExecution',
      positiveSignals: 1,
      negativeSignals: 2,
    });
  });

  it('reports regression when the release observation recommends rollback', () => {
    expect(
      attributeImprovementStrategyQualityPolicyRelease({
        baseline: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        current: policy(2, { maxInstructionClauses: 2 }),
        observation: observation({
          status: 'rollback-recommended',
          usabilityRate: -40,
          blockRate: 30,
          executionRate: -30,
        }),
      }),
    ).toMatchObject({
      status: 'regressed',
      changedField: 'maxInstructionClauses',
    });
  });

  it('waits for the observation window before attributing impact', () => {
    expect(
      attributeImprovementStrategyQualityPolicyRelease({
        baseline: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        current: policy(2, { warningPenalty: 10 }),
        observation: observation({ status: 'insufficient' }),
      }),
    ).toMatchObject({
      status: 'insufficient',
      changedField: 'warningPenalty',
    });
  });

  it('refuses causal attribution when a rollback changes multiple parameters', () => {
    expect(
      attributeImprovementStrategyQualityPolicyRelease({
        baseline: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        current: policy(2, {
          warningPenalty: 10,
          confoundedExecution: 'block',
        }),
        observation: observation(),
      }),
    ).toMatchObject({
      status: 'unattributable',
      changedField: null,
    });
  });
});
