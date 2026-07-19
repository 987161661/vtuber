import type { RoomInteractionSnapshot } from './roomInteractionTracker';

export type OperatorQueueStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'done'
  | 'skipped'
  | 'failed'
  /** Persistence tombstone; queue snapshots never expose deleted items. */
  | 'deleted';

/**
 * Serializable SpeechPlan subset kept with a prepared queue item.  Keeping
 * this alongside the display text prevents the operator queue from erasing
 * beat-level voice and avatar direction before playback begins.
 */
export type PreparedSpeechBeat = {
  text: string;
  ttsText?: string;
  emotion?: string;
  delivery?: string;
  emotionIntensity?: number;
  prosody?: Record<string, number>;
  pauseAfterMs?: number;
  motion?: string;
  gaze?: string;
  gesture?: string;
  interruptibleAfter?: boolean;
};

export type PreparedSpeechPlan = {
  version: 2;
  beats: PreparedSpeechBeat[];
};

export type InteractionAccountingEffect = 'relationship' | 'engagement';

export type InteractionAccountingClaim = {
  claimId: string;
  attemptId: string;
  ownerId: string;
  claimedAt: number;
};

export type OperatorQueueItem = {
  eventId: string;
  /** Correlates one generation attempt; changes on every controlled retry. */
  attemptId: string;
  turnVersion: 2;
  /** Short, operator-visible summary. User messages remain capped by the queue API. */
  text: string;
  /**
   * Internal generation context for system-originated turns such as quiet-room
   * awareness. This is intentionally separate from `text`: it is not a
   * viewer message and must never be truncated to fit the control-room card.
   */
  prompt?: string;
  source: string;
  sourceLabel?: string;
  viewerId?: string;
  viewerName?: string;
  sourcesSeen: string[];
  createdAt: number;
  updatedAt: number;
  order: number;
  status: OperatorQueueStatus;
  preparedReply?: string;
  /** Original structured output used by the TTS/animation execution path. */
  preparedSpeechPlan?: PreparedSpeechPlan;
  preparedAt?: number;
  doneAt?: number;
  /** Why this message was deliberately kept out of the broadcast queue. */
  skipReason?: string;
  skills: string[];
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
  finishReason?: string;
  retryCount?: number;
  beatCount?: number;
  completedBeatCount?: number;
  replyHash?: string;
  faultKind?:
    | 'typhoon-skill-timeout'
    | 'model-truncation'
    | 'tts-first-beat-failure'
    | 'prepare-lease-expiry';
  faultConsumed?: boolean;
  interactionObservedAt?: number;
  /** Durable at-most-once claims for relationship and engagement side effects. */
  interactionAccounting?: Partial<
    Record<InteractionAccountingEffect, InteractionAccountingClaim>
  >;
  /** Presence-triggered host speech must not be counted as a viewer message. */
  presenceOnly?: boolean;
  engagementAppliedAt?: number;
  engagementSignals?: Array<'follow' | 'like' | 'gift' | 'superchat' | 'guard'>;
  leaseOwnerId?: string;
  leaseExpiresAt?: number;
  audioByteLength?: number;
  panelObservedAt?: number;
  relationshipVisitDelta?: number;
  otherViewerRelationshipMutated?: boolean;
  /** Runtime owner selected for a stress run; other listener pages must not claim it. */
  assignedOwnerId?: string;
  /** Bounded room-level evidence for persona planning; never displayed as chat. */
  roomContext?: RoomInteractionSnapshot;
};

export const MAX_READY_REPLY_AGE_MS = 45_000;

export type OperatorQueueIngestInput = {
  eventId: string;
  text: string;
  prompt?: string;
  directReply?: string;
  source: string;
  sourceLabel: string;
  viewerId?: string;
  viewerName?: string;
  sourcesSeen?: string[];
  roomContext?: RoomInteractionSnapshot;
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
  faultKind?: OperatorQueueItem['faultKind'];
  engagementSignals?: OperatorQueueItem['engagementSignals'];
  presenceOnly?: boolean;
  createdAt?: number;
};

type QueueRequest = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type OperatorQueueClientOptions = {
  request: QueueRequest;
  now?: () => number;
  createId?: () => string;
};

const DELIVERY_REGRESSING_ACTIONS = new Set([
  'edit-reply',
  'skip',
  'fail',
  'retry',
  'ready',
]);

