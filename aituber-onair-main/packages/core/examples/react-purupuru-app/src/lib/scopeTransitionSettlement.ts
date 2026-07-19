import type { OperatorQueueItem } from './operatorQueue';
import {
  resolveSpeechOutcome,
  type SpeechDeliveryEvidence,
} from './liveHostDelivery';
import {
  projectSpeechTerminalOutcome,
  projectUndeliveredSpeech,
  type SpeechTerminalContext,
  type SpeechTerminalProjectionPorts,
} from './speechTerminalProjection';
import type { TurnEnvelopeV2 } from './turnEnvelope';

export type ScopeTransitionSettlementPorts = SpeechTerminalProjectionPorts & {
  mutateQueue: (
    eventId: string,
    action: 'skip' | 'fail',
    extra: { attemptId: string; ownerId: string; reason: string },
  ) => Promise<unknown>;
};

export type ScopeTransitionSettlementResult = {
  settledEventIds: Set<string>;
};

/**
 * Settles work owned by an outgoing runtime scope. Durable queue mutations
 * are attempted first, then every captured reservation converges through the
 * shared terminal projection even when an expired lease rejects that mutation.
 */
export async function settleScopeTransitionTerminals(
  input: {
    active?: SpeechTerminalContext;
    evidence: SpeechDeliveryEvidence;
    capturedEventIds: Iterable<string>;
    oldSoulEventIds: Iterable<string>;
    oldQueueItems: readonly OperatorQueueItem[];
    ownerId: string;
    turns: Map<string, TurnEnvelopeV2>;
    at: number;
  },
  ports: ScopeTransitionSettlementPorts,
): Promise<ScopeTransitionSettlementResult> {
  const activeOutcome = input.active
    ? resolveSpeechOutcome({
        signal: { type: 'interrupted', scopeTransition: true },
        evidence: input.evidence,
      })
    : undefined;
  const queueByEventId = new Map(
    input.oldQueueItems.map((item) => [item.eventId, item]),
  );
  const settledEventIds = new Set<string>([
    ...input.capturedEventIds,
    ...input.oldSoulEventIds,
    ...queueByEventId.keys(),
  ]);
  if (input.active?.eventId) settledEventIds.add(input.active.eventId);

  await Promise.allSettled(
    input.oldQueueItems.map((item) =>
      ports.mutateQueue(
        item.eventId,
        item.status === 'speaking' ? 'fail' : 'skip',
        {
          attemptId: item.attemptId,
          ownerId: input.ownerId,
          reason: 'scope_changed_before_delivery',
        },
      ),
    ),
  );

  await Promise.all(
    [...settledEventIds].map(async (eventId) => {
      const item = queueByEventId.get(eventId);
      if (eventId === input.active?.eventId && activeOutcome) {
        await projectSpeechTerminalOutcome(
          {
            context: input.active,
            turns: input.turns,
            outcome: activeOutcome,
            at: input.at,
            projectionFailureStage: 'scope_transition_projection_failed',
          },
          ports,
        );
        return;
      }

      const stored = input.turns.get(eventId);
      await projectUndeliveredSpeech(
        {
          context: {
            eventId,
            attemptId: item?.attemptId ?? stored?.attemptId,
            viewerId: item?.viewerId ?? stored?.viewerId,
          },
          turns: input.turns,
          status: item && item.status !== 'speaking' ? 'skipped' : 'failed',
          reasonCode: 'scope-switch-before-delivery',
          at: input.at,
          projectionFailureStage: 'scope_transition_projection_failed',
        },
        ports,
      );
    }),
  );

  return { settledEventIds };
}
