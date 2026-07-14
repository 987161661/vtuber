import type {
  LiveHostDecision,
  LiveHostEvent,
  LiveHostPhase,
  LiveHostPolicy,
  LiveHostSnapshot,
  LiveHostTurn,
} from './types.js';

export const DEFAULT_LIVE_HOST_POLICY: LiveHostPolicy = {
  quietThresholdMs: 120_000,
  proactiveCooldownMs: 120_000,
  maxProactiveTurns: 12,
};

/**
 * Deterministic authority for host timing and interruption decisions.
 *
 * The coordinator never performs I/O. Platform adapters, LLM generation,
 * speech playback, and avatar renderers execute the returned decisions and
 * feed lifecycle events back into this state machine.
 */
export class LiveHostCoordinator {
  private phase: LiveHostPhase = 'offline';
  private activeTurn?: LiveHostTurn;
  private pendingTurns = new Map<string, LiveHostTurn>();
  private pendingInterruptEventId?: string;
  private lastAudienceActivityAt = 0;
  private lastHostSpeechAt = 0;
  private proactiveDeliveredCount = 0;
  private nextProactiveAt = 0;
  private lastProactiveSource?: string;
  private recoveryCount = 0;
  private currentBeatIndex?: number;
  private currentBeatInterruptible = false;
  private lastDecisionReason = 'initial_state';
  private readonly policy: LiveHostPolicy;

  constructor(policy: Partial<LiveHostPolicy> = {}) {
    this.policy = { ...DEFAULT_LIVE_HOST_POLICY, ...policy };
  }

  dispatch(event: LiveHostEvent): LiveHostDecision[] {
    const decisions = this.reduce(event);
    if (decisions.length) {
      this.lastDecisionReason = decisions[decisions.length - 1].reasonCode;
    }
    return decisions;
  }

  snapshot(): LiveHostSnapshot {
    return {
      phase: this.phase,
      activeTurn: this.activeTurn ? { ...this.activeTurn } : undefined,
      pendingInterruptEventId: this.pendingInterruptEventId,
      lastAudienceActivityAt: this.lastAudienceActivityAt,
      lastHostSpeechAt: this.lastHostSpeechAt,
      proactiveDeliveredCount: this.proactiveDeliveredCount,
      proactiveRemaining: Math.max(
        0,
        this.policy.maxProactiveTurns - this.proactiveDeliveredCount,
      ),
      nextProactiveAt: this.nextProactiveAt,
      lastProactiveSource: this.lastProactiveSource,
      recoveryCount: this.recoveryCount,
      currentBeatIndex: this.currentBeatIndex,
      currentBeatInterruptible: this.currentBeatInterruptible,
      lastDecisionReason: this.lastDecisionReason,
    };
  }

