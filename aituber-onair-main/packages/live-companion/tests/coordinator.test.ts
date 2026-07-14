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
    expect(coordinator.snapshot()).toMatchObject({
      phase: 'recovering',
      recoveryCount: 1,
    });
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
});
