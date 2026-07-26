import { describe, expect, it, vi } from 'vitest';
import {
  AvatarRenderRuntime,
  CallbackAvatarRendererAdapter,
  RemoteAvatarRendererAdapter,
  type AvatarRenderFrameV1,
  type AvatarRendererManifestV1,
  type RemoteAvatarRendererTransport,
} from '../src/index.js';

const purupuruManifest: AvatarRendererManifestV1 = {
  protocolVersion: '1.0',
  id: 'purupuru',
  displayName: 'Purupuru 2D',
  maturity: 'stable',
  mode: '2d-sprite',
  quality: 0.65,
  expectedLatencyMs: 16,
  inputs: ['emotion', 'action', 'viseme'],
  hardware: {},
};

const flashHeadManifest: AvatarRendererManifestV1 = {
  protocolVersion: '1.0',
  id: 'soulx-flashhead',
  displayName: 'SoulX FlashHead',
  maturity: 'experimental',
  mode: '2d-video',
  quality: 0.95,
  expectedLatencyMs: 45,
  inputs: ['audio', 'emotion', 'action'],
  hardware: { cuda: true, minVramGb: 16 },
};

const frame: AvatarRenderFrameV1 = {
  protocolVersion: '1.0',
  id: 'frame-1',
  correlationId: 'turn-1',
  sequence: 0,
  at: 1_000,
  emotion: { name: 'warm', intensity: 0.8 },
  actions: [{ kind: 'gesture', name: 'wave' }],
  visemes: [{ atMs: 0, value: 'A', weight: 1 }],
};

describe('AvatarRenderRuntime', () => {
  it('uses the stable local renderer by default', async () => {
    const localRender = vi.fn(async () => undefined);
    const runtime = new AvatarRenderRuntime();
    runtime.register(
      new CallbackAvatarRendererAdapter(purupuruManifest, {
        render: localRender,
      }),
    );

    const receipt = await runtime.render(frame, {
      availableHardware: {},
      allowExperimental: false,
    });

    expect(receipt).toMatchObject({ rendererId: 'purupuru', fallbackUsed: false });
    expect(localRender).toHaveBeenCalledWith(frame, expect.any(AbortSignal));
  });

  it('selects a high-quality remote renderer when hardware and policy allow it', async () => {
    const transport: RemoteAvatarRendererTransport = {
      probe: async () => true,
      render: vi.fn(async () => undefined),
      interrupt: async () => undefined,
      close: async () => undefined,
    };
    const runtime = new AvatarRenderRuntime();
    runtime.register(
      new CallbackAvatarRendererAdapter(purupuruManifest, {
        render: async () => undefined,
      }),
    );
    runtime.register(new RemoteAvatarRendererAdapter(flashHeadManifest, transport));

    const receipt = await runtime.render({ ...frame, audio: new Uint8Array([1, 2]) }, {
      availableHardware: { cuda: true, vramGb: 24 },
      allowExperimental: true,
      quality: 'high',
    });

    expect(receipt.rendererId).toBe('soulx-flashhead');
  });

  it('falls back to the stable renderer and routes interruption to the active adapter', async () => {
    const localInterrupt = vi.fn(async () => undefined);
    const runtime = new AvatarRenderRuntime();
    runtime.register(
      new CallbackAvatarRendererAdapter(purupuruManifest, {
        render: async () => undefined,
        interrupt: localInterrupt,
      }),
    );
    runtime.register(
      new RemoteAvatarRendererAdapter(flashHeadManifest, {
        probe: async () => true,
        render: async () => {
          throw new Error('remote renderer unavailable');
        },
        interrupt: async () => undefined,
        close: async () => undefined,
      }),
    );

    const receipt = await runtime.render({ ...frame, audio: new Uint8Array([1, 2]) }, {
      availableHardware: { cuda: true, vramGb: 24 },
      allowExperimental: true,
      quality: 'high',
    });
    await runtime.interrupt('immediate');

    expect(receipt).toMatchObject({ rendererId: 'purupuru', fallbackUsed: true });
    expect(receipt.failures[0]).toMatchObject({ rendererId: 'soulx-flashhead' });
    expect(localInterrupt).toHaveBeenCalledWith('immediate');
  });
});
