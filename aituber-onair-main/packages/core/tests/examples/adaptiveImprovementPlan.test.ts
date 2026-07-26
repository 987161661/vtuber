import { describe, expect, it } from 'vitest';
import {
  adaptNextSessionImprovementPlan,
  type AdaptiveImprovementPlan,
} from '../../examples/react-purupuru-app/src/lib/adaptiveImprovementPlan';
import type { NextSessionImprovementEffect } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';
import type {
  NextSessionImprovementItem,
  NextSessionImprovementPlan,
} from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementPlan';

function item(
  id: string,
  priority: number,
  tone: NextSessionImprovementItem['tone'] = 'recommendation',
): NextSessionImprovementItem {
  return {
    id,
    priority,
    tone,
    title: id,
    detail: `${id} detail`,
    evidence: `${id} evidence`,
    action: 'open-pipeline',
    actionLabel: '执行',
  };
}

function effect(
  improvementId: string,
  overrides: Partial<NextSessionImprovementEffect>,
): NextSessionImprovementEffect {
  return {
    improvementId,
    attempts: 0,
    observed: 0,
    pending: 0,
    confounded: 0,
    executionFailures: 0,
    improved: 0,
    declined: 0,
    averageScoreDelta: null,
    signal: 'insufficient',
    summary: '',
    ...overrides,
  };
}

function adapt(
  items: NextSessionImprovementItem[],
  effects: NextSessionImprovementEffect[],
): AdaptiveImprovementPlan {
  const plan: NextSessionImprovementPlan = {
    status: 'suggested',
    title: '建议',
    summary: '摘要',
    items,
  };
  return adaptNextSessionImprovementPlan({
    plan,
    effectiveness: { records: [], effects },
  });
}

describe('adaptive improvement plan', () => {
  it('keeps the evidence order when history is insufficient', () => {
    const result = adapt(
      [item('pipeline', 80), item('archive', 50)],
      [effect('archive', { attempts: 1, pending: 1 })],
    );

    expect(result.items.map(({ id }) => id)).toEqual(['pipeline', 'archive']);
    expect(result.items[1].disposition).toBe('unchanged');
  });

  it('promotes an action with repeated positive outcomes', () => {
    const result = adapt(
      [item('pipeline', 80), item('archive', 70)],
      [
        effect('archive', {
          attempts: 2,
          observed: 2,
          improved: 2,
          averageScoreDelta: 8,
          signal: 'positive',
        }),
      ],
    );

    expect(result.items[0]).toMatchObject({
      id: 'archive',
      priority: 85,
      disposition: 'validated',
    });
  });

  it('demotes a recommendation that repeatedly fails to improve the next session', () => {
    const result = adapt(
      [item('pipeline', 80), item('archive', 70)],
      [
        effect('pipeline', {
          attempts: 3,
          observed: 3,
          improved: 0,
          averageScoreDelta: 1,
          signal: 'neutral',
        }),
      ],
    );

    expect(result.items.map(({ id }) => id)).toEqual(['archive', 'pipeline']);
    expect(result.items[1]).toMatchObject({
      priority: 65,
      disposition: 'reconsider',
    });
  });

  it('does not demote a current priority risk even when its historical outcome declined', () => {
    const result = adapt(
      [item('preflight', 100, 'priority'), item('pipeline', 80)],
      [
        effect('preflight', {
          attempts: 2,
          observed: 2,
          declined: 2,
          averageScoreDelta: -9,
          signal: 'negative',
        }),
      ],
    );

    expect(result.items[0]).toMatchObject({
      id: 'preflight',
      priority: 100,
      disposition: 'reconsider',
    });
    expect(result.items[0].learningNote).toContain('风险仍需优先处理');
  });
});
