import { describe, expect, it } from 'vitest';
import type { LiveSessionRetrospective } from '../../examples/react-purupuru-app/src/lib/liveSessionRetrospective';
import type { LiveSessionTrend } from '../../examples/react-purupuru-app/src/lib/liveSessionTrend';
import { planNextSessionImprovement } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementPlan';

const retrospective: LiveSessionRetrospective = {
  status: 'excellent',
  score: 100,
  title: '稳定闭环',
  summary: '60 分钟',
  metrics: {
    durationMs: 3_600_000,
    total: 10,
    responded: 10,
    skipped: 0,
    failed: 0,
    archived: 0,
    attentionOpened: 0,
    attentionResolved: 0,
    failedActions: 0,
  },
  findings: [],
  markdown: '# report',
};

const trend: LiveSessionTrend = {
  direction: 'stable',
  title: '稳定',
  summary: '稳定',
  averageScore: 95,
  scoreDelta: 0,
  records: [],
};

describe('next session improvement plan', () => {
  it('waits for the first retrospective without showing a false all-clear', () => {
    expect(
      planNextSessionImprovement({ retrospective: null, trend }),
    ).toMatchObject({
      status: 'waiting',
      title: '等待首份复盘',
      items: [],
    });
  });

  it('prioritizes unresolved incidents and failed recovery actions', () => {
    const plan = planNextSessionImprovement({
      retrospective: {
        ...retrospective,
        metrics: {
          ...retrospective.metrics,
          attentionOpened: 3,
          attentionResolved: 1,
          failedActions: 2,
          failed: 1,
          archived: 4,
        },
      },
      trend,
    });

    expect(plan.status).toBe('priority');
    expect(plan.items.map(({ id, action }) => [id, action])).toEqual([
      ['operational-followup', 'run-preflight'],
      ['pipeline-review', 'open-pipeline'],
      ['archive-review', 'review-queue'],
    ]);
    expect(plan.items[0].evidence).toContain('2 个提醒场内未闭环');
    expect(plan.items[0].evidence).toContain('2 次处理动作失败');
  });

  it('deduplicates queue failures and a declining trend into one pipeline review', () => {
    const plan = planNextSessionImprovement({
      retrospective: {
        ...retrospective,
        metrics: { ...retrospective.metrics, failed: 2 },
      },
      trend: { ...trend, direction: 'declining', scoreDelta: -12 },
    });

    expect(plan.items).toEqual([
      expect.objectContaining({
        id: 'pipeline-review',
        action: 'open-pipeline',
        evidence: expect.stringContaining('下降 12 分'),
      }),
    ]);
  });

  it('treats a decline without failures as a recommendation, not a blocker', () => {
    const plan = planNextSessionImprovement({
      retrospective,
      trend: { ...trend, direction: 'declining', scoreDelta: -6 },
    });

    expect(plan).toMatchObject({
      status: 'suggested',
      items: [
        {
          id: 'pipeline-review',
          tone: 'recommendation',
          action: 'open-pipeline',
        },
      ],
    });
  });

  it('keeps a healthy baseline clear and does not invent work', () => {
    const plan = planNextSessionImprovement({
      retrospective,
      trend,
    });

    expect(plan).toMatchObject({
      status: 'clear',
      title: '下一场无需额外整改',
      items: [],
    });
  });
});
