import { describe, expect, it, vi } from 'vitest';
import {
  AvatarBehaviorBus,
  createAvatarBehaviorEvent,
  type AvatarBehaviorAdapter,
} from '../src/index.js';

describe('AvatarBehaviorBus', () => {
  it('dispatches the same protocol event to compatible avatar adapters', async () => {
    const expressionDispatch = vi.fn().mockResolvedValue(undefined);
    const motionDispatch = vi.fn().mockResolvedValue(undefined);
    const adapters: AvatarBehaviorAdapter[] = [
      {
        id: 'live2d',
        capabilities: {
          actionKinds: ['expression'],
          emotionNames: '*',
        },
        dispatch: expressionDispatch,
      },
      {
        id: 'vrm-motion',
        capabilities: {
          actionKinds: ['motion'],
          emotionNames: '*',
        },
        dispatch: motionDispatch,
      },
    ];
    const bus = new AvatarBehaviorBus();
    for (const adapter of adapters) bus.register(adapter);
    const event = createAvatarBehaviorEvent(
      { name: 'happy', intensity: 0.8, valence: 0.9 },
      {
        streamId: 'stream-a',
        source: 'proactive-talk',
        speechText: 'Welcome back!',
      },
      [
        { kind: 'expression', name: 'smile', durationMs: 2_000 },
        { kind: 'motion', name: 'small-wave', durationMs: 1_000 },
      ],
      1_000,
    );

    const receipts = await bus.dispatch(event);

    expect(expressionDispatch).toHaveBeenCalledWith({
      ...event,
      actions: [event.actions[0]],
    });
    expect(motionDispatch).toHaveBeenCalledWith({
      ...event,
      actions: [event.actions[1]],
    });
    expect(receipts).toEqual([
      { adapterId: 'live2d', status: 'delivered' },
      { adapterId: 'vrm-motion', status: 'delivered' },
    ]);
  });

  it('isolates adapter failures', async () => {
    const bus = new AvatarBehaviorBus();
    bus.register({
      id: 'broken-adapter',
      capabilities: { actionKinds: '*' },
      dispatch: vi.fn().mockRejectedValue(new Error('renderer offline')),
    });
    const event = createAvatarBehaviorEvent(
      { name: 'neutral', intensity: 0.2 },
      { streamId: 'stream-a', source: 'assistant' },
      [],
      2_000,
    );

    const receipts = await bus.dispatch(event);

    expect(receipts[0]?.status).toBe('failed');
    expect(receipts[0]?.error).toBeInstanceOf(Error);
  });
});
