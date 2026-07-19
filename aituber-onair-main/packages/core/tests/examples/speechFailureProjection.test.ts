import { describe, expect, it, vi } from 'vitest';
import {
  projectSpeechFailure,
  type SpeechFailureProjectionPorts,
} from '../../examples/react-purupuru-app/src/lib/speechFailureProjection';
import {
  createTurnEnvelopeV2,
  transitionTurn,
  type TurnEnvelopeV2,
} from '../../examples/react-purupuru-app/src/lib/turnEnvelope';

function speakingTurns(): Map<string, TurnEnvelopeV2> {
  const pending = createTurnEnvelopeV2({
    eventId: 'event-1',
    attemptId: 'event-1:attempt:1',
    source: 'viewer-chat',
    viewerId: 'viewer-1',
    text: 'hello',
    createdAt: 1_000,
  });
  const preparing = transitionTurn(pending, 'preparing', 1_100);
  const ready = transitionTurn(preparing, 'ready', 1_200);
  return new Map([
    ['event-1', transitionTurn(ready, 'speaking', 1_500)],
  ]);
}

function ports() {
  const effects: SpeechFailureProjectionPorts = {
    finalizeSoulOutcome: vi.fn(async () => undefined),
    commitConversationHistoryOutcome: vi.fn(),
    emitRuntimeEvent: vi.fn(),
    dispatchLiveHostEvent: vi.fn(),
    retireLocalState: vi.fn(),
  };
  return effects;
}

describe('speech failure projection', () => {
  it('projects a first-beat failure through every terminal surface', async () => {
    const turns = speakingTurns();
    const effects = ports();

    const result = await projectSpeechFailure(
      {
        context: {
          eventId: 'event-1',
          attemptId: 'event-1:attempt:1',
          source: 'viewer-chat',
          sourceLabel: 'bilibili',
          viewerId: 'viewer-1',
          viewerName: 'Alice',
        },
        turns,
        evidence: {
          beatCount: 2,
          completedBeatCount: 0,
          audioByteLength: 0,
          playbackObserved: false,
        },
        failure: {
          reasonCode: 'tts-playback-failed',
          partialReasonCode: 'tts-playback-failed-after-partial-delivery',
          runtimeReason: 'tts_playback_failed',
          error: 'voice service failed',
        },
        now: () => 2_000,
      },
      effects,
    );

    expect(result).toEqual({
      status: 'failed',
      outcomeReason: 'tts-playback-failed',
      deliveredFraction: 0,
    });
    expect(turns.get('event-1')).toMatchObject({
      state: 'failed',
      outcomeReason: 'tts-playback-failed',
    });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'failed',
      expect.objectContaining({ deliveredFraction: 0 }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'failed',
      expect.objectContaining({
        viewerId: 'viewer-1',
        ttsEndAt: 2_000,
      }),
    );
    expect(effects.dispatchLiveHostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'runtime-fault',
        eventId: 'event-1',
        reasonCode: 'tts-playback-failed',
      }),
    );
    expect(effects.retireLocalState).toHaveBeenCalledWith('event-1');
  });

  it('preserves completed beats as a partial delivery', async () => {
    const effects = ports();

    const result = await projectSpeechFailure(
      {
        context: { eventId: 'event-1', viewerId: 'viewer-1' },
        evidence: {
          beatCount: 4,
          completedBeatCount: 1,
          audioByteLength: 512,
          playbackObserved: true,
        },
        failure: {
          reasonCode: 'direct-chat-tts-failed',
          partialReasonCode: 'direct-chat-tts-failed-after-partial-delivery',
          runtimeReason: 'direct_chat_tts_failed',
        },
      },
      effects,
    );

    expect(result).toMatchObject({
      status: 'partial',
      outcomeReason: 'direct-chat-tts-failed-after-partial-delivery',
      deliveredFraction: 0.25,
    });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.25 }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.25 }),
    );
  });

  it('isolates projection failures and still retires local state', async () => {
    const effects = ports();
    effects.finalizeSoulOutcome = vi.fn(async () => {
      throw new Error('soul unavailable');
    });
    effects.commitConversationHistoryOutcome = vi.fn(() => {
      throw new Error('history unavailable');
    });
    effects.dispatchLiveHostEvent = vi.fn(() => {
      throw new Error('host unavailable');
    });

    await expect(
      projectSpeechFailure(
        {
          context: { eventId: 'event-1' },
          evidence: {
            beatCount: 1,
            completedBeatCount: 0,
            audioByteLength: 0,
            playbackObserved: false,
          },
          failure: {
            reasonCode: 'direct-chat-tts-failed',
            runtimeReason: 'direct_chat_tts_failed',
          },
        },
        effects,
      ),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(effects.emitRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'speech_failure_projection_failed',
        projection: 'soul',
      }),
    );
    expect(effects.emitRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'speech_failure_projection_failed',
        projection: 'history',
      }),
    );
    expect(effects.retireLocalState).toHaveBeenCalledWith('event-1');
  });
});
