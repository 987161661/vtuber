import type { AppSettings } from '../types/settings';
import { assessOperatorSetup } from './operatorConfigurationProfile';

export type OperatorPreflightProbe = {
  id: 'runtime' | 'model' | 'voice' | 'platform';
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
};

export type OperatorPreflightProbeResult = {
  ok: boolean;
  status?: number;
  detail?: string;
  latencyMs?: number;
};

export type OperatorPreflightAdapter = {
  probe: (
    request: OperatorPreflightProbe,
  ) => Promise<OperatorPreflightProbeResult>;
};

export type OperatorPreflightCheckId =
  | 'runtime'
  | 'model'
  | 'voice'
  | 'character'
  | 'platform';

export type OperatorPreflightRemediationAction =
  | 'retry-check'
  | 'open-model-settings'
  | 'open-voice-settings'
  | 'open-character-settings'
  | 'open-platform-settings';

export type OperatorPreflightCheck = {
  id: OperatorPreflightCheckId;
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'skipped';
  evidence: 'live' | 'configuration' | 'none';
  required: boolean;
  detail: string;
  latencyMs?: number;
  remediation?: {
    action: OperatorPreflightRemediationAction;
    label: string;
    hint: string;
    retryable: boolean;
  };
};

export type OperatorPreflightReport = {
  status: 'ready' | 'degraded' | 'blocked';
  startedAt: number;
  completedAt: number;
  durationMs: number;
  summary: string;
  checks: OperatorPreflightCheck[];
};

export type OperatorPreflightSession =
  | { state: 'missing' | 'running' | 'stale'; report: null }
  | { state: 'fresh'; report: OperatorPreflightReport };

export type OperatorPreflightSessionEvent =
  | { type: 'start' }
  | { type: 'complete'; report: OperatorPreflightReport }
  | { type: 'invalidate' }
  | { type: 'fail' };

export function createOperatorPreflightSession(): OperatorPreflightSession {
  return { state: 'missing', report: null };
}

export function reduceOperatorPreflightSession(
  session: OperatorPreflightSession,
  event: OperatorPreflightSessionEvent,
): OperatorPreflightSession {
  if (event.type === 'start') return { state: 'running', report: null };
  if (event.type === 'complete') {
    return { state: 'fresh', report: event.report };
  }
  if (event.type === 'invalidate') {
    return session.state === 'missing'
      ? session
      : { state: 'stale', report: null };
  }
  return { state: 'stale', report: null };
}

export function operatorPreflightRequiresPause(
  session: OperatorPreflightSession,
): boolean {
  return (
    session.state === 'stale' ||
    (session.state === 'fresh' && session.report.status === 'blocked')
  );
}

type PreflightFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status'>>;

type PlannedProbe = {
  request: OperatorPreflightProbe;
  successDetail: string;
  failureDetail: string;
};

export type OperatorPreflightOptions = {
  now?: () => number;
  only?: OperatorPreflightCheckId;
  previousReport?: OperatorPreflightReport | null;
};

function httpFailureDetail(status: number): string {
  if (status === 401 || status === 403) return '凭据被服务拒绝';
  if (status === 404) return '探测地址不存在';
  if (status === 429) return '服务当前触发频率限制';
  if (status >= 500) return `服务暂时不可用（HTTP ${status}）`;
  return `连接检查未通过（HTTP ${status}）`;
}

