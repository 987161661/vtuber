import type {
  OperatorAttentionAction,
  OperatorAttentionItem,
} from './operatorAttention';

export type OperatorAttentionEventStage =
  | 'operator_attention_opened'
  | 'operator_attention_action_started'
  | 'operator_attention_action_completed'
  | 'operator_attention_action_failed'
  | 'operator_attention_resolved';

export type OperatorAttentionRuntimeEvent = {
  eventId?: string;
  stage?: string;
  at?: number;
  serverReceivedAt?: number;
  sessionId?: string;
  attentionId?: string;
  attentionTitle?: string;
  attentionDomain?: OperatorAttentionItem['domain'];
  attentionSeverity?: OperatorAttentionItem['severity'];
  attentionAction?: OperatorAttentionAction;
  error?: string;
};

export type OperatorAttentionActionEvidence = {
  action: OperatorAttentionAction;
  status: 'started' | 'completed' | 'failed';
  at: number;
  error?: string;
};

export type OperatorAttentionIncident = {
  attentionId: string;
  title: string;
  domain: OperatorAttentionItem['domain'];
  severity: OperatorAttentionItem['severity'];
  openedAt: number;
  resolvedAt?: number;
  actions: OperatorAttentionActionEvidence[];
};

export type OperatorAttentionRecap = {
  sessionId: string;
  opened: number;
  resolved: number;
  active: number;
  actions: number;
  failedActions: number;
  averageResolutionMs: number | null;
};

export type OperatorAttentionLedger = {
  incidents: OperatorAttentionIncident[];
  active: OperatorAttentionIncident[];
  recent: OperatorAttentionIncident[];
  recap: OperatorAttentionRecap;
  transitions: OperatorAttentionRuntimeEvent[];
};

type OperatorAttentionLedgerInput = {
  events: readonly OperatorAttentionRuntimeEvent[];
  sessionId: string;
  currentItems?: readonly OperatorAttentionItem[];
  now?: number;
};

const ATTENTION_EVENT_STAGES = new Set<OperatorAttentionEventStage>([
  'operator_attention_opened',
  'operator_attention_action_started',
  'operator_attention_action_completed',
  'operator_attention_action_failed',
  'operator_attention_resolved',
]);

function eventTimestamp(event: OperatorAttentionRuntimeEvent): number {
  return (
    finiteTimestamp(event.at) ?? finiteTimestamp(event.serverReceivedAt) ?? 0
  );
}

