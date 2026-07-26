import { describe, expect, it } from 'vitest';
import { LiveHostCoordinator } from '../src/index.js';

describe('LiveHostCoordinator', () => {
  it('queues audience messages and interrupts only proactive speech', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'quiet-candidate',
      at: 120_000,
      eventId: 'proactive-1',
      source: 'memory',
      prompt: 'Say something brief.',
      busy: false,
    });
    coordinator.dispatch({
      type: 'generation',
      at: 121_000,
      eventId: 'proactive-1',
      stage: 'completed',
      turn: {
        eventId: 'proactive-1',
        kind: 'proactive',
        priority: 'low',
        createdAt: 120_000,
        proactiveSource: 'memory',
      },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 122_000,
      eventId: 'proactive-1',
      stage: 'started',
      beatIndex: 0,
      interruptibleAfter: true,
    });

    const decisions = coordinator.dispatch({
      type: 'audience-message',
      at: 123_000,
      eventId: 'comment-1',
      viewerId: 'viewer-1',
    });

    expect(decisions.map((decision) => decision.kind)).toEqual([
      'interrupt',
      'queue-audience-turn',
    ]);
    expect(decisions[0]).toMatchObject({
      mode: 'beat-boundary',
      reasonCode: 'audience_interrupts_proactive',
    });
  });

  it('enforces the quiet threshold, cooldown, source rotation, and budget', () => {
    const coordinator = new LiveHostCoordinator({
      quietThresholdMs: 120_000,
      proactiveCooldownMs: 120_000,
      maxProactiveTurns: 1,
    });
    coordinator.dispatch({ type: 'stream-state', at: 1, isLive: true });
    coordinator.dispatch({
      type: 'audience-message',
      at: 10_000,
      eventId: 'comment-1',
    });
    coordinator.dispatch({
      type: 'speech',
      at: 20_000,
      eventId: 'comment-1',
      stage: 'completed',
    });

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 100_000,
        eventId: 'too-early',
        source: 'memory',
        prompt: 'No.',
        busy: false,
      })[0],
    ).toMatchObject({ reasonCode: 'quiet_threshold_not_reached' });

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 130_000,
        eventId: 'proactive-1',
        source: 'memory',
        prompt: 'One.',
        busy: false,
      })[0],
    ).toMatchObject({ kind: 'prepare-reply' });
    coordinator.dispatch({
      type: 'speech',
      at: 131_000,
      eventId: 'proactive-1',
      stage: 'completed',
    });

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 260_000,
        eventId: 'proactive-2',
        source: 'interface',
        prompt: 'Two.',
        busy: false,
      })[0],
    ).toMatchObject({ reasonCode: 'proactive_budget_exhausted' });
  });

  it('applies an operator policy update without replacing the live coordinator', () => {
    const coordinator = new LiveHostCoordinator({
      quietThresholdMs: 120_000,
      maxProactiveTurns: 1,
    });
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.updatePolicy({
      quietThresholdMs: 30_000,
      maxProactiveTurns: 3,
    });

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 30_000,
        eventId: 'operator-updated-policy',
        source: 'interface',
        prompt: 'A short proactive line.',
        busy: false,
      })[0],
    ).toMatchObject({ kind: 'prepare-reply' });
    expect(coordinator.snapshot().proactiveRemaining).toBe(3);
  });

  it('defers engagement and urgent events to a beat boundary', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'generation',
      at: 1,
      eventId: 'viewer-turn',
      stage: 'started',
      turn: {
        eventId: 'viewer-turn',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 1,
      },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 2,
      eventId: 'viewer-turn',
      stage: 'started',
    });

    expect(
      coordinator.dispatch({
        type: 'engagement',
        at: 3,
        eventId: 'gift-1',
        viewerId: 'viewer-2',
        engagementKind: 'gift',
      })[0],
    ).toMatchObject({
      kind: 'queue-audience-turn',
      reasonCode: 'engagement_deferred_to_next_beat',
    });
    expect(
      coordinator.dispatch({
        type: 'environment',
        at: 4,
        eventId: 'safety-1',
        priority: 'urgent',
      })[0],
    ).toMatchObject({
      kind: 'interrupt',
      mode: 'beat-boundary',
    });
  });

  it('admits likes at a bounded cadence while preserving higher-value engagement', () => {
    const coordinator = new LiveHostCoordinator({
      likeResponseCooldownMs: 120_000,
    });
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });

    expect(
      coordinator.dispatch({
        type: 'engagement',
        at: 1_000,
        eventId: 'like-1',
        viewerId: 'viewer-1',
        engagementKind: 'like',
      })[0],
    ).toMatchObject({ kind: 'queue-audience-turn', eventId: 'like-1' });

    expect(
      coordinator.dispatch({
        type: 'engagement',
        at: 60_000,
        eventId: 'like-2',
        viewerId: 'viewer-2',
        engagementKind: 'like',
      })[0],
    ).toMatchObject({
      kind: 'drop',
      eventId: 'like-2',
      reasonCode: 'like_response_cooldown',
    });

    expect(
      coordinator.dispatch({
        type: 'engagement',
        at: 61_000,
        eventId: 'gift-1',
        viewerId: 'viewer-2',
        engagementKind: 'gift',
      })[0],
    ).toMatchObject({ kind: 'queue-audience-turn', eventId: 'gift-1' });

    expect(
      coordinator.dispatch({
        type: 'engagement',
        at: 121_000,
        eventId: 'like-3',
        viewerId: 'viewer-3',
        engagementKind: 'like',
      })[0],
    ).toMatchObject({ kind: 'queue-audience-turn', eventId: 'like-3' });
  });

  it('takes over immediately and freezes new work until resume', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    const takeover = coordinator.dispatch({
      type: 'operator-command',
      at: 10,
      command: 'takeover',
    });
    expect(takeover[0]).toMatchObject({
      kind: 'interrupt',
      mode: 'immediate',
    });
    expect(coordinator.snapshot().phase).toBe('operator_hold');
    expect(
      coordinator.dispatch({
        type: 'audience-message',
        at: 11,
        eventId: 'blocked',
      })[0],
    ).toMatchObject({ kind: 'drop', reasonCode: 'operator_hold' });

    coordinator.dispatch({
      type: 'operator-command',
      at: 12,
      command: 'resume',
      isLive: true,
    });
    expect(coordinator.snapshot().phase).toBe('observing');
  });

  it('enters recovery with an operator attention decision', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    const decisions = coordinator.dispatch({
      type: 'runtime-fault',
      at: 1,
      eventId: 'turn-1',
      reasonCode: 'tts_failed',
    });
    expect(decisions.map((decision) => decision.kind)).toEqual([
      'enter-recovery',
      'request-operator-attention',
    ]);
    expect(decisions[0]).toMatchObject({ recoveryCount: 1, issuedAt: 1 });
    expect(decisions[1]).toMatchObject({
      severity: 'critical',
      recoveryCount: 1,
      issuedAt: 1,
    });
    expect(decisions[0].actionId).not.toBe(decisions[1].actionId);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'recovering',
      recoveryCount: 1,
    });
  });

  it('releases a failed generation without poisoning later host turns', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'generation',
      at: 1,
      eventId: 'failed-turn',
      stage: 'started',
      turn: {
        eventId: 'failed-turn',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 1,
      },
    });

    const decisions = coordinator.dispatch({
      type: 'generation',
      at: 2,
      eventId: 'failed-turn',
      stage: 'failed',
      turn: {
        eventId: 'failed-turn',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 1,
      },
    });

    expect(decisions).toMatchObject([
      {
        kind: 'request-operator-attention',
        severity: 'warning',
        reasonCode: 'generation_failed',
      },
      {
        kind: 'emit-avatar-intent',
        intent: 'observing',
        reasonCode: 'generation_failed_turn_released',
      },
    ]);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'observing',
      activeTurn: undefined,
      recoveryCount: 0,
    });

    expect(
      coordinator.dispatch({
        type: 'audience-message',
        at: 3,
        eventId: 'next-turn',
      })[0],
    ).toMatchObject({ kind: 'queue-audience-turn', eventId: 'next-turn' });
  });

  it('releases an unqueued proactive candidate without pausing the host', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'quiet-candidate',
      at: 120_000,
      eventId: 'proactive-1',
      source: 'audience',
      prompt: 'Say something brief.',
      busy: false,
    });

    expect(
      coordinator.dispatch({
        type: 'runtime-fault',
        at: 120_001,
        eventId: 'proactive-1',
        reasonCode: 'proactive_enqueue_failed',
      }),
    ).toMatchObject([{ kind: 'emit-avatar-intent', intent: 'observing' }]);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'observing',
      activeTurn: undefined,
      recoveryCount: 0,
    });
  });

  it('preserves a drafted viewer turn when a direct turn starts playback', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'generation',
      at: 1,
      eventId: 'viewer-1',
      stage: 'started',
      turn: {
        eventId: 'viewer-1',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 1,
      },
    });
    coordinator.dispatch({
      type: 'generation',
      at: 2,
      eventId: 'direct-1',
      stage: 'started',
      turn: {
        eventId: 'direct-1',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 2,
      },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 3,
      eventId: 'direct-1',
      stage: 'started',
    });
    coordinator.dispatch({
      type: 'speech',
      at: 4,
      eventId: 'direct-1',
      stage: 'completed',
    });

    expect(coordinator.snapshot()).toMatchObject({ phase: 'deliberating' });
    expect(
      coordinator.dispatch({
        type: 'speech',
        at: 5,
        eventId: 'viewer-1',
        stage: 'started',
      }),
    ).toMatchObject([{ kind: 'emit-avatar-intent', eventId: 'viewer-1' }]);
  });

  it('does not replace the speaking turn while drafting the next reply', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'generation',
      at: 1,
      eventId: 'speaking-turn',
      stage: 'started',
      turn: {
        eventId: 'speaking-turn',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 1,
      },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 2,
      eventId: 'speaking-turn',
      stage: 'started',
    });
    coordinator.dispatch({
      type: 'generation',
      at: 3,
      eventId: 'drafting-turn',
      stage: 'started',
      turn: {
        eventId: 'drafting-turn',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 3,
      },
    });

    expect(coordinator.snapshot()).toMatchObject({
      phase: 'speaking',
      activeTurn: { eventId: 'speaking-turn' },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 4,
      eventId: 'speaking-turn',
      stage: 'completed',
    });
    expect(coordinator.snapshot().phase).toBe('deliberating');
  });

  it('does not treat silent presence as audience conversation', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 1, isLive: true });
    coordinator.dispatch({
      type: 'viewer-presence',
      kind: 'join',
      at: 119_000,
      eventId: 'entry-1',
      viewer: {
        id: 'viewer-1',
        displayName: 'viewer',
        platform: 'bilibili',
      },
    });

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 120_001,
        eventId: 'proactive-1',
        source: 'audience',
        prompt: 'Generic greeting only.',
        busy: false,
      })[0],
    ).toMatchObject({ kind: 'prepare-reply' });
  });

  it('allows later proactive opportunities from the same source after cooldown', () => {
    const coordinator = new LiveHostCoordinator({
      quietThresholdMs: 0,
      proactiveCooldownMs: 100,
      maxProactiveTurns: 3,
    });
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });

    const first = coordinator.dispatch({
      type: 'quiet-candidate',
      at: 0,
      eventId: 'candidate-1',
      opportunityId: 'quiet-opportunity-1',
      source: 'empty-room-awareness',
      prompt: 'First thought.',
      busy: false,
    });
    expect(first[0]).toMatchObject({
      kind: 'prepare-reply',
      turn: {
        eventId: 'candidate-1',
        proactiveOpportunityId: 'quiet-opportunity-1',
      },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 1,
      eventId: 'candidate-1',
      stage: 'completed',
    });

    const second = coordinator.dispatch({
      type: 'quiet-candidate',
      at: 101,
      eventId: 'candidate-2',
      opportunityId: 'quiet-opportunity-2',
      source: 'empty-room-awareness',
      prompt: 'A genuinely new thought.',
      busy: false,
    });
    expect(second[0]).toMatchObject({
      kind: 'prepare-reply',
      reasonCode: 'quiet_candidate_selected',
      turn: { proactiveSource: 'empty-room-awareness' },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 102,
      eventId: 'candidate-2',
      stage: 'completed',
    });
    expect(coordinator.snapshot()).toMatchObject({
      proactiveDeliveredCount: 2,
      lastProactiveSource: 'empty-room-awareness',
      lastProactiveOpportunityId: 'quiet-opportunity-2',
    });
  });

  it('deduplicates proactive opportunities by opportunity id, not source label', () => {
    const coordinator = new LiveHostCoordinator({
      quietThresholdMs: 0,
      proactiveCooldownMs: 0,
    });
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'quiet-candidate',
      at: 1,
      eventId: 'candidate-1',
      opportunityId: 'same-opportunity',
      source: 'strategy',
      prompt: 'First attempt.',
      busy: false,
    });
    coordinator.dispatch({
      type: 'speech',
      at: 2,
      eventId: 'candidate-1',
      stage: 'completed',
    });

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 3,
        eventId: 'candidate-duplicate',
        opportunityId: 'same-opportunity',
        source: 'another-label',
        prompt: 'Duplicate attempt.',
        busy: false,
      })[0],
    ).toMatchObject({
      kind: 'drop',
      reasonCode: 'proactive_opportunity_repeated',
    });
  });

  it('serializes ready speech behind the active turn and emits executable actions', () => {
    const coordinator = new LiveHostCoordinator();
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'generation',
      at: 1,
      eventId: 'turn-a',
      stage: 'started',
      turn: {
        eventId: 'turn-a',
        kind: 'viewer',
        priority: 'normal',
        createdAt: 1,
      },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 2,
      eventId: 'turn-a',
      stage: 'started',
    });

    const queued = coordinator.dispatch({
      type: 'audience-message',
      at: 3,
      eventId: 'turn-b',
      viewerId: 'viewer-b',
      priority: 'high',
    });
    expect(queued[0]).toMatchObject({
      kind: 'queue-audience-turn',
      eventId: 'turn-b',
      turn: {
        eventId: 'turn-b',
        kind: 'viewer',
        targetViewerId: 'viewer-b',
      },
      issuedAt: 3,
    });
    expect(queued[0].actionId).toContain('turn-b');
    const queueAction = queued.find(
      (action) => action.kind === 'queue-audience-turn',
    );
    if (!queueAction) throw new Error('Expected an audience queue action');

    coordinator.dispatch({
      type: 'generation',
      at: 4,
      eventId: 'turn-b',
      stage: 'started',
      turn: queueAction.turn,
    });
    expect(
      coordinator.dispatch({
        type: 'generation',
        at: 5,
        eventId: 'turn-b',
        stage: 'completed',
        turn: queueAction.turn,
      }),
    ).toEqual([]);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'speaking',
      activeTurn: { eventId: 'turn-a' },
      readyTurnIds: ['turn-b'],
    });

    expect(
      coordinator.dispatch({
        type: 'speech',
        at: 6,
        eventId: 'turn-a',
        stage: 'completed',
      })[0],
    ).toMatchObject({
      kind: 'speak-turn',
      eventId: 'turn-b',
      reasonCode: 'next_ready_turn_after_speech',
      turn: { eventId: 'turn-b', priority: 'high' },
    });
    expect(
      coordinator.dispatch({
        type: 'speech',
        at: 6,
        eventId: 'turn-a',
        stage: 'completed',
      }),
    ).toEqual([]);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'deliberating',
      activeTurn: { eventId: 'turn-b' },
    });
  });

  it('holds an active turn until a requested beat-boundary interruption completes', () => {
    const coordinator = new LiveHostCoordinator({ quietThresholdMs: 0 });
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'quiet-candidate',
      at: 1,
      eventId: 'proactive',
      opportunityId: 'opportunity',
      source: 'strategy',
      prompt: 'Talk.',
      busy: false,
    });
    coordinator.dispatch({
      type: 'speech',
      at: 2,
      eventId: 'proactive',
      stage: 'started',
    });
    coordinator.dispatch({
      type: 'audience-message',
      at: 3,
      eventId: 'viewer-turn',
    });

    expect(
      coordinator.dispatch({
        type: 'speech',
        at: 4,
        eventId: 'proactive',
        stage: 'beat-completed',
        beatIndex: 0,
        interruptibleAfter: true,
      })[0],
    ).toMatchObject({
      kind: 'interrupt',
      mode: 'immediate',
      reasonCode: 'pending_interrupt_reached_beat_boundary',
    });
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'speaking',
      activeTurn: { eventId: 'proactive' },
    });
    coordinator.dispatch({
      type: 'speech',
      at: 5,
      eventId: 'proactive',
      stage: 'interrupted',
    });
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'deliberating',
      activeTurn: undefined,
      pendingTurnCount: 1,
    });
  });

  it('drops an unspoken proactive draft when an audience turn takes priority', () => {
    const coordinator = new LiveHostCoordinator({ quietThresholdMs: 0 });
    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'quiet-candidate',
      at: 1,
      eventId: 'proactive-draft',
      opportunityId: 'draft-opportunity',
      source: 'strategy',
      prompt: 'Draft only.',
      busy: false,
    });

    expect(
      coordinator.dispatch({
        type: 'audience-message',
        at: 2,
        eventId: 'viewer-turn',
      }),
    ).toMatchObject([
      {
        kind: 'drop',
        eventId: 'proactive-draft',
        reasonCode: 'audience_preempts_unspoken_proactive',
      },
      { kind: 'queue-audience-turn', eventId: 'viewer-turn' },
    ]);
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'deliberating',
      activeTurn: undefined,
      pendingTurnCount: 1,
    });
  });

  it('isolates coordinator state across profile and session scopes', () => {
    const coordinator = new LiveHostCoordinator({
      quietThresholdMs: 0,
      proactiveCooldownMs: 0,
    });
    const scopeA = {
      profileId: 'linglan',
      sessionId: 'session-a',
      streamId: 'stream-a',
    };
    const scopeB = {
      profileId: 'another-host',
      sessionId: 'session-b',
      streamId: 'stream-b',
    };
    coordinator.dispatch({
      type: 'stream-state',
      at: 0,
      isLive: true,
      scope: scopeA,
    });
    coordinator.dispatch({
      type: 'quiet-candidate',
      at: 1,
      eventId: 'candidate-a',
      opportunityId: 'shared-opportunity-id',
      source: 'strategy',
      prompt: 'A.',
      busy: false,
      scope: scopeA,
    });
    coordinator.dispatch({
      type: 'speech',
      at: 2,
      eventId: 'candidate-a',
      stage: 'completed',
      scope: scopeA,
    });
    expect(coordinator.snapshot().proactiveDeliveredCount).toBe(1);

    coordinator.dispatch({
      type: 'stream-state',
      at: 100,
      isLive: true,
      scope: scopeB,
    });
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'observing',
      scope: scopeB,
      proactiveDeliveredCount: 0,
      pendingTurnCount: 0,
    });
    expect(
      coordinator.dispatch({
        type: 'audience-message',
        at: 101,
        eventId: 'stale-audience-event',
        scope: scopeA,
      })[0],
    ).toMatchObject({ kind: 'drop', reasonCode: 'scope_mismatch' });
    expect(coordinator.snapshot().lastAudienceActivityAt).toBe(100);

    expect(
      coordinator.dispatch({
        type: 'quiet-candidate',
        at: 101,
        eventId: 'candidate-b',
        opportunityId: 'shared-opportunity-id',
        source: 'strategy',
        prompt: 'B.',
        busy: false,
        scope: scopeB,
      })[0],
    ).toMatchObject({
      kind: 'prepare-reply',
      scope: scopeB,
      turn: { scope: scopeB },
    });
  });
});
