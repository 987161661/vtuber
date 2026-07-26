import type { LiveSessionRecord } from './liveSessionLifecycle';
import type { OperatorAttentionLedger } from './operatorAttentionLedger';
import type { OperatorQueueSummary } from './operatorQueue';

export type LiveSessionRetrospectiveStatus =
  | 'excellent'
  | 'stable'
  | 'needs-review'
  | 'critical';

export type LiveSessionRetrospectiveFinding = {
  id: string;
  tone: 'positive' | 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
};

export type LiveSessionRetrospective = {
  status: LiveSessionRetrospectiveStatus;
  score: number;
  title: string;
  summary: string;
  metrics: {
    durationMs: number;
    total: number;
    responded: number;
    skipped: number;
    failed: number;
    archived: number;
    attentionOpened: number;
    attentionResolved: number;
    failedActions: number;
  };
  findings: LiveSessionRetrospectiveFinding[];
  markdown: string;
};

type LiveSessionRetrospectiveInput = {
  session: LiveSessionRecord;
  queue: OperatorQueueSummary;
  attention: Pick<OperatorAttentionLedger, 'recap' | 'incidents'>;
  scope: {
    platform: string;
    roomId: string;
  };
};

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function statusForScore(score: number): LiveSessionRetrospectiveStatus {
  if (score >= 95) return 'excellent';
  if (score >= 80) return 'stable';
  if (score >= 60) return 'needs-review';
  return 'critical';
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function buildFindings(input: {
  queue: OperatorQueueSummary;
  attention: Pick<OperatorAttentionLedger, 'recap' | 'incidents'>;
}): LiveSessionRetrospectiveFinding[] {
  const findings: LiveSessionRetrospectiveFinding[] = [];
  const settled = input.queue.done + input.queue.skipped + input.queue.failed;
  const failureRate = ratio(input.queue.failed, settled);
  const unresolved = input.attention.recap.active;

  if (input.queue.failed > 0) {
    findings.push({
      id: 'queue-failures',
      tone: failureRate >= 0.2 ? 'critical' : 'warning',
      title: `${input.queue.failed} 条互动处理失败`,
      detail: `占已结算互动的 ${Math.round(failureRate * 100)}%，建议复查生成、语音与投递证据。`,
    });
  } else if (settled > 0) {
    findings.push({
      id: 'queue-clean',
      tone: 'positive',
      title: '已结算互动无处理失败',
      detail: `本场回应 ${input.queue.done} 条，未采用 ${input.queue.skipped} 条。`,
    });
  }

  if (unresolved > 0) {
    findings.push({
      id: 'attention-unresolved',
      tone: 'critical',
      title: `${unresolved} 个运营提醒未在场内恢复`,
      detail: '这些提醒已随场次闭合，下一场开始前应确认根因已消除。',
    });
  } else if (input.attention.recap.opened > 0) {
    findings.push({
      id: 'attention-recovered',
      tone: 'positive',
      title: '本场运营提醒均已闭环',
      detail: `${input.attention.recap.resolved} 个提醒已恢复，平均恢复用时 ${
        input.attention.recap.averageResolutionMs === null
          ? '—'
          : formatDuration(input.attention.recap.averageResolutionMs)
      }。`,
    });
  } else {
    findings.push({
      id: 'attention-clear',
      tone: 'positive',
      title: '本场未出现运营提醒',
      detail: '运行、配置与运营跟进信号未触发人工处理。',
    });
  }

  if (input.attention.recap.failedActions > 0) {
    findings.push({
      id: 'action-failures',
      tone: 'warning',
      title: `${input.attention.recap.failedActions} 次处理动作失败`,
      detail: '复查对应动作的错误证据，避免下一场重复尝试无效恢复路径。',
    });
  }

  if (input.queue.archived > 0) {
    findings.push({
      id: 'queue-archived',
      tone: 'info',
      title: `${input.queue.archived} 条互动在切场时归档`,
      detail: '归档不是失败；如其中存在高价值互动，可在历史队列中继续复用。',
    });
  }

  return findings;
}

function buildMarkdown(input: {
  session: LiveSessionRecord;
  scope: LiveSessionRetrospectiveInput['scope'];
  score: number;
  title: string;
  metrics: LiveSessionRetrospective['metrics'];
  findings: LiveSessionRetrospectiveFinding[];
  incidents: OperatorAttentionLedger['incidents'];
}): string {
  const incidentLines = input.incidents.length
    ? input.incidents.map((incident) => {
        const state = incident.resolvedAt
          ? `已恢复于 ${formatDateTime(incident.resolvedAt)}`
          : '场内未恢复';
        return `- ${incident.title}：${formatDateTime(incident.openedAt)} 出现，${state}；处理动作 ${incident.actions.filter(({ status }) => status !== 'started').length} 次`;
      })
    : ['- 无'];
  return [
    `# 第 ${input.session.sequence} 场直播复盘`,
    '',
    `- 场次：${input.session.sessionId}`,
    `- 直播间：${input.scope.platform} / ${input.scope.roomId}`,
    `- 时间：${formatDateTime(input.session.startedAt)} — ${formatDateTime(input.session.endedAt ?? input.session.startedAt)}`,
    `- 评分：${input.score}/100（${input.title}）`,
    `- 时长：${formatDuration(input.metrics.durationMs)}`,
    '',
    '## 互动处理',
    '',
    `- 总计 ${input.metrics.total}；回应 ${input.metrics.responded}；未采用 ${input.metrics.skipped}；失败 ${input.metrics.failed}；归档 ${input.metrics.archived}`,
    '',
    '## 运营结论',
    '',
    ...input.findings.map(
      (finding) => `- **${finding.title}**：${finding.detail}`,
    ),
    '',
    '## 提醒处理证据',
    '',
    ...incidentLines,
  ].join('\n');
}

export function projectLiveSessionRetrospective(
  input: LiveSessionRetrospectiveInput,
): LiveSessionRetrospective {
  const endedAt = input.session.endedAt ?? input.session.startedAt;
  const durationMs = Math.max(0, endedAt - input.session.startedAt);
  const settled = input.queue.done + input.queue.skipped + input.queue.failed;
  const failureRate = ratio(input.queue.failed, settled);
  const unresolved = input.attention.recap.active;
  const score = clampScore(
    100 -
      Math.min(40, failureRate * 40) -
      Math.min(30, unresolved * 15) -
      Math.min(20, input.attention.recap.failedActions * 10),
  );
  const status = statusForScore(score);
  const titles: Record<LiveSessionRetrospectiveStatus, string> = {
    excellent: '稳定闭环',
    stable: '整体稳定',
    'needs-review': '建议复查',
    critical: '需要重点复盘',
  };
  const metrics: LiveSessionRetrospective['metrics'] = {
    durationMs,
    total: input.queue.total,
    responded: input.queue.done,
    skipped: input.queue.skipped,
    failed: input.queue.failed,
    archived: input.queue.archived,
    attentionOpened: input.attention.recap.opened,
    attentionResolved: input.attention.recap.resolved,
    failedActions: input.attention.recap.failedActions,
  };
  const findings = buildFindings({
    queue: input.queue,
    attention: input.attention,
  });
  const title = titles[status];
  const summary = `${formatDuration(durationMs)} · 回应 ${metrics.responded} · 提醒闭环 ${metrics.attentionResolved}/${metrics.attentionOpened}`;

  return {
    status,
    score,
    title,
    summary,
    metrics,
    findings,
    markdown: buildMarkdown({
      session: input.session,
      scope: input.scope,
      score,
      title,
      metrics,
      findings,
      incidents: input.attention.incidents,
    }),
  };
}
