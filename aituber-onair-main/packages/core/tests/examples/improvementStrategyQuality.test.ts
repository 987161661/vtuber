import { describe, expect, it } from 'vitest';
import {
  reviewImprovementStrategyDraft,
  type ImprovementStrategyQualityInput,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQuality';
import type {
  ImprovementStrategy,
  ImprovementStrategyDraft,
  NextImprovementStrategySelection,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';
import type { NextSessionImprovementActionRuntimeEvent } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';

const draft: ImprovementStrategyDraft = {
  label: '先验证最小链路',
  variable: 'sequence',
  instruction: '先验证输入与调度，再单独检查语音输出链路。',
  successSignal: '失败项减少且没有新增阻断',
};

const selection: NextImprovementStrategySelection = {
  mode: 'review',
  stage: 'redesign',
  strategy: null,
  progress: { observed: 9, pending: 0, target: 9, remaining: 0 },
  reason: '基础策略预算已经结束。',
};

function input(
  overrides: Partial<ImprovementStrategyQualityInput> = {},
): ImprovementStrategyQualityInput {
  return {
    improvementId: 'pipeline-review',
    draft,
    strategies: [],
    actions: [],
    baseSessionId: 'session-1',
    historyReady: true,
    selection,
    ...overrides,
  };
}

describe('improvement strategy quality review', () => {
  it('blocks invalid drafts while explaining every failed quality dimension', () => {
    const review = reviewImprovementStrategyDraft(
      input({
        draft: {
          label: '',
          variable: 'method',
          instruction: '太短',
          successSignal: '好',
        },
      }),
    );

    expect(review).toMatchObject({
      status: 'blocked',
      canSave: false,
      canExecute: false,
      strategy: null,
    });
    expect(
      review.checks
        .filter(({ status }) => status === 'block')
        .map(({ id }) => id),
    ).toEqual(
      expect.arrayContaining(['definition', 'execution', 'observation']),
    );
  });

  it('blocks a behavior duplicate even when its label is different', () => {
    const existing: ImprovementStrategy = {
      id: 'custom-existing',
      label: '已有最短链路策略',
      variable: 'sequence',
      instruction: draft.instruction,
      successSignal: '首条回复延迟下降',
      origin: 'custom',
      improvementId: 'pipeline-review',
    };

    const review = reviewImprovementStrategyDraft(
      input({ strategies: [existing] }),
    );

    expect(review).toMatchObject({
      status: 'blocked',
      canSave: false,
      duplicateStrategyId: 'custom-existing',
    });
    expect(review.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'novelty', status: 'block' }),
      ]),
    );
  });

  it('allows the same behavior to be saved as a new version of its own asset', () => {
    const existing: ImprovementStrategy = {
      id: 'custom-existing',
      label: '最小链路验证',
      variable: 'sequence',
      instruction: draft.instruction,
      successSignal: draft.successSignal,
      origin: 'custom',
      improvementId: 'pipeline-review',
    };

    const review = reviewImprovementStrategyDraft(
      input({
        draft: { ...draft, label: '最小链路验证 V2' },
        strategies: [existing],
        editingStrategyId: existing.id,
      }),
    );

    expect(review).toMatchObject({
      status: 'ready',
      canSave: true,
    });
    expect(review.duplicateStrategyId).toBeUndefined();
  });

  it('allows a reviewable draft but warns when the outcome is not observable', () => {
    const review = reviewImprovementStrategyDraft(
      input({
        draft: {
          ...draft,
          successSignal: '整体效果更好',
        },
      }),
    );

    expect(review).toMatchObject({
      status: 'review',
      canSave: true,
      canExecute: true,
      execution: {
        status: 'controlled',
        nextStep: 'explore',
      },
    });
    expect(review.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'observation', status: 'warning' }),
      ]),
    );
  });

  it('previews a ready controlled experiment for a focused novel strategy', () => {
    const review = reviewImprovementStrategyDraft(input());

    expect(review).toMatchObject({
      status: 'ready',
      canSave: true,
      canExecute: true,
      score: 100,
      strategy: expect.objectContaining({
        label: '先验证最小链路',
        variable: 'sequence',
      }),
      execution: {
        status: 'controlled',
        nextStep: 'explore',
        strategyLabel: '先验证最小链路',
      },
    });
  });

  it('keeps the asset saveable while a prior experiment is awaiting outcome', () => {
    const review = reviewImprovementStrategyDraft(
      input({
        selection: {
          ...selection,
          mode: 'wait',
          stage: 'awaiting-outcome',
          progress: { observed: 1, pending: 1, target: 2, remaining: 0 },
        },
      }),
    );

    expect(review).toMatchObject({
      canSave: true,
      canExecute: false,
      execution: { status: 'waiting', nextStep: 'wait' },
    });
  });

  it('surfaces a same-session competing experiment before execution', () => {
    const competingAction: NextSessionImprovementActionRuntimeEvent = {
      stage: 'operator_next_session_improvement_action',
      baseSessionId: 'session-1',
      improvementId: 'another-improvement',
      strategyId: 'focused-evidence',
      outcome: 'completed',
      experimentControlled: true,
    };
    const review = reviewImprovementStrategyDraft(
      input({ actions: [competingAction] }),
    );

    expect(review).toMatchObject({
      canSave: true,
      canExecute: true,
      execution: {
        status: 'confounded',
        nextStep: 'execute-with-warning',
      },
    });
  });

  it('honors a published policy that blocks confounded execution and changes warning scoring', () => {
    const competingAction: NextSessionImprovementActionRuntimeEvent = {
      stage: 'operator_next_session_improvement_action',
      baseSessionId: 'session-1',
      improvementId: 'another-improvement',
      strategyId: 'focused-evidence',
      outcome: 'completed',
      experimentControlled: true,
    };
    const review = reviewImprovementStrategyDraft(
      input({
        draft: { ...draft, successSignal: '整体效果更好' },
        actions: [competingAction],
        policy: {
          version: 2,
          warningPenalty: 10,
          maxInstructionClauses: 3,
          confoundedExecution: 'block',
          source: 'published',
        },
      }),
    );

    expect(review).toMatchObject({
      status: 'review',
      score: 90,
      canSave: true,
      canExecute: false,
      execution: {
        status: 'confounded',
        nextStep: 'execute-with-warning',
      },
    });
  });
});
