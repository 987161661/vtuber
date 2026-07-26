import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeakingAvatarHttpRenderer,
  createSpeakingMediaPipeline,
  type SpeakingMediaPipelineOptions,
} from '../../examples/react-purupuru-app/src/lib/speakingMediaPipeline';

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function createHarness(overrides: Partial<SpeakingMediaPipelineOptions> = {}) {
  const played: number[][] = [];
  const queued: number[][] = [];
  const released: string[] = [];
  const lifecycle = {
    onSourceChunk: vi.fn(),
    onFirstAudio: vi.fn(),
    onPlaybackStarted: vi.fn(),
    onFinished: vi.fn(),
  };
  const options: SpeakingMediaPipelineOptions = {
    engine: 'flashhead',
    renderer: { render: vi.fn(async () => null) },
    playback: {
      play: vi.fn(async (audio, callbacks) => {
        played.push(Array.from(new Uint8Array(audio)));
        callbacks?.onStart?.();
      }),
      stop: vi.fn(),
      beginQueue: vi.fn(),
      enqueue: vi.fn(async (audio, callbacks) => {
        queued.push(Array.from(new Uint8Array(audio)));
        callbacks?.onStart?.();
      }),
      finishQueue: vi.fn(async () => undefined),
      timeoutMs: vi.fn(async () => 30_000),
    },
    lifecycle,
    visual: {
      show: vi.fn(),
      waitUntilVisible: vi.fn(async () => undefined),
      release: vi.fn((url) => released.push(url)),
    },
    scheduler: {
      set: vi.fn(() => 1),
      clear: vi.fn(),
    },
    ...overrides,
  };
  return {
    pipeline: createSpeakingMediaPipeline(options),
    options,
    lifecycle,
    played,
    queued,
    released,
  };
}

