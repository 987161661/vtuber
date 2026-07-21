import type {
  LiveHostAction,
  LiveHostDecision,
  LiveHostEvent,
  LiveHostPhase,
  LiveHostPolicy,
  LiveHostPriority,
  LiveHostScope,
  LiveHostSnapshot,
  LiveHostTurn,
} from './types.js';

type PendingTurnStage = 'queued' | 'generating' | 'ready';

interface PendingTurn {
  turn: LiveHostTurn;
  stage: PendingTurnStage;
}

const PRIORITY_ORDER: Record<LiveHostPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const DEFAULT_LIVE_HOST_POLICY: LiveHostPolicy = {
  quietThresholdMs: 120_000,
  proactiveCooldownMs: 120_000,
  maxProactiveTurns: 12,
  likeResponseCooldownMs: 120_000,
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
  private scope?: LiveHostScope;
  private activeTurn?: LiveHostTurn;
  private pendingTurns = new Map<string, PendingTurn>();
  private pendingInterruptEventId?: string;
  private lastAudienceActivityAt = 0;
  private lastHostSpeechAt = 0;
  private proactiveDeliveredCount = 0;
  private nextProactiveAt = 0;
  private lastProactiveSource?: string;
  private lastProactiveOpportunityId?: string;
  private readonly reservedProactiveOpportunityIds = new Set<string>();
  private readonly finalizedSpeechEventIds = new Set<string>();
  private recoveryCount = 0;
  private currentBeatIndex?: number;
  private currentBeatInterruptible = false;
  private lastDecisionReason = 'initial_state';
  private lastQueuedLikeAt?: number;
  private readonly policy: LiveHostPolicy;

  constructor(policy: Partial<LiveHostPolicy> = {}) {
    this.policy = { ...DEFAULT_LIVE_HOST_POLICY, ...policy };
  }

  updatePolicy(policy: Partial<LiveHostPolicy>) {
    Object.assign(this.policy, policy);
  }

  dispatch(event: LiveHostEvent): LiveHostAction[] {
    const scopeDecision = this.bindOrRejectScope(event);
    const decisions = scopeDecision ? [scopeDecision] : this.reduce(event);
    if (decisions.length) {
      this.lastDecisionReason = decisions[decisions.length - 1].reasonCode;
    }
    return this.toActions(event, decisions);
  }

  snapshot(): LiveHostSnapshot {
    return {
      phase: this.phase,
      scope: this.scope ? { ...this.scope } : undefined,
      activeTurn: this.activeTurn ? { ...this.activeTurn } : undefined,
      pendingTurnCount: this.pendingTurns.size,
      readyTurnIds: [...this.pendingTurns.values()]
        .filter((pending) => pending.stage === 'ready')
        .map((pending) => pending.turn.eventId),
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
      lastProactiveOpportunityId: this.lastProactiveOpportunityId,
      recoveryCount: this.recoveryCount,
      currentBeatIndex: this.currentBeatIndex,
      currentBeatInterruptible: this.currentBeatInterruptible,
      lastDecisionReason: this.lastDecisionReason,
    };
  }

  private bindOrRejectScope(
    event: LiveHostEvent,
  ): LiveHostDecision | undefined {
    if (event.type === 'stream-state') {
      if (
        !event.isLive &&
        event.scope &&
        this.scope &&
        !this.isSameScope(event.scope, this.scope)
      ) {
        return {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'scope_mismatch',
        };
      }

      if (
        event.isLive &&
        event.scope &&
        (!this.scope || !this.isSameScope(event.scope, this.scope))
      ) {
        this.resetForOffline();
        this.scope = { ...event.scope };
      }
      return undefined;
    }

    if (!event.scope) return undefined;
    if (!this.scope) {
      this.scope = { ...event.scope };
      return undefined;
    }
    if (this.isSameScope(event.scope, this.scope)) return undefined;
    return {
      kind: 'drop',
      eventId: event.eventId,
      reasonCode: 'scope_mismatch',
    };
  }

  private isSameScope(left: LiveHostScope, right: LiveHostScope): boolean {
    return (
      left.profileId === right.profileId &&
      left.sessionId === right.sessionId &&
      left.streamId === right.streamId
    );
  }

  private toActions(
    event: LiveHostEvent,
    decisions: LiveHostDecision[],
  ): LiveHostAction[] {
    const lifecycle =
      'stage' in event
        ? event.stage
        : event.type === 'operator-command'
          ? event.command
          : event.type;
    const eventKey = event.eventId ?? `${event.type}-${event.at}`;
    const scopeKey =
      this.scope?.sessionId ?? event.scope?.sessionId ?? 'unscoped';
    return decisions.map(
      (decision, index) =>
        ({
          ...decision,
          actionId: `${scopeKey}:${eventKey}:${lifecycle}:${decision.kind}:${index}`,
          issuedAt: event.at,
          scope: this.scope ? { ...this.scope } : event.scope,
        }) as LiveHostAction,
    );
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
        const interruptedTurn = this.activeTurn
          ? { ...this.activeTurn }
          : undefined;
        const activeEventId = interruptedTurn?.eventId;
        this.phase = 'operator_hold';
        this.activeTurn = undefined;
        this.pendingTurns.clear();
        this.pendingInterruptEventId = undefined;
        this.currentBeatIndex = undefined;
        this.currentBeatInterruptible = false;
        return [
          {
            kind: 'interrupt',
            eventId: activeEventId,
            mode: 'immediate',
            reasonCode: `operator_${event.command}`,
            turn: interruptedTurn,
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
      const turn: LiveHostTurn = {
        eventId: event.eventId,
        kind: 'viewer',
        priority: event.priority ?? 'normal',
        createdAt: event.at,
        targetViewerId: event.viewerId,
        scope: this.scope ? { ...this.scope } : undefined,
      };
      this.reservePendingTurn(turn, 'queued');
      const decisions: LiveHostDecision[] = [
        {
          kind: 'queue-audience-turn',
          eventId: event.eventId,
          targetViewerId: event.viewerId,
          priority: event.priority ?? 'normal',
          reasonCode: 'audience_message_queued',
          turn,
        },
      ];
      if (this.activeTurn?.kind === 'proactive') {
        const proactiveTurn = { ...this.activeTurn };
        if (this.phase === 'speaking') {
          this.pendingInterruptEventId = event.eventId;
          decisions.unshift({
            kind: 'interrupt',
            eventId: proactiveTurn.eventId,
            mode: 'beat-boundary',
            reasonCode: 'audience_interrupts_proactive',
            turn: proactiveTurn,
          });
        } else {
          this.activeTurn = undefined;
          decisions.unshift({
            kind: 'drop',
            eventId: proactiveTurn.eventId,
            reasonCode: 'audience_preempts_unspoken_proactive',
            turn: proactiveTurn,
          });
        }
      }
      if (this.phase === 'observing' || this.phase === 'cooldown') {
        this.phase = 'deliberating';
      }
      return decisions;
    }

    if (event.type === 'engagement') {
      this.lastAudienceActivityAt = event.at;
      if (
        event.engagementKind === 'like' &&
        this.lastQueuedLikeAt !== undefined &&
        event.at - this.lastQueuedLikeAt < this.policy.likeResponseCooldownMs
      ) {
        return [
          {
            kind: 'drop',
            eventId: event.eventId,
            reasonCode: 'like_response_cooldown',
          },
        ];
      }
      if (event.engagementKind === 'like') this.lastQueuedLikeAt = event.at;
      const turn: LiveHostTurn = {
        eventId: event.eventId,
        kind: 'engagement',
        priority: event.priority ?? 'normal',
        createdAt: event.at,
        targetViewerId: event.viewerId,
        scope: this.scope ? { ...this.scope } : undefined,
      };
      this.reservePendingTurn(turn, 'queued');
      const decisions: LiveHostDecision[] = [
        {
          kind: 'queue-audience-turn',
          eventId: event.eventId,
          targetViewerId: event.viewerId,
          priority: event.priority ?? 'normal',
          reasonCode: 'engagement_deferred_to_next_beat',
          turn,
        },
      ];
      if (this.activeTurn?.kind === 'proactive') {
        const proactiveTurn = { ...this.activeTurn };
        if (this.phase === 'speaking') {
          this.pendingInterruptEventId = event.eventId;
          decisions.unshift({
            kind: 'interrupt',
            eventId: proactiveTurn.eventId,
            mode: 'beat-boundary',
            reasonCode: 'engagement_interrupts_proactive_at_beat_boundary',
            turn: proactiveTurn,
          });
        } else {
          this.activeTurn = undefined;
          decisions.unshift({
            kind: 'drop',
            eventId: proactiveTurn.eventId,
            reasonCode: 'engagement_preempts_unspoken_proactive',
            turn: proactiveTurn,
          });
        }
      }
      return decisions;
    }

    if (event.type === 'environment') {
      const isUrgent = event.priority === 'urgent';
      const turn: LiveHostTurn = {
        eventId: event.eventId,
        kind: 'safety',
        priority: event.priority,
        createdAt: event.at,
        scope: this.scope ? { ...this.scope } : undefined,
      };
      this.reservePendingTurn(turn, 'queued');
      const decisions: LiveHostDecision[] = [
        {
          kind: 'prepare-reply',
          eventId: event.eventId,
          turnKind: 'safety',
          reasonCode: isUrgent
            ? 'urgent_environment_event'
            : 'environment_event',
          turn,
        },
      ];
      if (isUrgent && this.phase === 'speaking' && this.activeTurn) {
        this.pendingInterruptEventId = event.eventId;
        decisions.unshift({
          kind: 'interrupt',
          eventId: this.activeTurn.eventId,
          mode: 'beat-boundary',
          reasonCode: 'urgent_event_interrupts_at_beat_boundary',
          turn: { ...this.activeTurn },
        });
      }
      return decisions;
    }

    if (event.type === 'quiet-candidate') {
      return this.handleQuietCandidate(event);
    }

    if (event.type === 'generation') {
      const turn = this.withCurrentScope(event.turn);
      if (
        this.finalizedSpeechEventIds.has(event.eventId) ||
        (this.phase === 'speaking' &&
          this.activeTurn?.eventId === event.eventId)
      ) {
        return [];
      }
      if (event.stage === 'started') {
        if (
          this.phase === 'speaking' &&
          this.activeTurn?.eventId !== event.eventId
        ) {
          this.reservePendingTurn(turn, 'generating');
          return [];
        }
        if (this.activeTurn && this.activeTurn.eventId !== event.eventId) {
          // A ready/direct queue item may begin after another turn has already
          // drafted. Preserve that draft so the actual playback lifecycle
          // cannot overwrite and lose it.
          this.reservePendingTurn(this.activeTurn, 'generating');
        }
        this.phase = 'deliberating';
        this.pendingTurns.delete(event.eventId);
        this.activeTurn = turn;
        return [];
      }
      if (event.stage === 'completed') {
        if (
          this.phase === 'speaking' &&
          this.activeTurn?.eventId !== event.eventId
        ) {
          this.reservePendingTurn(turn, 'ready');
          return [];
        }
        if (this.activeTurn && this.activeTurn.eventId !== event.eventId) {
          this.reservePendingTurn(this.activeTurn, 'generating');
        }
        this.pendingTurns.delete(event.eventId);
        this.activeTurn = turn;
        this.phase = 'deliberating';
        return [
          {
            kind: 'speak-turn',
            eventId: event.eventId,
            reasonCode: 'generation_completed',
            turn,
          },
        ];
      }
      const wasPending = this.pendingTurns.delete(event.eventId);
      if (
        wasPending ||
        (this.phase === 'speaking' &&
          this.activeTurn?.eventId !== event.eventId)
      ) {
        return [
          {
            kind: 'request-operator-attention',
            eventId: event.eventId,
            reasonCode: 'generation_failed',
            severity: 'warning',
            recoveryCount: this.recoveryCount,
          },
        ];
      }
      // A failed model turn is an isolated execution failure: no speech has
      // started and the coordinator's state is still reconstructable. Do not
      // escalate it into global recovery (or clear unrelated queued turns).
      // The queue consumer remains the only retry authority for this event.
      if (this.activeTurn?.eventId === event.eventId) {
        this.activeTurn = undefined;
        this.pendingInterruptEventId = undefined;
        this.currentBeatIndex = undefined;
        this.currentBeatInterruptible = false;
      }
      const nextReady = this.takeNextReadyTurn();
      if (nextReady) {
        this.activeTurn = nextReady;
        this.phase = 'deliberating';
        return [
          {
            kind: 'request-operator-attention',
            eventId: event.eventId,
            reasonCode: 'generation_failed',
            severity: 'warning',
            recoveryCount: this.recoveryCount,
          },
          {
            kind: 'speak-turn',
            eventId: nextReady.eventId,
            reasonCode: 'next_ready_after_generation_failure',
            turn: nextReady,
          },
        ];
      }
      this.phase = this.pendingTurns.size ? 'deliberating' : 'observing';
      return [
        {
          kind: 'request-operator-attention',
          eventId: event.eventId,
          reasonCode: 'generation_failed',
          severity: 'warning',
          recoveryCount: this.recoveryCount,
        },
        {
          kind: 'emit-avatar-intent',
          eventId: event.eventId,
          intent: 'observing',
          reasonCode: 'generation_failed_turn_released',
        },
      ];
    }

    if (event.type === 'speech') {
      return this.handleSpeechLifecycle(event);
    }

    if (event.type === 'runtime-fault') {
      // A proactive candidate is reserved before its asynchronous queue write.
      // If that write is rejected, no generation or speech ever started, so
      // recovering the whole host would leave an otherwise healthy room idle.
      if (event.reasonCode === 'proactive_enqueue_failed') {
        this.pendingTurns.delete(event.eventId ?? '');
        const releasesActiveCandidate =
          this.activeTurn?.eventId === event.eventId;
        if (releasesActiveCandidate) {
          this.phase = this.pendingTurns.size ? 'deliberating' : 'observing';
          this.activeTurn = undefined;
          this.pendingInterruptEventId = undefined;
          this.currentBeatIndex = undefined;
          this.currentBeatInterruptible = false;
        }
        if (!releasesActiveCandidate && this.activeTurn) {
          return [
            {
              kind: 'drop',
              eventId: event.eventId,
              reasonCode: event.reasonCode,
            },
          ];
        }
        return [
          {
            kind: 'emit-avatar-intent',
            eventId: event.eventId ?? 'proactive-enqueue',
            intent: 'observing',
            reasonCode: event.reasonCode,
          },
        ];
      }
      return this.enterRecovery(event.eventId, event.reasonCode);
    }

    return [];
  }

  private handleQuietCandidate(
    event: Extract<LiveHostEvent, { type: 'quiet-candidate' }>,
  ): LiveHostDecision[] {
    const opportunityId = event.opportunityId ?? event.eventId;
    if (this.phase === 'offline') {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'not_live',
        },
      ];
    }
    if (event.expiresAt !== undefined && event.at >= event.expiresAt) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'proactive_opportunity_expired',
        },
      ];
    }
    if (this.reservedProactiveOpportunityIds.has(opportunityId)) {
      return [
        {
          kind: 'drop',
          eventId: event.eventId,
          reasonCode: 'proactive_opportunity_repeated',
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
    this.reservedProactiveOpportunityIds.add(opportunityId);
    this.phase = 'deliberating';
    this.activeTurn = {
      eventId: event.eventId,
      kind: 'proactive',
      priority: 'low',
      createdAt: event.at,
      proactiveSource: event.source,
      proactiveOpportunityId: opportunityId,
      scope: this.scope ? { ...this.scope } : undefined,
    };
    return [
      {
        kind: 'prepare-reply',
        eventId: event.eventId,
        turnKind: 'proactive',
        prompt: event.prompt,
        reasonCode: 'quiet_candidate_selected',
        turn: { ...this.activeTurn },
      },
    ];
  }

  private handleSpeechLifecycle(
    event: Extract<LiveHostEvent, { type: 'speech' }>,
  ): LiveHostDecision[] {
    if (this.finalizedSpeechEventIds.has(event.eventId)) return [];
    if (event.stage === 'started') {
      const pending = this.pendingTurns.get(event.eventId);
      if (
        this.phase === 'speaking' &&
        this.activeTurn?.eventId !== event.eventId
      ) {
        return [
          {
            kind: 'interrupt',
            eventId: event.eventId,
            mode: 'immediate',
            reasonCode: 'concurrent_speech_rejected',
            turn: pending?.turn,
          },
          {
            kind: 'request-operator-attention',
            eventId: event.eventId,
            reasonCode: 'concurrent_speech_rejected',
            severity: 'warning',
            recoveryCount: this.recoveryCount,
          },
        ];
      }
      if (pending) {
        if (this.activeTurn && this.activeTurn.eventId !== event.eventId) {
          this.reservePendingTurn(this.activeTurn, 'generating');
        }
        this.activeTurn = pending.turn;
        this.pendingTurns.delete(event.eventId);
      }
      if (!this.activeTurn || this.activeTurn.eventId !== event.eventId) {
        return this.enterRecovery(event.eventId, 'speech_started_without_turn');
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
        return [
          {
            kind: 'interrupt',
            eventId: event.eventId,
            mode: 'immediate',
            reasonCode: 'pending_interrupt_reached_beat_boundary',
            turn: { ...this.activeTurn },
          },
        ];
      }
      return [];
    }

    if (event.stage === 'completed') {
      if (
        this.phase === 'speaking' &&
        this.activeTurn?.eventId !== event.eventId
      ) {
        return [
          {
            kind: 'drop',
            eventId: event.eventId,
            reasonCode: 'speech_event_not_active',
          },
        ];
      }
      const completed =
        this.activeTurn?.eventId === event.eventId
          ? this.activeTurn
          : this.pendingTurns.get(event.eventId)?.turn;
      if (completed?.kind === 'proactive') {
        this.proactiveDeliveredCount += 1;
        this.lastProactiveSource = completed.proactiveSource;
        this.lastProactiveOpportunityId = completed.proactiveOpportunityId;
        this.nextProactiveAt = event.at + this.policy.proactiveCooldownMs;
      }
      this.lastHostSpeechAt = event.at;
      this.markSpeechFinalized(event.eventId);
      this.pendingTurns.delete(event.eventId);
      this.activeTurn = undefined;
      this.pendingInterruptEventId = undefined;
      this.currentBeatIndex = undefined;
      this.currentBeatInterruptible = false;
      const nextReady = this.takeNextReadyTurn();
      if (nextReady) {
        this.phase = 'deliberating';
        this.activeTurn = nextReady;
        return [
          {
            kind: 'speak-turn',
            eventId: nextReady.eventId,
            turn: nextReady,
            reasonCode: 'next_ready_turn_after_speech',
          },
        ];
      }
      this.phase = this.pendingTurns.size ? 'deliberating' : 'cooldown';
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
      if (
        this.phase === 'speaking' &&
        this.activeTurn?.eventId !== event.eventId
      ) {
        return [
          {
            kind: 'drop',
            eventId: event.eventId,
            reasonCode: 'speech_event_not_active',
          },
        ];
      }
      this.markSpeechFinalized(event.eventId);
      this.pendingTurns.delete(event.eventId);
      this.activeTurn = undefined;
      this.pendingInterruptEventId = undefined;
      this.currentBeatIndex = undefined;
      this.currentBeatInterruptible = false;
      const decisions: LiveHostDecision[] = [
        {
          kind: 'emit-avatar-intent',
          eventId: event.eventId,
          intent: 'observing',
          reasonCode: 'speech_interrupted_cleanly',
        },
      ];
      const nextReady = this.takeNextReadyTurn();
      if (nextReady) {
        this.phase = 'deliberating';
        this.activeTurn = nextReady;
        decisions.push({
          kind: 'speak-turn',
          eventId: nextReady.eventId,
          turn: nextReady,
          reasonCode: 'next_ready_turn_after_interruption',
        });
      } else {
        this.phase = this.pendingTurns.size ? 'deliberating' : 'observing';
      }
      return decisions;
    }

    this.markSpeechFinalized(event.eventId);
    return this.enterRecovery(event.eventId, 'speech_failed');
  }

  private withCurrentScope(turn: LiveHostTurn): LiveHostTurn {
    return {
      ...turn,
      scope: this.scope ? { ...this.scope } : turn.scope,
    };
  }

  private reservePendingTurn(
    turn: LiveHostTurn,
    stage: PendingTurnStage,
  ): void {
    const normalized = this.withCurrentScope(turn);
    const existing = this.pendingTurns.get(normalized.eventId);
    const stageOrder: Record<PendingTurnStage, number> = {
      queued: 0,
      generating: 1,
      ready: 2,
    };
    if (existing && stageOrder[existing.stage] > stageOrder[stage]) return;
    this.pendingTurns.set(normalized.eventId, { turn: normalized, stage });
  }

  private takeNextReadyTurn(): LiveHostTurn | undefined {
    const ready = [...this.pendingTurns.values()]
      .filter((pending) => pending.stage === 'ready')
      .sort(
        (left, right) =>
          PRIORITY_ORDER[left.turn.priority] -
            PRIORITY_ORDER[right.turn.priority] ||
          left.turn.createdAt - right.turn.createdAt ||
          left.turn.eventId.localeCompare(right.turn.eventId),
      )[0];
    if (!ready) return undefined;
    this.pendingTurns.delete(ready.turn.eventId);
    return { ...ready.turn };
  }

  private markSpeechFinalized(eventId: string): void {
    this.finalizedSpeechEventIds.add(eventId);
    if (this.finalizedSpeechEventIds.size <= 2_048) return;
    const oldest = this.finalizedSpeechEventIds.values().next().value;
    if (oldest !== undefined) this.finalizedSpeechEventIds.delete(oldest);
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
        recoveryCount: this.recoveryCount,
      },
      {
        kind: 'request-operator-attention',
        eventId,
        reasonCode,
        severity: 'critical',
        recoveryCount: this.recoveryCount,
      },
    ];
  }

  private resetForOffline(): void {
    this.phase = 'offline';
    this.scope = undefined;
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
    this.lastProactiveOpportunityId = undefined;
    this.reservedProactiveOpportunityIds.clear();
    this.finalizedSpeechEventIds.clear();
    this.recoveryCount = 0;
    this.lastQueuedLikeAt = undefined;
  }
}
