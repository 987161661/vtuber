import { describe, expect, it, vi } from 'vitest';
import { createLiveRuntimeEventRequestHandler } from '../../examples/react-purupuru-app/server/liveRuntimeEventRequest';
import { createLiveRuntimeMonitor } from '../../examples/react-purupuru-app/server/liveRuntimeMonitor';

function createHarness() {
  const monitor = createLiveRuntimeMonitor();
  const logs: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const forwarded: Record<string, unknown>[] = [];
  const attestEvent = vi.fn(async () => ({
    serverCanaryRunId: 'server-run',
    serverCanaryReceivedAt: 2_000,
    serverCanaryAttested: true,
  }));
  const handleRequest = createLiveRuntimeEventRequestHandler({
    monitor,
    now: () => 2_000,
    attestEvent,
    appendRuntimeEvent: async (event) => {
      logs.push(event);
    },
    appendAuditEntry: async (entry) => {
      audits.push(entry);
    },
    forwardEvent: async (event) => {
      forwarded.push(event);
    },
  });
  return { attestEvent, audits, forwarded, handleRequest, logs, monitor };
}

describe('live runtime event request handler', () => {
  it('sanitizes privileged and private fields before every persistence egress', async () => {
    const { attestEvent, audits, forwarded, handleRequest, logs, monitor } =
      createHarness();
    const rawBody = JSON.stringify({
      stage: 'model_output',
      eventId: 'event-1',
      at: 1_500,
      modelRawText: 'private reasoning',
      rawText: 'raw response',
      parsedText: 'parsed response',
      serverCanaryRunId: 'client-spoof',
      serverCanaryReceivedAt: 1,
      serverCanaryAttested: true,
      serverReceivedAt: 1,
      actor: { type: 'system', id: 'runtime-owner' },
    });

    await expect(
      handleRequest({
        rawBody,
        byteLength: Buffer.byteLength(rawBody),
        headers: { 'x-runtime-owner-id': 'owner-a' },
      }),
    ).resolves.toEqual({ ok: true });

    expect(attestEvent).toHaveBeenCalledWith(
      { 'x-runtime-owner-id': 'owner-a' },
      expect.not.objectContaining({ serverCanaryRunId: 'client-spoof' }),
      2_000,
    );
    expect(logs).toEqual([
      expect.objectContaining({
        stage: 'model_output',
        eventId: 'event-1',
        at: 1_500,
        serverReceivedAt: 2_000,
        serverCanaryRunId: 'server-run',
        serverCanaryAttested: true,
      }),
    ]);
    expect(logs[0]).not.toMatchObject({
      modelRawText: expect.anything(),
      rawText: expect.anything(),
      parsedText: expect.anything(),
    });
    expect(audits).toEqual([
      expect.objectContaining({
        category: 'runtime',
        action: 'model_output',
        correlationId: 'event-1',
        status: 'succeeded',
        payload: expect.not.objectContaining({
          modelRawText: expect.anything(),
        }),
      }),
    ]);
    expect(forwarded).toEqual([]);
    expect(monitor.healthSnapshot(2_000).lastEventAt).toBe(1_500);
  });

  it('forwards only operational alert stages with a bounded payload', async () => {
    const { forwarded, handleRequest } = createHarness();
    const rawBody = JSON.stringify({
      stage: 'sanitizer_failure',
      eventId: 'event-alert',
      reasons: ['unsafe_artifact'],
      error: 'sanitizer rejected output',
      unrelated: 'must not reach the external sink',
    });

    await handleRequest({
      rawBody,
      byteLength: Buffer.byteLength(rawBody),
      headers: {},
    });

    expect(forwarded).toEqual([
      {
        event: 'sanitizer_failure',
        channel: 'virtual-runtime',
        requestId: 'event-alert',
        at: 2_000,
        reasons: ['unsafe_artifact'],
        error: 'sanitizer rejected output',
      },
    ]);
  });

  it('rejects oversized input and audits the failure without the raw body', async () => {
    const { attestEvent, audits, handleRequest, logs, monitor } =
      createHarness();

    await expect(
      handleRequest({
        rawBody: '{"secret":"must not be audited"}',
        byteLength: 300_000,
        headers: {},
      }),
    ).rejects.toThrow('live_runtime_event_too_large');

    expect(attestEvent).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
    expect(monitor.healthSnapshot(2_000).lastEventAt).toBe(0);
    expect(audits).toEqual([
      expect.objectContaining({
        category: 'runtime',
        action: 'invalid_event',
        actor: { type: 'system', id: 'runtime-ingress' },
        status: 'failed',
        error: 'live_runtime_event_too_large',
      }),
    ]);
    expect(audits[0]).not.toHaveProperty('payload');
    expect(audits[0]).not.toHaveProperty('request');
  });

  it('normalizes parser failures so malformed input cannot leak into audit errors', async () => {
    const { audits, handleRequest } = createHarness();
    const rawBody = '{"secret":"must-not-appear-in-an-error"';

    await expect(
      handleRequest({
        rawBody,
        byteLength: Buffer.byteLength(rawBody),
        headers: {},
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(audits).toEqual([
      expect.objectContaining({
        action: 'invalid_event',
        status: 'failed',
        error: 'invalid_runtime_event',
      }),
    ]);
    expect(JSON.stringify(audits)).not.toContain('must-not-appear-in-an-error');
  });
});
