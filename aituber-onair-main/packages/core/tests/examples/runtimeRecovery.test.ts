import { describe, expect, it, vi } from 'vitest';
import {
  executeRuntimeRecovery,
  projectRuntimeRecovery,
  type RuntimeRecoveryAction,
  type RuntimeRecoveryPorts,
} from '../../examples/react-purupuru-app/src/lib/runtimeRecovery';

describe('runtime recovery', () => {
  it('does not treat an intentionally unclaimed standby page as a fault', () => {
    const plan = projectRuntimeRecovery({
      healthState: 'available',
      health: {
        runtimeOwner: {
          active: false,
          available: false,
          ttsConfigured: false,
        },
      },
    });

    expect(plan.status).toBe('healthy');
    expect(plan.incidents).toEqual([]);
  });

  it('keeps credential failures out of the blind restart path', () => {
    const plan = projectRuntimeRecovery({
      healthState: 'available',
      health: {
        runtimeOwner: {
          active: true,
          available: true,
          ttsConfigured: true,
        },
        model: { credentialConfigured: false },
        lastFaults: {
          model: {
            at: 1_000,
            stage: 'generation_error',
            reason: 'unauthorized',
          },
        },
      },
      now: 2_000,
    });

    expect(plan.status).toBe('blocked');
    expect(plan.incidents).toEqual([
      expect.objectContaining({
        id: 'model-credential',
        action: 'open-settings',
      }),
    ]);
  });

  it('consolidates model, tts and renderer faults into one runtime restart', () => {
    const plan = projectRuntimeRecovery({
      healthState: 'available',
      health: {
        runtimeOwner: {
          active: true,
          available: true,
          ttsConfigured: true,
        },
        model: { credentialConfigured: true },
        lastFaults: {
          model: { at: 9_000, stage: 'generation_error' },
          tts: { at: 9_200, stage: 'tts_beat_error' },
          flashhead: { at: 9_400, stage: 'avatar_render_failed' },
        },
      },
      localRuntimeOwner: true,
      now: 10_000,
    });

    expect(plan.incidents).toHaveLength(1);
    expect(plan.incidents[0]).toMatchObject({
      id: 'execution-fault',
      action: 'restart-runtime',
    });
  });

  it('only recommends snapshot recovery for Soul state failures', () => {
    const recoverable = projectRuntimeRecovery({
      healthState: 'available',
      health: {
        runtimeOwner: {
          active: true,
          available: true,
          ttsConfigured: true,
        },
        lastFaults: {
          soul: {
            at: 9_000,
            stage: 'soul_snapshot_recovery_failed',
          },
        },
      },
      now: 10_000,
    });
    const diagnostic = projectRuntimeRecovery({
      healthState: 'available',
      health: {
        runtimeOwner: {
          active: true,
          available: true,
          ttsConfigured: true,
        },
        lastFaults: {
          soul: { at: 9_000, stage: 'soul_decision_failed' },
        },
      },
      now: 10_000,
    });

    expect(recoverable.incidents[0]?.action).toBe('recover-soul');
    expect(diagnostic.incidents[0]?.action).toBe('open-pipeline');
  });

  it('projects active connector errors even without recent telemetry', () => {
    const plan = projectRuntimeRecovery({
      healthState: 'available',
      health: {
        runtimeOwner: {
          active: true,
          available: true,
          ttsConfigured: true,
        },
      },
      connector: {
        ordinaryRoadState: 'error',
        ordinaryRoadError: 'gateway unavailable',
        socialError: 'websocket disconnected',
      },
    });

    expect(plan.incidents[0]).toMatchObject({
      id: 'connector-error',
      action: 'open-connectors',
    });
    expect(plan.incidents[0]?.detail).toContain('gateway unavailable');
  });

  it('executes exactly the selected recovery port', async () => {
    const actions: RuntimeRecoveryAction[] = [
      'restart-runtime',
      'recover-soul',
      'open-settings',
      'open-connectors',
      'review-queue',
      'open-pipeline',
      'retry-health',
    ];
    const ports = Object.fromEntries(
      actions.map((action) => [action, vi.fn()]),
    ) as unknown as RuntimeRecoveryPorts;

    await executeRuntimeRecovery('restart-runtime', ports);

    expect(ports['restart-runtime']).toHaveBeenCalledOnce();
    for (const action of actions.filter(
      (action) => action !== 'restart-runtime',
    )) {
      expect(ports[action]).not.toHaveBeenCalled();
    }
  });
});
