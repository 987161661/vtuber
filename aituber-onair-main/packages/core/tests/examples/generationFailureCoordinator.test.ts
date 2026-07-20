import { describe, expect, it, vi } from 'vitest';
import {
  GenerationFailureCoordinator,
  type GenerationFailureCoordinatorPorts,
} from '../../examples/react-purupuru-app/src/lib/generationFailureCoordinator';
import type { TurnEnvelopeV2 } from '../../examples/react-purupuru-app/src/lib/turnEnvelope';

const noAudio = {
  beatCount: 1,
  completedBeatCount: 0,
  audioByteLength: 0,
  playbackObserved: false,
};

function ports() {
  return {
    capturePreparationFailure: vi.fn(),
    retirePendingState: vi.fn(),
    finalizeSoulOutcome: vi.fn(async () => undefined),
    commitConversationHistoryOutcome: vi.fn(),
    dispatchLiveHostEvent: vi.fn(),
    emitRuntimeEvent: vi.fn(),
  } satisfies GenerationFailureCoordinatorPorts;
}

function speakingTurn(eventId: string, attemptId: string): TurnEnvelopeV2 {
  return {
    version: 2,
    eventId,
    attemptId,
    source: 'viewer-chat',
    scope: {
      personaId: 'persona-1',
      platform: 'bilibili',
      roomId: 'room-1',
      sessionId: 'session-1',
    },
    input: 'hello',
    state: 'speaking',
    createdAt: 1_000,
    updatedAt: 1_500,
  };
}

describe('generation failure coordinator', () => {
  it('records a preparation failure without projecting a terminal delivery', async () => {
    const coordinator = new GenerationFailureCoordinator();
    const effects = ports();

    const result = await coordinator.handle(
      {
        eventId: 'event-1',
        attemptId: 'event-1:attempt:1',
        preparationOwned: true,
        failure: {
          reason: 'generation_auth_failed',
          error: 'invalid api key',
          retryable: false,
        },
        evidence: noAudio,
        lifecycle: {
          eventId: 'event-1',
          attemptId: 'event-1:attempt:1',
          channel: 'viewer-chat',
          label: 'bilibili',
          viewerId: 'viewer-1',
        },
        now: () => 2_000,
      },
      effects,
    );

    expect(result).toEqual({
      handled: true,
      eventId: 'event-1',
      terminal: false,
    });
    expect(effects.capturePreparationFailure).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ reason: 'generation_auth_failed' }),
    );
    expect(effects.commitConversationHistoryOutcome).not.toHaveBeenCalled();
    expect(effects.finalizeSoulOutcome).not.toHaveBeenCalled();
    expect(effects.dispatchLiveHostEvent).not.toHaveBeenCalled();
    expect(effects.emitRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        attemptId: 'event-1:attempt:1',
        stage: 'generation_error',
      }),
    );
  });

  it('settles a direct generation failure once without a queue mutation port', async () => {
    const coordinator = new GenerationFailureCoordinator();
    const effects = ports();
    const turns = new Map([
      ['event-1', speakingTurn('event-1', 'event-1:attempt:1')],
    ]);
    const input = {
      eventId: 'event-1',
      attemptId: 'event-1:attempt:1',
      preparationOwned: false,
      failure: {
        reason: 'generation_failed' as const,
        error: 'provider disconnected',
        retryable: true,
      },
      evidence: noAudio,
      lifecycle: {
        eventId: 'event-1',
        attemptId: 'event-1:attempt:1',
        channel: 'viewer-chat',
        label: 'bilibili',
        viewerId: 'viewer-1',
        viewerName: 'Alice',
        sourcesSeen: ['bilibili'],
        ttsStartAt: 1_500,
      },
      turns,
      now: () => 2_000,
    };

    await expect(coordinator.handle(input, effects)).resolves.toMatchObject({
      handled: true,
      terminal: true,
    });
    await expect(coordinator.handle(input, effects)).resolves.toEqual({
      handled: false,
      eventId: 'event-1',
      terminal: true,
    });
    expect(effects.retirePendingState).toHaveBeenCalledOnce();
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledOnce();
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'failed',
      expect.objectContaining({
        deliveredFraction: 0,
        reasonCode: 'generation_failed',
      }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledOnce();
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'failed',
      expect.objectContaining({
        viewerId: 'viewer-1',
        deliveredFraction: 0,
        reasonCode: 'generation_failed',
        ttsStartAt: 1_500,
        ttsEndAt: 2_000,
      }),
    );
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledOnce();
    expect(effects.emitRuntimeEvent).toHaveBeenCalledOnce();
    expect(turns.get('event-1')).toMatchObject({
      state: 'failed',
      updatedAt: 2_000,
      outcomeReason: 'generation_failed',
    });
  });

  it('does not attach a newer active lifecycle to a late event', async () => {
    const coordinator = new GenerationFailureCoordinator();
    const effects = ports();

    await coordinator.handle(
      {
        eventId: 'old-event',
        attemptId: 'old-event:attempt:1',
        preparationOwned: false,
        failure: {
          reason: 'generation_truncated',
          error: 'continuation truncated',
          retryable: false,
        },
        evidence: noAudio,
        lifecycle: {
          eventId: 'new-event',
          attemptId: 'new-event:attempt:1',
          channel: 'quiet-room',
          label: 'proactive',
          viewerId: 'wrong-viewer',
          testRunId: 'wrong-run',
        },
      },
      effects,
    );

    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'old-event',
      'failed',
      expect.objectContaining({ viewerId: undefined }),
    );
    expect(effects.emitRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'old-event',
        source: undefined,
        viewerId: undefined,
        testRunId: undefined,
      }),
    );
  });

  it('preserves partial delivery evidence for a direct continuation failure', async () => {
    const coordinator = new GenerationFailureCoordinator();
    const effects = ports();

    await coordinator.handle(
      {
        eventId: 'event-1',
        preparationOwned: false,
        failure: {
          reason: 'generation_failed',
          error: 'late continuation failed',
          retryable: true,
        },
        evidence: {
          beatCount: 4,
          completedBeatCount: 1,
          audioByteLength: 512,
          playbackObserved: true,
        },
      },
      effects,
    );

    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.25 }),
    );
  });
});
