import { describe, expect, it, vi } from 'vitest';
import {
  createSpeakingMediaPipeline,
  type SpeakingMediaPipelineOptions,
} from '../../examples/react-purupuru-app/src/lib/speakingMediaPipeline';

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function createHarness(
  overrides: Partial<SpeakingMediaPipelineOptions> = {},
) {
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
});
