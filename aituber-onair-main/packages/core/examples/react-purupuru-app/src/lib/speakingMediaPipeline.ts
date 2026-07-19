import { parseFlashHeadBundle } from './flashheadBundle';

export type SpeakingAvatarEngine = 'flashhead' | 'musetalk';

export type RenderedSpeakingMedia = {
  videoUrl: string;
  audioBuffer: ArrayBuffer;
  durationSeconds: number;
};

export type SpeakingRenderOptions = {
  reset?: boolean;
  end?: boolean;
  sequence?: number;
};

export type SpeakingMediaResult = {
  chunkCount: number;
  sourceByteLength: number;
  playedByteLength: number;
  rendererProducedMedia: boolean;
};

type PlaybackCallbacks = {
  onStart?: () => void;
  onVisualStart?: () => void;
};

export type SpeakingMediaPipelineOptions = {
  engine: SpeakingAvatarEngine;
  renderer: {
    render(
      audio: ArrayBuffer,
      options?: SpeakingRenderOptions,
    ): Promise<RenderedSpeakingMedia | null>;
  };
  playback: {
    play(audio: ArrayBuffer, callbacks?: PlaybackCallbacks): Promise<unknown>;
    stop(): void;
    beginQueue(): unknown;
    enqueue(
      audio: ArrayBuffer,
      callbacks?: PlaybackCallbacks,
    ): Promise<unknown>;
    finishQueue(): Promise<unknown>;
    timeoutMs(audio: ArrayBuffer): Promise<number>;
  };
  lifecycle: {
    onSourceChunk(byteLength: number): void;
    onFirstAudio(byteLength: number): void;
    onPlaybackStarted(): void;
    onFinished(): void;
  };
  visual?: {
    show(url: string | null): void;
    waitUntilVisible(): Promise<void>;
    release(url: string): void;
  };
  capture?: (chunks: ArrayBuffer[]) => Promise<void>;
  emit?: (event: Record<string, unknown>) => void;
  scheduler: {
    set(callback: () => void, delayMs: number): number;
    clear(timer: number): void;
  };
  flashHeadStartBufferSeconds?: number;
  flashHeadPlaybackStartWaitMs?: number;
};

const DEFAULT_FLASHHEAD_START_BUFFER_SECONDS = 2.5;
const DEFAULT_FLASHHEAD_PLAYBACK_START_WAIT_MS = 2_800;

