import type { LiveHostEvent } from '@aituber-onair/live-companion';
import type { OperatorQueueItem } from './operatorQueue';
import { ownsOperatorAttempt } from './operatorTurnWorker';
import {
  transitionStoredTurn,
  type TurnEnvelopeV2,
} from './turnEnvelope';

export type GenerationFailureReason =
  | 'generation_auth_failed'
  | 'generation_truncated'
  | 'generation_failed';

export type CapturedGenerationFailure = {
  reason: GenerationFailureReason;
  error: string;
  retryable: boolean;
};

export function classifyOperatorGenerationFailure(
  error: unknown,
): CapturedGenerationFailure {
  const errorMessage =
    error instanceof Error ? error.message.slice(0, 240) : 'chat_failed';
  const reason: GenerationFailureReason =
    /\b401\b|unauthori[sz]ed|api.?key|credential|authorization/i.test(
      errorMessage,
    )
      ? 'generation_auth_failed'
      : /truncated|continuation/i.test(errorMessage)
        ? 'generation_truncated'
        : 'generation_failed';
  return {
    reason,
    error: errorMessage,
    retryable:
      reason !== 'generation_auth_failed' &&
      reason !== 'generation_truncated',
  };
}

export type OperatorPreparationRecoveryPorts = {
  listQueue: () => Promise<OperatorQueueItem[]>;
  mutateQueue: (
    eventId: string,
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  recoverRuntime: () => void;
  wait: (ms: number) => Promise<void>;
  emitRuntimeEvent: (event: Record<string, unknown>) => void;
  dispatchLiveHostEvent: (event: LiveHostEvent) => unknown;
  incrementStaleCallbacks: () => void;
  incrementCoordinatorRecoveries: () => void;
};

export type OperatorPreparationRecoveryResult = {
  status: 'retrying' | 'failed' | 'stale' | 'ignored';
  reason: string;
};

function generationTurn(item: OperatorQueueItem) {
  return {
    eventId: item.eventId,
    kind: item.source.includes('quiet-room')
      ? ('proactive' as const)
      : ('viewer' as const),
    priority: 'normal' as const,
    createdAt: item.createdAt,
    targetViewerId: item.viewerId,
  };
}

function releaseGeneration(
  item: OperatorQueueItem,
  at: number,
  ports: OperatorPreparationRecoveryPorts,
): void {
  ports.dispatchLiveHostEvent({
    type: 'generation',
    at,
    eventId: item.eventId,
    stage: 'failed',
    turn: generationTurn(item),
  });
  ports.incrementCoordinatorRecoveries();
}

function projectFailedTurn(
  item: OperatorQueueItem,
  turns: Map<string, TurnEnvelopeV2>,
  at: number,
  reason: string,
  emitRuntimeEvent: OperatorPreparationRecoveryPorts['emitRuntimeEvent'],
): void {
  try {
    transitionStoredTurn(
      turns,
      item.eventId,
      item.attemptId,
      'failed',
      at,
      reason,
    );
  } catch (error) {
    emitRuntimeEvent({
      eventId: item.eventId,
      attemptId: item.attemptId,
      stage: 'turn_projection_failed',
      at,
      reason: error instanceof Error ? error.message : String(error),
      durableState: 'failed',
    });
  }
}

function ownsPreparingAttempt(
  current: OperatorQueueItem | undefined,
  item: OperatorQueueItem,
  ownerId: string,
): boolean {
  return ownsOperatorAttempt(current, {
    eventId: item.eventId,
    attemptId: item.attemptId,
    ownerId,
    status: 'preparing',
  });
}

function recordStaleCallback(
  item: OperatorQueueItem,
  at: number,
  reason: string,
  ports: OperatorPreparationRecoveryPorts,
): OperatorPreparationRecoveryResult {
  ports.incrementStaleCallbacks();
  ports.emitRuntimeEvent({
    eventId: item.eventId,
    attemptId: item.attemptId,
    stage: 'stale_callback',
    at,
    reason,
  });
  return { status: 'stale', reason };
}

function classifyMutationRejection(
  item: OperatorQueueItem,
  at: number,
  error: unknown,
  ports: OperatorPreparationRecoveryPorts,
): OperatorPreparationRecoveryResult | undefined {
  const reason = error instanceof Error ? error.message : String(error);
  if (/stale queue .* attempt|queue lease owner mismatch/i.test(reason)) {
    return recordStaleCallback(item, at, reason, ports);
  }
  if (/not found|deleted/i.test(reason)) {
    return { status: 'ignored', reason };
  }
  return undefined;
}

export async function recoverOperatorPreparation(
  input: {
    item: OperatorQueueItem;
    ownerId: string;
    turns: Map<string, TurnEnvelopeV2>;
    failure:
      | {
          kind: 'no-draft';
          chatAccepted: boolean;
          captured?: CapturedGenerationFailure;
        }
      | { kind: 'exception'; error: unknown };
    now?: () => number;
    retryDelayMs?: number;
  },
  ports: OperatorPreparationRecoveryPorts,
): Promise<OperatorPreparationRecoveryResult> {
  const at = (input.now ?? Date.now)();
  const { item, ownerId } = input;
  const attemptClaim = {
    attemptId: item.attemptId,
    ownerId,
  };

  if (input.failure.kind === 'exception') {
    const error =
      input.failure.error instanceof Error
        ? input.failure.error.message
        : String(input.failure.error);
    if (/stale queue .* attempt|queue lease owner mismatch/i.test(error)) {
      return recordStaleCallback(item, at, error, ports);
    }
    if (/not found|deleted/i.test(error)) {
      return { status: 'ignored', reason: error };
    }

    const reason = 'operator_prepare_failed';
    ports.emitRuntimeEvent({
      eventId: item.eventId,
      attemptId: item.attemptId,
      stage: 'failed',
      at,
      reason,
      error,
    });
    const current = (await ports.listQueue().catch(() => [])).find(
      (candidate) => candidate.eventId === item.eventId,
    );
    if (!ownsPreparingAttempt(current, item, ownerId)) {
      return { status: 'ignored', reason: 'stale_or_unowned_attempt' };
    }
    try {
      await ports.mutateQueue(item.eventId, 'fail', {
        ...attemptClaim,
        reason,
      });
    } catch (mutationError) {
      const rejection = classifyMutationRejection(
        item,
        at,
        mutationError,
        ports,
      );
      if (rejection) return rejection;
      throw mutationError;
    }
    projectFailedTurn(item, input.turns, at, reason, ports.emitRuntimeEvent);
    releaseGeneration(item, at, ports);
    return { status: 'failed', reason };
  }

  const current = (await ports.listQueue()).find(
    (candidate) => candidate.eventId === item.eventId,
  );
  if (!ownsPreparingAttempt(current, item, ownerId)) {
    return { status: 'ignored', reason: 'stale_or_unowned_attempt' };
  }

  const reason =
    input.failure.captured?.reason ??
    (input.failure.chatAccepted
      ? 'generation_completed_without_draft'
      : 'generation_core_rejected');
  ports.emitRuntimeEvent({
    eventId: item.eventId,
    attemptId: item.attemptId,
    stage: 'failed',
    at,
    reason,
    error: input.failure.captured?.error,
  });

  if (input.failure.captured && !input.failure.captured.retryable) {
    await ports.mutateQueue(item.eventId, 'fail', {
      ...attemptClaim,
      reason,
    });
    projectFailedTurn(item, input.turns, at, reason, ports.emitRuntimeEvent);
    releaseGeneration(item, at, ports);
    return { status: 'failed', reason };
  }

  ports.recoverRuntime();
  await ports.wait(input.retryDelayMs ?? 750);
  // The original attempt claim is deliberately sent after the delay. The
  // queue runtime rechecks it atomically, so a newer attempt cannot be reset.
  await ports.mutateQueue(item.eventId, 'retry', {
    ...attemptClaim,
    reason,
  });
  projectFailedTurn(item, input.turns, at, reason, ports.emitRuntimeEvent);
  releaseGeneration(item, at, ports);
  return { status: 'retrying', reason };
}
