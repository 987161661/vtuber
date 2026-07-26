import { describe, expect, it } from 'vitest';
import {
  assessLiveReadiness,
  shouldPauseAutomationForReadiness,
} from '../../examples/react-purupuru-app/src/lib/liveReadiness';

const readyHealth = {
  runtimeOwner: { active: true, available: true, ttsConfigured: true },
  model: { credentialConfigured: true },
  obs: { processState: 'running' as const },
  queueDepth: 0,
  oldestQueueAgeMs: 0,
};

describe('live readiness', () => {
  it('does not claim readiness before authoritative health is loaded', () => {
    expect(
      assessLiveReadiness({
        healthState: 'checking',
        health: {},
        outputTargetConfigured: true,
      }),
    ).toMatchObject({ status: 'checking', canStartAutomation: false });
  });

  it('reports a compact ready result when every required capability is present', () => {
    expect(
      assessLiveReadiness({
        healthState: 'available',
        health: readyHealth,
        outputTargetConfigured: true,
      }),
    ).toEqual({
      status: 'ready',
      canStartAutomation: true,
      title: '已具备开播条件',
      summary: '运行时、模型、语音、直播目标和互动队列均已就绪。',
      issues: [],
    });
  });

  it('composes blockers and repair actions without hiding secondary warnings', () => {
    const result = assessLiveReadiness({
      healthState: 'available',
      health: {
        ...readyHealth,
        runtimeOwner: {
          active: false,
          available: false,
          ttsConfigured: false,
        },
        model: { credentialConfigured: false },
        obs: { processState: 'not-running' },
      },
      outputTargetConfigured: false,
    });

    expect(result.status).toBe('blocked');
    expect(result.canStartAutomation).toBe(false);
    expect(result.issues.map((issue) => issue.action)).toEqual([
      'claim-runtime',
      'open-settings',
      'open-connectors',
      'open-pipeline',
    ]);
  });

  it('names the lease holder when a claimed runtime has no usable heartbeat', () => {
    const result = assessLiveReadiness({
      healthState: 'available',
      health: {
        ...readyHealth,
        runtimeOwner: {
          active: false,
          available: false,
          ttsConfigured: false,
        },
        runtimeLease: {
          active: true,
          owner: {
            label: 'OBS 覆盖层',
            role: 'obs-overlay',
            fingerprint: '12ab34cd',
            acquiredAt: 1_000,
            renewedAt: 8_000,
            expiresAt: 18_000,
            remainingMs: 10_000,
          },
        },
      },
      outputTargetConfigured: true,
    });

    expect(result.issues[0]).toMatchObject({
      code: 'runtime-owner',
      title: '执行端已占用，但播出心跳未就绪',
      actionLabel: '重新检查执行端',
    });
    expect(result.issues[0]?.detail).toContain('OBS 覆盖层（12ab34cd）');
  });

  it('blocks stale queued speech using the most authoritative observed age', () => {
    const result = assessLiveReadiness({
      healthState: 'available',
      health: { ...readyHealth, queueDepth: 2, oldestQueueAgeMs: 75_000 },
      outputTargetConfigured: true,
      queueDepth: 1,
      oldestQueueAgeMs: 10_000,
    });

    expect(result).toMatchObject({ status: 'blocked' });
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'stale-queue',
        severity: 'blocker',
        action: 'review-queue',
      }),
    );
    expect(shouldPauseAutomationForReadiness(result)).toBe(false);
  });

  it('still pauses automation for execution-critical blockers', () => {
    const result = assessLiveReadiness({
      healthState: 'available',
      health: {
        ...readyHealth,
        runtimeOwner: {
          active: false,
          available: false,
          ttsConfigured: true,
        },
      },
      outputTargetConfigured: true,
    });

    expect(shouldPauseAutomationForReadiness(result)).toBe(true);
  });

  it('keeps preview available when only OBS is missing', () => {
    const result = assessLiveReadiness({
      healthState: 'available',
      health: {
        ...readyHealth,
        obs: { processState: 'not-running' },
      },
      outputTargetConfigured: true,
    });

    expect(result).toMatchObject({
      status: 'attention',
      canStartAutomation: true,
    });
  });

  it('surfaces recent faults but ignores historical faults', () => {
    const recent = assessLiveReadiness({
      healthState: 'available',
      health: {
        ...readyHealth,
        lastFaults: { model: { at: 95_000, stage: 'generation_error' } },
      },
      outputTargetConfigured: true,
      now: 100_000,
    });
    const historical = assessLiveReadiness({
      healthState: 'available',
      health: {
        ...readyHealth,
        lastFaults: { model: { at: 1, stage: 'generation_error' } },
      },
      outputTargetConfigured: true,
      now: 200_000,
    });

    expect(recent.status).toBe('attention');
    expect(historical.status).toBe('ready');
  });
});
