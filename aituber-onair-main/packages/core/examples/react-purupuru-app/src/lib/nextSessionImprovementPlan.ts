import type { LiveSessionRetrospective } from './liveSessionRetrospective';
import type { LiveStartupAction } from './liveStartupGuide';
import type { LiveSessionTrend } from './liveSessionTrend';

export type NextSessionImprovementItem = {
  id: string;
  priority: number;
  tone: 'priority' | 'recommendation';
  title: string;
  detail: string;
  evidence: string;
  action: Extract<
    LiveStartupAction,
    'run-preflight' | 'open-pipeline' | 'review-queue'
  >;
  actionLabel: string;
};

export type NextSessionImprovementPlan = {
  status: 'waiting' | 'clear' | 'suggested' | 'priority';
  title: string;
  summary: string;
  items: NextSessionImprovementItem[];
};

type ImprovementRule = {
  id: string;
  priority: number;
  applies: (
    retrospective: LiveSessionRetrospective,
    trend: LiveSessionTrend,
  ) => boolean;
  project: (
    retrospective: LiveSessionRetrospective,
    trend: LiveSessionTrend,
  ) => NextSessionImprovementItem;
};

const rules: ImprovementRule[] = [
  {
    id: 'operational-followup',
    priority: 100,
    applies: (retrospective) =>
      retrospective.metrics.attentionOpened >
        retrospective.metrics.attentionResolved ||
      retrospective.metrics.failedActions > 0,
    project: (retrospective) => {
      const unresolved = Math.max(
        0,
        retrospective.metrics.attentionOpened -
          retrospective.metrics.attentionResolved,
      );
      const parts = [
        unresolved ? `${unresolved} 个提醒场内未闭环` : '',
        retrospective.metrics.failedActions
          ? `${retrospective.metrics.failedActions} 次处理动作失败`
          : '',
      ].filter(Boolean);
      return {
        id: 'operational-followup',
        priority: 100,
        tone: 'priority',
        title: '开播前复核未闭环运营问题',
        detail: '先重新运行配置诊断，再决定是否恢复自动播出。',
        evidence: parts.join('；'),
        action: 'run-preflight',
        actionLabel: '运行开播前诊断',
      };
    },
  },
  {
    id: 'pipeline-review',
    priority: 80,
    applies: (retrospective, trend) =>
      retrospective.metrics.failed > 0 || trend.direction === 'declining',
    project: (retrospective, trend) => {
      const parts = [
        retrospective.metrics.failed
          ? `上一场 ${retrospective.metrics.failed} 条互动处理失败`
          : '',
        trend.direction === 'declining' && trend.scoreDelta !== null
          ? `最近一场评分下降 ${Math.abs(trend.scoreDelta)} 分`
          : '',
      ].filter(Boolean);
      return {
        id: 'pipeline-review',
        priority: 80,
        tone: retrospective.metrics.failed > 0 ? 'priority' : 'recommendation',
        title: '复查生成、语音与投递链路',
        detail: '从失败证据定位最先异常的阶段，避免只重复执行恢复动作。',
        evidence: parts.join('；'),
        action: 'open-pipeline',
        actionLabel: '打开链路监控',
      };
    },
  },
  {
    id: 'archive-review',
    priority: 50,
    applies: (retrospective) => retrospective.metrics.archived > 0,
    project: (retrospective) => ({
      id: 'archive-review',
      priority: 50,
      tone: 'recommendation',
      title: '复看切场归档互动',
      detail: '确认其中是否有高价值问题需要在下一场继续回应。',
      evidence: `上一场归档 ${retrospective.metrics.archived} 条互动`,
      action: 'review-queue',
      actionLabel: '查看历史队列',
    }),
  },
];

export function planNextSessionImprovement(input: {
  retrospective: LiveSessionRetrospective | null;
  trend: LiveSessionTrend;
}): NextSessionImprovementPlan {
  if (!input.retrospective) {
    return {
      status: 'waiting',
      title: '等待首份复盘',
      summary: '完成一次切场后，系统会根据真实处理证据生成下一场建议。',
      items: [],
    };
  }
  const retrospective = input.retrospective;
  const items = rules
    .filter((rule) => rule.applies(retrospective, input.trend))
    .map((rule) => rule.project(retrospective, input.trend))
    .sort((left, right) => right.priority - left.priority);
  if (!items.length) {
    return {
      status: 'clear',
      title: '下一场无需额外整改',
      summary: '上一场没有失败、未闭环提醒或明显质量回落，保持当前配置即可。',
      items: [],
    };
  }
  const priorityItems = items.filter(({ tone }) => tone === 'priority').length;
  return {
    status: priorityItems ? 'priority' : 'suggested',
    title: priorityItems
      ? `${priorityItems} 项开播前优先处理`
      : `${items.length} 项下一场优化建议`,
    summary: priorityItems
      ? '这些建议来自上一场的失败或未闭环证据，但不会自动阻断当前操作。'
      : '建议在下一场开始前完成，以持续改善跨场表现。',
    items,
  };
}
