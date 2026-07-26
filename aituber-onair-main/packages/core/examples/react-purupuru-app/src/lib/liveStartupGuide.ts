import type {
  LiveReadiness,
  LiveReadinessAction,
  LiveReadinessIssue,
} from './liveReadiness';

export type LiveStartupAction =
  | LiveReadinessAction
  | 'run-preflight'
  | 'enable-automation';
export type LiveStartupPhase =
  | 'checking'
  | 'needs-action'
  | 'ready'
  | 'started';

export interface LiveStartupStep {
  id: 'runtime' | 'preflight' | 'generation' | 'target' | 'queue';
  label: string;
  status: 'ready' | 'checking' | 'blocked';
  detail: string;
}

export interface LiveStartupPlan {
  phase: LiveStartupPhase;
  title: string;
  detail: string;
  primaryLabel: string;
  nextAction?: LiveStartupAction;
  automatic: boolean;
  steps: LiveStartupStep[];
}

const STEP_RULES: Array<{
  id: LiveStartupStep['id'];
  label: string;
  codes: string[];
}> = [
  { id: 'runtime', label: '播出执行端', codes: ['runtime-owner'] },
  { id: 'preflight', label: '开播前诊断', codes: [] },
  {
    id: 'generation',
    label: '模型与语音',
    codes: ['model-credential', 'tts'],
  },
  { id: 'target', label: '直播目标', codes: ['output-target'] },
  {
    id: 'queue',
    label: '互动队列',
    codes: ['stale-queue', 'stale-lease'],
  },
];

function blockerFor(
  readiness: LiveReadiness,
  codes: readonly string[],
): LiveReadinessIssue | undefined {
  return readiness.issues.find(
    (issue) => issue.severity === 'blocker' && codes.includes(issue.code),
  );
}

function stepsFor(
  readiness: LiveReadiness,
  runtimeStable: boolean,
  configurationPreflightStatus?: 'ready' | 'degraded' | 'blocked',
  configurationPreflightRunning = false,
): LiveStartupStep[] {
  return STEP_RULES.map((rule) => {
    const blocker = blockerFor(readiness, rule.codes);
    const preflightBlocked =
      rule.id === 'preflight' && configurationPreflightStatus === 'blocked';
    const preflightPending =
      rule.id === 'preflight' &&
      (configurationPreflightRunning || !configurationPreflightStatus);
    const stabilizing = rule.id === 'runtime' && !blocker && !runtimeStable;
    return {
      id: rule.id,
      label: rule.label,
      status:
        blocker || preflightBlocked
          ? 'blocked'
          : stabilizing || preflightPending
            ? 'checking'
            : 'ready',
      detail:
        blocker?.title ??
        (preflightBlocked
          ? '最新诊断仍有阻断项'
          : preflightPending
            ? configurationPreflightRunning
              ? '正在检测配置与服务链路'
              : '将在启动前自动诊断'
            : stabilizing
              ? '正在确认稳定心跳'
              : '已就绪'),
    };
  });
}

export function planLiveStartup(input: {
  readiness: LiveReadiness;
  autoBroadcastEnabled: boolean;
  runtimeStable?: boolean;
  platformLive?: boolean;
  configurationPreflightStatus?: 'ready' | 'degraded' | 'blocked';
  configurationPreflightRunning?: boolean;
}): LiveStartupPlan {
  const { readiness, autoBroadcastEnabled } = input;
  const runtimeStable = input.runtimeStable ?? true;
  const steps = stepsFor(
    readiness,
    runtimeStable,
    autoBroadcastEnabled && !input.configurationPreflightStatus
      ? 'ready'
      : input.configurationPreflightStatus,
    !autoBroadcastEnabled && input.configurationPreflightRunning,
  );

  if (readiness.status === 'checking') {
    return {
      phase: 'checking',
      title: '正在准备开播',
      detail: '正在检查播出执行端、模型、语音、直播目标和互动队列。',
      primaryLabel: '正在检查…',
      automatic: false,
      steps,
    };
  }

  if (!autoBroadcastEnabled && input.configurationPreflightRunning) {
    return {
      phase: 'checking',
      title: '正在运行开播前诊断',
      detail: '正在检测模型、语音、本地协调器和当前直播平台。',
      primaryLabel: '正在诊断…',
      automatic: false,
      steps,
    };
  }

  if (!autoBroadcastEnabled && !input.configurationPreflightStatus) {
    return {
      phase: 'ready',
      title: '先完成开播前诊断',
      detail: '一键开播会先验证核心配置和可实时检测的服务链路。',
      primaryLabel: '诊断并继续开播',
      nextAction: 'run-preflight',
      automatic: true,
      steps,
    };
  }

  if (input.configurationPreflightStatus === 'blocked') {
    return {
      phase: 'needs-action',
      title: '开播前诊断存在阻断项',
      detail: '请先按最新诊断结果修复核心配置或服务连接，再重新检测。',
      primaryLabel: '打开配置修复',
      nextAction: 'open-settings',
      automatic: false,
      steps,
    };
  }

  const blocker = readiness.issues.find(
    (issue) => issue.severity === 'blocker',
  );
  if (blocker?.action) {
    return {
      phase: 'needs-action',
      title: blocker.title,
      detail: blocker.detail,
      primaryLabel: blocker.actionLabel ?? '继续处理',
      nextAction: blocker.action,
      automatic: blocker.action === 'claim-runtime',
      steps,
    };
  }

  if (!runtimeStable) {
    return {
      phase: 'checking',
      title: '正在确认播出执行端稳定',
      detail: '持续收到稳定心跳后，向导会自动进入下一步。',
      primaryLabel: '正在确认…',
      automatic: false,
      steps,
    };
  }

  if (!autoBroadcastEnabled) {
    return {
      phase: 'ready',
      title: input.platformLive
        ? '已具备正式直播自动播出条件'
        : '已可开始站内预演',
      detail: input.platformLive
        ? '平台已确认开播，可以让数字人开始自动响应。'
        : readiness.status === 'attention'
          ? '非阻塞提醒不会影响站内预演，正式推流前仍需确认。'
          : '所有站内条件均已完成；检测到外部推流后会自动进入正式直播阶段。',
      primaryLabel: input.platformLive
        ? '启动正式直播自动播出'
        : '开始站内预演',
      nextAction: 'enable-automation',
      automatic: true,
      steps,
    };
  }

  return {
    phase: 'started',
    title: input.platformLive ? '正式直播自动播出中' : '站内预演已启动',
    detail: input.platformLive
      ? '平台已确认正式开播；总控会持续监测条件变化。'
      : '尚未检测到正式推流，当前自动播出只属于站内预演。',
    primaryLabel: input.platformLive ? '正式直播运行中' : '站内预演运行中',
    automatic: false,
    steps,
  };
}
