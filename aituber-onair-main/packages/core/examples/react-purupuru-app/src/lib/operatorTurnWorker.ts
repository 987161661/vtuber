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

const MAX_RECONNECT_PENDING_AGE_MS = 15 * 60_000;

export function coordinatorGenerationStagesForReadyTurn(
  activeTurnEventId: string | undefined,
  readyEventId: string,
): Array<'started' | 'completed'> {
  return activeTurnEventId === readyEventId
    ? ['completed']
    : ['started', 'completed'];
}

function belongsToOwner(item: OperatorQueueItem, ownerId: string): boolean {
  return !item.assignedOwnerId || item.assignedOwnerId === ownerId;
}

function enteredCurrentScope(
  item: OperatorQueueItem,
  scopeActivatedAt: number,
  now: number,
): boolean {
  return (
    item.createdAt >= scopeActivatedAt ||
    (item.status === 'ready' &&
      (item.preparedAt ?? item.updatedAt) >= scopeActivatedAt) ||
    item.finishReason === 'lease_expired_requeued' ||
    (item.status === 'pending' &&
      Boolean(item.scope) &&
      now - Math.max(item.createdAt, item.updatedAt) <=
        MAX_RECONNECT_PENDING_AGE_MS)
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
            enteredCurrentScope(item, runtime.scopeActivatedAt, now) &&
            belongsToOwner(item, runtime.ownerId),
        ) ?? null)
      : null;

  const speechAvailable =
    commonAvailable && !runtime.speaking && !runtime.speakingTaskActive;
  const staleReady = speechAvailable
    ? (queue.find(
        (item) =>
          isStaleReadyReply(item, now) &&
          (enteredCurrentScope(item, runtime.scopeActivatedAt, now) ||
            Boolean(item.scope)) &&
          belongsToOwner(item, runtime.ownerId),
      ) ?? null)
    : null;
  const speak =
    speechAvailable && !staleReady
      ? (queue.find(
          (item) =>
            item.status === 'ready' &&
            Boolean(item.preparedReply) &&
            enteredCurrentScope(item, runtime.scopeActivatedAt, now) &&
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
