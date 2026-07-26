export type LiveReadinessStatus =
  | 'checking'
  | 'blocked'
  | 'attention'
  | 'ready';

export type LiveReadinessAction =
  | 'claim-runtime'
  | 'open-settings'
  | 'open-connectors'
  | 'review-queue'
  | 'open-pipeline'
  | 'retry-health';

export type LiveReadinessIssue = {
  code: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  action?: LiveReadinessAction;
  actionLabel?: string;
};

export type LiveReadinessHealth = {
  alerts?: string[];
  queueDepth?: number;
  oldestQueueAgeMs?: number;
  runtimeOwner?: {
    active: boolean;
    available: boolean;
    ttsConfigured: boolean;
  };
  runtimeLease?: {
    active: boolean;
    owner?: {
      label: string;
      role: string;
      fingerprint: string;
      acquiredAt: number;
      renewedAt: number;
      expiresAt: number;
      remainingMs: number;
    };
  };
  model?: {
    credentialConfigured?: boolean;
  };
  obs?: {
    processState?: 'running' | 'not-running' | 'unknown';
  };
  supervisor?: {
    state?: string;
    isLive?: boolean;
    connectedClients?: number;
  };
  lastFaults?: Partial<
    Record<
      'soul' | 'model' | 'skill' | 'tts' | 'flashhead' | 'platform',
      { at: number; stage: string; reason?: string }
    >
  >;
};

export type LiveReadinessInput = {
  healthState: 'checking' | 'available' | 'unavailable';
  health: LiveReadinessHealth;
  outputTargetConfigured: boolean;
  queueDepth?: number;
  oldestQueueAgeMs?: number;
  now?: number;
};

export type LiveReadiness = {
  status: LiveReadinessStatus;
  canStartAutomation: boolean;
  title: string;
  summary: string;
  issues: LiveReadinessIssue[];
};

const AUTOMATION_PAUSE_BLOCKERS = new Set([
  'health-unavailable',
  'runtime-owner',
  'model-credential',
  'tts',
]);

/**
 * Startup readiness and runtime liveness are different decisions. In
 * particular, an old queue needs an active consumer to expire or settle it;
 * stopping that consumer creates a permanent feedback loop.
 */
export function shouldPauseAutomationForReadiness(
  readiness: LiveReadiness,
): boolean {
  return readiness.issues.some(
    (issue) =>
      issue.severity === 'blocker' && AUTOMATION_PAUSE_BLOCKERS.has(issue.code),
  );
}

type ReadinessRule = (
  input: RequiredLiveReadinessInput,
) => LiveReadinessIssue | undefined;

type RequiredLiveReadinessInput = LiveReadinessInput & { now: number };

