export const ROOM_ACTOR_ID = '__room__';

export type ConversationDeliveryStatus =
  | 'generated'
  | 'spoken'
  | 'partial'
  | 'interrupted'
  | 'failed'
  | 'skipped';

export type ConversationEngagementAction =
  | 'none'
  | 'invite-paid-support'
  | 'invite-free-engagement';

export type ConversationHistoryScope = {
  personaId: string;
  platform: string;
  roomId: string;
  sessionId: string;
  actorId: string;
  viewerId: string;
};

export type ConversationHistoryRecordLike = {
  at?: unknown;
  deliveryStatus?: unknown;
  partialTextVerified?: unknown;
  scope?: unknown;
};

export type LegacyMemoryMigrationInput = {
  digitalHumanId?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  sourceType?: unknown;
};

export type LegacyMigrationClassification =
  | { disposition: 'projection-seed'; viewerId: string }
  | { disposition: 'quarantine-audit'; reason: string };

const DELIVERY_OUTCOMES = new Set<ConversationDeliveryStatus>([
  'spoken',
  'partial',
  'interrupted',
  'failed',
  'skipped',
]);

const RETRIEVABLE_DELIVERY = new Set<ConversationDeliveryStatus>([
  'spoken',
  'partial',
]);

function requiredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 500 ? normalized : undefined;
}

export function normalizeConversationHistoryScope(
  value: unknown,
): ConversationHistoryScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const personaId = requiredText(raw.personaId);
  const platform = requiredText(raw.platform);
  const roomId = requiredText(raw.roomId);
  const sessionId = requiredText(raw.sessionId);
  const actorId = requiredText(raw.actorId);
  const viewerId = requiredText(raw.viewerId);
  if (
    !personaId ||
    !platform ||
    !roomId ||
    !sessionId ||
    !actorId ||
    !viewerId
  ) {
    return undefined;
  }
  return { personaId, platform, roomId, sessionId, actorId, viewerId };
}

export function conversationHistoryScopeKey(
  scope: ConversationHistoryScope,
): string {
  return [
    scope.personaId,
    scope.platform,
    scope.roomId,
    scope.sessionId,
    scope.actorId,
    scope.viewerId,
  ].join('\u0000');
}

export function sameConversationHistoryScope(
  left: unknown,
  right: ConversationHistoryScope,
): boolean {
  const normalized = normalizeConversationHistoryScope(left);
  return Boolean(
    normalized &&
      conversationHistoryScopeKey(normalized) ===
        conversationHistoryScopeKey(right),
  );
}

export function conversationHistoryScopeFromSearchParams(
  params: URLSearchParams,
): ConversationHistoryScope | undefined {
  return normalizeConversationHistoryScope({
    personaId: params.get('personaId'),
    platform: params.get('platform'),
    roomId: params.get('roomId'),
    sessionId: params.get('sessionId'),
    actorId: params.get('actorId'),
    viewerId: params.get('viewerId'),
  });
}

export function appendConversationHistoryScopeQuery(
  params: URLSearchParams,
  scope: ConversationHistoryScope,
): URLSearchParams {
  for (const [key, value] of Object.entries(scope)) params.set(key, value);
  return params;
}

export function isConversationDeliveryOutcome(
  value: unknown,
): value is Exclude<ConversationDeliveryStatus, 'generated'> {
  return (
    typeof value === 'string' &&
    DELIVERY_OUTCOMES.has(value as ConversationDeliveryStatus)
  );
}

export function applyConversationDeliveryOutcome<
  T extends Record<string, unknown>,
>(
  record: T,
  eventId: string,
  scope: ConversationHistoryScope,
  outcome: {
    deliveryStatus: Exclude<ConversationDeliveryStatus, 'generated'>;
    deliveryUpdatedAt: number;
    deliveredFraction?: number;
    deliveryReason?: string;
    deliveredReply?: string;
    partialTextVerified?: boolean;
    ttsStartAt?: number;
    ttsEndAt?: number;
    engagementDecisionId?: string;
    engagementAction?: ConversationEngagementAction;
    engagementDeliveryStatus?: Exclude<ConversationDeliveryStatus, 'generated'>;
  },
): T | undefined {
  if (
    record.eventId !== eventId ||
    !sameConversationHistoryScope(record.scope, scope)
  ) {
    return undefined;
  }
  const previousStatus = record.deliveryStatus;
  const upgradesPartialEvidence =
    previousStatus === 'partial' &&
    outcome.deliveryStatus === 'partial' &&
    record.partialTextVerified !== true &&
    outcome.partialTextVerified === true;
  if (
    previousStatus === 'spoken' ||
    (previousStatus === 'partial' &&
      outcome.deliveryStatus !== 'spoken' &&
      !upgradesPartialEvidence)
  ) {
    // Stronger playback evidence is monotonic. A late watchdog, duplicated
    // interrupt, or retry failure cannot erase something already heard.
    return record;
  }
  return {
    ...record,
    ...outcome,
    reply: outcome.deliveredReply ?? record.reply,
    ttsStartAt: outcome.ttsStartAt ?? record.ttsStartAt,
    ttsEndAt: outcome.ttsEndAt ?? record.ttsEndAt,
  };
}

export function isRetrievableConversationHistoryRecord(
  record: ConversationHistoryRecordLike,
  scope: ConversationHistoryScope,
  before?: number,
): boolean {
  if (!sameConversationHistoryScope(record.scope, scope)) return false;
  if (
    typeof record.deliveryStatus !== 'string' ||
    !RETRIEVABLE_DELIVERY.has(
      record.deliveryStatus as ConversationDeliveryStatus,
    ) ||
    (record.deliveryStatus === 'partial' && record.partialTextVerified !== true)
  ) {
    // Legacy records have no outcome evidence and therefore cannot be
    // treated as something the host actually said.
    return false;
  }
  return (
    !Number.isFinite(before) ||
    (typeof record.at === 'number' && record.at <= (before as number))
  );
}

export function classifyLegacyMemoryMigration(
  record: LegacyMemoryMigrationInput,
  expected: Pick<ConversationHistoryScope, 'personaId' | 'platform'>,
): LegacyMigrationClassification {
  if (record.digitalHumanId !== expected.personaId) {
    return { disposition: 'quarantine-audit', reason: 'persona-unproven' };
  }
  if (record.subjectType !== 'viewer' || typeof record.subjectId !== 'string') {
    return { disposition: 'quarantine-audit', reason: 'viewer-unproven' };
  }
  const prefix = `${expected.platform}:`;
  if (
    !record.subjectId.startsWith(prefix) ||
    record.subjectId.length <= prefix.length
  ) {
    return { disposition: 'quarantine-audit', reason: 'platform-unproven' };
  }
  if (record.sourceType !== 'live_event') {
    return { disposition: 'quarantine-audit', reason: 'source-unproven' };
  }
  return {
    disposition: 'projection-seed',
    viewerId: record.subjectId.slice(prefix.length),
  };
}

export function classifyLegacyRelationshipMigration(
  viewerScopeKey: string,
  expectedPlatform: string,
): LegacyMigrationClassification {
  const prefix = `${expectedPlatform}:`;
  if (
    !viewerScopeKey.startsWith(prefix) ||
    viewerScopeKey.length <= prefix.length
  ) {
    return { disposition: 'quarantine-audit', reason: 'platform-unproven' };
  }
  return {
    disposition: 'projection-seed',
    viewerId: viewerScopeKey.slice(prefix.length),
  };
}