export function createBrowserPreflightAdapter(
  fetcher: PreflightFetch = globalThis.fetch.bind(globalThis),
  now: () => number = () => globalThis.performance.now(),
): OperatorPreflightAdapter {
  return {
    async probe(request) {
      const startedAt = now();
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(
        () => controller.abort(),
        request.timeoutMs,
      );
      try {
        const response = await fetcher(request.url, {
          method: request.method,
          cache: 'no-store',
          signal: controller.signal,
        });
        return {
          ok: response.ok,
          status: response.status,
          detail: response.ok
            ? `实时探测成功（HTTP ${response.status}）`
            : httpFailureDetail(response.status),
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
        };
      } catch (error) {
        return {
          ok: false,
          detail: controller.signal.aborted
            ? `连接超时（${request.timeoutMs} ms）`
            : error instanceof TypeError
              ? '无法连接，或请求被浏览器跨域策略阻止'
              : '连接探测发生未知错误',
          latencyMs: Math.max(0, Math.round(now() - startedAt)),
        };
      } finally {
        globalThis.clearTimeout(timeout);
      }
    },
  };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/u, '')}/${path.replace(/^\/+/u, '')}`;
}

function localModelProbe(settings: AppSettings): PlannedProbe | null {
  if (settings.llm.provider !== 'openai-compatible') return null;
  try {
    const endpoint = new URL(settings.llm.endpoint || '');
    const isMiniMaxGateway = endpoint.pathname.endsWith('/api/minimax-chat');
    if (
      endpoint.hostname !== 'localhost' &&
      endpoint.hostname !== '127.0.0.1'
    ) {
      return null;
    }
    endpoint.pathname = endpoint.pathname.replace(
      /\/(?:chat\/completions|responses)\/?$/u,
      '/models',
    );
    if (!endpoint.pathname.endsWith('/models')) {
      endpoint.pathname = joinUrl(endpoint.pathname || '/v1', 'models');
    }
    endpoint.search = '';
    endpoint.hash = '';
    return {
      request: {
        id: 'model',
        url: endpoint.toString(),
        method: 'GET',
        timeoutMs: isMiniMaxGateway ? 12_000 : 5_000,
      },
      successDetail: '本地模型目录可访问',
      failureDetail: '本地模型服务无法访问',
    };
  } catch {
    return null;
  }
}

function localVoiceProbe(settings: AppSettings): PlannedProbe | null {
  const engine = settings.tts.engine;
  if (engine === 'voicevox' || engine === 'aivisSpeech') {
    const base =
      engine === 'voicevox'
        ? settings.tts.voicevoxApiUrl || 'http://localhost:50021'
        : settings.tts.aivisSpeechApiUrl || 'http://localhost:10101';
    return {
      request: {
        id: 'voice',
        url: joinUrl(base, 'speakers'),
        method: 'GET',
        timeoutMs: 5_000,
      },
      successDetail: `${engine} 音色目录可访问`,
      failureDetail: `${engine} 本地服务无法访问`,
    };
  }
  if (engine === 'voicepeak' && settings.tts.voicepeakApiUrl) {
    return {
      request: {
        id: 'voice',
        url: settings.tts.voicepeakApiUrl,
        method: 'HEAD',
        timeoutMs: 5_000,
      },
      successDetail: 'VOICEPEAK 服务可访问',
      failureDetail: 'VOICEPEAK 服务无法访问',
    };
  }
  if (engine === 'piperPlus') {
    try {
      const url = new URL(
        settings.tts.piperPlusModelConfigFile || '',
        settings.tts.piperPlusBasePath ||
          `${globalThis.location?.origin || 'http://localhost'}/piper/`,
      ).toString();
      return {
        request: {
          id: 'voice',
          url,
          method: 'HEAD',
          timeoutMs: 5_000,
        },
        successDetail: 'Piper Plus 模型配置可访问',
        failureDetail: 'Piper Plus 模型配置无法访问',
      };
    } catch {
      return null;
    }
  }
  return null;
}

function platformProbe(settings: AppSettings): PlannedProbe | null {
  if (settings.stream.platform !== 'bilibili') return null;
  const gateway = settings.liveConnectors.ordinaryRoad.gatewayUrl;
  if (!gateway.trim()) return null;
  return {
    request: {
      id: 'platform',
      url: joinUrl(gateway, 'health'),
      method: 'GET',
      timeoutMs: 4_000,
    },
    successDetail: '哔哩哔哩连接网关可访问',
    failureDetail: '哔哩哔哩连接网关无法访问',
  };
}

async function executeProbe(
  planned: PlannedProbe,
  adapter: OperatorPreflightAdapter,
  now: () => number,
): Promise<OperatorPreflightCheck> {
  const startedAt = now();
  const result = await adapter.probe(planned.request);
  const completedAt = now();
  return {
    id: planned.request.id,
    label:
      planned.request.id === 'runtime'
        ? '运行协调器'
        : planned.request.id === 'model'
          ? '模型'
          : planned.request.id === 'voice'
            ? '语音'
            : '平台',
    status: result.ok ? 'pass' : 'fail',
    evidence: 'live',
    required: planned.request.id !== 'platform',
    detail:
      result.detail ??
      (result.ok ? planned.successDetail : planned.failureDetail),
    latencyMs: result.latencyMs ?? Math.max(0, completedAt - startedAt),
  };
}

function remediationFor(
  check: OperatorPreflightCheck,
): OperatorPreflightCheck['remediation'] {
  if (check.status === 'pass' || check.status === 'skipped') return undefined;
  const actions = {
    model: {
      action: 'open-model-settings' as const,
      label: '修复模型配置',
      hint: '补充模型凭据，或配置并启动本地模型服务。',
    },
    voice: {
      action: 'open-voice-settings' as const,
      label: '修复语音配置',
      hint: '选择可用语音引擎，并补全所需凭据或本地服务地址。',
    },
    character: {
      action: 'open-character-settings' as const,
      label: '选择可用角色',
      hint: '回到角色工作台，选择已就绪的角色配置。',
    },
    platform: {
      action: 'open-platform-settings' as const,
      label: '修复平台配置',
      hint: '补全直播平台、房间或连接器配置。',
    },
    runtime: {
      action: 'retry-check' as const,
      label: '重新检测',
      hint: '确认应用服务仍在运行后重新检测。',
    },
  };
  if (check.evidence === 'live') {
    return {
      ...actions[check.id],
      hint:
        check.id === 'runtime'
          ? '确认应用服务仍在运行后重新检测。'
          : '检查服务地址、端口和跨域设置；启动对应服务后可单项复测。',
      retryable: true,
    };
  }
  return { ...actions[check.id], retryable: false };
}

function decorateChecks(
  checks: OperatorPreflightCheck[],
): OperatorPreflightCheck[] {
  return checks.map((check) => ({
    ...check,
    remediation: remediationFor(check),
  }));
}

function createReport(
  startedAt: number,
  completedAt: number,
  checks: OperatorPreflightCheck[],
): OperatorPreflightReport {
  const decoratedChecks = decorateChecks(checks);
  const requiredFailure = decoratedChecks.some(
    (check) => check.required && check.status === 'fail',
  );
  const degraded = decoratedChecks.some(
    (check) =>
      check.status === 'warning' ||
      (!check.required && check.status === 'fail'),
  );
  return {
    status: requiredFailure ? 'blocked' : degraded ? 'degraded' : 'ready',
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    summary: requiredFailure
      ? '开播前诊断发现阻断项。'
      : degraded
        ? '核心链路可用，但仍有仅完成配置验证的项目。'
        : '开播前诊断全部通过。',
    checks: decoratedChecks,
  };
}

export async function runOperatorPreflight(
  settings: AppSettings,
  adapter: OperatorPreflightAdapter,
  options: OperatorPreflightOptions = {},
): Promise<OperatorPreflightReport> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const setup = assessOperatorSetup(settings);
  const checks: OperatorPreflightCheck[] = setup.steps.map((step) => ({
    id: step.id,
    label: step.label,
    status:
      step.status === 'ready'
        ? step.id === 'platform' && settings.stream.platform === 'none'
          ? 'skipped'
          : 'pass'
        : 'fail',
    evidence: 'configuration',
    required: step.required,
    detail: step.detail,
  }));
  const completedAt = now();
  const blocked = checks.some(
    (check) => check.required && check.status === 'fail',
  );
  const isSingleRetry = Boolean(options.only && options.previousReport);
  if (blocked && !isSingleRetry) {
    return {
      status: 'blocked',
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      summary: '核心配置尚未完成，已跳过网络探测。',
      checks: decorateChecks(checks),
    };
  }

  const model = localModelProbe(settings);
  const voice = localVoiceProbe(settings);
  const platform = platformProbe(settings);
  const plannedProbes: PlannedProbe[] = [
    {
      request: {
        id: 'runtime',
        url: '/api/live-runtime-health',
        method: 'GET',
        timeoutMs: 3_000,
      },
      successDetail: '本地运行协调器可访问',
      failureDetail: '本地运行协调器无法访问',
    },
    ...(model ? [model] : []),
    ...(voice ? [voice] : []),
    ...(platform ? [platform] : []),
  ];
  const probesToRun = isSingleRetry
    ? plannedProbes.filter((planned) => planned.request.id === options.only)
    : plannedProbes;
  const liveChecks = await Promise.all(
    probesToRun.map((planned) => executeProbe(planned, adapter, now)),
  );
  for (const liveCheck of liveChecks) {
    const index = checks.findIndex((check) => check.id === liveCheck.id);
    if (index >= 0) checks[index] = liveCheck;
    else checks.unshift(liveCheck);
  }
  const modelCheck = checks.find((check) => check.id === 'model');
  if (modelCheck && modelCheck.status !== 'fail' && !model) {
    modelCheck.status = 'warning';
    modelCheck.detail = `${modelCheck.detail}；尚未产生计费请求验证云端连通性`;
  }
  const voiceCheck = checks.find((check) => check.id === 'voice');
  if (
    voiceCheck &&
    voiceCheck.status !== 'fail' &&
    !voice &&
    settings.tts.engine !== 'none'
  ) {
    voiceCheck.status = 'warning';
    voiceCheck.detail = `${voiceCheck.detail}；当前仅验证配置，未产生计费语音请求`;
  }
  const platformCheck = checks.find((check) => check.id === 'platform');
  if (
    platformCheck &&
    platformCheck.status !== 'fail' &&
    !platform &&
    settings.stream.platform !== 'none'
  ) {
    platformCheck.status = 'warning';
    platformCheck.detail = `${platformCheck.detail}；当前平台不支持无副作用实时探测`;
  }
  const finalCompletedAt = now();
  if (isSingleRetry && options.only && options.previousReport) {
    const updatedCheck = checks.find((check) => check.id === options.only);
    const mergedChecks = options.previousReport.checks.map((check) =>
      check.id === options.only && updatedCheck ? updatedCheck : check,
    );
    return createReport(startedAt, finalCompletedAt, mergedChecks);
  }
  return createReport(startedAt, finalCompletedAt, checks);
}
