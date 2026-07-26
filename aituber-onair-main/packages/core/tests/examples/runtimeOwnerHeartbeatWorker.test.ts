import { describe, expect, it, vi } from 'vitest';
import {
  startRuntimeOwnerHeartbeatWorker,
  type RuntimeOwnerHeartbeatWorkerLike,
} from '../../examples/react-purupuru-app/src/lib/runtimeOwnerHeartbeatWorker';

describe('runtime owner heartbeat worker', () => {
  it('keeps lease scheduling outside the throttled iframe main thread', () => {
    let messageHandler:
      | ((event: MessageEvent<Record<string, unknown>>) => void)
      | null = null;
    const worker: RuntimeOwnerHeartbeatWorkerLike = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      set onmessage(handler) {
        messageHandler = handler;
      },
      get onmessage() {
        return messageHandler;
      },
    };
    const onResult = vi.fn();
    const createWorker = vi.fn(() => worker);

    const stop = startRuntimeOwnerHeartbeatWorker({
      createWorker,
      endpoint: 'http://127.0.0.1:5173/api/live-runtime-owner',
      heartbeatMs: 3_000,
      identity: {
        ownerId: 'owner-a',
        label: 'OBS overlay',
        role: 'obs-overlay',
      },
      onResult,
    });

    expect(createWorker).toHaveBeenCalledWith(
      expect.stringContaining('setInterval'),
    );
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'start',
      endpoint: 'http://127.0.0.1:5173/api/live-runtime-owner',
      heartbeatMs: 3_000,
      identity: {
        ownerId: 'owner-a',
        label: 'OBS overlay',
        role: 'obs-overlay',
      },
    });

    messageHandler?.({
      data: { type: 'result', ok: true, payload: { owns: true } },
    } as MessageEvent<Record<string, unknown>>);
    expect(onResult).toHaveBeenCalledWith({
      type: 'result',
      ok: true,
      payload: { owns: true },
    });

    stop();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
