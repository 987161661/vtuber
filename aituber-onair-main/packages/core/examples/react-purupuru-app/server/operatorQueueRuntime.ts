import { createHash } from 'node:crypto';
import type {
  InteractionAccountingEffect,
  OperatorQueueItem,
  OperatorQueueStatus,
  PreparedSpeechPlan,
} from '../src/lib/operatorQueue';
import { wouldRegressCompletedDelivery } from '../src/lib/operatorQueue';
import type { SerializedJsonStore } from './serializedJsonStore';

export type OperatorQueueRuntimeStore = SerializedJsonStore<
  OperatorQueueItem[]
>;

export type OperatorQueueRuntime = ReturnType<
  typeof createOperatorQueueRuntime
>;

export type OperatorQueueCommand =
  | {
      action: 'ingest';
      item: OperatorQueueItem;
    }
  | {
      action: 'delete';
      eventId: string;
    }
  | {
      action: 'move';
      eventId: string;
      order: number;
    }
  | {
      action: 'edit-reply';
      eventId: string;
      reply: string;
    }
  | {
      action: 'skip';
      eventId: string;
      reason?: string;
      attemptId?: string;
      ownerId?: string;
    }
  | {
      action: 'fail';
      eventId: string;
      reason?: string;
      attemptId?: string;
      ownerId?: string;
    }
  | {
      action: 'retry';
      eventId: string;
      reason?: string;
      attemptId?: string;
      ownerId?: string;
    }
  | {
      action: 'claim-interaction-accounting';
      eventId: string;
      attemptId: string;
      ownerId: string;
      claimId: string;
      effects: InteractionAccountingEffect[];
    }
  | {
      action: 'record-interaction-metrics';
      eventId: string;
      claimId: string;
      relationshipVisitDelta: number;
      otherViewerRelationshipMutated: boolean;
    }
  | {
      action: 'consume-fault';
      eventId: string;
    }
  | {
      action: 'beat-progress';
      eventId: string;
      attemptId: string;
      ownerId: string;
      beatCount: number;
      completedBeatCount: number;
      byteLength: number;
      replaceBeatPlan?: boolean;
    }
  | {
      action: 'claim-prepare';
      eventId: string;
      ownerId: string;
    }
  | {
      action: 'renew-lease';
      eventId: string;
      attemptId: string;
      ownerId: string;
    }
  | {
      action: 'ready';
      eventId: string;
      attemptId: string;
      reply?: string;
      speechPlan?: PreparedSpeechPlan;
      skills?: string[];
    }
  | {
      action: 'claim-speak';
      eventId: string;
      attemptId: string;
      ownerId: string;
    }
  | {
      action: 'done';
      eventId: string;
      attemptId: string;
      ownerId: string;
      beatCount: number;
      completedBeatCount: number;
      audioByteLength: number;
      reason?: string;
    };

/**
 * Owns the durable state invariants of the operator queue. HTTP request
 * parsing remains in the Vite plugin; restart recovery, lease recovery,
 * ordering and persistence belong here so every transport sees the same
 * queue semantics.
 */