function isAttentionStage(
  stage: string | undefined,
): stage is OperatorAttentionEventStage {
  return Boolean(
    stage && ATTENTION_EVENT_STAGES.has(stage as OperatorAttentionEventStage),
  );
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function actionStatus(
  stage: OperatorAttentionEventStage,
): OperatorAttentionActionEvidence['status'] | undefined {
  if (stage === 'operator_attention_action_started') return 'started';
  if (stage === 'operator_attention_action_completed') return 'completed';
  if (stage === 'operator_attention_action_failed') return 'failed';
  return undefined;
}

function createIncident(
  event: OperatorAttentionRuntimeEvent,
  at: number,
): OperatorAttentionIncident {
  return {
    attentionId: event.attentionId ?? 'unknown',
    title: event.attentionTitle?.trim() || event.attentionId || '未命名提醒',
    domain: event.attentionDomain ?? 'runtime',
    severity: event.attentionSeverity ?? 'warning',
    openedAt: at,
    actions: [],
  };
}

function transitionEvent(
  stage: 'operator_attention_opened' | 'operator_attention_resolved',
  sessionId: string,
  item: Pick<OperatorAttentionItem, 'id' | 'title' | 'domain' | 'severity'>,
  at: number,
): OperatorAttentionRuntimeEvent {
  return {
    eventId: `operator-attention:${sessionId}:${item.id}:${stage}:${at}`,
    stage,
    at,
    sessionId,
    attentionId: item.id,
    attentionTitle: item.title,
    attentionDomain: item.domain,
    attentionSeverity: item.severity,
  };
}

export function projectOperatorAttentionLedger(
  input: OperatorAttentionLedgerInput,
): OperatorAttentionLedger {
  const incidents: OperatorAttentionIncident[] = [];
  const activeById = new Map<string, OperatorAttentionIncident>();
  const events = input.events
    .filter(
      (event) =>
        event.sessionId === input.sessionId &&
        Boolean(event.attentionId) &&
        isAttentionStage(event.stage),
    )
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));

  for (const event of events) {
    const stage = event.stage as OperatorAttentionEventStage;
    const at = eventTimestamp(event);
    const attentionId = event.attentionId as string;
    let incident = activeById.get(attentionId);

    if (stage === 'operator_attention_opened') {
      if (incident) continue;
      incident = createIncident(event, at);
      incidents.push(incident);
      activeById.set(attentionId, incident);
      continue;
    }

    if (stage === 'operator_attention_resolved') {
      if (!incident) continue;
      incident.resolvedAt = Math.max(at, incident.openedAt);
      activeById.delete(attentionId);
      continue;
    }

    const status = actionStatus(stage);
    if (!status || !event.attentionAction) continue;
    if (!incident) {
      incident = createIncident(event, at);
      incidents.push(incident);
      activeById.set(attentionId, incident);
    }
    incident.actions.push({
      action: event.attentionAction,
      status,
      at,
      error: status === 'failed' ? event.error : undefined,
    });
  }

  const currentItems = input.currentItems;
  const now = input.now ?? Date.now();
  const transitions: OperatorAttentionRuntimeEvent[] = [];
  if (currentItems) {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    for (const item of currentItems) {
      if (!activeById.has(item.id)) {
        transitions.push(
          transitionEvent(
            'operator_attention_opened',
            input.sessionId,
            item,
            now,
          ),
        );
      }
    }
    for (const incident of activeById.values()) {
      if (!currentById.has(incident.attentionId)) {
        transitions.push(
          transitionEvent(
            'operator_attention_resolved',
            input.sessionId,
            {
              id: incident.attentionId,
              title: incident.title,
              domain: incident.domain,
              severity: incident.severity,
            },
            now,
          ),
        );
      }
    }
  }

  const resolvedDurations = incidents
    .filter(
      (
        incident,
      ): incident is OperatorAttentionIncident & { resolvedAt: number } =>
        incident.resolvedAt !== undefined,
    )
    .map((incident) => incident.resolvedAt - incident.openedAt);
  const actionEvidence = incidents.flatMap((incident) => incident.actions);
  const active = [...activeById.values()].sort(
    (left, right) => right.openedAt - left.openedAt,
  );
  const recent = [...incidents]
    .sort(
      (left, right) =>
        (right.resolvedAt ?? right.openedAt) -
        (left.resolvedAt ?? left.openedAt),
    )
    .slice(0, 5);

  return {
    incidents,
    active,
    recent,
    recap: {
      sessionId: input.sessionId,
      opened: incidents.length,
      resolved: resolvedDurations.length,
      active: active.length,
      actions: actionEvidence.filter(({ status }) => status !== 'started')
        .length,
      failedActions: actionEvidence.filter(({ status }) => status === 'failed')
        .length,
      averageResolutionMs: resolvedDurations.length
        ? Math.round(
            resolvedDurations.reduce((total, duration) => total + duration, 0) /
              resolvedDurations.length,
          )
        : null,
    },
    transitions,
  };
}

export function createOperatorAttentionActionEvent(input: {
  stage:
    | 'operator_attention_action_started'
    | 'operator_attention_action_completed'
    | 'operator_attention_action_failed';
  sessionId: string;
  item: OperatorAttentionItem;
  action: OperatorAttentionAction;
  at?: number;
  eventId?: string;
  error?: string;
}): OperatorAttentionRuntimeEvent {
  const at = input.at ?? Date.now();
  return {
    eventId:
      input.eventId ??
      `operator-attention:${input.sessionId}:${input.item.id}:${input.stage}:${at}`,
    stage: input.stage,
    at,
    sessionId: input.sessionId,
    attentionId: input.item.id,
    attentionTitle: input.item.title,
    attentionDomain: input.item.domain,
    attentionSeverity: input.item.severity,
    attentionAction: input.action,
    error: input.error,
  };
}

function runtimeEventKey(event: OperatorAttentionRuntimeEvent): string {
  return (
    event.eventId ??
    [
      event.stage,
      event.sessionId,
      event.attentionId,
      event.attentionAction,
      event.at,
    ].join(':')
  );
}

export function mergeOperatorAttentionRuntimeEvents(input: {
  remote: readonly OperatorAttentionRuntimeEvent[];
  local: readonly OperatorAttentionRuntimeEvent[];
  now?: number;
  optimisticTtlMs?: number;
}): OperatorAttentionRuntimeEvent[] {
  const now = input.now ?? Date.now();
  const optimisticTtlMs = input.optimisticTtlMs ?? 10_000;
  const remoteKeys = new Set(input.remote.map(runtimeEventKey));
  const pendingLocal = input.local.filter((event) => {
    if (remoteKeys.has(runtimeEventKey(event))) return false;
    const at = eventTimestamp(event);
    return at > 0 && now - at <= optimisticTtlMs;
  });
  return [...input.remote, ...pendingLocal].sort(
    (left, right) => eventTimestamp(left) - eventTimestamp(right),
  );
}
