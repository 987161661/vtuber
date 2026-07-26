import { describe, expect, it } from 'vitest';
import type { LiveReadiness } from '../../examples/react-purupuru-app/src/lib/liveReadiness';
import type { OperatorPreflightSession } from '../../examples/react-purupuru-app/src/lib/operatorPreflight';
import { projectOperatorAttention } from '../../examples/react-purupuru-app/src/lib/operatorAttention';
import type { RuntimeRecoveryPlan } from '../../examples/react-purupuru-app/src/lib/runtimeRecovery';

const ready: LiveReadiness = {
  status: 'ready',
  canStartAutomation: true,
  title: '可以开播',
  summary: '检查通过',
  issues: [],
};

const healthy: RuntimeRecoveryPlan = {
  status: 'healthy',
  title: '运行正常',
  summary: '无需恢复',
  incidents: [],
};

const missingPreflight: OperatorPreflightSession = {
  state: 'missing',
  report: null,
};

describe('operator attention center', () => {
  it('deduplicates equivalent readiness and recovery incidents', () => {
    const center = projectOperatorAttention({
      readiness: {
        ...ready,
        status: 'blocked',
        canStartAutomation: false,
        issues: [
          {
            code: 'runtime-owner',
            severity: 'blocker',
            title: '执行端未接管',
            detail: '请接管运行时',
            action: 'claim-runtime',
            actionLabel: '接管运行时',
          },
          {
            code: 'tts',
            severity: 'blocker',
            title: '语音未配置',
            detail: '缺少语音配置',
            action: 'open-settings',
            actionLabel: '检查配置',
          },
        ],
      },
      recovery: {
        ...healthy,
        status: 'blocked',
        incidents: [
          {
            id: 'runtime-owner',
            domain: 'runtime',
            severity: 'blocker',
            title: '执行端尚未恢复',
            detail: '当前执行端可以安全重建',
            action: 'restart-runtime',
            actionLabel: '重建运行时',
          },
          {
            id: 'tts-configuration',
            domain: 'voice',
            severity: 'blocker',
            title: '语音合成尚未配置',
            detail: '无法形成声音',
            action: 'open-settings',
            actionLabel: '检查语音配置',
          },
        ],
      },
      preflight: missingPreflight,
      commitments: { attention: 0, overdue: 0, dueSoon: 0 },
    });

    expect(center.items).toHaveLength(2);
    expect(center.items.map(({ id }) => id)).toEqual([
      'runtime-owner',
      'tts-configuration',
    ]);
    expect(center.items[0]).toMatchObject({
      action: 'restart-runtime',
      source: 'recovery',
    });
  });

  it('combines distinct blockers and follow-up work in priority order', () => {
    const center = projectOperatorAttention({
      readiness: {
        ...ready,
        status: 'blocked',
        canStartAutomation: false,
        issues: [
          {
            code: 'output-target',
            severity: 'blocker',
            title: '尚未配置直播目标',
            detail: '请选择直播平台',
            action: 'open-connectors',
            actionLabel: '配置平台',
          },
        ],
      },
      recovery: healthy,
      preflight: {
        state: 'fresh',
        report: {
          status: 'degraded',
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          summary: '部分链路只有配置证据',
          checks: [],
        },
      },
      commitments: { attention: 3, overdue: 1, dueSoon: 2 },
    });

    expect(center.status).toBe('blocked');
    expect(center.counts).toEqual({ total: 3, blockers: 1, warnings: 2 });
    expect(center.items.map(({ id, action }) => [id, action])).toEqual([
      ['output-target', 'open-connectors'],
      ['preflight-degraded', 'run-preflight'],
      ['commitments', 'open-commitments'],
    ]);
  });

  it('projects stale or blocked preflight as one blocking action', () => {
    const stale = projectOperatorAttention({
      readiness: ready,
      recovery: healthy,
      preflight: { state: 'stale', report: null },
      commitments: { attention: 0, overdue: 0, dueSoon: 0 },
    });
    const blocked = projectOperatorAttention({
      readiness: ready,
      recovery: healthy,
      preflight: {
        state: 'fresh',
        report: {
          status: 'blocked',
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          summary: '模型检查失败',
          checks: [],
        },
      },
      commitments: { attention: 0, overdue: 0, dueSoon: 0 },
    });

    expect(stale.items[0]).toMatchObject({
      id: 'preflight-stale',
      severity: 'blocker',
      action: 'run-preflight',
    });
    expect(blocked.items[0]).toMatchObject({
      id: 'preflight-blocked',
      severity: 'blocker',
      action: 'run-preflight',
    });
  });

  it('distinguishes checking from a clear attention center', () => {
    const checking = projectOperatorAttention({
      readiness: { ...ready, status: 'checking' },
      recovery: { ...healthy, status: 'checking' },
      preflight: missingPreflight,
      commitments: { attention: 0, overdue: 0, dueSoon: 0 },
    });
    const clear = projectOperatorAttention({
      readiness: ready,
      recovery: healthy,
      preflight: missingPreflight,
      commitments: { attention: 0, overdue: 0, dueSoon: 0 },
    });

    expect(checking.status).toBe('checking');
    expect(clear.status).toBe('clear');
    expect(clear.items).toEqual([]);
  });
});
