export type RuntimeRecoveryAction =
  | 'restart-runtime'
  | 'recover-soul'
  | 'open-settings'
  | 'open-connectors'
  | 'review-queue'
  | 'open-pipeline'
  | 'retry-health';

export type RuntimeRecoveryIncident = {
  id: string;
  domain: 'runtime' | 'model' | 'voice' | 'soul' | 'platform' | 'queue';
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  action: RuntimeRecoveryAction;
  actionLabel: string;
  observedAt?: number;
};

export type RuntimeRecoveryPlan = {
  status: 'checking' | 'healthy' | 'degraded' | 'blocked';
  title: string;
  summary: string;
  incidents: RuntimeRecoveryIncident[];
};

type RuntimeFaultKind =
  | 'soul'
  | 'model'
  | 'skill'
  | 'tts'
  | 'flashhead'
  | 'platform';

type RuntimeFault = {
  at: number;
  stage: string;
  reason?: string;
};

export type RuntimeRecoveryInput = {
  healthState: 'checking' | 'available' | 'unavailable';
  health: {
    runtimeOwner?: {
      active: boolean;
      available: boolean;
      ttsConfigured: boolean;
    };
    model?: { credentialConfigured?: boolean };
    alerts?: string[];
    ttsRateLimitCount?: number;
    lastFaults?: Partial<Record<RuntimeFaultKind, RuntimeFault>>;
  };
  connector?: {
    ordinaryRoadState?: string;
    ordinaryRoadError?: string;
    socialError?: string;
  };
  localRuntimeOwner?: boolean;
  now?: number;
  recentFaultWindowMs?: number;
};

export type RuntimeRecoveryPorts = Record<
  RuntimeRecoveryAction,
  () => void | Promise<void>
>;

const ACTION_LABELS: Record<RuntimeRecoveryAction, string> = {
  'restart-runtime': '重建生成与语音运行时',
  'recover-soul': '从快照恢复 Soul',
  'open-settings': '检查模型与语音配置',
  'open-connectors': '检查平台连接',
  'review-queue': '处理异常队列',
  'open-pipeline': '查看故障链路',
  'retry-health': '重新检查运行状态',
};

function incident(
  value: Omit<RuntimeRecoveryIncident, 'actionLabel'>,
): RuntimeRecoveryIncident {
  return { ...value, actionLabel: ACTION_LABELS[value.action] };
}

function readableReason(faults: RuntimeFault[]): string {
  const reason = faults
    .map((fault) => fault.reason?.trim() || fault.stage.trim())
    .filter(Boolean)
    .join('；');
  return reason.slice(0, 220);
}

function recentFaults(
  input: RuntimeRecoveryInput,
  now: number,
): Array<[RuntimeFaultKind, RuntimeFault]> {
  const windowMs = input.recentFaultWindowMs ?? 5 * 60_000;
  return Object.entries(input.health.lastFaults ?? {}).filter(
    (entry): entry is [RuntimeFaultKind, RuntimeFault] => {
      const fault = entry[1];
      return Boolean(fault && now - fault.at <= windowMs);
    },
  );
}

