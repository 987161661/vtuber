import type {
  LiveSessionRetrospective,
  LiveSessionRetrospectiveStatus,
} from './liveSessionRetrospective';
import type { LiveSessionRecord } from './liveSessionLifecycle';
import type { ImprovementExperimentContext } from './improvementExperimentContext';

export type LiveSessionRetrospectiveRuntimeEvent = {
  eventId?: string;
  stage?: string;
  at?: number;
  serverReceivedAt?: number;
  sessionId?: string;
  sessionSequence?: number;
  sessionStartedAt?: number;
  sessionEndedAt?: number;
  personaId?: string;
  platform?: string;
  roomId?: string;
  retrospectiveScore?: number;
  retrospectiveStatus?: LiveSessionRetrospectiveStatus;
  durationMs?: number;
  queueTotal?: number;
  queueResponded?: number;
  queueSkipped?: number;
  queueFailed?: number;
  queueArchived?: number;
  attentionOpened?: number;
  attentionResolved?: number;
  failedActions?: number;
  retrospectiveRevision?: string;
  experimentContextId?: string;
  experimentContextLabel?: string;
};

export type LiveSessionTrendRecord = {
  sessionId: string;
  sequence: number;
  endedAt: number;
  personaId: string;
  platform: string;
  roomId: string;
  score: number;
  status: LiveSessionRetrospectiveStatus;
  responded: number;
  failed: number;
  attentionOpened: number;
  attentionResolved: number;
  experimentContextId?: string;
  experimentContextLabel?: string;
};

export type LiveSessionTrend = {
  direction: 'insufficient' | 'improving' | 'stable' | 'declining';
  title: string;
  summary: string;
  averageScore: number | null;
  scoreDelta: number | null;
  records: LiveSessionTrendRecord[];
};

export type LiveSessionTrendProjectionScope = {
  personaId?: string;
  platform: string;
  roomId: string;
  recordLimit?: number;
};

const DEFAULT_RECORD_LIMIT = 8;
const MAX_RECORD_LIMIT = 200;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function eventTimestamp(event: LiveSessionRetrospectiveRuntimeEvent): number {
  return finiteNumber(event.at) ?? finiteNumber(event.serverReceivedAt) ?? 0;
}

function validStatus(value: unknown): value is LiveSessionRetrospectiveStatus {
  return (
    value === 'excellent' ||
    value === 'stable' ||
    value === 'needs-review' ||
    value === 'critical'
  );
}

function toRecord(
  event: LiveSessionRetrospectiveRuntimeEvent,
): LiveSessionTrendRecord | undefined {
  const sessionId = event.sessionId?.trim();
  const sequence = finiteNumber(event.sessionSequence);
  const endedAt = finiteNumber(event.sessionEndedAt);
  const score = finiteNumber(event.retrospectiveScore);
  if (
    event.stage !== 'operator_session_retrospective' ||
    !sessionId ||
    sequence === undefined ||
    endedAt === undefined ||
    score === undefined ||
    score < 0 ||
    score > 100 ||
    !validStatus(event.retrospectiveStatus)
  ) {
    return undefined;
  }
  return {
    sessionId,
    sequence,
    endedAt,
    personaId: event.personaId?.trim() || 'unknown',
    platform: event.platform?.trim() || 'unknown',
    roomId: event.roomId?.trim() || 'unknown',
    score: Math.round(score),
    status: event.retrospectiveStatus,
    responded: Math.max(0, Math.round(finiteNumber(event.queueResponded) ?? 0)),
    failed: Math.max(0, Math.round(finiteNumber(event.queueFailed) ?? 0)),
    attentionOpened: Math.max(
      0,
      Math.round(finiteNumber(event.attentionOpened) ?? 0),
    ),
    attentionResolved: Math.max(
      0,
      Math.round(finiteNumber(event.attentionResolved) ?? 0),
    ),
    experimentContextId: event.experimentContextId?.trim() || undefined,
    experimentContextLabel: event.experimentContextLabel?.trim() || undefined,
  };
}

export function retrospectiveRevision(
  report: LiveSessionRetrospective,
): string {
  const metrics = report.metrics;
  return [
    report.score,
    metrics.durationMs,
    metrics.total,
    metrics.responded,
    metrics.skipped,
    metrics.failed,
    metrics.archived,
    metrics.attentionOpened,
    metrics.attentionResolved,
    metrics.failedActions,
  ].join('-');
}

