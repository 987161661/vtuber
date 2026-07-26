import { describe, expect, it } from 'vitest';
import type { LiveSessionTrendRecord } from '../../examples/react-purupuru-app/src/lib/liveSessionTrend';
import type { NextSessionImprovementActionRuntimeEvent } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';
import {
  composeImprovementStrategy,
  listImprovementStrategies,
  prepareImprovementStrategyExperiment,
  projectImprovementStrategyExperiments,
  selectNextImprovementStrategy,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';
import type { ImprovementExperimentContext } from '../../examples/react-purupuru-app/src/lib/improvementExperimentContext';

const scope = {
  personaId: 'persona-1',
  platform: 'bilibili',
  roomId: '1001',
};

function session(
  sessionId: string,
  sequence: number,
  score: number,
): LiveSessionTrendRecord {
  return {
    sessionId,
    sequence,
    endedAt: sequence * 1_000,
    score,
    status: 'stable',
    responded: 5,
    failed: 0,
    attentionOpened: 0,
    attentionResolved: 0,
    ...scope,
  };
}

function action(
  baseSessionId: string,
  improvementId: string,
  strategyId: string,
  at: number,
  controlled = true,
  experimentContext?: ImprovementExperimentContext,
): NextSessionImprovementActionRuntimeEvent {
  return {
    stage: 'operator_next_session_improvement_action',
    at,
    baseSessionId,
    baseSessionSequence: Number(baseSessionId.split('-')[1]),
    improvementId,
    improvementAction: 'open-pipeline',
    strategyId,
    strategyLabel: strategyId,
    experimentControlled: controlled,
    outcome: 'completed',
    experimentContextId: experimentContext?.id,
    experimentContextLabel: experimentContext?.label,
    ...scope,
  };
}

function experimentScenario(
  experiments: Array<{ strategyId: string; scoreDelta: number }>,
) {
  const actions: NextSessionImprovementActionRuntimeEvent[] = [];
  const sessions: LiveSessionTrendRecord[] = [];
  experiments.forEach((experiment, index) => {
    const baseSequence = index * 2 + 1;
    actions.push(
      action(
        `session-${baseSequence}`,
        'pipeline-review',
        experiment.strategyId,
        baseSequence * 100,
      ),
    );
    sessions.push(
      session(`session-${baseSequence}`, baseSequence, 70),
      session(
        `session-${baseSequence + 1}`,
        baseSequence + 1,
        70 + experiment.scoreDelta,
      ),
    );
  });
  return { actions, sessions };
}

describe('improvement strategy experiment', () => {
  it('carries the quality gate version into the projected outcome window', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        {
          ...action(
            'session-1',
            'pipeline-review',
            'custom-focused',
            100,
          ),
          strategyQualityGateVersion: 2,
        },
      ],
      sessions: [session('session-1', 1, 70), session('session-2', 2, 80)],
      scope,
    });

    expect(result.records).toEqual([
      expect.objectContaining({
        strategyId: 'custom-focused',
        qualityGateVersion: 2,
        outcome: 'improved',
      }),
    ]);
  });

  it('allows only the first improvement variable to be controlled for a base session', () => {
    const first = prepareImprovementStrategyExperiment({
      actions: [],
      baseSessionId: 'session-1',
      improvementId: 'pipeline-review',
      strategyId: 'focused-evidence',
    });
    const second = prepareImprovementStrategyExperiment({
      actions: [
        action('session-1', 'pipeline-review', 'focused-evidence', 100),
      ],
      baseSessionId: 'session-1',
      improvementId: 'archive-review',
      strategyId: 'alternative-path',
    });

    expect(first).toMatchObject({
      controlled: true,
      strategy: { id: 'focused-evidence' },
    });
    expect(second).toMatchObject({
      controlled: false,
      strategy: { id: 'alternative-path' },
    });
    expect(second.explanation).toContain('不纳入');
  });

  it('isolates strategy outcomes and excludes uncontrolled actions from attribution', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'focused-evidence', 100),
        action('session-1', 'archive-review', 'alternative-path', 110, false),
        action('session-2', 'pipeline-review', 'alternative-path', 200),
      ],
      sessions: [
        session('session-1', 1, 70),
        session('session-2', 2, 80),
        session('session-3', 3, 74),
      ],
      scope,
    });

    expect(result.records.map(({ outcome }) => outcome)).toEqual([
      'improved',
      'confounded',
      'declined',
    ]);
    expect(result.strategies).toEqual([
      expect.objectContaining({
        improvementId: 'pipeline-review',
        strategyId: 'focused-evidence',
        observed: 1,
        averageScoreDelta: 10,
      }),
      expect.objectContaining({
        improvementId: 'pipeline-review',
        strategyId: 'alternative-path',
        observed: 1,
        averageScoreDelta: -6,
      }),
    ]);
  });

  it('marks racing controlled experiments as confounded instead of claiming both caused the result', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'focused-evidence', 100),
        action('session-1', 'archive-review', 'alternative-path', 110),
      ],
      sessions: [session('session-1', 1, 70), session('session-2', 2, 90)],
      scope,
    });

    expect(result.records.map(({ outcome }) => outcome)).toEqual([
      'confounded',
      'confounded',
    ]);
    expect(result.strategies).toEqual([]);
  });

  it('keeps an experiment pending until a following session exists', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action('session-2', 'pipeline-review', 'focused-evidence', 200),
      ],
      sessions: [session('session-2', 2, 80)],
      scope,
    });

    expect(result.records[0]).toMatchObject({
      outcome: 'pending',
      strategyId: 'focused-evidence',
    });
    expect(result.strategies).toEqual([]);
  });

  it('uses only evidence from the current experiment context', () => {
    const previousContext = {
      id: 'experiment-v1-context-a',
      label: '旧模型 · openai · 自动播出',
    };
    const currentContext = {
      id: 'experiment-v1-context-b',
      label: '新模型 · openai · 自动播出',
    };
    const result = projectImprovementStrategyExperiments({
      actions: [
        action(
          'session-1',
          'pipeline-review',
          'focused-evidence',
          100,
          true,
          previousContext,
        ),
        action(
          'session-3',
          'pipeline-review',
          'alternative-path',
          300,
          true,
          currentContext,
        ),
      ],
      sessions: [
        {
          ...session('session-1', 1, 70),
          experimentContextId: previousContext.id,
        },
        {
          ...session('session-2', 2, 90),
          experimentContextId: previousContext.id,
        },
        {
          ...session('session-3', 3, 70),
          experimentContextId: currentContext.id,
        },
        {
          ...session('session-4', 4, 80),
          experimentContextId: currentContext.id,
        },
      ],
      scope,
      context: currentContext,
    });

    expect(result.records).toEqual([
      expect.objectContaining({
        strategyId: 'alternative-path',
        outcome: 'improved',
      }),
    ]);
    expect(result.context).toMatchObject({
      status: 'active',
      includedAttempts: 1,
      excludedAttempts: 1,
      label: currentContext.label,
    });
  });

  it('marks a result as context-changed when the following session uses another context', () => {
    const currentContext = {
      id: 'experiment-v1-context-a',
      label: 'gpt-5 · openai · 自动播出',
    };
    const result = projectImprovementStrategyExperiments({
      actions: [
        action(
          'session-1',
          'pipeline-review',
          'focused-evidence',
          100,
          true,
          currentContext,
        ),
      ],
      sessions: [
        {
          ...session('session-1', 1, 70),
          experimentContextId: currentContext.id,
        },
        {
          ...session('session-2', 2, 90),
          experimentContextId: 'experiment-v1-context-b',
        },
      ],
      scope,
      context: currentContext,
    });

    expect(result.records).toEqual([
      expect.objectContaining({
        outcome: 'context-changed',
        nextSessionId: 'session-2',
      }),
    ]);
    expect(result.strategies).toEqual([]);
  });

  it('announces a rebuilding baseline when only old-context evidence exists', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action(
          'session-1',
          'pipeline-review',
          'focused-evidence',
          100,
          true,
          {
            id: 'experiment-v1-context-a',
            label: '旧环境',
          },
        ),
      ],
      sessions: [session('session-1', 1, 70), session('session-2', 2, 85)],
      scope,
      context: {
        id: 'experiment-v1-context-b',
        label: '新环境',
      },
    });

    expect(result.records).toEqual([]);
    expect(result.context).toMatchObject({
      status: 'rebuilding',
      includedAttempts: 0,
      excludedAttempts: 1,
    });
  });

  it('recommends a strategy only after it has enough stable samples and beats a comparator', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'focused-evidence', 100),
        action('session-3', 'pipeline-review', 'focused-evidence', 300),
        action('session-5', 'pipeline-review', 'focused-evidence', 500),
        action('session-7', 'pipeline-review', 'standard', 700),
        action('session-9', 'pipeline-review', 'standard', 900),
      ],
      sessions: [
        session('session-1', 1, 60),
        session('session-2', 2, 70),
        session('session-3', 3, 65),
        session('session-4', 4, 75),
        session('session-5', 5, 70),
        session('session-6', 6, 80),
        session('session-7', 7, 75),
        session('session-8', 8, 76),
        session('session-9', 9, 75),
        session('session-10', 10, 74),
      ],
      scope,
    });

    expect(
      result.strategies.find(
        ({ strategyId }) => strategyId === 'focused-evidence',
      ),
    ).toMatchObject({
      decision: 'recommended',
      confidence: 'high',
      relativeAdvantage: 10,
    });
  });

  it('keeps a positive strategy as leading while comparison evidence is insufficient', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'focused-evidence', 100),
        action('session-3', 'pipeline-review', 'focused-evidence', 300),
      ],
      sessions: [
        session('session-1', 1, 60),
        session('session-2', 2, 68),
        session('session-3', 3, 65),
        session('session-4', 4, 72),
      ],
      scope,
    });

    expect(result.strategies[0]).toMatchObject({
      decision: 'leading',
      confidence: 'medium',
    });
  });

  it('marks a repeatedly harmful strategy to avoid', () => {
    const result = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'alternative-path', 100),
        action('session-3', 'pipeline-review', 'alternative-path', 300),
        action('session-5', 'pipeline-review', 'alternative-path', 500),
      ],
      sessions: [
        session('session-1', 1, 80),
        session('session-2', 2, 70),
        session('session-3', 3, 75),
        session('session-4', 4, 66),
        session('session-5', 5, 72),
        session('session-6', 6, 64),
      ],
      scope,
    });

    expect(result.strategies[0]).toMatchObject({
      decision: 'avoid',
      confidence: 'high',
      declined: 3,
    });
  });

  it('starts exploration with the standard baseline and then rotates to an unseen strategy', () => {
    const emptyProjection = projectImprovementStrategyExperiments({
      actions: [],
      sessions: [],
      scope,
    });
    expect(
      selectNextImprovementStrategy(emptyProjection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      strategy: { id: 'standard' },
    });

    const baselineProjection = projectImprovementStrategyExperiments({
      actions: [action('session-1', 'pipeline-review', 'standard', 100)],
      sessions: [session('session-1', 1, 70), session('session-2', 2, 72)],
      scope,
    });
    expect(
      selectNextImprovementStrategy(baselineProjection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      strategy: { id: 'focused-evidence' },
    });
  });

  it('waits for a pending experiment instead of starting another one', () => {
    const projection = projectImprovementStrategyExperiments({
      actions: [action('session-1', 'pipeline-review', 'standard', 100)],
      sessions: [session('session-1', 1, 70)],
      scope,
    });

    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'wait',
      stage: 'awaiting-outcome',
      strategy: { id: 'standard' },
      progress: {
        observed: 0,
        pending: 1,
        target: 1,
        remaining: 0,
      },
    });
  });

  it('expires an action whose baseline has left the retained session window', () => {
    const projection = projectImprovementStrategyExperiments({
      actions: [action('session-1', 'pipeline-review', 'standard', 100)],
      sessions: [session('session-8', 8, 70), session('session-9', 9, 72)],
      scope,
    });

    expect(projection.records[0]).toMatchObject({
      outcome: 'evidence-expired',
    });
    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      stage: 'coverage',
      strategy: { id: 'standard' },
    });
  });

  it('confirms the positive leader after every strategy has initial coverage', () => {
    const history = experimentScenario([
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
    ]);
    const projection = projectImprovementStrategyExperiments({
      ...history,
      scope,
    });

    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      stage: 'confirmation',
      strategy: { id: 'focused-evidence' },
      progress: {
        observed: 2,
        pending: 0,
        target: 3,
        remaining: 1,
      },
    });
  });

  it('stops an inconclusive experiment after the bounded sample budget', () => {
    const history = experimentScenario([
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 0 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
    ]);
    const projection = projectImprovementStrategyExperiments({
      ...history,
      scope,
    });

    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'review',
      stage: 'redesign',
      strategy: null,
      progress: {
        observed: 9,
        pending: 0,
        target: 9,
        remaining: 0,
      },
      reason: expect.stringContaining('样本预算'),
    });
  });

  it('composes a deterministic custom strategy from reusable primitives', () => {
    const first = composeImprovementStrategy({
      improvementId: 'pipeline-review',
      draft: {
        label: '先验证最短链路',
        variable: 'sequence',
        instruction: '先验证输入与调度，再检查语音输出，避免同时改动多个环节。',
        successSignal: '失败条目减少且首条回复延迟下降',
      },
    });
    const duplicate = composeImprovementStrategy({
      improvementId: 'pipeline-review',
      draft: {
        label: ' 先验证最短链路 ',
        variable: 'sequence',
        instruction: '先验证输入与调度，再检查语音输出，避免同时改动多个环节。',
        successSignal: '失败条目减少且首条回复延迟下降',
      },
    });

    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({
      ok: true,
      strategy: {
        id: expect.stringMatching(/^custom-/),
        origin: 'custom',
        improvementId: 'pipeline-review',
        variable: 'sequence',
        successSignal: '失败条目减少且首条回复延迟下降',
      },
    });
    expect(
      composeImprovementStrategy({
        improvementId: 'pipeline-review',
        draft: {
          label: '',
          variable: 'method',
          instruction: '太短',
          successSignal: '',
        },
      }),
    ).toMatchObject({
      ok: false,
      errors: {
        label: expect.any(String),
        instruction: expect.any(String),
        successSignal: expect.any(String),
      },
    });
  });

  it('rediscovers persisted custom strategies from action events', () => {
    const customAction = {
      ...action(
        'session-1',
        'pipeline-review',
        'custom-shortest-path',
        100,
      ),
      strategyLabel: '先验证最短链路',
      strategyVariable: 'sequence',
      strategyInstruction:
        '先验证输入与调度，再检查语音输出，避免同时改动多个环节。',
      strategySuccessSignal: '失败条目减少且首条回复延迟下降',
      strategyOrigin: 'custom' as const,
    };

    expect(
      listImprovementStrategies({
        actions: [customAction],
        improvementId: 'pipeline-review',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-shortest-path',
          origin: 'custom',
          improvementId: 'pipeline-review',
          variable: 'sequence',
        }),
      ]),
    );
    expect(
      listImprovementStrategies({
        actions: [customAction],
        improvementId: 'archive-review',
      }).some(({ id }) => id === 'custom-shortest-path'),
    ).toBe(false);
    expect(
      listImprovementStrategies({
        actions: [customAction],
        improvementId: 'pipeline-review',
        excludedStrategyIds: ['custom-shortest-path'],
      }).some(({ id }) => id === 'custom-shortest-path'),
    ).toBe(false);
  });

  it('reopens exploration when a custom strategy is added after the base catalog budget ends', () => {
    const history = experimentScenario([
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 0 },
      { strategyId: 'focused-evidence', scoreDelta: 0 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
      { strategyId: 'alternative-path', scoreDelta: 0 },
    ]);
    const composed = composeImprovementStrategy({
      improvementId: 'pipeline-review',
      draft: {
        label: '先验证最短链路',
        variable: 'sequence',
        instruction: '先验证输入与调度，再检查语音输出，避免同时改动多个环节。',
        successSignal: '失败条目减少且首条回复延迟下降',
      },
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    const projection = projectImprovementStrategyExperiments({
      ...history,
      scope,
      strategyCatalog: [
        ...listImprovementStrategies(),
        composed.strategy,
      ],
    });

    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      stage: 'coverage',
      strategy: {
        id: composed.strategy.id,
        origin: 'custom',
      },
    });
  });

  it('excludes an avoid strategy from exploration', () => {
    const projection = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'alternative-path', 100),
        action('session-3', 'pipeline-review', 'alternative-path', 300),
        action('session-5', 'pipeline-review', 'alternative-path', 500),
        action('session-7', 'pipeline-review', 'standard', 700),
      ],
      sessions: [
        session('session-1', 1, 80),
        session('session-2', 2, 70),
        session('session-3', 3, 80),
        session('session-4', 4, 70),
        session('session-5', 5, 80),
        session('session-6', 6, 70),
        session('session-7', 7, 70),
        session('session-8', 8, 71),
      ],
      scope,
    });

    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      strategy: { id: 'focused-evidence' },
    });
  });

  it('switches from exploration to exploitation after a strategy is recommended', () => {
    const projection = projectImprovementStrategyExperiments({
      actions: [
        action('session-1', 'pipeline-review', 'focused-evidence', 100),
        action('session-3', 'pipeline-review', 'focused-evidence', 300),
        action('session-5', 'pipeline-review', 'focused-evidence', 500),
        action('session-7', 'pipeline-review', 'standard', 700),
        action('session-9', 'pipeline-review', 'standard', 900),
      ],
      sessions: [
        session('session-1', 1, 60),
        session('session-2', 2, 70),
        session('session-3', 3, 60),
        session('session-4', 4, 70),
        session('session-5', 5, 60),
        session('session-6', 6, 70),
        session('session-7', 7, 70),
        session('session-8', 8, 70),
        session('session-9', 9, 70),
        session('session-10', 10, 70),
      ],
      scope,
    });

    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'exploit',
      strategy: { id: 'focused-evidence' },
    });
  });

  it('revokes a historically recommended strategy after two recent declines', () => {
    const history = experimentScenario([
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: -10 },
      { strategyId: 'focused-evidence', scoreDelta: -10 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
    ]);
    const projection = projectImprovementStrategyExperiments({
      ...history,
      scope,
    });
    const focused = projection.strategies.find(
      ({ strategyId }) => strategyId === 'focused-evidence',
    );

    expect(focused).toMatchObject({
      decision: 'drifting',
      drift: 'confirmed',
      recentAverageScoreDelta: -10,
    });
    expect(
      selectNextImprovementStrategy(projection, 'pipeline-review'),
    ).toMatchObject({
      mode: 'explore',
      strategy: { id: 'alternative-path' },
    });
  });

  it('clears drift after two recent positive controlled outcomes', () => {
    const history = experimentScenario([
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: -10 },
      { strategyId: 'focused-evidence', scoreDelta: -10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'focused-evidence', scoreDelta: 10 },
      { strategyId: 'standard', scoreDelta: 0 },
      { strategyId: 'standard', scoreDelta: 0 },
    ]);
    const projection = projectImprovementStrategyExperiments({
      ...history,
      scope,
    });

    expect(
      projection.strategies.find(
        ({ strategyId }) => strategyId === 'focused-evidence',
      ),
    ).toMatchObject({
      decision: 'recommended',
      drift: 'none',
      recentAverageScoreDelta: 10,
    });
  });
});
