import type { SoulOutcomeStatus } from '@aituber-onair/soul';
import type { ConversationDeliveryStatus } from './conversationHistory';
import type { TerminalSpeechOutcomeDecision } from './liveHostDelivery';
import {
  transitionStoredTurn,
  type TurnEnvelopeV2,
} from './turnEnvelope';

type TerminalHistoryStatus = Exclude<
  ConversationDeliveryStatus,
  'generated'
>;

export type UndeliveredSpeechOutcomeDecision = {
  kind: 'terminal';
  soulStatus: 'skipped' | 'failed';
  historyStatus: 'skipped' | 'failed';
  turnStatus: 'skipped' | 'failed';
  deliveredFraction: 0;
  reasonCode: string;
};

export type SpeechTerminalProjectionDecision =
  | TerminalSpeechOutcomeDecision
  | UndeliveredSpeechOutcomeDecision;

export type SpeechTerminalContext = {
  eventId: string;
  attemptId?: string;
  viewerId?: string;
  ttsStartAt?: number;
};

export type SpeechTerminalProjectionPorts = {
  finalizeSoulOutcome: (
    eventId: string,
    status: SoulOutcomeStatus,
    options?: { deliveredFraction?: number; reasonCode?: string },
  ) => Promise<unknown>;
  commitConversationHistoryOutcome: (
    eventId: string,
    status: TerminalHistoryStatus,
    options?: {
      viewerId?: string;
      deliveredFraction?: number;
      reasonCode?: string;
      ttsStartAt?: number;
      ttsEndAt?: number;
    },
  ) => unknown;
  emitRuntimeEvent: (event: Record<string, unknown>) => void;
};

function emitProjectionFailure(
  context: SpeechTerminalContext,
  at: number,
  projection: string,
  error: unknown,
  emit: SpeechTerminalProjectionPorts['emitRuntimeEvent'],
  stage: string,
): void {
  try {
    emit({
      eventId: context.eventId,
      attemptId: context.attemptId,
      stage,
      at,
      projection,
      reason: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Telemetry must not prevent the other terminal stores from converging.
  }
}

/**
 * Converges the durable turn, Soul reservation, and conversation history for
 * a speech result that has already been resolved from playback evidence.
 * Callers retain ownership-specific work such as queue mutations and persona
 * commits; this module keeps their shared terminal state in lockstep.
 */
export async function projectSpeechTerminalOutcome(
  input: {
    context: SpeechTerminalContext;
    turns?: Map<string, TurnEnvelopeV2>;
    outcome: SpeechTerminalProjectionDecision;
    at: number;
    projectionFailureStage?: string;
  },
  ports: SpeechTerminalProjectionPorts,
): Promise<SpeechTerminalProjectionDecision> {
  const { context, outcome, at } = input;
  const projectionFailureStage =
    input.projectionFailureStage ?? 'speech_terminal_projection_failed';

  if (input.turns && context.attemptId) {
    try {
      transitionStoredTurn(
        input.turns,
        context.eventId,
        context.attemptId,
        outcome.turnStatus,
        at,
        outcome.reasonCode,
      );
    } catch (error) {
      emitProjectionFailure(
        context,
        at,
        'turn',
        error,
        ports.emitRuntimeEvent,
        projectionFailureStage,
      );
    }
  }

  try {
    await ports.finalizeSoulOutcome(context.eventId, outcome.soulStatus, {
      deliveredFraction: outcome.deliveredFraction,
      reasonCode: outcome.reasonCode,
    });
  } catch (error) {
    emitProjectionFailure(
      context,
      at,
      'soul',
      error,
      ports.emitRuntimeEvent,
      projectionFailureStage,
    );
  }

  try {
    ports.commitConversationHistoryOutcome(
      context.eventId,
      outcome.historyStatus,
      {
        viewerId: context.viewerId,
        deliveredFraction: outcome.deliveredFraction,
        reasonCode: outcome.reasonCode,
        ttsStartAt: context.ttsStartAt,
        ttsEndAt: at,
      },
    );
  } catch (error) {
    emitProjectionFailure(
      context,
      at,
      'history',
      error,
      ports.emitRuntimeEvent,
      projectionFailureStage,
    );
  }

  return outcome;
}

/**
 * Marks a generated response that never reached playback. This is shared by
 * cancellation, expiration, and recovery paths so they cannot disagree about
 * whether zero delivered audio was skipped or failed.
 */
export function projectUndeliveredSpeech(
  input: {
    context: SpeechTerminalContext;
    turns?: Map<string, TurnEnvelopeV2>;
    status: 'skipped' | 'failed';
    reasonCode: string;
    at: number;
    projectionFailureStage?: string;
  },
  ports: SpeechTerminalProjectionPorts,
): Promise<SpeechTerminalProjectionDecision> {
  return projectSpeechTerminalOutcome(
    {
      context: input.context,
      turns: input.turns,
      outcome: {
        kind: 'terminal',
        soulStatus: input.status,
        historyStatus: input.status,
        turnStatus: input.status === 'failed' ? 'failed' : 'skipped',
        deliveredFraction: 0,
        reasonCode: input.reasonCode,
      },
      at: input.at,
      projectionFailureStage: input.projectionFailureStage,
    },
    ports,
  );
}
