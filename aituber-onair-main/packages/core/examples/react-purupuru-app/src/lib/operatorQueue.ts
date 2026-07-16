import type { RoomInteractionSnapshot } from './roomInteractionTracker';

export type OperatorQueueStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'done'
  | 'skipped'
  | 'failed';

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

export type OperatorQueueItem = {
  eventId: string;
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

export async function updateOperatorQueue(
  eventId: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const response = await fetch('/api/operator-queue', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, action, ...extra }),
  });
  if (!response.ok) {
    // The queue endpoint returns only safe state-machine reasons. Preserve
    // that reason in runtime events instead of hiding every bad transition.
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const reason =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim().slice(0, 160)
        : `http_${response.status}`;
    throw new Error(`operator_queue_${action}_failed: ${reason}`);
  }
  return response.json() as Promise<{ items?: OperatorQueueItem[] }>;
}