export function createOperatorQueueRuntime(options: {
  initialItems?: Iterable<readonly [string, OperatorQueueItem]>;
  store: OperatorQueueRuntimeStore;
  now?: () => number;
  prepareLeaseMs?: number;
  speakLeaseMs?: number;
  maxRetries?: number;
  onPersistenceError?: (error: unknown) => void;
  onRestoreError?: (error: unknown) => void;
}) {
  const items = new Map(options.initialItems);
  const now = options.now ?? Date.now;
  const prepareLeaseMs = options.prepareLeaseMs ?? 120_000;
  const speakLeaseMs = options.speakLeaseMs ?? 60_000;
  const maxRetries = options.maxRetries ?? 4;
  let persistenceTail: Promise<void> = Promise.resolve();

  function orderedItems(releaseExpired = true): OperatorQueueItem[] {
    if (releaseExpired) releaseExpiredLeases();
    return [...items.values()]
      .filter((item) => item.status !== 'deleted')
      .sort(
        (left, right) =>
          left.order - right.order || left.createdAt - right.createdAt,
      );
  }

  function snapshot(releaseExpired = true): OperatorQueueItem[] {
    return structuredClone(orderedItems(releaseExpired));
  }

  function get(eventId: string): OperatorQueueItem | undefined {
    const item = items.get(eventId);
    return item ? structuredClone(item) : undefined;
  }

  function normalizeOrder(): void {
    orderedItems(false).forEach((item, index) => {
      item.order = index;
    });
  }

  async function restore(): Promise<void> {
    try {
      const saved = await options.store.read();
      if (!saved) return;
      items.clear();
      for (const item of saved) {
        if (!item?.eventId || item.status === 'deleted') continue;
        item.turnVersion = 2;
        item.attemptId =
          item.attemptId ||
          `${item.eventId}:attempt:${Math.max(1, (item.retryCount || 0) + 1)}`;
        // Browser audio and generation work cannot survive a Vite restart.
        if (item.status === 'speaking') {
          item.status = item.preparedReply ? 'ready' : 'pending';
        }
        if (item.status === 'preparing') item.status = 'pending';
        item.leaseOwnerId = undefined;
        item.leaseExpiresAt = undefined;
        items.set(item.eventId, item);
      }
      normalizeOrder();
    } catch (error) {
      options.onRestoreError?.(error);
    }
  }

  async function persist(): Promise<void> {
    await options.store.write(orderedItems(false));
  }

  function schedulePersistence(): Promise<void> {
    persistenceTail = persistenceTail
      .then(() => persist())
      .catch((error) => {
        options.onPersistenceError?.(error);
      });
    return persistenceTail;
  }

  function releaseExpiredLeases(at = now()): boolean {
    let changed = false;
    for (const item of items.values()) {
      if (!isLeasedStatus(item.status) || !isExpired(item, at)) continue;
      item.status = item.preparedReply ? 'ready' : 'pending';
      item.finishReason = 'lease_expired_requeued';
      item.leaseOwnerId = undefined;
      item.leaseExpiresAt = undefined;
      item.updatedAt = at;
      changed = true;
    }
    if (changed) void schedulePersistence();
    return changed;
  }

  async function execute(
    command: OperatorQueueCommand,
  ): Promise<OperatorQueueItem> {
    const at = now();
    if (command.action === 'ingest') {
      const existing = items.get(command.item.eventId);
      if (!existing) {
        items.set(command.item.eventId, command.item);
        normalizeOrder();
        await persist();
        return command.item;
      }
      existing.roomContext = mergeRoomContext(
        existing.roomContext,
        command.item.roomContext,
      );
      existing.sourcesSeen = [
        ...new Set([...existing.sourcesSeen, ...command.item.sourcesSeen]),
      ];
      await persist();
      return existing;
    }
    const item = items.get(command.eventId);
    if (!item) throw new Error('queue item not found');
    if (wouldRegressCompletedDelivery(item, command.action)) {
      throw new Error('completed delivery is immutable');
    }

    if (command.action === 'delete') {
      item.status = 'deleted';
    } else if (command.action === 'move') {
      const visible = orderedItems().filter(
        (entry) => entry.eventId !== command.eventId,
      );
      const target = Number.isFinite(command.order)
        ? Math.max(0, Math.min(visible.length, command.order))
        : visible.length;
      visible.splice(target, 0, item);
      visible.forEach((entry, index) => {
        entry.order = index;
      });
    } else if (command.action === 'edit-reply') {
      const reply = command.reply.trim();
      if (!reply || reply.length > 3_000) {
        throw new Error('invalid prepared reply');
      }
      item.preparedReply = reply;
      item.status = 'ready';
    } else if (command.action === 'skip') {
      assertLeasedMutationClaim(item, command, 'skip');
      item.status = 'skipped';
      item.skipReason = command.reason?.trim() || 'llm_no_reply';
      item.finishReason = item.skipReason;
      item.leaseOwnerId = undefined;
      item.leaseExpiresAt = undefined;
    } else if (command.action === 'fail') {
      assertLeasedMutationClaim(item, command, 'failure');
      item.status = 'failed';
      item.finishReason = command.reason?.trim() || 'runtime_failed';
      item.leaseOwnerId = undefined;
      item.leaseExpiresAt = undefined;
    } else if (command.action === 'retry') {
      assertLeasedMutationClaim(item, command, 'retry');
      item.retryCount = (item.retryCount || 0) + 1;
      item.attemptId = `${item.eventId}:attempt:${item.retryCount + 1}`;
      item.leaseOwnerId = undefined;
      item.leaseExpiresAt = undefined;
      if (item.status === 'speaking' && (item.completedBeatCount || 0) > 0) {
        item.status = 'failed';
        item.finishReason = 'partial_playback_not_retried';
      } else if (item.retryCount > maxRetries) {
        item.status = 'failed';
        item.finishReason = command.reason ?? 'retry_limit_exceeded';
      } else if (['preparing', 'speaking', 'ready'].includes(item.status)) {
        item.status = item.preparedReply ? 'ready' : 'pending';
      }
    } else if (command.action === 'claim-interaction-accounting') {
      if (!command.attemptId || command.attemptId !== item.attemptId) {
        throw new Error('stale queue accounting attempt');
      }
      if (!command.ownerId || command.ownerId !== item.leaseOwnerId) {
        throw new Error('queue lease owner mismatch');
      }
      if (item.status !== 'preparing') {
        throw new Error('queue item is not preparing');
      }
      if (!command.claimId) throw new Error('accounting claim id is required');
      if (!command.effects.length) {
        throw new Error('accounting effects are required');
      }
      item.interactionAccounting ??= {};
      for (const effect of command.effects) {
        if (item.interactionAccounting[effect]) continue;
        item.interactionAccounting[effect] = {
          claimId: command.claimId,
          attemptId: command.attemptId,
          ownerId: command.ownerId,
          claimedAt: at,
        };
        if (effect === 'relationship') item.interactionObservedAt = at;
        if (effect === 'engagement') item.engagementAppliedAt = at;
      }
    } else if (command.action === 'record-interaction-metrics') {
      const claim = item.interactionAccounting?.relationship;
      if (!claim || claim.claimId !== command.claimId) {
        throw new Error('relationship accounting claim mismatch');
      }
      item.relationshipVisitDelta = command.relationshipVisitDelta || 0;
      item.otherViewerRelationshipMutated =
        command.otherViewerRelationshipMutated;
    } else if (command.action === 'consume-fault') {
      if (!item.testRunId) throw new Error('faults are test-only');
      item.faultConsumed = true;
    } else if (command.action === 'beat-progress') {
      if (item.status !== 'speaking') {
        throw new Error('queue item has no active speech');
      }
      assertLeasedMutationClaim(item, command, 'speech progress');
      const reportedBeatCount = Math.max(1, command.beatCount || 0);
      const reportedCompletedBeats = Math.max(
        0,
        command.completedBeatCount || 0,
      );
      item.beatCount = command.replaceBeatPlan
        ? reportedBeatCount
        : Math.max(item.beatCount || 0, reportedBeatCount);
      item.completedBeatCount = command.replaceBeatPlan
        ? Math.min(reportedCompletedBeats, item.beatCount)
        : Math.max(item.completedBeatCount || 0, reportedCompletedBeats);
      item.audioByteLength =
        (item.audioByteLength || 0) + Math.max(0, command.byteLength || 0);
    } else if (command.action === 'claim-prepare') {
      releaseExpiredLeases(at);
      if (item.status !== 'pending') {
        throw new Error('queue item is not pending');
      }
      assertOwnerCanClaim(item, command.ownerId);
      item.status = 'preparing';
      item.leaseOwnerId = command.ownerId;
      item.leaseExpiresAt = at + prepareLeaseMs;
    } else if (command.action === 'renew-lease') {
      if (!isLeasedStatus(item.status)) {
        throw new Error('queue item has no renewable lease');
      }
      assertLeasedMutationClaim(item, command, 'lease');
      item.leaseExpiresAt =
        at + (item.status === 'speaking' ? speakLeaseMs : prepareLeaseMs);
    } else if (command.action === 'ready') {
      if (!command.attemptId || command.attemptId !== item.attemptId) {
        throw new Error('stale queue generation attempt');
      }
      if (command.reply !== undefined) {
        item.preparedReply = command.reply.trim();
      }
      item.preparedSpeechPlan = command.speechPlan;
      item.skills = command.skills ?? item.skills;
      // A late generation callback must not regress active or completed work.
      if (!['speaking', 'done'].includes(item.status)) {
        item.status = item.preparedReply ? 'ready' : 'pending';
      }
      if (item.preparedReply) item.preparedAt = at;
      item.leaseOwnerId = undefined;
      item.leaseExpiresAt = undefined;
      resetDeliveryEvidence(item);
    } else if (command.action === 'claim-speak') {
      releaseExpiredLeases(at);
      if (item.status !== 'ready' || !item.preparedReply) {
        throw new Error('queue item is not ready');
      }
      if (!command.attemptId || command.attemptId !== item.attemptId) {
        throw new Error('stale queue speech attempt');
      }
      assertOwnerCanClaim(item, command.ownerId);
      if (
        orderedItems(false).some(
          (entry) =>
            entry.eventId !== command.eventId && entry.status === 'speaking',
        )
      ) {
        throw new Error('another queue item is already speaking');
      }
      item.status = 'speaking';
      item.leaseOwnerId = command.ownerId;
      item.leaseExpiresAt = at + speakLeaseMs;
    } else if (command.action === 'done') {
      if (item.status !== 'speaking') {
        throw new Error('queue item has no active speech');
      }
      assertLeasedMutationClaim(item, command, 'speech completion');
      const beatCount = Math.max(item.beatCount || 0, command.beatCount || 0);
      const completedBeatCount = Math.max(
        item.completedBeatCount || 0,
        command.completedBeatCount || 0,
      );
      const audioByteLength = Math.max(
        item.audioByteLength || 0,
        command.audioByteLength || 0,
      );
      if (
        beatCount <= 0 ||
        completedBeatCount < beatCount ||
        audioByteLength <= 0
      ) {
        throw new Error('cannot finish without complete audio evidence');
      }
      item.beatCount = beatCount;
      item.completedBeatCount = completedBeatCount;
      item.audioByteLength = audioByteLength;
      item.status = 'done';
      item.doneAt = at;
      item.finishReason = command.reason ?? 'played';
      item.leaseOwnerId = undefined;
      item.leaseExpiresAt = undefined;
    }

    item.updatedAt = at;
    normalizeOrder();
    await persist();
    return item;
  }

  async function observeControlPanel(): Promise<number> {
    const observedAt = now();
    let changed = 0;
    for (const item of items.values()) {
      if (!item.testRunId || item.panelObservedAt) continue;
      item.panelObservedAt = observedAt;
      changed += 1;
    }
    if (changed) await persist();
    return changed;
  }

  async function removeTestRun(testRunId: string): Promise<number> {
    let removed = 0;
    for (const [eventId, item] of items) {
      if (item.testRunId !== testRunId) continue;
      items.delete(eventId);
      removed += 1;
    }
    if (removed) {
      normalizeOrder();
      await persist();
    }
    return removed;
  }

  return {
    execute,
    flushPersistence: () => persistenceTail,
    get,
    normalizeOrder,
    observeControlPanel,
    persist,
    releaseExpiredLeases,
    removeTestRun,
    restore,
    schedulePersistence,
    snapshot,
  };
}

