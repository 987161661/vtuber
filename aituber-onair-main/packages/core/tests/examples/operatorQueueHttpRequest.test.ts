import { describe, expect, it, vi } from 'vitest';
import { createOperatorQueueHttpRequestHandler } from '../../examples/react-purupuru-app/server/operatorQueueHttpRequest';
import {
  createOperatorQueueRuntime,
  type OperatorQueueRuntimeStore,
} from '../../examples/react-purupuru-app/server/operatorQueueRuntime';

function createHarness() {
  const store: OperatorQueueRuntimeStore = {
    read: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
  };
  const runtime = createOperatorQueueRuntime({ store, now: () => 10_000 });
  const audits: Record<string, unknown>[] = [];
  const executeRequest = createOperatorQueueHttpRequestHandler({
    runtime,
    now: () => 10_000,
    appendAuditEntry: async (entry) => {
      audits.push(entry);
    },
  });
  return { audits, executeRequest, runtime };
}

describe('operator queue HTTP request handler', () => {
  it('executes a normalized request and returns its durable audit result', async () => {
    const { audits, executeRequest } = createHarness();

    const result = await executeRequest({
      method: 'POST',
      rawBody: JSON.stringify({
        action: 'manual-broadcast',
        eventId: ' manual-1 ',
        text: 'announce',
        reply: 'prepared reply',
        source: 'operator-manual',
      }),
    });

    expect(result.item).toMatchObject({
      eventId: 'manual-1',
      status: 'ready',
      preparedReply: 'prepared reply',
    });
    expect(result.items).toHaveLength(1);
    expect(audits).toEqual([
      expect.objectContaining({
        category: 'operator_queue',
        action: 'manual-broadcast',
        actor: { type: 'operator', id: 'control-room' },
        correlationId: 'manual-1',
        eventId: 'manual-1',
        occurredAt: 10_000,
        status: 'succeeded',
        before: null,
        after: expect.objectContaining({ eventId: 'manual-1' }),
      }),
    ]);
  });

  it('records rejected mutations with the original request context', async () => {
    const { audits, executeRequest } = createHarness();

    await expect(
      executeRequest({
        method: 'PATCH',
        rawBody: JSON.stringify({
          action: 'unknown-action',
          eventId: 'event-404',
          auditActor: 'runtime-probe',
        }),
      }),
    ).rejects.toThrow('invalid queue action');

    expect(audits).toEqual([
      expect.objectContaining({
        category: 'operator_queue',
        action: 'unknown-action',
        actor: { type: 'operator', id: 'runtime-probe' },
        correlationId: 'event-404',
        eventId: 'event-404',
        occurredAt: 10_000,
        status: 'failed',
        request: expect.objectContaining({ eventId: 'event-404' }),
        before: null,
        error: 'invalid queue action',
      }),
    ]);
  });
});
