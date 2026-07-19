type RuntimeFaultKind =
  | 'soul'
  | 'model'
  | 'skill'
  | 'tts'
  | 'flashhead'
  | 'platform'
  | 'director';

type RuntimeFault = {
  at: number;
  stage: string;
  reason?: string;
};

type RuntimeOwnerHeartbeat = {
  seenAt: number;
  availableForStress: boolean;
  ttsConfigured: boolean;
};

export type RuntimeOwnerAvailability = {
  active: boolean;
  available: boolean;
  ttsConfigured: boolean;
};

export type LiveRuntimeHealthSnapshot = {
  oldestQueuedAt: number | null;
  reconciledRuntimeQueueEvents: number;
  duplicateDrops: number;
  sanitizerFailures: number;
  ttsRateLimitCount: number;
  lastSpeechAt: number;
  lastGeneratedAt: number;
  lastEventAt: number;
  isSpeaking: boolean;
  hostTelemetry: Record<string, unknown>;
  lastFaults: Partial<Record<RuntimeFaultKind, RuntimeFault>>;
  runtimeOwner: RuntimeOwnerAvailability;
};

const TERMINAL_QUEUE_STAGES = new Set([
  'selected',
  'dropped',
  'deduplicated',
  'done',
  'failed',
]);
const SPEECH_TERMINAL_STAGES = new Set([
  'done',
  'tts_rate_limit',
  'failed',
  'dropped',
]);
const INTENTIONAL_SOUL_FALLBACKS = new Set([
  'cognition-frozen',
  'operator-neutral-fallback',
  'operator-has-execution-control',
  'local-safety-mute',
]);

export function createLiveRuntimeMonitor(
  options: {
    ownerHeartbeatTtlMs?: number;
    queueEventTtlMs?: number;
    ttsRateLimitWindowMs?: number;
  } = {},
) {
  const ownerHeartbeatTtlMs = options.ownerHeartbeatTtlMs ?? 15_000;
  const queueEventTtlMs = options.queueEventTtlMs ?? 120_000;
  const ttsRateLimitWindowMs = options.ttsRateLimitWindowMs ?? 60_000;
  const queued = new Map<string, number>();
  const ownerHeartbeats = new Map<string, RuntimeOwnerHeartbeat>();
  const state = {
    duplicateDrops: 0,
    sanitizerFailures: 0,
    ttsRateLimitTimes: [] as number[],
    lastSpeechAt: 0,
    lastGeneratedAt: 0,
    lastEventAt: 0,
    isSpeaking: false,
    hostTelemetry: {} as Record<string, unknown>,
    lastFaults: {} as Partial<Record<RuntimeFaultKind, RuntimeFault>>,
  };

  function recordOwnerHeartbeat(
    ownerId: string,
    heartbeat: {
      availableForStress: boolean;
      ttsConfigured: boolean;
    },
    at: number,
  ): void {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) return;
    ownerHeartbeats.set(normalizedOwnerId, { seenAt: at, ...heartbeat });
  }

  function ownerAvailability(at: number): RuntimeOwnerAvailability {
    for (const [ownerId, heartbeat] of ownerHeartbeats) {
      if (at - heartbeat.seenAt <= ownerHeartbeatTtlMs) continue;
      ownerHeartbeats.delete(ownerId);
    }
    return {
      active: ownerHeartbeats.size > 0,
      available: [...ownerHeartbeats.values()].some(
        (heartbeat) => heartbeat.availableForStress,
      ),
      ttsConfigured: [...ownerHeartbeats.values()].some(
        (heartbeat) => heartbeat.ttsConfigured,
      ),
    };
  }

  function ingest(event: Record<string, unknown>, at: number) {
    const eventId = String(event.eventId || event.id || 'runtime');
    const stage = String(event.stage || event.kind || 'event');
    state.lastEventAt = at;

    if (stage === 'runtime-owner-heartbeat') {
      recordOwnerHeartbeat(
        String(event.ownerId || ''),
        {
          availableForStress: event.availableForStress === true,
          ttsConfigured: event.ttsConfigured === true,
        },
        at,
      );
      state.hostTelemetry = {
        hostPhase: event.hostPhase,
        activeTurnId: event.activeTurnId,
        targetViewerId: event.targetViewerId,
        lastDecisionReason: event.lastDecisionReason,
        proactiveRemaining: event.proactiveRemaining,
        nextProactiveAt: event.nextProactiveAt,
        currentBeatIndex: event.currentBeatIndex,
        currentBeatInterruptible: event.currentBeatInterruptible,
        recoveryCount: event.recoveryCount,
        unsupportedAvatarActionCount: event.unsupportedAvatarActionCount,
      };
    }

    if (stage === 'queued') {
      queued.set(eventId, finiteTimestamp(event.queuedAt) ?? at);
    } else if (TERMINAL_QUEUE_STAGES.has(stage)) {
      queued.delete(eventId);
    }
    if (
      stage === 'deduplicated' &&
      String(event.dropReason || '').startsWith('duplicate')
    ) {
      state.duplicateDrops += 1;
    }
    if (stage === 'generated') state.lastGeneratedAt = at;
    if (stage === 'speaking') {
      state.lastSpeechAt = at;
      state.isSpeaking = true;
    }
    if (SPEECH_TERMINAL_STAGES.has(stage)) state.isSpeaking = false;
    if (stage === 'sanitizer_failure') state.sanitizerFailures += 1;
    if (stage === 'tts_rate_limit') state.ttsRateLimitTimes.push(at);

    const reason =
      typeof event.reason === 'string'
        ? event.reason
        : typeof event.error === 'string'
          ? event.error
          : undefined;
    updateFaults(event, stage, reason, at, state.lastFaults);
    return { eventId, stage, reason };
  }

  function healthSnapshot(at: number): LiveRuntimeHealthSnapshot {
    state.ttsRateLimitTimes = state.ttsRateLimitTimes.filter(
      (value) => at - value <= ttsRateLimitWindowMs,
    );
    let reconciledRuntimeQueueEvents = 0;
    for (const [eventId, queuedAt] of queued) {
      if (at - queuedAt <= queueEventTtlMs) continue;
      queued.delete(eventId);
      reconciledRuntimeQueueEvents += 1;
    }
    if (reconciledRuntimeQueueEvents) {
      state.lastFaults.director = {
        at,
        stage: 'director_telemetry_reconciled',
        reason: `cleared_${reconciledRuntimeQueueEvents}_stale_client_queue_event(s)`,
      };
    }
    const oldestQueuedAt = Math.min(
      ...queued.values(),
      Number.POSITIVE_INFINITY,
    );
    return {
      oldestQueuedAt: Number.isFinite(oldestQueuedAt) ? oldestQueuedAt : null,
      reconciledRuntimeQueueEvents,
      duplicateDrops: state.duplicateDrops,
      sanitizerFailures: state.sanitizerFailures,
      ttsRateLimitCount: state.ttsRateLimitTimes.length,
      lastSpeechAt: state.lastSpeechAt,
      lastGeneratedAt: state.lastGeneratedAt,
      lastEventAt: state.lastEventAt,
      isSpeaking: state.isSpeaking,
      hostTelemetry: structuredClone(state.hostTelemetry),
      lastFaults: structuredClone(state.lastFaults),
      runtimeOwner: ownerAvailability(at),
    };
  }

  return {
    healthSnapshot,
    ingest,
    ownerAvailability,
    recordOwnerHeartbeat,
  };
}

