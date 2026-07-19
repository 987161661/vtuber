import type { LiveHostEvent } from '@aituber-onair/live-companion';
import type { SoulOutcomeStatus } from '@aituber-onair/soul';
import {
  resolveSpeechOutcome,
  type SpeechDeliveryEvidence,
} from './liveHostDelivery';
import {
  projectSpeechTerminalOutcome,
  type SpeechTerminalContext,
  type SpeechTerminalProjectionPorts,
} from './speechTerminalProjection';
import type { TurnEnvelopeV2 } from './turnEnvelope';

export type SpeechFailureContext = SpeechTerminalContext & {
  source?: string;
  sourceLabel?: string;
  viewerName?: string;
  sourcesSeen?: string[];
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
};

export type SpeechFailureProjectionPorts = SpeechTerminalProjectionPorts & {
  emitRuntimeEvent: (event: Record<string, unknown>) => void;
  dispatchLiveHostEvent: (event: LiveHostEvent) => unknown;
  retireLocalState: (eventId: string) => void;
};

export type SpeechFailureProjectionResult = {
  status: SoulOutcomeStatus;
  outcomeReason: string;
  deliveredFraction: number;
};

/**
 * Projects a speech failure after the caller's ownership gate has succeeded.
 * Queue mutation intentionally does not exist at this seam: operator callers
 * gate durably first, while direct callers can reuse the same evidence-based
 * terminal behavior without learning queue protocol details.
 */
export async function projectSpeechFailure(
  input: {
    context: SpeechFailureContext;
    turns?: Map<string, TurnEnvelopeV2>;
    evidence: SpeechDeliveryEvidence;
    failure: {
      reasonCode: string;
      partialReasonCode?: string;
      runtimeReason: string;
      error?: string;
    };
    now?: () => number;
  },
  ports: SpeechFailureProjectionPorts,
): Promise<SpeechFailureProjectionResult> {
  const at = (input.now ?? Date.now)();
  const { context } = input;
  const outcome = resolveSpeechOutcome({
    signal: {
      type: 'failed',
      reasonCode: input.failure.reasonCode,
      partialReasonCode: input.failure.partialReasonCode,
    },
    evidence: input.evidence,
  });

  await projectSpeechTerminalOutcome(
    {
      context,
      turns: input.turns,
      outcome,
      at,
      projectionFailureStage: 'speech_failure_projection_failed',
    },
    ports,
  );

  try {
    ports.emitRuntimeEvent({
      eventId: context.eventId,
      attemptId: context.attemptId,
      testRunId: context.testRunId,
      stepId: context.stepId,
      scenarioId: context.scenarioId,
      stage: 'failed',
      at,
      source: context.source,
      sourceLabel: context.sourceLabel,
      viewerId: context.viewerId,
      viewerName: context.viewerName,
      sourcesSeen: context.sourcesSeen,
      reason: input.failure.runtimeReason,
      error: input.failure.error,
      soulOutcomeStatus: outcome.soulStatus,
      deliveredFraction: outcome.deliveredFraction,
    });
  } catch {
    // Runtime telemetry must not prevent the remaining terminal projections.
  }

  try {
    ports.dispatchLiveHostEvent({
      type: 'runtime-fault',
      at,
      eventId: context.eventId,
      reasonCode: outcome.reasonCode,
    });
  } catch (error) {
    try {
      ports.emitRuntimeEvent({
        eventId: context.eventId,
        attemptId: context.attemptId,
        stage: 'speech_failure_projection_failed',
        at,
        projection: 'host',
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Runtime telemetry must not prevent local terminal cleanup.
    }
  }

  ports.retireLocalState(context.eventId);
  return {
    status: outcome.soulStatus,
    outcomeReason: outcome.reasonCode,
    deliveredFraction: outcome.deliveredFraction,
  };
}
