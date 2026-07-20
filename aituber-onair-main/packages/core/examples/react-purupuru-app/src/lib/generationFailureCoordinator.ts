import type { LiveHostEvent } from '@aituber-onair/live-companion';
import {
  resolveSpeechOutcome,
  type SpeechDeliveryEvidence,
} from './liveHostDelivery';
import type { CapturedGenerationFailure } from './operatorPreparationRecovery';
import {
  projectSpeechTerminalOutcome,
  type SpeechTerminalProjectionPorts,
} from './speechTerminalProjection';
import type { TurnEnvelopeV2 } from './turnEnvelope';

export type GenerationFailureLifecycle = {
  eventId: string;
  attemptId?: string;
  channel: string;
  label: string;
  viewerId?: string;
  viewerName?: string;
  sourcesSeen?: string[];
  ttsStartAt?: number;
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
};

export type GenerationFailureCoordinatorPorts = SpeechTerminalProjectionPorts & {
  capturePreparationFailure: (
    eventId: string,
    failure: CapturedGenerationFailure,
  ) => void;
  retirePendingState: (eventId: string) => void;
  dispatchLiveHostEvent: (event: LiveHostEvent) => unknown;
};

export type GenerationFailureHandlingResult = {
  handled: boolean;
  eventId?: string;
  terminal: boolean;
};

/**
 * Owns callback deduplication and terminal projections for generation errors.
 * Operator preparation remains non-terminal here because its outer worker is
 * the sole durable retry/failure authority. Direct chat has no queue mutation
 * interface at all, so it cannot accidentally mutate an unrelated lease.
 */
export class GenerationFailureCoordinator {
  private readonly handledClaims = new Map<string, true>();
  private readonly maxClaims: number;

  constructor(maxClaims = 256) {
    this.maxClaims = maxClaims;
  }

  async handle(
    input: {
      eventId?: string;
      attemptId?: string;
      preparationOwned: boolean;
      failure: CapturedGenerationFailure;
      evidence: SpeechDeliveryEvidence;
      lifecycle?: GenerationFailureLifecycle;
      turns?: Map<string, TurnEnvelopeV2>;
      now?: () => number;
    },
    ports: GenerationFailureCoordinatorPorts,
  ): Promise<GenerationFailureHandlingResult> {
    const terminal = !input.preparationOwned;
    const claim = input.eventId
      ? `${input.eventId}\u0000${input.attemptId ?? ''}`
      : undefined;
    if (claim && this.handledClaims.has(claim)) {
      return { handled: false, eventId: input.eventId, terminal };
    }
    if (claim) this.rememberClaim(claim);

    const at = (input.now ?? Date.now)();
    const eventId = input.eventId;
    const lifecycle =
      eventId && input.lifecycle?.eventId === eventId
        ? input.lifecycle
        : undefined;

    if (eventId) {
      ports.retirePendingState(eventId);
      if (input.preparationOwned) {
        ports.capturePreparationFailure(eventId, input.failure);
      } else {
        const outcome = resolveSpeechOutcome({
          signal: {
            type: 'failed',
            reasonCode: input.failure.reason,
          },
          evidence: input.evidence,
        });
        await projectSpeechTerminalOutcome(
          {
            context: {
              eventId,
              attemptId: input.attemptId ?? lifecycle?.attemptId,
              viewerId: lifecycle?.viewerId,
              ttsStartAt: lifecycle?.ttsStartAt,
            },
            turns: input.turns,
            outcome,
            at,
            projectionFailureStage: 'generation_failure_projection_failed',
          },
          ports,
        );
        ports.dispatchLiveHostEvent({
          type: 'generation',
          at,
          eventId,
          stage: 'failed',
          turn: {
            eventId,
            kind: lifecycle?.channel.includes('quiet-room')
              ? 'proactive'
              : 'viewer',
            priority: lifecycle?.channel.includes('quiet-room')
              ? 'low'
              : 'normal',
            createdAt: at,
            targetViewerId: lifecycle?.viewerId,
          },
        });
      }
    }

    ports.emitRuntimeEvent({
      eventId,
      attemptId: input.attemptId,
      stage: input.preparationOwned ? 'generation_error' : 'failed',
      at,
      source: lifecycle?.channel,
      sourceLabel: lifecycle?.label,
      viewerId: lifecycle?.viewerId,
      viewerName: lifecycle?.viewerName,
      sourcesSeen: lifecycle?.sourcesSeen,
      testRunId: lifecycle?.testRunId,
      stepId: lifecycle?.stepId,
      scenarioId: lifecycle?.scenarioId,
      reason: input.failure.reason,
      error: input.failure.error,
    });

    return { handled: true, eventId, terminal };
  }

  private rememberClaim(claim: string): void {
    this.handledClaims.set(claim, true);
    while (this.handledClaims.size > Math.max(1, this.maxClaims)) {
      const oldest = this.handledClaims.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this.handledClaims.delete(oldest);
    }
  }
}
