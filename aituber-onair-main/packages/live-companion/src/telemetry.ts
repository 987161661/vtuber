import {
  SpanStatusCode,
  context,
  metrics,
  propagation,
  trace,
  type Span,
} from '@opentelemetry/api';
import type {
  LiveHostAction,
  LiveHostEvent,
  LiveHostPhase,
  LiveHostSnapshot,
} from './types.js';

export interface LiveTelemetryRecordV1 {
  protocolVersion: '1.0';
  at: number;
  correlationId?: string;
  eventType: LiveHostEvent['type'];
  stage?: string;
  priority?: string;
  phase: LiveHostPhase;
  queueDepth: number;
  actionKinds: readonly string[];
  reasonCodes: readonly string[];
  traceContext?: Readonly<Record<string, string>>;
}

export interface LiveTelemetrySink {
  record(record: LiveTelemetryRecordV1): void;
}

export const NOOP_LIVE_TELEMETRY: LiveTelemetrySink = Object.freeze({
  record() {},
});

export function createLiveTelemetryRecord(
  event: LiveHostEvent,
  actions: readonly LiveHostAction[],
  snapshot: LiveHostSnapshot,
): LiveTelemetryRecordV1 {
  return {
    protocolVersion: '1.0',
    at: event.at,
    ...('eventId' in event && event.eventId
      ? { correlationId: event.eventId }
      : {}),
    eventType: event.type,
    ...('stage' in event ? { stage: event.stage } : {}),
    ...('priority' in event && event.priority
      ? { priority: event.priority }
      : {}),
    phase: snapshot.phase,
    queueDepth: snapshot.pendingTurnCount ?? 0,
    actionKinds: actions.map((action) => action.kind),
    reasonCodes: actions.map((action) => action.reasonCode),
    ...(event.traceContext ? { traceContext: event.traceContext } : {}),
  };
}

interface ActiveTurnTrace {
  span: Span;
  startedAt: number;
  generationStartedAt?: number;
}

export interface OpenTelemetryLiveTelemetryOptions {
  instrumentationName?: string;
  instrumentationVersion?: string;
}

/**
 * OpenTelemetry adapter for the sanitized live telemetry seam. No viewer id,
 * message, prompt, utterance, or model payload can cross this interface.
 */
export class OpenTelemetryLiveTelemetry implements LiveTelemetrySink {
  private readonly tracer;
  private readonly actionCounter;
  private readonly stageLatency;
  private readonly queueDepth;
  private readonly active = new Map<string, ActiveTurnTrace>();

  constructor(options: OpenTelemetryLiveTelemetryOptions = {}) {
    const name = options.instrumentationName ?? '@aituber-onair/live-companion';
    const version = options.instrumentationVersion ?? '0.0.1';
    this.tracer = trace.getTracer(name, version);
    const meter = metrics.getMeter(name, version);
    this.actionCounter = meter.createCounter('aituber.live.actions', {
      description: 'Coordinator actions emitted by kind and reason.',
    });
    this.stageLatency = meter.createHistogram('aituber.live.stage_latency_ms', {
      unit: 'ms',
      description: 'Elapsed time from turn admission to a delivery stage.',
    });
    this.queueDepth = meter.createHistogram('aituber.live.queue_depth', {
      unit: '{turn}',
      description: 'Pending live turn count after a coordinator dispatch.',
    });
  }

  record(record: LiveTelemetryRecordV1): void {
    this.queueDepth.record(record.queueDepth, { phase: record.phase });
    record.actionKinds.forEach((kind, index) => {
      this.actionCounter.add(1, {
        'action.kind': kind,
        'action.reason': record.reasonCodes[index] ?? 'unknown',
      });
    });

    const key = record.correlationId;
    if (!key) {
      if (record.eventType === 'stream-state' && record.phase === 'offline') {
        this.endAll('stream-ended');
      }
      return;
    }
    let active = this.active.get(key);
    if (!active) {
      const parent = propagation.extract(
        context.active(),
        record.traceContext ?? {},
      );
      active = {
        span: this.tracer.startSpan(
          'aituber.live.turn',
          {
            attributes: {
              'live.event.type': record.eventType,
              ...(record.priority
                ? { 'live.turn.priority': record.priority }
                : {}),
            },
          },
          parent,
        ),
        startedAt: record.at,
      };
      this.active.set(key, active);
    }

    const stage = record.stage ?? record.eventType;
    active.span.addEvent(`live.${record.eventType}.${stage}`, {
      'live.phase': record.phase,
      'live.queue.depth': record.queueDepth,
      'live.action.kinds': record.actionKinds.join(','),
    });
    if (record.eventType === 'generation' && record.stage === 'started') {
      active.generationStartedAt = record.at;
    }
    if (record.eventType === 'generation' && record.stage === 'completed') {
      this.stageLatency.record(
        Math.max(0, record.at - (active.generationStartedAt ?? active.startedAt)),
        { stage: 'llm-complete' },
      );
    }
    if (record.eventType === 'delivery-observation' && record.stage) {
      this.stageLatency.record(Math.max(0, record.at - active.startedAt), {
        stage: record.stage,
      });
    }

    const failed =
      (record.eventType === 'generation' && record.stage === 'failed') ||
      (record.eventType === 'speech' && record.stage === 'failed') ||
      record.eventType === 'runtime-fault';
    const finished =
      failed ||
      (record.eventType === 'speech' &&
        ['completed', 'interrupted'].includes(record.stage ?? '')) ||
      record.actionKinds.includes('drop');
    if (finished) {
      if (failed) {
        active.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: record.reasonCodes[0] ?? `${record.eventType} failed`,
        });
      } else {
        active.span.setStatus({ code: SpanStatusCode.OK });
      }
      active.span.end();
      this.active.delete(key);
    }
  }

  shutdown(): void {
    this.endAll('telemetry-shutdown');
  }

  private endAll(reason: string): void {
    for (const active of this.active.values()) {
      active.span.addEvent(reason);
      active.span.end();
    }
    this.active.clear();
  }
}
