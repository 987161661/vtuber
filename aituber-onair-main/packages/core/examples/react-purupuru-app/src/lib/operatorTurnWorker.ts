import {
  isStaleReadyReply,
  type OperatorQueueItem,
  type OperatorQueueStatus,
} from './operatorQueue';

export type OperatorTurnWorkerRuntime = {
  ownsRuntime: boolean;
  coreReady: boolean;
  scopeReady: boolean;
  coordinatorHold: boolean;
  processing: boolean;
  speaking: boolean;
  preparingTaskActive: boolean;
  speakingTaskActive: boolean;
  ownerId: string;
  scopeActivatedAt: number;
};

export type OperatorTurnWorkPlan = {
  prepare: OperatorQueueItem | null;
  staleReady: OperatorQueueItem | null;
  speak: OperatorQueueItem | null;
};

function belongsToOwner(item: OperatorQueueItem, ownerId: string): boolean {
  return !item.assignedOwnerId || item.assignedOwnerId === ownerId;
}

function enteredCurrentScope(
  item: OperatorQueueItem,
  scopeActivatedAt: number,
): boolean {
  return (
    item.createdAt >= scopeActivatedAt ||
    item.finishReason === 'lease_expired_requeued'
  );
}

export function planOperatorTurnWork(
  queue: readonly OperatorQueueItem[],
  runtime: OperatorTurnWorkerRuntime,
  now = Date.now(),
): OperatorTurnWorkPlan {
  const commonAvailable =
    runtime.ownsRuntime &&
    runtime.scopeReady &&
    !runtime.coordinatorHold &&
    !runtime.processing;

  const prepare =
    commonAvailable && runtime.coreReady && !runtime.preparingTaskActive
      ? (queue.find(
          (item) =>
            item.status === 'pending' &&
            enteredCurrentScope(item, runtime.scopeActivatedAt) &&
            belongsToOwner(item, runtime.ownerId),
        ) ?? null)
      : null;

  const speechAvailable =
    commonAvailable && !runtime.speaking && !runtime.speakingTaskActive;
  const staleReady = speechAvailable
    ? (queue.find(
        (item) =>
          isStaleReadyReply(item, now) &&
          enteredCurrentScope(item, runtime.scopeActivatedAt) &&
          belongsToOwner(item, runtime.ownerId),
      ) ?? null)
    : null;
  const speak =
    speechAvailable && !staleReady
      ? (queue.find(
          (item) =>
            item.status === 'ready' &&
            Boolean(item.preparedReply) &&
            item.createdAt >= runtime.scopeActivatedAt &&
            belongsToOwner(item, runtime.ownerId),
        ) ?? null)
      : null;

  return { prepare, staleReady, speak };
}

export function ownsOperatorAttempt(
  current: OperatorQueueItem | undefined,
  claim: {
    eventId: string;
    attemptId: string;
    ownerId: string;
    status: OperatorQueueStatus;
  },
): boolean {
  return (
    current?.eventId === claim.eventId &&
    current.attemptId === claim.attemptId &&
    current.status === claim.status &&
    current.leaseOwnerId === claim.ownerId
  );
}
