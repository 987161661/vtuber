import { describe, expect, it } from 'vitest';
import { createLiveRuntimeMonitor } from '../../examples/react-purupuru-app/server/liveRuntimeMonitor';

describe('live runtime monitor', () => {
  it('owns heartbeat, queue and speech lifecycle state behind one interface', () => {
    const monitor = createLiveRuntimeMonitor({
      ownerHeartbeatTtlMs: 10_000,
      queueEventTtlMs: 120_000,
      ttsRateLimitWindowMs: 60_000,
    });

    monitor.ingest(
      {
        stage: 'runtime-owner-heartbeat',
        ownerId: 'owner-a',
        availableForStress: true,
        ttsConfigured: true,
        hostPhase: 'listening',
        activeTurnId: 'turn-1',
      },
      1_000,
    );
    monitor.ingest(
      { stage: 'queued', eventId: 'event-1', queuedAt: 1_100 },
      1_100,
    );
    monitor.ingest({ stage: 'generated', eventId: 'event-1' }, 1_200);
    monitor.ingest({ stage: 'speaking', eventId: 'event-1' }, 1_300);

    expect(monitor.healthSnapshot(1_400)).toMatchObject({
      oldestQueuedAt: 1_100,
      lastGeneratedAt: 1_200,
      lastSpeechAt: 1_300,
      lastEventAt: 1_300,
      isSpeaking: true,
      hostTelemetry: {
        hostPhase: 'listening',
        activeTurnId: 'turn-1',
      },
      runtimeOwner: {
        active: true,
        available: true,
        ttsConfigured: true,
      },
    });

    monitor.ingest({ stage: 'done', eventId: 'event-1' }, 1_500);
    expect(monitor.healthSnapshot(1_600)).toMatchObject({
      oldestQueuedAt: null,
      isSpeaking: false,
      lastEventAt: 1_500,
    });
  });

  it('expires stale client telemetry and provisional runtime owners', () => {
    const monitor = createLiveRuntimeMonitor({
      ownerHeartbeatTtlMs: 10_000,
      queueEventTtlMs: 120_000,
    });
    monitor.recordOwnerHeartbeat(
      'provisional-owner',
      { availableForStress: true, ttsConfigured: false },
      1_000,
    );
    monitor.ingest(
      { stage: 'queued', eventId: 'stale-event', queuedAt: 1_000 },
      1_000,
    );

    expect(monitor.ownerAvailability(11_000).active).toBe(true);
    expect(monitor.healthSnapshot(121_001)).toMatchObject({
      oldestQueuedAt: null,
      reconciledRuntimeQueueEvents: 1,
      runtimeOwner: { active: false, available: false, ttsConfigured: false },
      lastFaults: {
        director: {
          stage: 'director_telemetry_reconciled',
          reason: 'cleared_1_stale_client_queue_event(s)',
        },
      },
    });
  });

  it('classifies faults, counters and successful Soul recovery consistently', () => {
    const monitor = createLiveRuntimeMonitor();

    monitor.ingest(
      {
        stage: 'deduplicated',
        eventId: 'duplicate-1',
        dropReason: 'duplicate_text',
      },
      1_000,
    );
    monitor.ingest({ stage: 'sanitizer_failure' }, 1_100);
    monitor.ingest(
      { stage: 'failed', reason: 'generation_auth_failed' },
      1_200,
    );
    monitor.ingest(
      {
        stage: 'soul_snapshot_recovery_failed',
        error: 'snapshot ledger mismatch',
      },
      1_300,
    );

    expect(monitor.healthSnapshot(1_400)).toMatchObject({
      duplicateDrops: 1,
      sanitizerFailures: 1,
      lastFaults: {
        model: {
          stage: 'generation_auth_failed',
          reason: expect.stringContaining('MiniMax 服务端凭据为空'),
        },
        soul: {
          stage: 'soul_snapshot_recovery_failed',
          reason: 'snapshot ledger mismatch',
        },
      },
    });

    monitor.ingest({ stage: 'soul_snapshot_recovered' }, 1_500);
    expect(monitor.healthSnapshot(1_600).lastFaults.soul).toBeUndefined();
  });
});
