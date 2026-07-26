import { describe, expect, it } from 'vitest';
import { planLiveStartup } from '../../examples/react-purupuru-app/src/lib/liveStartupGuide';
import type { LiveReadiness } from '../../examples/react-purupuru-app/src/lib/liveReadiness';

const ready: LiveReadiness = {
  status: 'ready',
  canStartAutomation: true,
  title: 'ready',
  summary: 'ready',
  issues: [],
};

describe('live startup guide', () => {
  it('waits while authoritative readiness is still checking', () => {
    const plan = planLiveStartup({
      readiness: { ...ready, status: 'checking', canStartAutomation: false },
      autoBroadcastEnabled: false,
    });
    expect(plan.phase).toBe('checking');
    expect(plan).not.toHaveProperty('nextAction');
  });

  it('automatically claims the runtime before later steps', () => {
    const plan = planLiveStartup({
      readiness: {
        ...ready,
        status: 'blocked',
        canStartAutomation: false,
        issues: [
          {
            code: 'runtime-owner',
            severity: 'blocker',
            title: '播出执行端未接管',
            detail: '需要接管',
            action: 'claim-runtime',
            actionLabel: '接管播出运行时',
          },
          {
            code: 'output-target',
            severity: 'blocker',
            title: '尚未配置直播目标',
            detail: '需要配置',
            action: 'open-connectors',
            actionLabel: '配置直播平台',
          },
        ],
      },
      autoBroadcastEnabled: false,
      configurationPreflightStatus: 'ready',
    });

    expect(plan).toMatchObject({
      phase: 'needs-action',
      nextAction: 'claim-runtime',
      automatic: true,
    });
    expect(plan.steps.map((step) => step.status)).toEqual([
      'blocked',
      'ready',
      'ready',
      'blocked',
      'ready',
    ]);
  });

  it('pauses on configuration that requires operator input', () => {
    expect(
      planLiveStartup({
        readiness: {
          ...ready,
          status: 'blocked',
          canStartAutomation: false,
          issues: [
            {
              code: 'model-credential',
              severity: 'blocker',
              title: '模型未配置',
              detail: '需要输入凭证',
              action: 'open-settings',
              actionLabel: '检查模型配置',
            },
          ],
        },
        autoBroadcastEnabled: false,
        configurationPreflightStatus: 'ready',
      }),
    ).toMatchObject({
      nextAction: 'open-settings',
      automatic: false,
    });
  });

  it('starts automation when blockers are cleared', () => {
    expect(
      planLiveStartup({
        readiness: ready,
        autoBroadcastEnabled: false,
        configurationPreflightStatus: 'ready',
      }),
    ).toMatchObject({
      phase: 'ready',
      nextAction: 'enable-automation',
      automatic: true,
      primaryLabel: '开始站内预演',
    });
  });

  it('automatically runs preflight before enabling automation when no fresh report exists', () => {
    const plan = planLiveStartup({
      readiness: ready,
      autoBroadcastEnabled: false,
    });

    expect(plan).toMatchObject({
      phase: 'ready',
      nextAction: 'run-preflight',
      automatic: true,
      primaryLabel: '诊断并继续开播',
    });
    expect(plan.steps[1]).toMatchObject({
      id: 'preflight',
      status: 'checking',
    });
  });

  it('waits without dispatching another action while preflight is running', () => {
    const plan = planLiveStartup({
      readiness: ready,
      autoBroadcastEnabled: false,
      configurationPreflightRunning: true,
    });

    expect(plan).toMatchObject({
      phase: 'checking',
      title: '正在运行开播前诊断',
    });
    expect(plan).not.toHaveProperty('nextAction');
  });

  it('gates startup when the latest configuration preflight is blocked', () => {
    const plan = planLiveStartup({
      readiness: ready,
      autoBroadcastEnabled: false,
      configurationPreflightStatus: 'blocked',
    });

    expect(plan).toMatchObject({
      phase: 'needs-action',
      nextAction: 'open-settings',
      automatic: false,
    });
    expect(plan.steps[1]).toMatchObject({
      id: 'preflight',
      status: 'blocked',
    });
  });

  it('allows startup when preflight only contains non-blocking warnings', () => {
    expect(
      planLiveStartup({
        readiness: ready,
        autoBroadcastEnabled: false,
        configurationPreflightStatus: 'degraded',
      }),
    ).toMatchObject({
      phase: 'ready',
      nextAction: 'enable-automation',
    });
  });

  it('waits for a stable runtime heartbeat before enabling automation', () => {
    const plan = planLiveStartup({
      readiness: ready,
      autoBroadcastEnabled: false,
      runtimeStable: false,
      configurationPreflightStatus: 'ready',
    });

    expect(plan).toMatchObject({
      phase: 'checking',
      title: '正在确认播出执行端稳定',
    });
    expect(plan.steps[0]?.status).toBe('checking');
    expect(plan).not.toHaveProperty('nextAction');
  });

  it('uses preview language for non-blocking warnings', () => {
    expect(
      planLiveStartup({
        readiness: {
          ...ready,
          status: 'attention',
          issues: [
            {
              code: 'obs',
              severity: 'warning',
              title: '未检测到 OBS',
              detail: '仅影响正式推流',
            },
          ],
        },
        autoBroadcastEnabled: false,
        configurationPreflightStatus: 'degraded',
      }),
    ).toMatchObject({
      phase: 'ready',
      primaryLabel: '开始站内预演',
    });
  });

  it('reports the started state without another action', () => {
    const plan = planLiveStartup({
      readiness: ready,
      autoBroadcastEnabled: true,
    });
    expect(plan.phase).toBe('started');
    expect(plan.title).toBe('站内预演已启动');
    expect(plan).not.toHaveProperty('nextAction');
  });

  it('uses formal-live language only after an external live signal', () => {
    expect(
      planLiveStartup({
        readiness: ready,
        autoBroadcastEnabled: true,
        platformLive: true,
      }),
    ).toMatchObject({
      phase: 'started',
      title: '正式直播自动播出中',
      primaryLabel: '正式直播运行中',
    });
  });
});
