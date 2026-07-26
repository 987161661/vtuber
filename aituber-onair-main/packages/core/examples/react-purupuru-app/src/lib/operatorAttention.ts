import type { LiveReadiness, LiveReadinessAction } from './liveReadiness';
import type { OperatorPreflightSession } from './operatorPreflight';
import type {
  RuntimeRecoveryAction,
  RuntimeRecoveryPlan,
} from './runtimeRecovery';

export type OperatorAttentionAction =
  | LiveReadinessAction
  | RuntimeRecoveryAction
  | 'run-preflight'
  | 'open-commitments';

export type OperatorAttentionItem = {
  id: string;
  domain:
    | 'runtime'
    | 'model'
    | 'voice'
    | 'soul'
    | 'platform'
    | 'queue'
    | 'configuration'
    | 'commitment';
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  action?: OperatorAttentionAction;
  actionLabel?: string;
  source: 'readiness' | 'recovery' | 'preflight' | 'commitment';
};

export type OperatorAttentionCenter = {
  status: 'checking' | 'clear' | 'attention' | 'blocked';
  title: string;
  summary: string;
  counts: {
    total: number;
    blockers: number;
    warnings: number;
  };
  items: OperatorAttentionItem[];
};

type OperatorAttentionInput = {
  readiness: LiveReadiness;
  recovery: RuntimeRecoveryPlan;
  preflight: OperatorPreflightSession;
  commitments: {
    attention: number;
    overdue: number;
    dueSoon: number;
  };
};

const equivalentIncidentIds: Record<string, string> = {
  tts: 'tts-configuration',
  'stale-lease': 'stale-queue-lease',
};

function canonicalIncidentId(id: string): string {
  return equivalentIncidentIds[id] ?? id;
}

function preflightItem(
  session: OperatorPreflightSession,
): OperatorAttentionItem | undefined {
  if (session.state === 'stale') {
    return {
      id: 'preflight-stale',
      domain: 'configuration',
      severity: 'blocker',
      title: '配置诊断结果已经过期',
      detail: '配置发生变更后，必须重新完成诊断才能安全恢复自动播出。',
      action: 'run-preflight',
      actionLabel: '重新运行诊断',
      source: 'preflight',
    };
  }
  if (session.state !== 'fresh' || session.report.status === 'ready') {
    return undefined;
  }
  const blocked = session.report.status === 'blocked';
  return {
    id: blocked ? 'preflight-blocked' : 'preflight-degraded',
    domain: 'configuration',
    severity: blocked ? 'blocker' : 'warning',
    title: blocked ? '配置诊断存在阻断项' : '配置诊断存在降级项',
    detail: session.report.summary,
    action: 'run-preflight',
    actionLabel: '重新运行诊断',
    source: 'preflight',
  };
}

function commitmentItem(
  input: OperatorAttentionInput['commitments'],
): OperatorAttentionItem | undefined {
  if (!input.attention) return undefined;
  const parts = [
    input.overdue ? `${input.overdue} 项逾期` : '',
    input.dueSoon ? `${input.dueSoon} 项将在 7 日内到期` : '',
  ].filter(Boolean);
  return {
    id: 'commitments',
    domain: 'commitment',
    severity: 'warning',
    title: `${input.attention} 项承诺需要关注`,
    detail: parts.join('，') || '存在需要运营者确认的待兑现承诺。',
    action: 'open-commitments',
    actionLabel: '查看承诺雷达',
    source: 'commitment',
  };
}

export function projectOperatorAttention(
  input: OperatorAttentionInput,
): OperatorAttentionCenter {
  const itemsById = new Map<string, OperatorAttentionItem>();

  for (const incident of input.recovery.incidents) {
    const id = canonicalIncidentId(incident.id);
    itemsById.set(id, {
      id,
      domain: incident.domain,
      severity: incident.severity,
      title: incident.title,
      detail: incident.detail,
      action: incident.action,
      actionLabel: incident.actionLabel,
      source: 'recovery',
    });
  }

  for (const issue of input.readiness.issues) {
    const id = canonicalIncidentId(issue.code);
    if (itemsById.has(id)) continue;
    itemsById.set(id, {
      id,
      domain:
        id.includes('queue') || id.includes('lease')
          ? 'queue'
          : id.includes('model')
            ? 'model'
            : id.includes('tts')
              ? 'voice'
              : id.includes('platform') ||
                  id.includes('connector') ||
                  id === 'output-target'
                ? 'platform'
                : 'runtime',
      severity: issue.severity,
      title: issue.title,
      detail: issue.detail,
      action: issue.action,
      actionLabel: issue.actionLabel,
      source: 'readiness',
    });
  }

  const configuration = preflightItem(input.preflight);
  if (configuration) itemsById.set(configuration.id, configuration);
  const commitment = commitmentItem(input.commitments);
  if (commitment) itemsById.set(commitment.id, commitment);

  const items = [...itemsById.values()].sort((left, right) => {
    if (left.severity === right.severity) return 0;
    return left.severity === 'blocker' ? -1 : 1;
  });
  const blockers = items.filter(
    ({ severity }) => severity === 'blocker',
  ).length;
  const warnings = items.length - blockers;
  const checking =
    !items.length &&
    (input.readiness.status === 'checking' ||
      input.recovery.status === 'checking' ||
      input.preflight.state === 'running');

  if (checking) {
    return {
      status: 'checking',
      title: '正在汇总运营状态',
      summary: '正在读取开播条件、运行故障、配置诊断和承诺提醒。',
      counts: { total: 0, blockers: 0, warnings: 0 },
      items: [],
    };
  }
  if (!items.length) {
    return {
      status: 'clear',
      title: '当前无需人工处理',
      summary: '运行链路、配置和运营跟进项均无待处理提醒。',
      counts: { total: 0, blockers: 0, warnings: 0 },
      items: [],
    };
  }

  return {
    status: blockers ? 'blocked' : 'attention',
    title: blockers
      ? `${blockers} 项问题阻止安全开播`
      : `${warnings} 项运营提醒`,
    summary: blockers
      ? '请优先处理阻断项，再恢复自动播出。'
      : '这些事项不阻止当前操作，但建议按优先级跟进。',
    counts: { total: items.length, blockers, warnings },
    items,
  };
}
