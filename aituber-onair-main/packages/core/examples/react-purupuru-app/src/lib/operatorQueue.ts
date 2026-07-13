export type OperatorQueueStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'done'
  | 'skipped'
  | 'failed';

export type OperatorQueueItem = {
  eventId: string;
  text: string;
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
};

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
