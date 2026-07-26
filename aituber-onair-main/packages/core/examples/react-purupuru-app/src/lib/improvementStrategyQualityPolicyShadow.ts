import type { ImprovementStrategyAsset } from './improvementStrategyAssets';
import type {
  ImprovementStrategy,
  NextImprovementStrategySelection,
} from './improvementStrategyExperiment';
import {
  reviewImprovementStrategyDraft,
  type ImprovementStrategyQualityReview,
} from './improvementStrategyQuality';
import type { ImprovementStrategyQualityPolicy } from './improvementStrategyQualityPolicy';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

type ShadowReview = Pick<
  ImprovementStrategyQualityReview,
  'status' | 'score' | 'canSave' | 'canExecute'
>;

export type ImprovementStrategyQualityPolicyShadowSample = {
  assetId: string;
  strategyLabel: string;
  updatedAt: number;
  current: ShadowReview;
  candidate: ShadowReview;
  effect: 'stricter' | 'unchanged' | 'looser';
};

export type ImprovementStrategyQualityPolicyShadowImpact = {
  sampleCount: number;
  confidence: 'unavailable' | 'limited' | 'representative';
  current: {
    policyVersion: number;
    ready: number;
    review: number;
    blocked: number;
    executable: number;
    averageScore: number | null;
  };
  candidate: {
    policyVersion: number;
    ready: number;
    review: number;
    blocked: number;
    executable: number;
    averageScore: number | null;
  };
  delta: {
    ready: number;
    blocked: number;
    executable: number;
    averageScore: number | null;
    stricter: number;
    looser: number;
  };
  samples: ImprovementStrategyQualityPolicyShadowSample[];
};

type EvaluationInput = {
  currentPolicy: ImprovementStrategyQualityPolicy;
  candidatePolicy: ImprovementStrategyQualityPolicy;
  assets: readonly ImprovementStrategyAsset[];
  strategies: readonly ImprovementStrategy[];
  actions: readonly NextSessionImprovementActionRuntimeEvent[];
  baseSessionId?: string;
  historyReady: boolean;
  selectionByImprovement: Readonly<
    Record<string, NextImprovementStrategySelection | undefined>
  >;
  sampleLimit?: number;
};

function summarize(
  policyVersion: number,
  reviews: readonly ShadowReview[],
): ImprovementStrategyQualityPolicyShadowImpact['current'] {
  return {
    policyVersion,
    ready: reviews.filter(({ status }) => status === 'ready').length,
    review: reviews.filter(({ status }) => status === 'review').length,
    blocked: reviews.filter(({ status }) => status === 'blocked').length,
    executable: reviews.filter(({ canExecute }) => canExecute).length,
    averageScore: reviews.length
      ? Math.round(
          reviews.reduce((total, { score }) => total + score, 0) /
            reviews.length,
        )
      : null,
  };
}

function effectOf(
  current: ShadowReview,
  candidate: ShadowReview,
): ImprovementStrategyQualityPolicyShadowSample['effect'] {
  const statusRank = { blocked: 0, review: 1, ready: 2 } as const;
  if (
    (current.canSave && !candidate.canSave) ||
    (current.canExecute && !candidate.canExecute) ||
    statusRank[candidate.status] < statusRank[current.status] ||
    candidate.score < current.score
  ) {
    return 'stricter';
  }
  if (
    (!current.canSave && candidate.canSave) ||
    (!current.canExecute && candidate.canExecute) ||
    statusRank[candidate.status] > statusRank[current.status] ||
    candidate.score > current.score
  ) {
    return 'looser';
  }
  return 'unchanged';
}

function reviewAsset(
  input: EvaluationInput,
  asset: ImprovementStrategyAsset,
  policy: ImprovementStrategyQualityPolicy,
  selection: NextImprovementStrategySelection,
): ShadowReview {
  const strategy = asset.strategy;
  const review = reviewImprovementStrategyDraft({
    improvementId: strategy.improvementId!,
    draft: {
      label: strategy.label,
      variable: strategy.variable as Exclude<
        ImprovementStrategy['variable'],
        'none'
      >,
      instruction: strategy.instruction,
      successSignal: strategy.successSignal!,
    },
    strategies: input.strategies.filter(
      ({ id }) => id !== strategy.id,
    ),
    actions: input.actions,
    baseSessionId: input.baseSessionId,
    historyReady: input.historyReady,
    selection,
    editingStrategyId: strategy.id,
    policy,
  });
  return {
    status: review.status,
    score: review.score,
    canSave: review.canSave,
    canExecute: review.canExecute,
  };
}

export function evaluateImprovementStrategyQualityPolicyImpact(
  input: EvaluationInput,
): ImprovementStrategyQualityPolicyShadowImpact {
  const sampleLimit = Math.max(
    1,
    Math.min(20, Math.floor(input.sampleLimit ?? 8)),
  );
  const eligibleAssets = input.assets
    .filter(
      ({ status, strategy }) =>
        status === 'active' &&
        Boolean(strategy.improvementId) &&
        Boolean(strategy.successSignal) &&
        Boolean(
          input.selectionByImprovement[strategy.improvementId ?? ''],
        ),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, sampleLimit);
  const samples = eligibleAssets.map((asset) => {
    const selection =
      input.selectionByImprovement[asset.strategy.improvementId!]!;
    const current = reviewAsset(
      input,
      asset,
      input.currentPolicy,
      selection,
    );
    const candidate = reviewAsset(
      input,
      asset,
      input.candidatePolicy,
      selection,
    );
    return {
      assetId: asset.assetId,
      strategyLabel: asset.strategy.label,
      updatedAt: asset.updatedAt,
      current,
      candidate,
      effect: effectOf(current, candidate),
    };
  });
  const current = summarize(
    input.currentPolicy.version,
    samples.map((sample) => sample.current),
  );
  const candidate = summarize(
    input.candidatePolicy.version,
    samples.map((sample) => sample.candidate),
  );
  return {
    sampleCount: samples.length,
    confidence:
      samples.length === 0
        ? 'unavailable'
        : samples.length < 3
          ? 'limited'
          : 'representative',
    current,
    candidate,
    delta: {
      ready: candidate.ready - current.ready,
      blocked: candidate.blocked - current.blocked,
      executable: candidate.executable - current.executable,
      averageScore:
        current.averageScore === null || candidate.averageScore === null
          ? null
          : candidate.averageScore - current.averageScore,
      stricter: samples.filter(({ effect }) => effect === 'stricter')
        .length,
      looser: samples.filter(({ effect }) => effect === 'looser').length,
    },
    samples,
  };
}
