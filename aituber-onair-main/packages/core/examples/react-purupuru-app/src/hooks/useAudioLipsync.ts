import { useCallback, useEffect, useRef, useState } from 'react';

/** Number of mouth animation levels (0-4) */
const MOUTH_LEVELS = 5;
/** Smoothing factor (higher means smoother) */
const SMOOTH_FACTOR = 0.5;
/** RMS normalization ceiling (this value maps to 1.0) */
const RMS_CEILING = 0.12;
/** Raise the stream voice above the avatar/background mix. */
const SPEECH_VOLUME_GAIN = 1.8;
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 1_500;

type AudioContextWindow = Window & {
  __aituberSharedAudioContext?: AudioContext;
};

interface PlayAudioOptions {
  onStart?: () => void;
}

interface QueueAudioOptions extends PlayAudioOptions {
  onVisualStart?: () => void;
}

interface QueuedAudio {
  startAt: number;
  duration: number;
  ended: Promise<void>;
}

export function useAudioLipsync() {
  const [mouthLevel, setMouthLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [smoothedValue, setSmoothedValue] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queuedSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const queueTimersRef = useRef<Set<number>>(new Set());
  const queueEndTimeRef = useRef(0);
  const queueHasAudioRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const rafRef = useRef<number>(0);
  const smoothedRef = useRef(0);

  const getAudioContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      const sharedWindow = window as AudioContextWindow;
      const shared = sharedWindow.__aituberSharedAudioContext;
      ctxRef.current =
        shared && shared.state !== 'closed' ? shared : new AudioContext();
      sharedWindow.__aituberSharedAudioContext = ctxRef.current;
    }
    return ctxRef.current;
  }, []);

  const resumeAudioContext = useCallback(async (ctx: AudioContext) => {
    if (ctx.state === 'running') return;
    let timer: number | null = null;
    try {
      await Promise.race([
        ctx.resume(),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error('audio_context_resume_timeout')),
            AUDIO_CONTEXT_RESUME_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
    if ((ctx.state as string) !== 'running')
      throw new Error('audio_context_locked');
  }, []);

  // Must be called directly from a user gesture. Creating/resuming Web Audio
  // only after the LLM round-trip can be blocked by browser autoplay policy,
  // leaving a successful TTS request completely silent.
  const unlock = useCallback(async (): Promise<void> => {
    const ctx = getAudioContext();
    await resumeAudioContext(ctx);
  }, [getAudioContext, resumeAudioContext]);

  const stopCurrent = useCallback(() => {
    playbackGenerationRef.current += 1;
    // Stop the currently playing source
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    for (const source of queuedSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    queuedSourcesRef.current.clear();
    for (const timer of queueTimersRef.current) {
      window.clearTimeout(timer);
    }
    queueTimersRef.current.clear();
    queueEndTimeRef.current = 0;
    queueHasAudioRef.current = false;
    // Stop the animation loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    smoothedRef.current = 0;
    setMouthLevel(0);
    setSmoothedValue(0);
    setIsSpeaking(false);
  }, []);

  const ensureAnalyser = useCallback((ctx: AudioContext) => {
    if (analyserRef.current && analyserRef.current.context !== ctx) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    }
    return analyserRef.current;
  }, []);

  const startAnalysis = useCallback(() => {
    if (rafRef.current || !analyserRef.current) return;
    const dataArray = new Float32Array(analyserRef.current.fftSize);
    const tick = () => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      analyser.getFloatTimeDomainData(dataArray);
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSq += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      smoothedRef.current =
        smoothedRef.current * SMOOTH_FACTOR + rms * (1 - SMOOTH_FACTOR);
      const normalized = Math.min(smoothedRef.current / RMS_CEILING, 1);
      setMouthLevel(
        Math.min(Math.round(normalized * (MOUTH_LEVELS - 1)), MOUTH_LEVELS - 1),
      );
      setSmoothedValue(smoothedRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(
    async (
      arrayBuffer: ArrayBuffer,
      options?: PlayAudioOptions,
    ): Promise<void> => {
      // Stop previous playback
      stopCurrent();

      const ctx = getAudioContext();
      await resumeAudioContext(ctx);

      // Decode audio data
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

      // Node chain: source -> gain -> analyser -> destination
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gain = ctx.createGain();
      gain.gain.value = SPEECH_VOLUME_GAIN;

      const analyser = ensureAnalyser(ctx);

      source.connect(gain);
      gain.connect(analyser);

      sourceRef.current = source;
      analyserRef.current = analyser;
      setIsSpeaking(true);

      startAnalysis();

      // Cleanup when playback ends
      return new Promise<void>((resolve) => {
        let settled = false;
        const fallbackTimer = window.setTimeout(
          () => finish(),
          Math.ceil((audioBuffer.duration + 2) * 1000),
        );

        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(fallbackTimer);
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
          }
          smoothedRef.current = 0;
          setMouthLevel(0);
          setSmoothedValue(0);
          setIsSpeaking(false);
          sourceRef.current = null;
          resolve();
        };
        source.onended = finish;
        source.start(0);
        options?.onStart?.();
      });
    },
    [
      stopCurrent,
      getAudioContext,
      ensureAnalyser,
      resumeAudioContext,
      startAnalysis,
    ],
  );

  const beginQueue = useCallback(() => {
    stopCurrent();
    queueEndTimeRef.current = 0;
    queueHasAudioRef.current = false;
    return playbackGenerationRef.current;
  }, [stopCurrent]);

  const enqueue = useCallback(
    async (
      arrayBuffer: ArrayBuffer,
      options?: QueueAudioOptions,
    ): Promise<QueuedAudio> => {
      const generation = playbackGenerationRef.current;
      const ctx = getAudioContext();
      await resumeAudioContext(ctx);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (generation !== playbackGenerationRef.current) {
        return {
          startAt: ctx.currentTime,
          duration: 0,
          ended: Promise.resolve(),
        };
      }

      const first = !queueHasAudioRef.current;
      const startAt = Math.max(
        queueEndTimeRef.current,
        ctx.currentTime + (first ? 0.42 : 0.018),
      );
      queueHasAudioRef.current = true;
      queueEndTimeRef.current = startAt + audioBuffer.duration;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      const gain = ctx.createGain();
      gain.gain.value = SPEECH_VOLUME_GAIN;
      source.connect(gain);
      gain.connect(ensureAnalyser(ctx));
      queuedSourcesRef.current.add(source);

      const addTimer = (callback: () => void, delayMs: number) => {
        const timer = window.setTimeout(
          () => {
            queueTimersRef.current.delete(timer);
            if (generation === playbackGenerationRef.current) callback();
          },
          Math.max(0, delayMs),
        );
        queueTimersRef.current.add(timer);
      };
      const untilStartMs = (startAt - ctx.currentTime) * 1000;
      addTimer(() => options?.onVisualStart?.(), untilStartMs - 90);
      addTimer(() => {
        setIsSpeaking(true);
        startAnalysis();
        options?.onStart?.();
      }, untilStartMs);

      const ended = new Promise<void>((resolve) => {
        source.onended = () => {
          queuedSourcesRef.current.delete(source);
          source.disconnect();
          resolve();
        };
      });
      source.start(startAt);
      return { startAt, duration: audioBuffer.duration, ended };
    },
    [ensureAnalyser, getAudioContext, resumeAudioContext, startAnalysis],
  );

  const finishQueue = useCallback(async () => {
    const generation = playbackGenerationRef.current;
    const ctx = getAudioContext();
    const remainingMs = Math.max(
      0,
      (queueEndTimeRef.current - ctx.currentTime) * 1000,
    );
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, remainingMs + 20),
    );
    if (generation !== playbackGenerationRef.current) return;
    queueHasAudioRef.current = false;
    queueEndTimeRef.current = 0;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    smoothedRef.current = 0;
    setMouthLevel(0);
    setSmoothedValue(0);
    setIsSpeaking(false);
  }, [getAudioContext]);

  useEffect(() => {
    return () => {
      stopCurrent();
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      ctxRef.current = null;
    };
  }, [stopCurrent]);

  return {
    mouthLevel,
    isSpeaking,
    smoothedValue,
    play,
    beginQueue,
    enqueue,
    finishQueue,
    unlock,
    stop: stopCurrent,
  };
}
