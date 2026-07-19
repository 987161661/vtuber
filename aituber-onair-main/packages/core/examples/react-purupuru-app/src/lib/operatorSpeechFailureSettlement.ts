import type { SoulOutcomeStatus } from '@aituber-onair/soul';
import type { SpeechDeliveryEvidence } from './liveHostDelivery';
import type { OperatorQueueItem } from './operatorQueue';
import {
  projectSpeechFailure,
  type SpeechFailureProjectionPorts,
} from './speechFailureProjection';
import type { TurnEnvelopeV2 } from './turnEnvelope';

export type OperatorSpeechFailurePorts = SpeechFailureProjectionPorts & {
  mutateQueue: (
    eventId: string,
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
};

export type OperatorSpeechFailureResult = {
  status: SoulOutcomeStatus;
  queueReason: string;
  outcomeReason: string;
  deliveredFraction: number;
};

export async function settleOperatorSpeechFailure(
  input: {
    item: OperatorQueueItem;
    ownerId: string;
    turns: Map<string, TurnEnvelopeV2>;
    evidence: SpeechDeliveryEvidence;
    failure:
      | { kind: 'watchdog'; reason: string }
      | { kind: 'playback'; error: string };
    now?: () => number;
  },
  ports: OperatorSpeechFailurePorts,
): Promise<OperatorSpeechFailureResult> {
  const at = (input.now ?? Date.now)();
  const { item, evidence } = input;
  const runtimeReason =
    input.failure.kind === 'playback'
      ? 'tts_playback_failed'
      : input.failure.reason;
  const playbackError =
    input.failure.kind === 'playback' ? input.failure.error : undefined;
  const queueReason = input.failure.kind === 'playback'
    ? evidence.completedBeatCount > 0
      ? 'later_beat_failed_partial_playback_preserved'
      : 'tts_first_beat_failed_after_retry'
    : input.failure.reason;

  // Durable attempt ownership is the settlement gate. No local terminal
  // projection may run when this mutation is rejected as stale.
  await ports.mutateQueue(item.eventId, 'fail', {
    attemptId: item.attemptId,
    ownerId: input.ownerId,
    reason: queueReason,
  });
  const projected = await projectSpeechFailure(
    {
      context: {
        eventId: item.eventId,
        attemptId: item.attemptId,
        source: item.source,
        sourceLabel: item.sourceLabel,
        viewerId: item.viewerId,
        viewerName: item.viewerName,
        sourcesSeen: item.sourcesSeen,
        testRunId: item.testRunId,
        stepId: item.stepId,
        scenarioId: item.scenarioId,
      },
      turns: input.turns,
      evidence,
      failure: {
        reasonCode:
          input.failure.kind === 'playback'
            ? 'tts-playback-failed'
            : input.failure.reason,
        partialReasonCode:
          input.failure.kind === 'playback'
            ? 'tts-playback-failed-after-partial-delivery'
            : undefined,
        runtimeReason,
        error: playbackError,
      },
      now: () => at,
    },
    ports,
  );

  return {
    status: projected.status,
    queueReason,
    outcomeReason: projected.outcomeReason,
    deliveredFraction: projected.deliveredFraction,
  };
}
