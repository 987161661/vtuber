import { describe, expect, it, vi } from 'vitest';
import {
  createOperatorQueueClient,
  projectOperatorQueueItems,
  type OperatorQueueItem,
} from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function queueItem(
  input: Pick<OperatorQueueItem, 'eventId' | 'status'> &
    Partial<OperatorQueueItem>,
): OperatorQueueItem {
  return {
    text: input.eventId,
    source: 'test',
    sourceLabel: 'test',
    sourcesSeen: ['test'],
    createdAt: 1,
    updatedAt: 1,
    order: 1,
    ...input,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('operator queue client', () => {
  it('reads the observer snapshot through the queue interface', async () => {
    const request = vi.fn(async () =>
      jsonResponse({ items: [{ eventId: 'e' }] }),
    );
    const client = createOperatorQueueClient({ request });

    const items = await client.list('control-panel');

    expect(items).toEqual([{ eventId: 'e' }]);
    expect(request).toHaveBeenCalledWith(
      '/api/operator-queue?observer=control-panel',
      { cache: 'no-store' },
    );
  });

  it('encodes a scoped session projection without exposing legacy records', async () => {
    const request = vi.fn(async () => jsonResponse({ items: [] }));
    const client = createOperatorQueueClient({ request });

    await client.list({
      observer: 'control-panel',
      view: 'session',
      scope: {
        personaId: 'host-1',
        platform: 'bilibili',
        roomId: 'room-1',
        sessionId: 'session-1',
      },
      includeTestRuns: true,
    });

    expect(request).toHaveBeenCalledWith(
      '/api/operator-queue?observer=control-panel&view=session&includeTestRuns=1&personaId=host-1&platform=bilibili&roomId=room-1&sessionId=session-1',
      { cache: 'no-store' },
    );
  });

  it('returns server-side history totals independently of the page size', async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        items: [{ eventId: 'recent' }],
        summary: {
          total: 581,
          active: 0,
          done: 455,
          skipped: 50,
          failed: 65,
          archived: 11,
        },
      }),
    );
    const client = createOperatorQueueClient({ request });

    const page = await client.page({ view: 'history', limit: 200 });

    expect(page.items).toHaveLength(1);
    expect(page.summary).toMatchObject({ total: 581, archived: 11 });
  });

  it('projects history to one live session when a scope is supplied', () => {
    const currentScope = {
      personaId: 'host-1',
      platform: 'bilibili',
      roomId: 'room-1',
      sessionId: 'session-1',
    };
    expect(
      projectOperatorQueueItems(
        [
          queueItem({
            eventId: 'current',
            status: 'done',
            scope: currentScope,
          }),
          queueItem({
            eventId: 'previous',
            status: 'done',
            scope: { ...currentScope, sessionId: 'session-0' },
          }),
        ],
        { view: 'history', scope: currentScope },
      ).map((item) => item.eventId),
    ).toEqual(['current']);
  });

  it('keeps manual broadcast on the authoritative ready-queue command', async () => {
    const request = vi.fn(async () => jsonResponse({ items: [] }));
    const client = createOperatorQueueClient({
      request,
      now: () => 10_000,
      createId: () => 'manual-1',
    });

    expect(await client.manualBroadcast('  prepared announcement  ')).toBe(
      true,
    );
    expect(await client.manualBroadcast('   ')).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      action: 'manual-broadcast',
      eventId: 'manual-1',
      text: 'prepared announcement',
      reply: 'prepared announcement',
      source: 'operator-manual',
      sourceLabel: '总控手动播报',
      viewerName: '主播总控',
      sourcesSeen: ['operator-manual'],
      createdAt: 10_000,
      auditActor: 'control-room',
    });
  });

  it('reports a bounded server reason when ingest is rejected', async () => {
    const request = vi.fn(
      async () => new Response('invalid queue item', { status: 400 }),
    );
    const client = createOperatorQueueClient({ request });

    await expect(
      client.ingest({
        eventId: 'event-1',
        text: 'hello',
        source: 'viewer-chat',
        sourceLabel: 'viewer',
      }),
    ).rejects.toThrow('operator queue ingest failed (400): invalid queue item');
  });
});