  private reduce(event: LiveHostEvent): LiveHostDecision[] {
    if (event.type === 'stream-state') {
      if (!event.isLive) {
        this.resetForOffline();
        return [];
      }
      if (this.phase === 'offline') this.phase = 'observing';
      this.lastAudienceActivityAt ||= event.at;
      return [];
    }

    if (event.type === 'viewer-presence') {
      // Presence is observational state. It must not reset the audience-chat
      // quiet timer or fabricate a reason to address a silent viewer by name.
      return [];
    }

    if (event.type === 'operator-command') {
      if (event.command === 'takeover' || event.command === 'mute') {
        const activeEventId = this.activeTurn?.eventId;
        this.phase = 'operator_hold';
        this.activeTurn = undefined;
        this.pendingInterruptEventId = undefined;
        this.currentBeatIndex = undefined;
        this.currentBeatInterruptible = false;
        return [
          {
            kind: 'interrupt',
            eventId: activeEventId,
            mode: 'immediate',
            reasonCode: `operator_${event.command}`,
          },
        ];
      }
      this.phase = event.isLive === false ? 'offline' : 'observing';
      return [];
    }

    if (this.phase === 'operator_hold') {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'operator_hold',
        },
      ];
    }

    if (event.type === 'audience-message') {
      this.lastAudienceActivityAt = event.at;
      const decisions: LiveHostDecision[] = [
        {
          kind: 'queue-audience-turn',
          eventId: event.eventId,
          targetViewerId: event.viewerId,
          priority: event.priority ?? 'normal',
          reasonCode: 'audience_message_queued',
        },
      ];
      if (this.activeTurn?.kind === 'proactive') {
        this.pendingInterruptEventId = event.eventId;
        decisions.unshift({
          kind: 'interrupt',
          eventId: this.activeTurn.eventId,
          mode: 'beat-boundary',
          reasonCode: 'audience_interrupts_proactive',
        });
      }
      if (this.phase === 'observing' || this.phase === 'cooldown') {
        this.phase = 'deliberating';
      }
      return decisions;
    }

    if (event.type === 'engagement') {
      this.lastAudienceActivityAt = event.at;
      const decisions: LiveHostDecision[] = [
        {
          kind: 'queue-audience-turn',
          eventId: event.eventId,
          targetViewerId: event.viewerId,
          priority: event.priority ?? 'normal',
          reasonCode: 'engagement_deferred_to_next_beat',
        },
      ];
      if (this.activeTurn?.kind === 'proactive') {
        this.pendingInterruptEventId = event.eventId;
        decisions.unshift({
          kind: 'interrupt',
          eventId: this.activeTurn.eventId,
          mode: 'beat-boundary',
          reasonCode: 'engagement_interrupts_proactive_at_beat_boundary',
        });
      }
      return decisions;
    }

    if (event.type === 'environment') {
      const isUrgent = event.priority === 'urgent';
      const decisions: LiveHostDecision[] = [
        {
          kind: 'prepare-reply',
          eventId: event.eventId,
          turnKind: 'safety',
          reasonCode: isUrgent
            ? 'urgent_environment_event'
            : 'environment_event',
        },
      ];
      if (isUrgent && this.phase === 'speaking' && this.activeTurn) {
        this.pendingInterruptEventId = event.eventId;
        decisions.unshift({
          kind: 'interrupt',
          eventId: this.activeTurn.eventId,
          mode: 'beat-boundary',
          reasonCode: 'urgent_event_interrupts_at_beat_boundary',
        });
      }
      return decisions;
    }

    if (event.type === 'quiet-candidate') {
      return this.handleQuietCandidate(event);
    }

    if (event.type === 'generation') {
      if (event.stage === 'started') {
        if (
          this.phase === 'speaking' &&
          this.activeTurn?.eventId !== event.eventId
        ) {
          this.pendingTurns.set(event.eventId, { ...event.turn });
          return [];
        }
        this.phase = 'deliberating';
        this.activeTurn = { ...event.turn };
        return [];
      }
      if (event.stage === 'completed') {
        if (
          this.phase === 'speaking' &&
          this.activeTurn?.eventId !== event.eventId
        ) {
          this.pendingTurns.set(event.eventId, { ...event.turn });
          return [
            {
              kind: 'speak-turn',
              eventId: event.eventId,
              reasonCode: 'generation_completed_while_speech_active',
            },
          ];
        }
        if (!this.activeTurn || this.activeTurn.eventId !== event.eventId) {
          this.activeTurn = { ...event.turn };
        }
        return [
          {
            kind: 'speak-turn',
            eventId: event.eventId,
            reasonCode: 'generation_completed',
          },
        ];
      }
      if (this.pendingTurns.delete(event.eventId)) {
        return [
          {
            kind: 'request-operator-attention',
            eventId: event.eventId,
            reasonCode: 'generation_failed',
          },
        ];
      }
      return this.enterRecovery(event.eventId, 'generation_failed');
    }

    if (event.type === 'speech') {
      return this.handleSpeechLifecycle(event);
    }

    if (event.type === 'runtime-fault') {
      return this.enterRecovery(event.eventId, event.reasonCode);
    }

    return [];
  }

  private handleQuietCandidate(
    event: Extract<LiveHostEvent, { type: 'quiet-candidate' }>,
  ): LiveHostDecision[] {
    if (this.phase === 'offline') {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'not_live',
        },
      ];
    }
    if (
      !['observing', 'cooldown'].includes(this.phase) ||
      this.activeTurn !== undefined ||
      event.busy
    ) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'host_busy',
        },
      ];
    }
    if (event.at - this.lastAudienceActivityAt < this.policy.quietThresholdMs) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'quiet_threshold_not_reached',
        },
      ];
    }
    if (event.at < this.nextProactiveAt) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'proactive_cooldown',
        },
      ];
    }
    if (this.proactiveDeliveredCount >= this.policy.maxProactiveTurns) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'proactive_budget_exhausted',
        },
      ];
    }
    if (this.lastProactiveSource === event.source) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'proactive_source_repeated',
        },
      ];
    }

    this.phase = 'deliberating';
    this.activeTurn = {
      eventId: event.eventId,
      kind: 'proactive',
      priority: 'low',
      createdAt: event.at,
      proactiveSource: event.source,
    };
    return [
      {
        kind: 'prepare-reply',
        eventId: event.eventId,
        turnKind: 'proactive',
        prompt: event.prompt,
        reasonCode: 'quiet_candidate_selected',
      },
    ];
  }

  private handleSpeechLifecycle(
    event: Extract<LiveHostEvent, { type: 'speech' }>,
  ): LiveHostDecision[] {
    if (event.stage === 'started') {
      const pending = this.pendingTurns.get(event.eventId);
      if (pending) {
        this.activeTurn = pending;
        this.pendingTurns.delete(event.eventId);
      }
      this.phase = 'speaking';
      this.currentBeatIndex = event.beatIndex ?? 0;
      this.currentBeatInterruptible = event.interruptibleAfter === true;
      return [
        {
          kind: 'emit-avatar-intent',
          eventId: event.eventId,
          intent: 'speaking',
          reasonCode: 'speech_started',
        },
      ];
    }

    if (event.stage === 'beat-completed') {
      this.currentBeatIndex = event.beatIndex;
      this.currentBeatInterruptible = event.interruptibleAfter === true;
      if (
        this.pendingInterruptEventId &&
        this.currentBeatInterruptible &&
        this.activeTurn?.eventId === event.eventId
      ) {
        this.activeTurn = undefined;
        this.phase = 'deliberating';
        this.pendingInterruptEventId = undefined;
      }
      return [];
    }

    if (event.stage === 'completed') {
      const completed = this.activeTurn;
      if (completed?.kind === 'proactive') {
        this.proactiveDeliveredCount += 1;
        this.lastProactiveSource = completed.proactiveSource;
        this.nextProactiveAt = event.at + this.policy.proactiveCooldownMs;
      }
      this.lastHostSpeechAt = event.at;
      this.phase = this.pendingTurns.size ? 'deliberating' : 'cooldown';
      this.activeTurn = undefined;
      this.pendingInterruptEventId = undefined;
      this.currentBeatIndex = undefined;
      this.currentBeatInterruptible = false;
      return [
        {
          kind: 'emit-avatar-intent',
          eventId: event.eventId,
          intent: 'observing',
          reasonCode: 'speech_completed',
        },
      ];
    }

    if (event.stage === 'interrupted') {
      this.phase =
        this.pendingInterruptEventId || this.pendingTurns.size
          ? 'deliberating'
          : 'observing';
      this.activeTurn = undefined;
      this.pendingInterruptEventId = undefined;
      this.currentBeatIndex = undefined;
      this.currentBeatInterruptible = false;
      return [
        {
          kind: 'emit-avatar-intent',
          eventId: event.eventId,
          intent: 'observing',
          reasonCode: 'speech_interrupted_cleanly',
        },
      ];
    }

    return this.enterRecovery(event.eventId, 'speech_failed');
  }

  private enterRecovery(
    eventId: string | undefined,
    reasonCode: string,
  ): LiveHostDecision[] {
    this.phase = 'recovering';
    this.recoveryCount += 1;
    this.activeTurn = undefined;
    this.pendingTurns.clear();
    this.pendingInterruptEventId = undefined;
    this.currentBeatIndex = undefined;
    this.currentBeatInterruptible = false;
    return [
      {
        kind: 'enter-recovery',
        eventId,
        reasonCode,
      },
      {
        kind: 'request-operator-attention',
        eventId,
        reasonCode,
      },
    ];
  }

  private resetForOffline(): void {
    this.phase = 'offline';
    this.activeTurn = undefined;
    this.pendingTurns.clear();
    this.pendingInterruptEventId = undefined;
    this.currentBeatIndex = undefined;
    this.currentBeatInterruptible = false;
    this.lastAudienceActivityAt = 0;
    this.lastHostSpeechAt = 0;
    this.proactiveDeliveredCount = 0;
    this.nextProactiveAt = 0;
    this.lastProactiveSource = undefined;
    this.recoveryCount = 0;
  }
}
