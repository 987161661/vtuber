import { describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '../../examples/react-purupuru-app/src/hooks/useSettings';
import {
  createBrowserPreflightAdapter,
  createOperatorPreflightSession,
  operatorPreflightRequiresPause,
  reduceOperatorPreflightSession,
  runOperatorPreflight,
} from '../../examples/react-purupuru-app/src/lib/operatorPreflight';

describe('operator preflight', () => {
  it('distinguishes missing, running, fresh, and stale diagnostic sessions', () => {
    const missing = createOperatorPreflightSession();
    const running = reduceOperatorPreflightSession(missing, {
      type: 'start',
    });
    const report = {
      status: 'ready' as const,
      startedAt: 10,
      completedAt: 20,
      durationMs: 10,
      summary: 'ready',
      checks: [],
    };
    const fresh = reduceOperatorPreflightSession(running, {
      type: 'complete',
      report,
    });
    const stale = reduceOperatorPreflightSession(fresh, {
      type: 'invalidate',
    });

    expect(missing).toEqual({ state: 'missing', report: null });
    expect(running).toEqual({ state: 'running', report: null });
    expect(fresh).toEqual({ state: 'fresh', report });
    expect(stale).toEqual({ state: 'stale', report: null });
  });

  it('only pauses active automation for stale or freshly blocked diagnostics', () => {
    const missing = createOperatorPreflightSession();
    const stale = reduceOperatorPreflightSession(
      reduceOperatorPreflightSession(missing, { type: 'start' }),
      { type: 'invalidate' },
    );
    const blocked = reduceOperatorPreflightSession(missing, {
      type: 'complete',
      report: {
        status: 'blocked',
        startedAt: 10,
        completedAt: 20,
        durationMs: 10,
        summary: 'blocked',
        checks: [],
      },
    });

    expect(operatorPreflightRequiresPause(missing)).toBe(false);
    expect(operatorPreflightRequiresPause(stale)).toBe(true);
    expect(operatorPreflightRequiresPause(blocked)).toBe(true);
  });

  it('blocks before network probes when required model and voice configuration is missing', async () => {
    const settings = getDefaultSettings();
    const probe = vi.fn();

    const report = await runOperatorPreflight(settings, { probe });

    expect(report.status).toBe('blocked');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model',
          status: 'fail',
          evidence: 'configuration',
          required: true,
        }),
        expect.objectContaining({
          id: 'voice',
          status: 'fail',
          evidence: 'configuration',
          required: true,
        }),
      ]),
    );
    expect(probe).not.toHaveBeenCalled();
  });

  it('distinguishes a live runtime probe from cloud configuration evidence', async () => {
    const settings = getDefaultSettings();
    settings.llm.apiKeys.openai = 'configured';
    settings.tts.engine = 'none';
    const probe = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 18,
    });

    const report = await runOperatorPreflight(settings, { probe });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'runtime',
        url: '/api/live-runtime-health',
      }),
    );
    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'runtime',
          status: 'pass',
          evidence: 'live',
          latencyMs: 18,
        }),
        expect.objectContaining({
          id: 'model',
          status: 'warning',
          evidence: 'configuration',
        }),
        expect.objectContaining({
          id: 'voice',
          status: 'pass',
          evidence: 'configuration',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('configured');
  });

  it('live-probes a local model and local voice engine through the same adapter', async () => {
    const settings = getDefaultSettings();
    settings.llm.provider = 'openai-compatible';
    settings.llm.model = 'qwen-local';
    settings.llm.endpoint = 'http://127.0.0.1:11434/v1/chat/completions';
    settings.tts.engine = 'voicevox';
    settings.tts.voicevoxApiUrl = 'http://127.0.0.1:50021';
    const probe = vi.fn().mockImplementation(async (request) => ({
      ok: true,
      status: 200,
      latencyMs:
        request.id === 'runtime' ? 12 : request.id === 'model' ? 24 : 36,
    }));

    const report = await runOperatorPreflight(settings, { probe });

    expect(probe).toHaveBeenCalledTimes(3);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'model',
        url: 'http://127.0.0.1:11434/v1/models',
      }),
    );
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'voice',
        url: 'http://127.0.0.1:50021/speakers',
      }),
    );
    expect(report.status).toBe('ready');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model',
          status: 'pass',
          evidence: 'live',
          latencyMs: 24,
        }),
        expect.objectContaining({
          id: 'voice',
          status: 'pass',
          evidence: 'live',
          latencyMs: 36,
        }),
      ]),
    );
  });

  it('allows the local MiniMax gateway a cloud cold-start probe window', async () => {
    const settings = getDefaultSettings();
    settings.llm.provider = 'openai-compatible';
    settings.llm.model = 'MiniMax-M3';
    settings.llm.endpoint = 'http://127.0.0.1:5173/api/minimax-chat';
    settings.tts.engine = 'none';
    const probe = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 6_500,
    });

    await runOperatorPreflight(settings, { probe });

    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'model',
        url: 'http://127.0.0.1:5173/api/minimax-chat/models',
        timeoutMs: 12_000,
      }),
    );
  });

  it('blocks on a failed required live probe but only degrades for an optional platform probe', async () => {
    const settings = getDefaultSettings();
    settings.llm.provider = 'openai-compatible';
    settings.llm.model = 'qwen-local';
    settings.llm.endpoint = 'http://127.0.0.1:11434/v1/chat/completions';
    settings.tts.engine = 'none';
    settings.stream.platform = 'bilibili';
    settings.liveConnectors.ordinaryRoad.enabled = true;
    settings.liveConnectors.ordinaryRoad.platforms.bilibili.enabled = true;
    settings.liveConnectors.ordinaryRoad.platforms.bilibili.roomId = '123';

    const modelFailure = await runOperatorPreflight(settings, {
      probe: vi.fn().mockImplementation(async (request) => ({
        ok: request.id !== 'model',
        status: request.id === 'model' ? 503 : 200,
      })),
    });
    expect(modelFailure.status).toBe('blocked');
    expect(
      modelFailure.checks.find((check) => check.id === 'model'),
    ).toMatchObject({
      status: 'fail',
      required: true,
      evidence: 'live',
    });

    const platformFailure = await runOperatorPreflight(settings, {
      probe: vi.fn().mockImplementation(async (request) => ({
        ok: request.id !== 'platform',
        status: request.id === 'platform' ? 502 : 200,
      })),
    });
    expect(platformFailure.status).toBe('degraded');
    expect(
      platformFailure.checks.find((check) => check.id === 'platform'),
    ).toMatchObject({
      status: 'fail',
      required: false,
      evidence: 'live',
    });
  });

  it('attaches repair guidance to actionable findings', async () => {
    const settings = getDefaultSettings();
    const report = await runOperatorPreflight(settings, { probe: vi.fn() });

    expect(report.checks.find((check) => check.id === 'model')).toMatchObject({
      status: 'fail',
      remediation: {
        action: 'open-model-settings',
        retryable: false,
      },
    });
    expect(report.checks.find((check) => check.id === 'voice')).toMatchObject({
      status: 'fail',
      remediation: {
        action: 'open-voice-settings',
        retryable: false,
      },
    });
  });

  it('retests one live check and merges it into the previous report', async () => {
    const settings = getDefaultSettings();
    settings.llm.provider = 'openai-compatible';
    settings.llm.model = 'qwen-local';
    settings.llm.endpoint = 'http://127.0.0.1:11434/v1/chat/completions';
    settings.tts.engine = 'none';
    const initialProbe = vi.fn().mockImplementation(async (request) => ({
      ok: request.id !== 'model',
      status: request.id === 'model' ? 503 : 200,
    }));
    const initial = await runOperatorPreflight(settings, {
      probe: initialProbe,
    });
    expect(initial.checks.find((check) => check.id === 'model')).toMatchObject({
      remediation: {
        action: 'open-model-settings',
        retryable: true,
      },
    });
    const retryProbe = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 9,
    });

    const repaired = await runOperatorPreflight(
      settings,
      { probe: retryProbe },
      {
        only: 'model',
        previousReport: initial,
      },
    );

    expect(retryProbe).toHaveBeenCalledTimes(1);
    expect(retryProbe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'model' }),
    );
    expect(repaired.status).toBe('ready');
    expect(repaired.checks.find((check) => check.id === 'model')).toMatchObject(
      {
        status: 'pass',
        latencyMs: 9,
      },
    );
    expect(repaired.checks.find((check) => check.id === 'runtime')).toEqual(
      initial.checks.find((check) => check.id === 'runtime'),
    );
  });

  it('classifies browser probe failures without exposing response bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    const adapter = createBrowserPreflightAdapter(fetcher, () => 35);

    const result = await adapter.probe({
      id: 'model',
      url: 'https://provider.example.test/v1/models',
      method: 'GET',
      timeoutMs: 100,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      latencyMs: 0,
    });
    expect(result.detail).toContain('凭据');
    expect(fetcher).toHaveBeenCalledWith(
      'https://provider.example.test/v1/models',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );
  });
});