function updateFaults(
  event: Record<string, unknown>,
  stage: string,
  reason: string | undefined,
  at: number,
  faults: Partial<Record<RuntimeFaultKind, RuntimeFault>>,
): void {
  const soulFallbackReason =
    typeof event.fallbackReason === 'string' ? event.fallbackReason : undefined;
  const soulFallbackDetail =
    typeof event.fallbackDetail === 'string'
      ? event.fallbackDetail.slice(0, 120)
      : undefined;
  if (
    stage === 'soul_shadow_decision' &&
    event.fallback !== true &&
    event.persistenceOk === true
  ) {
    faults.soul = undefined;
  }
  if (
    stage === 'soul_snapshot_recovered' &&
    faults.soul?.stage === 'soul_snapshot_recovery_failed'
  ) {
    faults.soul = undefined;
  }
  if (
    (stage.startsWith('soul_') && /failed|failure|timeout|error/.test(stage)) ||
    (stage.startsWith('soul_') && event.persistenceOk === false) ||
    (stage === 'soul_shadow_decision' &&
      event.fallback === true &&
      soulFallbackReason &&
      !INTENTIONAL_SOUL_FALLBACKS.has(soulFallbackReason))
  ) {
    faults.soul = {
      at,
      stage: stage === 'soul_shadow_decision' ? 'soul_fast_fallback' : stage,
      reason:
        soulFallbackDetail ||
        soulFallbackReason ||
        (typeof event.persistenceError === 'string'
          ? event.persistenceError
          : undefined) ||
        reason ||
        (event.persistenceOk === false ? 'soul_persistence_failed' : undefined),
    };
  }
  if (
    stage === 'model-truncated' ||
    (stage === 'failed' && /generation|model|chat/i.test(reason || ''))
  ) {
    const authenticationFailed = reason === 'generation_auth_failed';
    faults.model = {
      at,
      stage: authenticationFailed ? 'generation_auth_failed' : stage,
      reason: authenticationFailed
        ? 'MiniMax 服务端凭据为空。请在设置 → LLM → OpenAI-Compatible → API 密钥中重新输入原 key；无需转换。'
        : reason,
    };
  }
  if (stage.includes('skill') && /fail|timeout|error/.test(stage)) {
    faults.skill = { at, stage, reason };
  }
  if (stage.startsWith('tts-') && /error|failed|timeout|rate/.test(stage)) {
    faults.tts = { at, stage, reason };
  }
  if (stage.includes('flashhead') && /error|failed|timeout/.test(stage)) {
    faults.flashhead = { at, stage, reason };
  }
  if (stage === 'live_platform_delivery_failed') {
    faults.platform = { at, stage, reason };
  }
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