/**
 * Delivery evidence is monotonic. Once every planned beat produced audio, a
 * late cancellation, failure callback, or generation callback cannot rewrite
 * the item into an unspoken state. This also covers the short race between
 * the final beat callback and the subsequent `done` mutation.
 */
export function wouldRegressCompletedDelivery(
  item: {
    status: string;
    beatCount?: number;
    completedBeatCount?: number;
    audioByteLength?: number;
  },
  action: string,
): boolean {
  if (!DELIVERY_REGRESSING_ACTIONS.has(action)) return false;
  if (item.status === 'done') return true;
  const beatCount = Math.max(0, item.beatCount ?? 0);
  return (
    beatCount > 0 &&
    (item.completedBeatCount ?? 0) >= beatCount &&
    (item.audioByteLength ?? 0) > 0
  );
}

/**
 * A generated reply becomes misleading once the live room has already moved
 * on. Operator-authored speech is exempt because it is an explicit command.
 */
export function isStaleReadyReply(
  item: OperatorQueueItem,
  now = Date.now(),
  maxAgeMs = MAX_READY_REPLY_AGE_MS,
): boolean {
  return (
    item.status === 'ready' &&
    item.source !== 'operator-manual' &&
    now - item.createdAt > maxAgeMs
  );
}

export function createOperatorQueueClient(options: OperatorQueueClientOptions) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const post = (body: Record<string, unknown>) =>
    options.request('/api/operator-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    async list(observer?: string): Promise<OperatorQueueItem[]> {
      const suffix = observer
        ? `?observer=${encodeURIComponent(observer)}`
        : '';
      const response = await options.request(`/api/operator-queue${suffix}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`operator queue list failed (${response.status})`);
      }
      const payload = (await response.json()) as {
        items?: OperatorQueueItem[];
      };
      return Array.isArray(payload.items) ? payload.items : [];
    },

    async ingest(input: OperatorQueueIngestInput): Promise<void> {
      const createdAt =
        typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)
          ? input.createdAt
          : now();
      const response = await post({ action: 'ingest', ...input, createdAt });
      if (response.ok) return;
      const detail = (await response.text()).trim();
      throw new Error(
        `operator queue ingest failed (${response.status})${
          detail ? `: ${detail.slice(0, 300)}` : ''
        }`,
      );
    },

    async manualBroadcast(text: string): Promise<boolean> {
      const preparedReply = text.trim();
      if (!preparedReply) return false;
      const response = await post({
        action: 'manual-broadcast',
        eventId: createId(),
        text: preparedReply,
        reply: preparedReply,
        source: 'operator-manual',
        sourceLabel: '总控手动播报',
        viewerName: '主播总控',
        sourcesSeen: ['operator-manual'],
        createdAt: now(),
        auditActor: 'control-room',
      });
      if (!response.ok) {
        throw new Error(`manual broadcast failed (${response.status})`);
      }
      return true;
    },

    async mutate(
      eventId: string,
      action: string,
      extra: Record<string, unknown> = {},
    ) {
      const response = await options.request('/api/operator-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, action, ...extra }),
      });
      if (!response.ok) {
        // Preserve safe state-machine reasons in runtime diagnostics.
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        const reason =
          typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim().slice(0, 160)
            : `http_${response.status}`;
        throw new Error(`operator_queue_${action}_failed: ${reason}`);
      }
      return response.json() as Promise<{
        item?: OperatorQueueItem;
        items?: OperatorQueueItem[];
      }>;
    },
  };
}

export const operatorQueueClient = createOperatorQueueClient({
  request: (input, init) => fetch(input, init),
});

export async function updateOperatorQueue(
  eventId: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  return operatorQueueClient.mutate(eventId, action, extra);
}

export const operatorInteractionAccountingQueue = {
  async claim(input: {
    item: OperatorQueueItem;
    effects: InteractionAccountingEffect[];
    claimId: string;
    ownerId: string;
  }): Promise<OperatorQueueItem> {
    const result = await updateOperatorQueue(
      input.item.eventId,
      'claim-interaction-accounting',
      {
        attemptId: input.item.attemptId,
        ownerId: input.ownerId,
        claimId: input.claimId,
        effects: input.effects,
      },
    );
    if (!result.item) throw new Error('accounting claim response missing item');
    return result.item;
  },

  async recordMetrics(input: {
    eventId: string;
    claimId: string;
    relationshipVisitDelta: number;
    otherViewerRelationshipMutated: boolean;
  }): Promise<void> {
    await updateOperatorQueue(
      input.eventId,
      'record-interaction-metrics',
      input,
    );
  },
};