const rules: ReadinessRule[] = [
  ({ health }) => {
    if (health.runtimeOwner?.active && health.runtimeOwner.available) {
      return undefined;
    }
    const leaseOwner = health.runtimeLease?.active
      ? health.runtimeLease.owner
      : undefined;
    return {
          code: 'runtime-owner',
          severity: 'blocker',
          title: leaseOwner
            ? '执行端已占用，但播出心跳未就绪'
            : '播出执行端未接管',
          detail: leaseOwner
            ? `${leaseOwner.label}（${leaseOwner.fingerprint}）持有租约，剩余 ${formatDuration(leaseOwner.remainingMs)}；当前尚未形成可播出心跳。`
            : '当前页面只能观察状态，无法消费队列或驱动语音播出。',
          action: 'claim-runtime',
          actionLabel: leaseOwner ? '重新检查执行端' : '接管播出运行时',
        };
  },
  ({ health }) =>
    health.model?.credentialConfigured === false
      ? {
          code: 'model-credential',
          severity: 'blocker',
          title: '对话模型凭证不可用',
          detail: '主播无法生成新回复，请检查当前模型及服务端凭证。',
          action: 'open-settings',
          actionLabel: '检查模型配置',
        }
      : undefined,
  ({ health }) =>
    health.runtimeOwner?.active &&
    health.runtimeOwner.available &&
    health.runtimeOwner.ttsConfigured === false
      ? {
          code: 'tts',
          severity: 'blocker',
          title: '语音合成尚未就绪',
          detail: '文本可以生成，但无法形成可播出的声音。',
          action: 'open-settings',
          actionLabel: '检查语音配置',
        }
      : undefined,
  ({ outputTargetConfigured }) =>
    !outputTargetConfigured
      ? {
          code: 'output-target',
          severity: 'blocker',
          title: '尚未配置直播目标',
          detail: '请选择直播平台或启用一个带房间号的平台连接器。',
          action: 'open-connectors',
          actionLabel: '配置直播平台',
        }
      : undefined,
  ({ health, queueDepth = 0, oldestQueueAgeMs = 0 }) => {
    const authoritativeDepth = Math.max(queueDepth, health.queueDepth ?? 0);
    const authoritativeAge = Math.max(
      oldestQueueAgeMs,
      health.oldestQueueAgeMs ?? 0,
    );
    if (authoritativeDepth === 0 || authoritativeAge <= 15_000)
      return undefined;
    return {
      code: 'stale-queue',
      severity: 'blocker',
      title: `${authoritativeDepth} 条互动等待过久`,
      detail: `最早一条已等待 ${formatDuration(authoritativeAge)}，继续自动播出可能回复过期内容。`,
      action: 'review-queue',
      actionLabel: '处理等待队列',
    };
  },
  ({ health }) =>
    health.alerts?.includes('preparing_lease_stale')
      ? {
          code: 'stale-lease',
          severity: 'blocker',
          title: '有回复任务卡在准备阶段',
          detail: '任务租约已经过期，需要先恢复或清理后再自动播出。',
          action: 'review-queue',
          actionLabel: '检查卡住任务',
        }
      : undefined,
  ({ health }) =>
    health.obs?.processState === 'not-running'
      ? {
          code: 'obs',
          severity: 'warning',
          title: '未检测到 OBS',
          detail: '站内预演不受影响；正式推流前请启动 OBS 并确认画面采集。',
          action: 'open-pipeline',
          actionLabel: '查看播出链路',
        }
      : undefined,
  ({ health }) =>
    health.supervisor?.isLive === true &&
    Number(health.supervisor.connectedClients ?? 0) === 0
      ? {
          code: 'platform-listener',
          severity: 'warning',
          title: '直播中但未收到平台监听连接',
          detail: '观众弹幕可能无法进入总控，请检查平台网关。',
          action: 'open-connectors',
          actionLabel: '检查平台连接',
        }
      : undefined,
  ({ health, now }) => {
    const recentFaults = Object.entries(health.lastFaults ?? {}).filter(
      ([, fault]) => fault && now - fault.at <= 120_000,
    );
    if (!recentFaults.length) return undefined;
    return {
      code: 'recent-fault',
      severity: 'warning',
      title: '播出链路刚刚发生异常',
      detail: `近两分钟有 ${recentFaults.length} 个环节报错，请确认链路已经恢复。`,
      action: 'open-pipeline',
      actionLabel: '查看异常位置',
    };
  },
];

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

export function assessLiveReadiness(input: LiveReadinessInput): LiveReadiness {
  if (input.healthState === 'checking') {
    return {
      status: 'checking',
      canStartAutomation: false,
      title: '正在检查开播条件',
      summary: '正在读取运行时、模型、语音、队列和推流状态。',
      issues: [],
    };
  }

  if (input.healthState === 'unavailable') {
    return {
      status: 'blocked',
      canStartAutomation: false,
      title: '无法确认是否可以开播',
      summary: '健康检查服务没有响应，请恢复本地运行服务后重试。',
      issues: [
        {
          code: 'health-unavailable',
          severity: 'blocker',
          title: '运行状态不可用',
          detail: '总控无法读取权威运行状态，为避免误播已阻止启动自动播出。',
          action: 'retry-health',
          actionLabel: '重新检查',
        },
      ],
    };
  }

  const resolvedInput = { ...input, now: input.now ?? Date.now() };
  const issues = rules
    .map((rule) => rule(resolvedInput))
    .filter((issue): issue is LiveReadinessIssue => Boolean(issue));
  const blockerCount = issues.filter(
    (issue) => issue.severity === 'blocker',
  ).length;
  const warningCount = issues.length - blockerCount;

  if (blockerCount > 0) {
    return {
      status: 'blocked',
      canStartAutomation: false,
      title: '暂不建议开播',
      summary: `${blockerCount} 项必须处理${warningCount ? `，另有 ${warningCount} 项提醒` : ''}。`,
      issues,
    };
  }

  if (warningCount > 0) {
    return {
      status: 'attention',
      canStartAutomation: true,
      title: '可以预演，正式开播前需确认',
      summary: `${warningCount} 项不会阻止自动播出，但可能影响正式推流。`,
      issues,
    };
  }

  return {
    status: 'ready',
    canStartAutomation: true,
    title: '已具备开播条件',
    summary: '运行时、模型、语音、直播目标和互动队列均已就绪。',
    issues: [],
  };
}