function mergeRoomContext(
  current?: OperatorQueueItem['roomContext'],
  incoming?: OperatorQueueItem['roomContext'],
): OperatorQueueItem['roomContext'] {
  if (!current) return incoming;
  if (!incoming) return current;
  const rank = { calm: 0, friction: 1, escalating: 2, attack: 3 } as const;
  const stronger =
    rank[incoming.conflictLevel] > rank[current.conflictLevel]
      ? incoming
      : current;
  const samples = new Map(
    [...current.samples, ...incoming.samples].map((sample) => [
      sample.id,
      sample,
    ]),
  );
  const laneKeys = new Set([
    ...Object.keys(current.laneCounts),
    ...Object.keys(incoming.laneCounts),
  ]);
  return {
    ...stronger,
    totalCount: Math.max(current.totalCount, incoming.totalCount),
    participantCount: Math.max(
      current.participantCount,
      incoming.participantCount,
    ),
    mergedCount: Math.max(current.mergedCount, incoming.mergedCount),
    catchup: current.catchup || incoming.catchup,
    laneCounts: Object.fromEntries(
      [...laneKeys].map((lane) => [
        lane,
        Math.max(current.laneCounts[lane] ?? 0, incoming.laneCounts[lane] ?? 0),
      ]),
    ),
    samples: [...samples.values()].slice(-12),
    ambiguous: current.ambiguous || incoming.ambiguous,
    clearOffenderIds: [
      ...new Set([...current.clearOffenderIds, ...incoming.clearOffenderIds]),
    ].slice(0, 12),
    observedAt: Math.max(current.observedAt, incoming.observedAt),
  };
}

