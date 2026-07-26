import { describe, expect, it } from 'vitest';
import type { LiveSessionTrendRecord } from '../../examples/react-purupuru-app/src/lib/liveSessionTrend';
import {
  createNextSessionImprovementActionEvent,
  mergeNextSessionImprovementActionEvents,
  projectNextSessionImprovementEffectiveness,
  type NextSessionImprovementActionRuntimeEvent,
} from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';

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
    ...scope,
    score,
    status: score >= 80 ? 'stable' : 'needs-review',
    responded: 5,
    failed: 0,
    attentionOpened: 0,
    attentionResolved: 0,
  };
}

function action(
  baseSessionId: string,
  improvementId: string,
  at: number,
  outcome: 'completed' | 'failed' = 'completed',
): NextSessionImprovementActionRuntimeEvent {
  return {
    stage: 'operator_next_session_improvement_action',
    at,
    baseSessionId,
    improvementId,
    improvementAction: 'open-pipeline',
    outcome,
    ...scope,
  };
}

describe('next session improvement effectiveness', () => {
  it('creates a scoped action event that can be linked to the next session', () => {
    const runtimeEvent = createNextSessionImprovementActionEvent({
      item: {
        id: 'pipeline-review',
        priority: 80,
        tone: 'priority',
        title: '复查链路',
        detail: '查看失败证据',
        evidence: '失败 1 条',
        action: 'open-pipeline',
        actionLabel: '打开链路',
      },
      baseSession: {
        sessionId: 'session-1',
        sequence: 1,
        startedAt: 100,
        endedAt: 200,
      },
      scope,
      outcome: 'completed',
      strategy: {
        id: 'custom-focused-evidence',
        label: '聚焦首要证据',
        controlled: true,
        variable: 'scope',
        instruction: '只处理首要失败证据。',
        successSignal: '失败数量下降',
        origin: 'custom',
      },
      experimentContext: {
        id: 'experiment-v1-context-a',
        label: 'gpt-5 · openai · 自动播出',
      },
      strategyQualityGateVersion: 2,
      at: 250,
    });

    expect(runtimeEvent).toMatchObject({
      eventId:
        'next-session-improvement:session-1:pipeline-review:completed:250',
      baseSessionId: 'session-1',
      baseSessionSequence: 1,
      improvementAction: 'open-pipeline',
      strategyId: 'custom-focused-evidence',
      strategyVariable: 'scope',
      strategyInstruction: '只处理首要失败证据。',
      strategySuccessSignal: '失败数量下降',
      strategyOrigin: 'custom',
      experimentContextId: 'experiment-v1-context-a',
      experimentContextLabel: 'gpt-5 · openai · 自动播出',
      strategyQualityGateVersion: 2,
      ...scope,
    });
  });

  it('links a completed action to the immediately following session', () => {
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [action('session-1', 'pipeline-review', 150)],
      sessions: [session('session-1', 1, 70), session('session-2', 2, 82)],
      scope,
    });

    expect(effectiveness.records).toEqual([
      expect.objectContaining({
        improvementId: 'pipeline-review',
        baseSessionId: 'session-1',
        nextSessionId: 'session-2',
        scoreDelta: 12,
        outcome: 'improved',
      }),
    ]);
    expect(effectiveness.effects[0]).toMatchObject({
      observed: 1,
      averageScoreDelta: 12,
      signal: 'positive',
    });
  });

  it('classifies stable and declining outcomes with a five-point threshold', () => {
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [
        action('session-1', 'pipeline-review', 150),
        action('session-2', 'pipeline-review', 250),
      ],
      sessions: [
        session('session-1', 1, 80),
        session('session-2', 2, 77),
        session('session-3', 3, 68),
      ],
      scope,
    });

    expect(effectiveness.records.map(({ outcome }) => outcome)).toEqual([
      'stable',
      'declined',
    ]);
    expect(effectiveness.effects[0]).toMatchObject({
      observed: 2,
      declined: 1,
      averageScoreDelta: -6,
      signal: 'negative',
    });
  });

  it('does not attribute a result across a known experiment context change', () => {
    const completedAction = {
      ...action('session-1', 'pipeline-review', 150),
      experimentContextId: 'experiment-v1-context-a',
    };
    const base = {
      ...session('session-1', 1, 70),
      experimentContextId: 'experiment-v1-context-a',
    };
    const next = {
      ...session('session-2', 2, 90),
      experimentContextId: 'experiment-v1-context-b',
    };

    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [completedAction],
      sessions: [base, next],
      scope,
    });

    expect(effectiveness.records[0]).toMatchObject({
      outcome: 'context-changed',
      nextSessionId: 'session-2',
    });
    expect(effectiveness.effects[0]).toMatchObject({
      observed: 0,
      contextChanged: 1,
      averageScoreDelta: null,
      signal: 'insufficient',
    });
  });

  it('treats an unversioned baseline as unknown instead of assuming compatibility', () => {
    const completedAction = {
      ...action('session-1', 'pipeline-review', 150),
      experimentContextId: 'experiment-v1-context-a',
    };
    const next = {
      ...session('session-2', 2, 90),
      experimentContextId: 'experiment-v1-context-a',
    };

    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [completedAction],
      sessions: [session('session-1', 1, 70), next],
      scope,
    });

    expect(effectiveness.records[0]).toMatchObject({
      outcome: 'context-changed',
    });
    expect(effectiveness.effects[0].observed).toBe(0);
  });

  it('keeps aggregate effectiveness scoped to the current experiment context', () => {
    const currentContext = {
      id: 'experiment-v1-context-b',
      label: '新模型 · openai · 自动播出',
    };
    const previousAction = {
      ...action('session-1', 'pipeline-review', 150),
      experimentContextId: 'experiment-v1-context-a',
    };
    const currentAction = {
      ...action('session-3', 'pipeline-review', 350),
      experimentContextId: currentContext.id,
    };
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [previousAction, currentAction],
      sessions: [
        session('session-1', 1, 70),
        session('session-2', 2, 90),
        {
          ...session('session-3', 3, 70),
          experimentContextId: currentContext.id,
        },
        {
          ...session('session-4', 4, 78),
          experimentContextId: currentContext.id,
        },
      ],
      scope,
      context: currentContext,
    });

    expect(effectiveness.records).toEqual([
      expect.objectContaining({
        baseSessionId: 'session-3',
        scoreDelta: 8,
      }),
    ]);
    expect(effectiveness.effects[0]).toMatchObject({
      observed: 1,
      averageScoreDelta: 8,
    });
  });

  it('keeps completed actions pending until the next session exists', () => {
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [
        {
          ...action('session-2', 'archive-review', 250),
          baseSessionSequence: 2,
        },
      ],
      sessions: [session('session-2', 2, 90)],
      scope,
    });

    expect(effectiveness.effects[0]).toMatchObject({
      attempts: 1,
      observed: 0,
      pending: 1,
      signal: 'insufficient',
      summary: expect.stringContaining('等待下一场'),
    });
  });

  it('expires actions whose baseline is no longer retained', () => {
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [
        {
          ...action('session-1', 'pipeline-review', 150),
          baseSessionSequence: 1,
        },
      ],
      sessions: [session('session-8', 8, 70), session('session-9', 9, 72)],
      scope,
    });

    expect(effectiveness.records[0]).toMatchObject({
      outcome: 'evidence-expired',
    });
    expect(effectiveness.effects[0]).toMatchObject({
      observed: 0,
      pending: 0,
      expired: 1,
      signal: 'insufficient',
    });
  });

  it('deduplicates retries and isolates scope while retaining execution failures', () => {
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [
        action('session-1', 'pipeline-review', 100, 'failed'),
        action('session-1', 'pipeline-review', 200, 'completed'),
        {
          ...action('session-1', 'archive-review', 300, 'failed'),
          roomId: 'other-room',
        },
        action('session-1', 'archive-review', 400, 'failed'),
      ],
      sessions: [session('session-1', 1, 80), session('session-2', 2, 88)],
      scope,
    });

    expect(effectiveness.records).toHaveLength(2);
    expect(
      effectiveness.effects.find(
        ({ improvementId }) => improvementId === 'pipeline-review',
      ),
    ).toMatchObject({ attempts: 1, observed: 1, executionFailures: 0 });
    expect(
      effectiveness.effects.find(
        ({ improvementId }) => improvementId === 'archive-review',
      ),
    ).toMatchObject({ attempts: 0, observed: 0, executionFailures: 1 });
  });

  it('keeps optimistic action evidence until server history confirms it', () => {
    const optimistic = {
      ...action('session-1', 'pipeline-review', 100),
      eventId: 'action-1',
    };
    expect(
      mergeNextSessionImprovementActionEvents({
        remote: [],
        local: [optimistic],
        now: 200,
      }),
    ).toEqual([optimistic]);
    expect(
      mergeNextSessionImprovementActionEvents({
        remote: [optimistic],
        local: [optimistic],
        now: 200,
      }),
    ).toEqual([optimistic]);
  });

  it('does not attribute an explicitly uncontrolled strategy action to the next session', () => {
    const effectiveness = projectNextSessionImprovementEffectiveness({
      actions: [
        {
          ...action('session-1', 'archive-review', 100),
          strategyId: 'alternative-path',
          experimentControlled: false,
        },
      ],
      sessions: [session('session-1', 1, 70), session('session-2', 2, 90)],
      scope,
    });

    expect(effectiveness.records[0]).toMatchObject({
      outcome: 'confounded',
    });
    expect(effectiveness.records[0]).not.toHaveProperty('scoreDelta');
    expect(effectiveness.effects[0]).toMatchObject({
      observed: 0,
      confounded: 1,
      signal: 'insufficient',
    });
  });
});
