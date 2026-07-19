import { describe, expect, it, vi } from 'vitest';
import { createOperatorQueueClient } from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('operator queue client', () => {
  it('reads the observer snapshot through the queue interface', async () => {
    const request = vi.fn(async () => jsonResponse({ items: [{ eventId: 'e' }] }));
    const client = createOperatorQueueClient({ request });

    const items = await client.list('control-panel');

    expect(items).toEqual([{ eventId: 'e' }]);
    expect(request).toHaveBeenCalledWith(
      '/api/operator-queue?observer=control-panel',
      { cache: 'no-store' },
    );
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
    const request = vi.fn(async () => new Response('invalid queue item', { status: 400 }));
    const client = createOperatorQueueClient({ request });

    await expect(
      client.ingest({
        eventId: 'event-1',
        text: 'hello',
        source: 'viewer-chat',
        sourceLabel: 'viewer',
      }),
    ).rejects.toThrow(
      'operator queue ingest failed (400): invalid queue item',
    );
  });
});