describe('speaking media pipeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays renderer-aligned media through the full-audio entry point', async () => {
    const renderer = {
      render: vi.fn(async () => ({
        audioBuffer: bytes(8, 9),
        videoUrl: 'blob:aligned-video',
        durationSeconds: 1,
      })),
    };
    const harness = createHarness({ renderer });

    const result = await harness.pipeline.playFull(bytes(1, 2, 3));

    expect(result).toEqual({
      chunkCount: 1,
      sourceByteLength: 3,
      playedByteLength: 2,
      rendererProducedMedia: true,
    });
    expect(renderer.render).toHaveBeenCalledWith(bytes(1, 2, 3), {
      reset: true,
      end: true,
    });
    expect(harness.played).toEqual([[8, 9]]);
    expect(harness.lifecycle.onFirstAudio).toHaveBeenCalledWith(3);
    expect(harness.lifecycle.onPlaybackStarted).toHaveBeenCalledOnce();
    expect(harness.options.visual?.show).toHaveBeenNthCalledWith(
      1,
      'blob:aligned-video',
    );
    expect(harness.options.visual?.show).toHaveBeenLastCalledWith(null);
    expect(harness.released).toEqual(['blob:aligned-video']);
    expect(harness.lifecycle.onFinished).toHaveBeenCalledOnce();
  });

  it('flushes one complete source buffer when FlashHead returns no stream media', async () => {
    const harness = createHarness();
    async function* stream() {
      yield bytes(1, 2);
      yield bytes(3);
    }

    const result = await harness.pipeline.playStream(stream());

    expect(result).toEqual({
      chunkCount: 2,
      sourceByteLength: 3,
      playedByteLength: 3,
      rendererProducedMedia: false,
    });
    expect(harness.queued).toEqual([[1, 2, 3]]);
    expect(harness.lifecycle.onSourceChunk).toHaveBeenCalledTimes(2);
    expect(harness.lifecycle.onFirstAudio).toHaveBeenCalledWith(2);
    expect(harness.options.renderer.render).toHaveBeenLastCalledWith(
      new ArrayBuffer(0),
      { end: true, sequence: 2 },
    );
    expect(harness.options.playback.finishQueue).toHaveBeenCalledOnce();
    expect(harness.lifecycle.onFinished).toHaveBeenCalledOnce();
  });

  it('starts a short FlashHead stream by its deadline so later speech is not blocked', async () => {
    let releaseStream!: () => void;
    const streamMayContinue = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    let startupDeadline: (() => void) | undefined;
    const renderer = {
      render: vi
        .fn()
        .mockResolvedValueOnce({
          audioBuffer: bytes(10),
          videoUrl: 'blob:first-video',
          durationSeconds: 0.4,
        })
        .mockResolvedValueOnce({
          audioBuffer: bytes(20),
          videoUrl: 'blob:second-video',
          durationSeconds: 0.5,
        })
        .mockResolvedValueOnce(null),
    };
    const harness = createHarness({
      renderer,
      flashHeadStartBufferSeconds: 2.5,
      flashHeadPlaybackStartWaitMs: 2_800,
      scheduler: {
        set: vi.fn((callback) => {
          startupDeadline = callback;
          return 1;
        }),
        clear: vi.fn(),
      },
    });
    async function* stream() {
      yield bytes(1);
      await streamMayContinue;
      yield bytes(2);
    }

    const playing = harness.pipeline.playStream(stream());
    await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledOnce());

    expect(harness.queued).toEqual([]);
    expect(startupDeadline).toBeTypeOf('function');

    startupDeadline?.();
    await vi.waitFor(() => expect(harness.queued).toEqual([[10]]));

    releaseStream();
    await playing;

    expect(harness.queued).toEqual([[10], [20]]);
    expect(harness.lifecycle.onPlaybackStarted).toHaveBeenCalledOnce();
  });

  it('preserves a middle source chunk when its FlashHead render fails', async () => {
    const emit = vi.fn();
    const renderer = {
      render: vi
        .fn()
        .mockResolvedValueOnce({
          audioBuffer: bytes(10),
          videoUrl: 'blob:first-video',
          durationSeconds: 1,
        })
        .mockResolvedValueOnce({
          fallbackAudioBuffer: bytes(2),
          failureReason: 'flashhead returned 500',
        })
        .mockResolvedValueOnce(null),
    };
    const harness = createHarness({
      renderer,
      emit,
      flashHeadStartBufferSeconds: 0,
    });
    async function* stream() {
      yield bytes(1);
      yield bytes(2);
      yield bytes(3);
    }

    await harness.pipeline.playStream(stream());

    expect(harness.queued).toEqual([[10], [2, 3]]);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'flashhead_stream_degraded',
        reason: 'flashhead returned 500',
      }),
    );
  });

  it('recovers from one transient FlashHead proxy 500', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('proxy connection failed', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const emit = vi.fn();
    const renderer = createSpeakingAvatarHttpRenderer({
      enabled: true,
      engine: 'flashhead',
      getTrace: () => null,
      getEventId: () => 'event-1',
      emit,
      onFirstFrame: vi.fn(),
    });

    await expect(
      renderer.render(bytes(1, 2, 3), { reset: true, sequence: 0 }),
    ).resolves.toBeNull();

    expect(request).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'flashhead_render_retry',
        status: 500,
      }),
    );
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'flashhead_render_failed' }),
    );
  });

  it('does not retry a FlashHead service-side render failure', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: 'FlashHead render failed: RuntimeError: CUDA failure',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const emit = vi.fn();
    const renderer = createSpeakingAvatarHttpRenderer({
      enabled: true,
      engine: 'flashhead',
      getTrace: () => null,
      getEventId: () => 'event-2',
      emit,
      onFirstFrame: vi.fn(),
    });

    await expect(
      renderer.render(bytes(1, 2, 3), { sequence: 1 }),
    ).resolves.toEqual({
      fallbackAudioBuffer: bytes(1, 2, 3),
      failureReason: expect.stringContaining('CUDA failure'),
    });

    expect(request).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'flashhead_render_failed',
        reason: expect.stringContaining('CUDA failure'),
      }),
    );
  });
});