export function createLiveSessionRetrospectiveEvent(input: {
  report: LiveSessionRetrospective;
  session: LiveSessionRecord;
  scope: { personaId: string; platform: string; roomId: string };
  experimentContext?: ImprovementExperimentContext;
  at?: number;
}): LiveSessionRetrospectiveRuntimeEvent {
  const at = input.at ?? Date.now();
  const revision = retrospectiveRevision(input.report);
  return {
    eventId: `session-retrospective:${input.session.sessionId}:${revision}`,
    stage: 'operator_session_retrospective',
    at,
    sessionId: input.session.sessionId,
    sessionSequence: input.session.sequence,
    sessionStartedAt: input.session.startedAt,
    sessionEndedAt: input.session.endedAt ?? input.session.startedAt,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    retrospectiveScore: input.report.score,
    retrospectiveStatus: input.report.status,
    durationMs: input.report.metrics.durationMs,
    queueTotal: input.report.metrics.total,
    queueResponded: input.report.metrics.responded,
    queueSkipped: input.report.metrics.skipped,
    queueFailed: input.report.metrics.failed,
    queueArchived: input.report.metrics.archived,
    attentionOpened: input.report.metrics.attentionOpened,
    attentionResolved: input.report.metrics.attentionResolved,
    failedActions: input.report.metrics.failedActions,
    retrospectiveRevision: revision,
    experimentContextId: input.experimentContext?.id,
    experimentContextLabel: input.experimentContext?.label,
  };
}

export function projectLiveSessionTrend(
  events: readonly LiveSessionRetrospectiveRuntimeEvent[],
  scope?: LiveSessionTrendProjectionScope,
): LiveSessionTrend {
  const latestBySession = new Map<
    string,
    {
      event: LiveSessionRetrospectiveRuntimeEvent;
      record: LiveSessionTrendRecord;
    }
  >();
  for (const event of events) {
    const record = toRecord(event);
    if (!record) continue;
    if (
      scope &&
      ((scope.personaId && record.personaId !== scope.personaId) ||
        record.platform !== scope.platform ||
        record.roomId !== scope.roomId)
    ) {
      continue;
    }
    const existing = latestBySession.get(record.sessionId);
    if (!existing || eventTimestamp(event) >= eventTimestamp(existing.event)) {
      latestBySession.set(record.sessionId, { event, record });
    }
  }
  const requestedRecordLimit = finiteNumber(scope?.recordLimit);
  const recordLimit =
    requestedRecordLimit === undefined
      ? DEFAULT_RECORD_LIMIT
      : Math.min(
          MAX_RECORD_LIMIT,
          Math.max(1, Math.floor(requestedRecordLimit)),
        );
  const records = [...latestBySession.values()]
    .map(({ record }) => record)
    .sort(
      (left, right) =>
        left.endedAt - right.endedAt || left.sequence - right.sequence,
    )
    .slice(-recordLimit);
  if (!records.length) {
    return {
      direction: 'insufficient',
      title: '等待首份场次复盘',
      summary: '切换场次后会自动保存结构化复盘，并在这里形成长期趋势。',
      averageScore: null,
      scoreDelta: null,
      records: [],
    };
  }
  const averageScore = Math.round(
    records.reduce((total, record) => total + record.score, 0) / records.length,
  );
  if (records.length === 1) {
    return {
      direction: 'insufficient',
      title: '已建立复盘基线',
      summary: `最近场次 ${records[0].score} 分；再完成一场后即可判断变化方向。`,
      averageScore,
      scoreDelta: null,
      records,
    };
  }
  const latest = records.at(-1) as LiveSessionTrendRecord;
  const previous = records.at(-2) as LiveSessionTrendRecord;
  const scoreDelta = latest.score - previous.score;
  const direction =
    scoreDelta >= 5 ? 'improving' : scoreDelta <= -5 ? 'declining' : 'stable';
  const title =
    direction === 'improving'
      ? '场次质量正在改善'
      : direction === 'declining'
        ? '最近一场质量回落'
        : '场次质量保持稳定';
  const summary = `近 ${records.length} 场平均 ${averageScore} 分；最近一场较前一场${scoreDelta > 0 ? '提升' : scoreDelta < 0 ? '下降' : '持平'} ${Math.abs(scoreDelta)} 分。`;
  return {
    direction,
    title,
    summary,
    averageScore,
    scoreDelta,
    records,
  };
}

function retrospectiveEventKey(
  event: LiveSessionRetrospectiveRuntimeEvent,
): string {
  return (
    event.eventId ??
    [event.stage, event.sessionId, event.retrospectiveRevision, event.at].join(
      ':',
    )
  );
}

export function mergeLiveSessionRetrospectiveEvents(input: {
  remote: readonly LiveSessionRetrospectiveRuntimeEvent[];
  local: readonly LiveSessionRetrospectiveRuntimeEvent[];
  now?: number;
  optimisticTtlMs?: number;
}): LiveSessionRetrospectiveRuntimeEvent[] {
  const now = input.now ?? Date.now();
  const optimisticTtlMs = input.optimisticTtlMs ?? 10_000;
  const remoteKeys = new Set(input.remote.map(retrospectiveEventKey));
  const pending = input.local.filter((event) => {
    if (remoteKeys.has(retrospectiveEventKey(event))) return false;
    const at = eventTimestamp(event);
    return at > 0 && now - at <= optimisticTtlMs;
  });
  return [...input.remote, ...pending].sort(
    (left, right) => eventTimestamp(left) - eventTimestamp(right),
  );
}
