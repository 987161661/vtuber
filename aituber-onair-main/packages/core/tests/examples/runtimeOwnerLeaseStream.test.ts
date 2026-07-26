import { describe, expect, it, vi } from 'vitest';
import {
  startRuntimeOwnerLeaseStream,
  type RuntimeOwnerEventSourceLike,
} from '../../examples/react-purupuru-app/src/lib/runtimeOwnerLeaseStream';

describe('runtime owner lease event stream', () => {
  it('lets the server own renewal timing while forwarding lease results', () => {
    const source: RuntimeOwnerEventSourceLike = {
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };
    const createEventSource = vi.fn(() => source);
    const onResult = vi.fn();

    const stop = startRuntimeOwnerLeaseStream({
      endpoint: 'http://127.0.0.1:5173/api/live-runtime-owner/stream',
      identity: {
        ownerId: 'owner-a',
        label: 'OBS overlay',
        role: 'obs-overlay',
      },
      createEventSource,
      onResult,
    });

    const url = new URL(createEventSource.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/live-runtime-owner/stream');
    expect(url.searchParams.get('ownerId')).toBe('owner-a');
    expect(url.searchParams.get('role')).toBe('obs-overlay');

    source.onmessage?.({
      data: JSON.stringify({ owns: true, leaseToken: 'lease-a' }),
    } as MessageEvent<string>);
    expect(onResult).toHaveBeenCalledWith({
      type: 'result',
      ok: true,
      payload: { owns: true, leaseToken: 'lease-a' },
    });

    source.onerror?.(new Event('error'));
    expect(onResult).toHaveBeenLastCalledWith({ type: 'result', ok: false });

    stop();
    expect(source.close).toHaveBeenCalledOnce();
  });
});
