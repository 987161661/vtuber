import type { OperatorQueueItem } from '../src/lib/operatorQueue';
import {
  decodeOperatorQueueCommand,
  decodeOperatorQueueIngest,
} from './operatorQueueHttpAdapter';
import type { OperatorQueueRuntime } from './operatorQueueRuntime';

type QueueRuntimePort = Pick<
  OperatorQueueRuntime,
  'execute' | 'get' | 'snapshot'
>;

export type OperatorQueueHttpResult = {
  item?: OperatorQueueItem;
  items: OperatorQueueItem[];
};

export function createOperatorQueueHttpRequestHandler(options: {
  runtime: QueueRuntimePort;
  appendAuditEntry: (entry: Record<string, unknown>) => Promise<void>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;

  return async function executeOperatorQueueHttpRequest(request: {
    method: 'POST' | 'PATCH';
    rawBody: string;
  }): Promise<OperatorQueueHttpResult> {
    let body: Record<string, unknown> = {};
    let action = request.method === 'POST' ? 'ingest' : 'unknown';
    let before: OperatorQueueItem | null = null;

    try {
      body = JSON.parse(request.rawBody) as Record<string, unknown>;
      action = String(
        body.action || (request.method === 'POST' ? 'ingest' : ''),
      ).trim();
      const eventId = String(body.eventId || '').trim();
      before = eventId ? (options.runtime.get(eventId) ?? null) : null;
      const occurredAt = now();

      await options.runtime.execute(
        action === 'ingest' || action === 'manual-broadcast'
          ? decodeOperatorQueueIngest(action, body, {
              items: options.runtime.snapshot(),
              now: occurredAt,
            })
          : decodeOperatorQueueCommand(action, body),
      );

      const actorId = successfulActorId(action, body);
      const after = eventId ? (options.runtime.get(eventId) ?? null) : null;
      await options.appendAuditEntry({
        category: 'operator_queue',
        action,
        actor: {
          type:
            actorId === 'control-room'
              ? 'operator'
              : actorId === 'stress-test'
                ? 'test'
                : 'system',
          id: actorId,
        },
        correlationId: eventId || undefined,
        eventId: eventId || undefined,
        occurredAt,
        status: 'succeeded',
        request: body,
        before,
        after,
      });

      return {
        item: after ?? undefined,
        items: options.runtime.snapshot(),
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'invalid queue request';
      void options
        .appendAuditEntry({
          category: 'operator_queue',
          action,
          actor: {
            type: 'operator',
            id:
              typeof body.auditActor === 'string'
                ? body.auditActor
                : 'unknown-client',
          },
          correlationId:
            typeof body.eventId === 'string' ? body.eventId : undefined,
          eventId: typeof body.eventId === 'string' ? body.eventId : undefined,
          occurredAt: now(),
          status: 'failed',
          request: body,
          before,
          error: reason,
        })
        .catch(() => undefined);
      throw error instanceof Error ? error : new Error(reason);
    }
  };
}

function successfulActorId(
  action: string,
  body: Record<string, unknown>,
): string {
  if (typeof body.auditActor === 'string' && body.auditActor.trim()) {
    return body.auditActor.trim();
  }
  if (['manual-broadcast', 'delete', 'move', 'edit-reply'].includes(action)) {
    return 'control-room';
  }
  return body.testRunId ? 'stress-test' : 'runtime';
}