export async function getAudioPlaybackTimeoutMs(audio: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([audio.slice(0)]));
  try {
    const duration = await new Promise<number>((resolve) => {
      const element = new Audio();
      const timeout = window.setTimeout(() => resolve(Number.NaN), 3_000);
      const finish = (value: number) => {
        window.clearTimeout(timeout);
        element.removeAttribute('src');
        resolve(value);
      };
      element.preload = 'metadata';
      element.onloadedmetadata = () => finish(element.duration);
      element.onerror = () => finish(Number.NaN);
      element.src = url;
    });
    return Number.isFinite(duration)
      ? Math.ceil((duration + 2) * 1_000)
      : 30_000;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function concatenate(chunks: ArrayBuffer[]): ArrayBuffer {
  const byteLength = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const complete = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    complete.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return complete.buffer;
}

export function createSpeakingMediaPipeline(
  options: SpeakingMediaPipelineOptions,
) {
  const {
    engine,
    renderer,
    playback,
    lifecycle,
    visual,
    capture,
    emit,
    scheduler,
  } = options;
  const startBufferSeconds =
    options.flashHeadStartBufferSeconds ??
    DEFAULT_FLASHHEAD_START_BUFFER_SECONDS;
  const playbackStartWaitMs =
    options.flashHeadPlaybackStartWaitMs ??
    DEFAULT_FLASHHEAD_PLAYBACK_START_WAIT_MS;

  const reportSourceChunk = (
    byteLength: number,
    state: { firstAudioSeen: boolean },
  ) => {
    lifecycle.onSourceChunk(byteLength);
    if (byteLength <= 0 || state.firstAudioSeen) return;
    state.firstAudioSeen = true;
    lifecycle.onFirstAudio(byteLength);
  };

  const playFull = async (
    sourceAudio: ArrayBuffer,
  ): Promise<SpeakingMediaResult> => {
    const sourceState = { firstAudioSeen: false };
    reportSourceChunk(sourceAudio.byteLength, sourceState);
    if (capture) await capture([sourceAudio.slice(0)]);
    const rendered = await renderer.render(sourceAudio, {
      reset: true,
      end: true,
    });
    const audio = rendered?.audioBuffer ?? sourceAudio;
    const videoUrl = rendered?.videoUrl ?? null;
    const timeoutMs = await playback.timeoutMs(audio);
    if (videoUrl && visual) {
      visual.show(videoUrl);
      await visual.waitUntilVisible();
    }
    try {
      await Promise.race([
        playback.play(audio, {
          onStart: () => lifecycle.onPlaybackStarted(),
        }),
        new Promise<void>((resolve) => scheduler.set(resolve, timeoutMs)),
      ]);
    } finally {
      playback.stop();
      if (videoUrl && visual) {
        visual.show(null);
        visual.release(videoUrl);
      }
    }
    lifecycle.onFinished();
    return {
      chunkCount: 1,
      sourceByteLength: sourceAudio.byteLength,
      playedByteLength: audio.byteLength,
      rendererProducedMedia: rendered !== null,
    };
  };

  const playStream = async (
    audioStream: AsyncIterable<ArrayBuffer>,
  ): Promise<SpeakingMediaResult> => {
    playback.beginQueue();
    const iterator = audioStream[Symbol.asyncIterator]();
    let current = await iterator.next();
    if (current.done) {
      await playback.finishQueue();
      return {
        chunkCount: 0,
        sourceByteLength: 0,
        playedByteLength: 0,
        rendererProducedMedia: false,
      };
    }

    const sourceState = { firstAudioSeen: false };
    const sourceChunks: ArrayBuffer[] = [];
    const capturedChunks: ArrayBuffer[] = [];
    let sourceByteLength = 0;
    let playedByteLength = 0;
    let chunkCount = 0;
    let sequence = 0;
    let firstPlayable = true;
    let playbackStarted = engine !== 'flashhead';
    let rendererProducedMedia = false;
    let stagedDuration = 0;
    const stagedMedia: RenderedSpeakingMedia[] = [];
    const generatedVideoUrls: string[] = [];
    let startDeadlineTimer: number | null = null;

    const acceptSourceChunk = (audio: ArrayBuffer) => {
      const copy = audio.slice(0);
      sourceChunks.push(copy);
      if (capture) capturedChunks.push(copy.slice(0));
      chunkCount += 1;
      sourceByteLength += audio.byteLength;
      reportSourceChunk(audio.byteLength, sourceState);
    };

    const enqueuePlayable = async (
      audio: ArrayBuffer,
      videoUrl?: string,
    ) => {
      const isFirst = firstPlayable;
      if (videoUrl) generatedVideoUrls.push(videoUrl);
      await playback.enqueue(audio, {
        onVisualStart:
          videoUrl && visual ? () => visual.show(videoUrl) : undefined,
        onStart: isFirst ? () => lifecycle.onPlaybackStarted() : undefined,
      });
      firstPlayable = false;
      playedByteLength += audio.byteLength;
    };

    const startStagedPlayback = async () => {
      if (playbackStarted || stagedMedia.length === 0) return;
      playbackStarted = true;
      if (startDeadlineTimer !== null) {
        scheduler.clear(startDeadlineTimer);
        startDeadlineTimer = null;
      }
      for (const staged of stagedMedia.splice(0)) {
        await enqueuePlayable(staged.audioBuffer, staged.videoUrl);
      }
    };

    const stageOrEnqueue = async (
      rendered: RenderedSpeakingMedia,
      forceStart = false,
    ) => {
      if (playbackStarted) {
        await enqueuePlayable(rendered.audioBuffer, rendered.videoUrl);
        return;
      }
      stagedMedia.push(rendered);
      stagedDuration += rendered.durationSeconds;
      if (startDeadlineTimer === null) {
        startDeadlineTimer = scheduler.set(
          () => void startStagedPlayback(),
          playbackStartWaitMs,
        );
      }
      if (!forceStart && stagedDuration < startBufferSeconds) return;
      await startStagedPlayback();
    };

    const enqueueFallback = async (audio: ArrayBuffer) => {
      if (!playbackStarted) {
        playbackStarted = true;
        if (startDeadlineTimer !== null) {
          scheduler.clear(startDeadlineTimer);
          startDeadlineTimer = null;
        }
      }
      emit?.({
        stage: 'flashhead_audio_fallback',
        byteLength: audio.byteLength,
        reason: 'renderer_returned_no_playable_media',
      });
      await enqueuePlayable(audio);
    };

    acceptSourceChunk(current.value);
    let renderPromise = renderer.render(current.value, {
      reset: true,
      sequence,
    });

    while (!current.done) {
      const sourceAudio = current.value;
      const nextPromise = iterator.next();
      const rendered = await renderPromise;
      if (rendered) {
        rendererProducedMedia = true;
        await stageOrEnqueue(rendered);
      } else if (sourceAudio.byteLength > 0) {
        if (engine === 'flashhead') {
          emit?.({
            stage: 'flashhead_fragment_deferred',
            byteLength: sourceAudio.byteLength,
            reason: 'renderer_session_will_flush_tail',
          });
        } else {
          await enqueueFallback(sourceAudio);
        }
      }

      const next = await nextPromise;
      if (!next.done) {
        acceptSourceChunk(next.value);
        renderPromise = renderer.render(next.value, { sequence: ++sequence });
      }
      current = next;
    }

    if (engine === 'flashhead') {
      const finalRendered = await renderer.render(new ArrayBuffer(0), {
        end: true,
        sequence: ++sequence,
      });
      if (finalRendered) {
        rendererProducedMedia = true;
        await stageOrEnqueue(finalRendered, true);
      }
      if (!rendererProducedMedia && sourceChunks.length > 0) {
        await enqueueFallback(concatenate(sourceChunks));
      }
    }
    if (!playbackStarted && stagedMedia.length > 0) {
      await startStagedPlayback();
    }
    if (startDeadlineTimer !== null) scheduler.clear(startDeadlineTimer);
    if (capture && capturedChunks.length > 0) await capture(capturedChunks);
    await playback.finishQueue();
    visual?.show(null);
    for (const url of generatedVideoUrls) visual?.release(url);
    lifecycle.onFinished();
    return {
      chunkCount,
      sourceByteLength,
      playedByteLength,
      rendererProducedMedia,
    };
  };

  return { playFull, playStream };
}

export type SpeakingRenderTrace = {
  requestId: string;
  source: 'chat' | 'live' | 'vision';
  text: string;
};

export type SpeakingAvatarHttpRendererOptions = {
  enabled: boolean;
  engine: SpeakingAvatarEngine;
  timeoutMs?: number;
  getTrace(): SpeakingRenderTrace | null;
  getEventId(): string | undefined;
  emit(event: Record<string, unknown>): void;
  onFirstFrame(): void;
  now?: () => number;
};

export function createSpeakingAvatarHttpRenderer(
  options: SpeakingAvatarHttpRendererOptions,
) {
  const now = options.now ?? Date.now;
  return {
    async render(
      audio: ArrayBuffer,
      renderOptions: SpeakingRenderOptions = {},
    ): Promise<RenderedSpeakingMedia | null> {
      if (!options.enabled) return null;
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 6_000,
      );
      const requestedAt = now();
      try {
        const parameters = new URLSearchParams();
        if (renderOptions.reset) parameters.set('reset', 'true');
        if (renderOptions.end) parameters.set('end', 'true');
        const trace = options.getTrace();
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'X-Avatar-Caller': 'react-purupuru-app',
          'X-Avatar-Sequence': String(renderOptions.sequence ?? 0),
        };
        if (trace) {
          headers['X-Avatar-Request-Id'] = trace.requestId;
          headers['X-Avatar-Source'] = trace.source;
          if (renderOptions.reset) {
            headers['X-Avatar-Text'] = encodeURIComponent(
              trace.text.slice(0, 1_000),
            );
          }
        }
        options.emit({
          eventId: options.getEventId(),
          stage: `${options.engine}_render_request`,
          at: requestedAt,
          sequence: renderOptions.sequence ?? 0,
          byteLength: audio.byteLength,
          reset: renderOptions.reset === true,
          end: renderOptions.end === true,
        });
        const response = await fetch(
          `/api/${options.engine}/render?${parameters.toString()}`,
          {
            method: 'POST',
            headers,
            body: audio.slice(0),
            signal: controller.signal,
          },
        );
        const headersAt = now();
        options.emit({
          eventId: options.getEventId(),
          stage: `${options.engine}_render_headers`,
          at: headersAt,
          sequence: renderOptions.sequence ?? 0,
          requestToHeadersMs: headersAt - requestedAt,
          status: response.status,
        });
        if (response.status === 204) return null;
        if (!response.ok) {
          throw new Error(`${options.engine} returned ${response.status}`);
        }
        const payload = new Uint8Array(await response.arrayBuffer());
        options.emit({
          eventId: options.getEventId(),
          stage: `${options.engine}_render_completed`,
          at: now(),
          sequence: renderOptions.sequence ?? 0,
          requestToMediaMs: now() - requestedAt,
          payloadByteLength: payload.byteLength,
        });
        const { audioBuffer, videoBuffer } = parseFlashHeadBundle(payload);
        const frameCount = Number(response.headers.get('X-FlashHead-Frames'));
        if (Number.isFinite(frameCount) && frameCount > 0) {
          options.onFirstFrame();
        }
        return {
          audioBuffer,
          videoUrl: URL.createObjectURL(
            new Blob([videoBuffer], { type: 'video/webm' }),
          ),
          durationSeconds:
            Number.isFinite(frameCount) && frameCount > 0
              ? frameCount / 25
              : 0,
        };
      } catch (error) {
        console.warn(
          `${options.engine} unavailable; using the idle avatar.`,
          error,
        );
        options.emit({
          eventId: options.getEventId(),
          stage: `${options.engine}_render_failed`,
          at: now(),
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        window.clearTimeout(timeout);
      }
    },
  };
}
