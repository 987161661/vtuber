import type { createLiveRuntimeMonitor } from './liveRuntimeMonitor';

type LiveRuntimeMonitorPort = Pick<
  ReturnType<typeof createLiveRuntimeMonitor>,
  'ingest'
>;

type RuntimeRequestHeaders = Record<string, string | string[] | undefined>;

const PRIVILEGED_SERVER_FIELDS = new Set([
  'serverCanaryRunId',
  'serverCanaryReceivedAt',
  'serverCanaryAttested',
  'serverReceivedAt',
]);
const PRIVATE_MODEL_FIELDS = new Set(['modelRawText', 'rawText', 'parsedText']);
const FORWARDED_STAGES = new Set([
  'fact_validation_rewrite',
  'sanitizer_failure',
  'tts_rate_limit',
]);

export function createLiveRuntimeEventRequestHandler(options: {
  monitor: LiveRuntimeMonitorPort;
  attestEvent: (
    headers: RuntimeRequestHeaders,
    event: Record<string, unknown>,
    serverReceivedAt: number,
  ) => Promise<Record<string, unknown>>;
  appendRuntimeEvent: (event: Record<string, unknown>) => Promise<void>;
  appendAuditEntry: (entry: Record<string, unknown>) => Promise<void>;
  forwardEvent?: (event: Record<string, unknown>) => Promise<void>;
  now?: () => number;
  maxBytes?: number;
}) {
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? 256 * 1024;

  return async function handleLiveRuntimeEventRequest(request: {
    rawBody: string;
    byteLength: number;
    headers: RuntimeRequestHeaders;
  }): Promise<{ ok: true }> {
    let stage = 'invalid_event';
    let eventId = 'runtime';
    try {
      if (request.byteLength > maxBytes) {
        throw new Error('live_runtime_event_too_large');
      }
      const parsed = JSON.parse(request.rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid_runtime_event');
      }
      const eventForAttestation = omitFields(
        parsed as Record<string, unknown>,
        PRIVILEGED_SERVER_FIELDS,
      );
      const serverReceivedAt = now();
      const canaryAttestation = await options.attestEvent(
        request.headers,
        eventForAttestation,
        serverReceivedAt,
      );
      const occurredAt = finiteTimestamp(eventForAttestation.at) ?? now();
      eventId = String(
        eventForAttestation.eventId || eventForAttestation.id || 'runtime',
      );
      stage = String(
        eventForAttestation.stage || eventForAttestation.kind || 'event',
      );
      const event =
        stage === 'model_output'
          ? omitFields(eventForAttestation, PRIVATE_MODEL_FIELDS)
          : eventForAttestation;

      options.monitor.ingest(event, occurredAt);
      await options.appendRuntimeEvent({
        ...event,
        at: occurredAt,
        serverReceivedAt,
        ...canaryAttestation,
      });
      await options.appendAuditEntry({
        category: 'runtime',
        action: stage,
        actor:
          event.actor ??
          (stage.startsWith('operator_')
            ? { type: 'operator', id: 'control-room' }
            : { type: 'system', id: 'runtime' }),
        correlationId: eventId === 'runtime' ? undefined : eventId,
        eventId: eventId === 'runtime' ? undefined : eventId,
        occurredAt,
        status: 'succeeded',
        payload: event,
      });
      if (FORWARDED_STAGES.has(stage) && options.forwardEvent) {
        void options
          .forwardEvent({
            event: stage,
            channel: 'virtual-runtime',
            requestId: eventId === 'runtime' ? undefined : eventId,
            at: occurredAt,
            reasons: Array.isArray(event.reasons) ? event.reasons : undefined,
            error: typeof event.error === 'string' ? event.error : undefined,
          })
          .catch(() => undefined);
      }
      return { ok: true };
    } catch (error) {
      const reason = auditFailureReason(error);
      await options
        .appendAuditEntry({
          category: 'runtime',
          action: stage,
          actor: { type: 'system', id: 'runtime-ingress' },
          correlationId: eventId === 'runtime' ? undefined : eventId,
          eventId: eventId === 'runtime' ? undefined : eventId,
          occurredAt: now(),
          status: 'failed',
          error: reason,
        })
        .catch(() => undefined);
      throw error instanceof Error ? error : new Error(reason);
    }
  };
}

function auditFailureReason(error: unknown): string {
  if (
    error instanceof Error &&
    ['live_runtime_event_too_large', 'invalid_runtime_event'].includes(
      error.message,
    )
  ) {
    return error.message;
  }
  return 'invalid_runtime_event';
}

function omitFields(
  value: Record<string, unknown>,
  omitted: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  );
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