export function projectRuntimeRecovery(
  input: RuntimeRecoveryInput,
): RuntimeRecoveryPlan {
  if (input.healthState === 'checking') {
    return {
      status: 'checking',
      title: '正在确认运行故障',
      summary: '正在汇总生成、语音、Soul 和平台连接状态。',
      incidents: [],
    };
  }

  const incidents: RuntimeRecoveryIncident[] = [];
  if (input.healthState === 'unavailable') {
    incidents.push(
      incident({
        id: 'health-unavailable',
        domain: 'runtime',
        severity: 'blocker',
        title: '运行状态服务无响应',
        detail: '无法确认当前播出执行状态，自动播出应保持停止。',
        action: 'retry-health',
      }),
    );
  }

  const owner = input.health.runtimeOwner;
  if (input.healthState === 'available' && owner?.active && !owner.available) {
    incidents.push(
      incident({
        id: 'runtime-owner',
        domain: 'runtime',
        severity: 'blocker',
        title: '播出执行端尚未恢复就绪',
        detail: input.localRuntimeOwner
          ? '当前执行端仍在恢复或被卡住，可以安全重建生成与语音运行时。'
          : '另一个页面持有执行权，请在链路面板确认执行端状态。',
        action: input.localRuntimeOwner ? 'restart-runtime' : 'open-pipeline',
      }),
    );
  }

  if (input.health.model?.credentialConfigured === false) {
    incidents.push(
      incident({
        id: 'model-credential',
        domain: 'model',
        severity: 'blocker',
        title: '模型凭证不可用',
        detail: '重新启动运行时无法修复凭证，请先检查模型配置。',
        action: 'open-settings',
      }),
    );
  }

  if (owner?.active && owner.ttsConfigured === false) {
    incidents.push(
      incident({
        id: 'tts-configuration',
        domain: 'voice',
        severity: 'blocker',
        title: '语音合成尚未配置完成',
        detail: '文本可以生成，但无法形成可播出的声音。',
        action: 'open-settings',
      }),
    );
  }

  if (input.health.alerts?.includes('preparing_lease_stale')) {
    incidents.push(
      incident({
        id: 'stale-queue-lease',
        domain: 'queue',
        severity: 'blocker',
        title: '有回复任务卡在准备阶段',
        detail: '任务租约已经过期，需要检查并处理该条队列记录。',
        action: 'review-queue',
      }),
    );
  }

  if ((input.health.ttsRateLimitCount ?? 0) >= 3) {
    incidents.push(
      incident({
        id: 'tts-rate-limit',
        domain: 'voice',
        severity: 'warning',
        title: '语音服务正在频繁限流',
        detail: '重启不会解除上游限流；请检查语音服务额度、并发或供应商配置。',
        action: 'open-settings',
      }),
    );
  }

  const connectorReasons = [
    input.connector?.ordinaryRoadState === 'error'
      ? input.connector.ordinaryRoadError || 'OrdinaryRoad 连接失败'
      : '',
    input.connector?.socialError || '',
  ].filter(Boolean);
  if (connectorReasons.length) {
    incidents.push(
      incident({
        id: 'connector-error',
        domain: 'platform',
        severity: 'warning',
        title: '直播平台连接正在恢复',
        detail: connectorReasons.join('；').slice(0, 220),
        action: 'open-connectors',
      }),
    );
  }

  const faults = recentFaults(input, input.now ?? Date.now());
  const executionFaults = faults.filter(([kind]) =>
    ['model', 'tts', 'flashhead'].includes(kind),
  );
  if (
    executionFaults.length &&
    !incidents.some((item) =>
      ['model-credential', 'tts-configuration', 'tts-rate-limit'].includes(
        item.id,
      ),
    )
  ) {
    incidents.push(
      incident({
        id: 'execution-fault',
        domain: executionFaults.some(([kind]) => kind === 'model')
          ? 'model'
          : 'voice',
        severity: 'warning',
        title: '生成或语音运行时刚刚发生故障',
        detail: readableReason(executionFaults.map(([, fault]) => fault)),
        action: input.localRuntimeOwner ? 'restart-runtime' : 'open-pipeline',
        observedAt: Math.max(...executionFaults.map(([, fault]) => fault.at)),
      }),
    );
  }

  const soulFault = faults.find(([kind]) => kind === 'soul')?.[1];
  if (soulFault) {
    const snapshotRecoveryAppropriate =
      /snapshot|persist|integrity|ledger|state/iu.test(
        `${soulFault.stage} ${soulFault.reason ?? ''}`,
      );
    incidents.push(
      incident({
        id: 'soul-fault',
        domain: 'soul',
        severity: snapshotRecoveryAppropriate ? 'blocker' : 'warning',
        title: snapshotRecoveryAppropriate
          ? 'Soul 状态需要恢复'
          : 'Soul 最近出现异常',
        detail: readableReason([soulFault]),
        action: snapshotRecoveryAppropriate ? 'recover-soul' : 'open-pipeline',
        observedAt: soulFault.at,
      }),
    );
  }

  const diagnosticFaults = faults.filter(([kind]) =>
    ['skill', 'platform'].includes(kind),
  );
  if (
    diagnosticFaults.length &&
    !incidents.some((item) => item.id === 'connector-error')
  ) {
    incidents.push(
      incident({
        id: 'pipeline-fault',
        domain: diagnosticFaults.some(([kind]) => kind === 'platform')
          ? 'platform'
          : 'runtime',
        severity: 'warning',
        title: '扩展或平台链路刚刚发生故障',
        detail: readableReason(diagnosticFaults.map(([, fault]) => fault)),
        action: diagnosticFaults.some(([kind]) => kind === 'platform')
          ? 'open-connectors'
          : 'open-pipeline',
        observedAt: Math.max(...diagnosticFaults.map(([, fault]) => fault.at)),
      }),
    );
  }

  const blockerCount = incidents.filter(
    (item) => item.severity === 'blocker',
  ).length;
  if (!incidents.length) {
    return {
      status: 'healthy',
      title: '运行链路可恢复状态正常',
      summary: '当前没有需要操作员处理的模型、语音、Soul 或平台故障。',
      incidents,
    };
  }
  return {
    status: blockerCount ? 'blocked' : 'degraded',
    title: blockerCount ? '存在需要处理的运行故障' : '运行链路正在降级恢复',
    summary: blockerCount
      ? `${blockerCount} 项故障会阻止安全播出，另有 ${incidents.length - blockerCount} 项提醒。`
      : `${incidents.length} 项异常可通过下方动作恢复或进一步检查。`,
    incidents,
  };
}

export async function executeRuntimeRecovery(
  action: RuntimeRecoveryAction,
  ports: RuntimeRecoveryPorts,
): Promise<void> {
  await ports[action]();
}
