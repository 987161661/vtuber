import { describe, expect, it } from 'vitest';
import type { ImprovementStrategyAsset } from '../../examples/react-purupuru-app/src/lib/improvementStrategyAssets';
import type { NextImprovementStrategySelection } from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';
import {
  DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
  type ImprovementStrategyQualityPolicy,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicy';
import { evaluateImprovementStrategyQualityPolicyImpact } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyShadow';

const selection: NextImprovementStrategySelection = {
  mode: 'explore',
  stage: 'coverage',
  strategy: null,
  progress: {
    observed: 0,
    pending: 0,
    target: 1,
    remaining: 1,
  },
  reason: '需要探索样本',
};

function asset(
  assetId: string,
  instruction: string,
  successSignal: string,
  updatedAt: number,
): ImprovementStrategyAsset {
  return {
    assetId,
    version: 1,
    status: 'active',
    updatedAt,
    strategy: {
      id: `custom-${assetId}`,
      label: assetId,
      variable: 'scope',
      instruction,
      successSignal,
      origin: 'custom',
      improvementId: 'engagement',
    },
  };
}

describe('improvement strategy quality policy shadow evaluation', () => {
  it('compares the candidate with the active gate through the production review interface', () => {
    const candidate: ImprovementStrategyQualityPolicy = {
      ...DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      version: 2,
      warningPenalty: 10,
      maxInstructionClauses: 2,
      confoundedExecution: 'block',
      source: 'published',
    };
    const impact = evaluateImprovementStrategyQualityPolicyImpact({
      currentPolicy: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      candidatePolicy: candidate,
      assets: [
        asset('older', '先聚焦弹幕，再调整话题，然后补充提问。', '互动更好', 10),
        asset('newer', '只聚焦高频弹幕并追问一次。', '互动率提升 10%', 20),
        { ...asset('archived', '归档策略。', '互动率提升 5%', 30), status: 'archived' },
      ],
      strategies: [],
      actions: [
        {
          stage: 'operator_next_session_improvement_action',
          baseSessionId: 'session-1',
          improvementId: 'another-improvement',
          strategyId: 'focused-evidence',
          outcome: 'completed',
          experimentControlled: true,
        },
      ],
      baseSessionId: 'session-1',
      historyReady: true,
      selectionByImprovement: { engagement: selection },
      sampleLimit: 8,
    });

    expect(impact).toMatchObject({
      sampleCount: 2,
      current: {
        policyVersion: 1,
        executable: 2,
        averageScore: 93,
      },
      candidate: {
        policyVersion: 2,
        executable: 0,
        averageScore: 90,
      },
      delta: {
        executable: -2,
        averageScore: -3,
        stricter: 2,
        looser: 0,
      },
    });
    expect(impact.samples.map(({ assetId }) => assetId)).toEqual([
      'newer',
      'older',
    ]);
    expect(impact.samples[0]).toMatchObject({
      current: { score: 100, canExecute: true },
      candidate: { score: 100, canExecute: false },
      effect: 'stricter',
    });
    expect(impact.samples[1]).toMatchObject({
      current: { score: 85, canExecute: true },
      candidate: { score: 80, canExecute: false },
      effect: 'stricter',
    });
  });

  it('returns an explicit empty result when no active custom assets are available', () => {
    const impact = evaluateImprovementStrategyQualityPolicyImpact({
      currentPolicy: DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
      candidatePolicy: {
        ...DEFAULT_IMPROVEMENT_STRATEGY_QUALITY_POLICY,
        version: 2,
      },
      assets: [],
      strategies: [],
      actions: [],
      historyReady: false,
      selectionByImprovement: {},
    });

    expect(impact).toMatchObject({
      sampleCount: 0,
      current: { averageScore: null },
      candidate: { averageScore: null },
      confidence: 'unavailable',
    });
  });
});
