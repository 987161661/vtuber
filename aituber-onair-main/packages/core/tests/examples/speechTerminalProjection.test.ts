import { describe, expect, it, vi } from 'vitest';
import {
  projectUndeliveredSpeech,
  projectSpeechTerminalOutcome,
  type SpeechTerminalProjectionPorts,
} from '../../examples/react-purupuru-app/src/lib/speechTerminalProjection';
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

function readyTurns(): Map<string, TurnEnvelopeV2> {
  const pending = createTurnEnvelopeV2({
    eventId: 'event-1',
    attemptId: 'event-1:attempt:1',
    source: 'viewer-chat',
    viewerId: 'viewer-1',
    text: 'hello',
    createdAt: 1_000,
  });
  const preparing = transitionTurn(pending, 'preparing', 1_100);
  return new Map([['event-1', transitionTurn(preparing, 'ready', 1_200)]]);
}

function ports(): SpeechTerminalProjectionPorts {
  return {
    finalizeSoulOutcome: vi.fn(async () => undefined),
    commitConversationHistoryOutcome: vi.fn(),
    emitRuntimeEvent: vi.fn(),
  };
}

describe('speech terminal projection', () => {
  it('projects a cancelled turn before speech as a zero-delivery skip everywhere', async () => {
    const turns = readyTurns();
    const effects = ports();

    await projectUndeliveredSpeech(
      {
        context: {
          eventId: 'event-1',
          attemptId: 'event-1:attempt:1',
          viewerId: 'viewer-1',
        },
        turns,
        status: 'skipped',
        reasonCode: 'viewer-interaction',
        at: 2_000,
      },
      effects,
    );

    expect(turns.get('event-1')).toMatchObject({
      state: 'skipped',
      outcomeReason: 'viewer-interaction',
    });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'skipped',
      expect.objectContaining({ deliveredFraction: 0 }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'skipped',
      expect.objectContaining({ deliveredFraction: 0, ttsEndAt: 2_000 }),
    );
  });

  it('projects a completed turn consistently across stored turn, Soul, and history', async () => {
    const turns = speakingTurns();
    const effects = ports();

    await projectSpeechTerminalOutcome(
      {
        context: {
          eventId: 'event-1',
          attemptId: 'event-1:attempt:1',
          viewerId: 'viewer-1',
          ttsStartAt: 1_600,
        },
        turns,
        outcome: {
          kind: 'terminal',
          soulStatus: 'spoken',
          historyStatus: 'spoken',
          turnStatus: 'spoken',
          deliveredFraction: 1,
          reasonCode: 'tts-playback-completed',
        },
        at: 2_000,
      },
      effects,
    );

    expect(turns.get('event-1')).toMatchObject({ state: 'spoken' });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'spoken',
      expect.objectContaining({ deliveredFraction: 1 }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'spoken',
      expect.objectContaining({ viewerId: 'viewer-1', ttsEndAt: 2_000 }),
    );
  });

  it('keeps partial interruption evidence aligned across all terminal stores', async () => {
    const turns = speakingTurns();
    const effects = ports();

    await projectSpeechTerminalOutcome(
      {
        context: {
          eventId: 'event-1',
          attemptId: 'event-1:attempt:1',
          viewerId: 'viewer-1',
        },
        turns,
        outcome: {
          kind: 'terminal',
          soulStatus: 'partial',
          historyStatus: 'partial',
          turnStatus: 'skipped',
          deliveredFraction: 0.5,
          reasonCode: 'interrupted-at-beat-boundary',
        },
        at: 2_000,
      },
      effects,
    );

    expect(turns.get('event-1')).toMatchObject({
      state: 'skipped',
      outcomeReason: 'interrupted-at-beat-boundary',
    });
    expect(effects.finalizeSoulOutcome).toHaveBeenCalledWith(
      'event-1',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.5 }),
    );
    expect(effects.commitConversationHistoryOutcome).toHaveBeenCalledWith(
      'event-1',
      'partial',
      expect.objectContaining({ deliveredFraction: 0.5 }),
    );
  });
});
