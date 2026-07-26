import { describe, expect, it, vi } from 'vitest';
import { createRuntimeEventTransport } from '../../examples/react-purupuru-app/src/lib/runtimeEventTransport';

describe('runtime event transport', () => {
  it('bounds slow telemetry requests so owner lease renewals retain a connection', () => {
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>(() => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
        }),
    );
    const transport = createRuntimeEventTransport(fetcher);

    for (let index = 0; index < 20; index += 1) {
      transport.emit(
        { stage: 'flashhead_render_request', index },
        { 'Content-Type': 'application/json' },
      );
    }

    expect(maximumActive).toBeLessThanOrEqual(2);
  });

  it('coalesces queued owner heartbeats to the newest liveness snapshot', async () => {
    const releases: Array<() => void> = [];
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Promise<Response>((resolve) => {
        releases.push(() => resolve(new Response()));
      });
    });
    const transport = createRuntimeEventTransport(fetcher);
    const headers = { 'Content-Type': 'application/json' };

    transport.emit({ stage: 'event-a' }, headers);
    transport.emit({ stage: 'event-b' }, headers);
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      transport.emit({ stage: 'runtime-owner-heartbeat', sequence }, headers);
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(bodies[2]).toMatchObject({
      stage: 'runtime-owner-heartbeat',
      sequence: 10,
    });
  });
});