function assertOwnerCanClaim(item: OperatorQueueItem, ownerId: string): void {
  if (!ownerId) throw new Error('queue lease owner is required');
  if (item.assignedOwnerId && item.assignedOwnerId !== ownerId) {
    throw new Error('queue item is assigned to another runtime owner');
  }
}

function resetDeliveryEvidence(item: OperatorQueueItem): void {
  if (!item.preparedReply) return;
  item.beatCount = Math.max(
    1,
    item.preparedSpeechPlan?.beats.length ??
      item.preparedReply.split(/(?<=[。！？!?])/u).filter((part) => part.trim())
        .length,
  );
  item.completedBeatCount = 0;
  item.audioByteLength = 0;
  item.replyHash = createHash('sha256')
    .update(item.preparedReply)
    .digest('hex')
    .slice(0, 16);
}

function isLeasedStatus(status: OperatorQueueStatus): boolean {
  return status === 'preparing' || status === 'speaking';
}

function assertLeasedMutationClaim(
  item: OperatorQueueItem,
  command: { attemptId?: string; ownerId?: string },
  action: string,
): void {
  const carriesClaim = Boolean(command.attemptId || command.ownerId);
  if (!isLeasedStatus(item.status)) {
    if (carriesClaim) throw new Error(`stale queue ${action} attempt`);
    return;
  }
  if (!command.attemptId || command.attemptId !== item.attemptId) {
    throw new Error(`stale queue ${action} attempt`);
  }
  if (!command.ownerId || command.ownerId !== item.leaseOwnerId) {
    throw new Error('queue lease owner mismatch');
  }
}

function isExpired(item: OperatorQueueItem, now: number): boolean {
  return Boolean(item.leaseExpiresAt && item.leaseExpiresAt <= now);
}
