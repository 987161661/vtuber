import {
  MINIMAX_CHINA_API_URL,
  MINIMAX_GLOBAL_API_URL,
} from '../constants/voiceEngine';
import { Talk } from '../types/voice';
import { decodeHexToArrayBuffer, fetchWithTimeout } from './internal/utils';
import { VoiceEngine } from './VoiceEngine';

/**
 * MiniMax endpoint types
 */
export type MinimaxEndpoint = 'global' | 'china';

/**
 * Available MiniMax TTS models
 */
export type MinimaxModel =
  | 'speech-2.8-hd'
  | 'speech-2.8-turbo'
  | 'speech-2.6-hd'
  | 'speech-2.6-turbo'
  | 'speech-2.5-hd-preview'
  | 'speech-2.5-turbo-preview'
  | 'speech-02-hd'
  | 'speech-02-turbo'
  | 'speech-01-hd'
  | 'speech-01-turbo';

/**
 * MiniMax voice speaker information
 */
export interface MinimaxVoiceSpeaker {
  voice_id: string;
  voice_name: string;
  gender: string;
  language: string;
  preview_audio?: string;
}

/**
 * MiniMax voice setting override options
 */
export interface MinimaxVoiceSettingsOptions {
  speed?: number;
  vol?: number;
  pitch?: number;
  emotion?: string;
}

/**
 * MiniMax audio format options
 */
export type MinimaxAudioFormat = 'mp3' | 'wav' | 'aac' | 'pcm' | 'flac' | 'ogg';

/**
 * MiniMax audio setting override options
 */
export interface MinimaxAudioSettingsOptions {
  sampleRate?: number;
  bitrate?: number;
  format?: MinimaxAudioFormat;
  channel?: 1 | 2;
}

async function readJsonWithDeadline<T>(
  response: Response,
  timeoutMs = 15_000,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.json() as Promise<T>,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('minimax_response_body_timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * MiniMax TTS voice synthesis engine
 */
export class MinimaxEngine implements VoiceEngine {
  private groupId?: string;
  private model: MinimaxModel = 'speech-2.8-turbo';
  private defaultVoiceId: string = 'Japanese_IntellectualSenior';
  private language: string = 'Chinese';
  private endpoint: MinimaxEndpoint = 'china';
  private apiEndpoint?: string;
  private voiceOverrides: MinimaxVoiceSettingsOptions = {};
  private audioOverrides: MinimaxAudioSettingsOptions = {};

  /**
   * Set GroupId for MiniMax API
   *
   * Retained for compatibility with older MiniMax credentials and saved
   * settings. Current HTTP TTS requests authenticate with the Bearer API key and
   * do not require GroupId in the URL.
   *
   * @param groupId Optional legacy MiniMax GroupId
   */
  setGroupId(groupId: string): void {
    this.groupId = groupId;
  }

  /**
   * Set endpoint region for MiniMax API
   * @param endpoint Endpoint region ('global' or 'china')
   */
  setEndpoint(endpoint: MinimaxEndpoint): void {
    this.endpoint = endpoint;
    this.apiEndpoint = undefined;
  }

  /**
   * Set model for MiniMax TTS
   * Available models:
   * - speech-2.6-hd: Latest flagship HD model with highest fidelity
   * - speech-2.6-turbo: Low-latency Turbo model from 2.6 generation
   * - speech-2.5-hd-preview: Latest high-quality model (preview)
   * - speech-2.5-turbo-preview: Latest fast model (preview)
   * - speech-02-hd: High-quality model
   * - speech-02-turbo: Fast model
   * - speech-01-hd: Previous generation high-quality model
   * - speech-01-turbo: Previous generation fast model
   * @param model Model name
   */
  setModel(model: MinimaxModel): void {
    this.model = model;
  }

  /**
   * Set language boost
   * @param language Language to boost recognition
   */
  setLanguage(language: string): void {
    this.language = language;
  }

  /**
   * Set voice setting overrides (speed, volume, pitch)
   * @param settings Voice setting overrides
   */
  setVoiceSettings(settings: MinimaxVoiceSettingsOptions): void {
    this.updateVoiceOverrides(settings);
  }

  /**
   * Set speech speed multiplier
   * @param speed Speed multiplier
   */
  setSpeed(speed?: number): void {
    this.updateVoiceOverrides({ speed });
  }

  /**
   * Set output volume multiplier
   * @param vol Volume multiplier
   */
  setVolume(vol?: number): void {
    this.updateVoiceOverrides({ vol });
  }

  /**
   * Set pitch adjustment in semitones
   * @param pitch Pitch adjustment
   */
  setPitch(pitch?: number): void {
    this.updateVoiceOverrides({ pitch });
  }

  /**
   * Set audio encoding overrides (sample rate, bitrate, format, channel)
   * @param settings Audio setting overrides
   */
  setAudioSettings(settings: MinimaxAudioSettingsOptions): void {
    this.updateAudioOverrides(settings);
  }

  /**
   * Set audio sampling rate (Hz)
   * @param sampleRate Sampling rate
   */
  setSampleRate(sampleRate?: number): void {
    this.updateAudioOverrides({ sampleRate });
  }

  /**
   * Set audio bitrate (bps)
   * @param bitrate Bitrate
   */
  setBitrate(bitrate?: number): void {
    this.updateAudioOverrides({ bitrate });
  }

  /**
   * Set audio output format
   * @param format Audio format
   */
  setAudioFormat(format?: MinimaxAudioFormat): void {
    this.updateAudioOverrides({ format });
  }

  /**
   * Set audio channel count
   * @param channel Number of channels
   */
  setAudioChannel(channel?: 1 | 2): void {
    this.updateAudioOverrides({ channel });
  }

  /**
   * Alias for setLanguage to emphasize MiniMax terminology
   * @param language Language boost string
   */
  setLanguageBoost(language: string): void {
    this.setLanguage(language);
  }

  /**
   * Get current API endpoint URL based on selected endpoint
   * @returns API endpoint URL
   */
  private getTtsApiUrl(): string {
    if (this.apiEndpoint) return this.apiEndpoint;
    return this.endpoint === 'china'
      ? MINIMAX_CHINA_API_URL
      : MINIMAX_GLOBAL_API_URL;
  }

  /**
   * Get available voice speakers list
   *
   * MiniMax currently documents system voice IDs in its public FAQ, but the
   * linked dynamic voice-list endpoint is not available.
   */
  async getVoiceList(_apiKey?: string): Promise<MinimaxVoiceSpeaker[]> {
    throw new Error(
      'MiniMax voice list API is not supported. Use MiniMax system voice IDs from the official documentation.',
    );
  }

  /**
   * Build MiniMax voice settings by merging emotion defaults with overrides
   * @param voiceId Target voice ID
   * @param defaults Default emotion-based values
   */
  private buildVoiceSetting(
    voiceId: string,
    defaults: { speed: number; vol: number; pitch: number; emotion: string },
  ): {
    voice_id: string;
    speed: number;
    vol: number;
    pitch: number;
    emotion: string;
  } {
    return {
      voice_id: voiceId,
      // Keep the adjustments deliberately narrow. They complement MiniMax's
      // native emotion rendering rather than trying to fake acting through a
      // different voice or large pitch shifts.
      speed: this.voiceOverrides.speed ?? defaults.speed,
      vol: this.voiceOverrides.vol ?? defaults.vol,
      pitch: this.voiceOverrides.pitch ?? defaults.pitch,
      emotion: this.voiceOverrides.emotion ?? defaults.emotion,
    };
  }

  /**
   * Build MiniMax audio settings from overrides
   */
  private buildAudioSetting(): {
    sample_rate: number;
    bitrate: number;
    format: string;
    channel: number;
  } {
    return {
      // Request MiniMax's highest documented MP3 rate.  The browser decodes
      // this directly; do not introduce a lower-rate intermediary.
      sample_rate: this.audioOverrides.sampleRate ?? 44100,
      bitrate: this.audioOverrides.bitrate ?? 128000,
      format: this.audioOverrides.format ?? 'mp3',
      channel: this.audioOverrides.channel ?? 1,
    };
  }

  /**
   * Test voice synthesis with minimal requirements
   * Requires API key and voice ID.
   * @param text Text to synthesize (shorter text recommended for testing)
   * @param voiceId Voice ID to test
   * @param apiKey MiniMax API key
   * @returns Promise<ArrayBuffer>
   */
  async testVoice(
    text: string,
    voiceId: string,
    apiKey: string,
  ): Promise<ArrayBuffer> {
    if (!apiKey) {
      throw new Error('MiniMax API key is required');
    }

    if (!voiceId) {
      throw new Error('Voice ID is required');
    }

    // Limit test text length to avoid quota waste
    const testText = text.length > 100 ? text.substring(0, 100) + '...' : text;

    const requestBody = {
      model: this.model,
      text: testText,
      stream: false,
      voice_setting: this.buildVoiceSetting(voiceId, {
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
        emotion: 'neutral',
      }),
      audio_setting: this.buildAudioSetting(),
      language_boost: this.language,
    };

    const response = await fetchWithTimeout(this.getTtsApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMessage = `HTTP error ${response.status}`;
      try {
        const errorText = await response.text();
        console.error(
          'Failed to test voice from MiniMax:',
          response.status,
          errorText,
        );
        errorMessage = `Failed to test voice: ${response.status} - ${errorText}`;
      } catch (e) {
        console.error(
          'Failed to test voice from MiniMax:',
          response.status,
          response.statusText,
        );
        errorMessage = `Failed to test voice: ${response.status} - ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = await readJsonWithDeadline<{
      base_resp?: { status_code?: number; status_msg?: string };
      data?: { audio?: string };
    }>(response);

    // Check base_resp for API errors
    if (result.base_resp && result.base_resp.status_code !== 0) {
      const errorMsg = result.base_resp.status_msg || 'Unknown error';
      throw new Error(
        `MiniMax API error: ${result.base_resp.status_code} - ${errorMsg}`,
      );
    }

    // Get audio data from response
    if (!result.data || !result.data.audio) {
      console.error('Invalid response structure:', result);
      throw new Error('Audio data not found in MiniMax response');
    }

    // Convert hex string to ArrayBuffer
    try {
      return decodeHexToArrayBuffer(result.data.audio);
    } catch (error) {
      console.error('Failed to convert hex audio data:', error);
      throw new Error(`Failed to process audio data: ${error}`);
    }
  }

  /**
   * Full production audio synthesis
   * Requires API key and voice ID.
   * @param input Talk object
   * @param speaker Voice ID
   * @param apiKey MiniMax API key
   * @returns Promise<ArrayBuffer>
   */
  async fetchAudio(
    input: Talk,
    speaker: string,
    apiKey?: string,
  ): Promise<ArrayBuffer> {
    return this.fetchAudioWithOptions(input, speaker, apiKey, true);
  }

  /**
   * Audio synthesis with legacy GroupId compatibility.
   * @param input Talk object
   * @param speaker Voice ID
   * @param apiKey MiniMax API key
   * @param requireGroupId Retained for backward compatibility; current MiniMax
   * HTTP TTS authenticates with the Bearer API key and does not require it.
   * @returns Promise<ArrayBuffer>
   */
  async fetchAudioWithOptions(
    input: Talk,
    speaker: string,
    apiKey?: string,
    requireGroupId: boolean = true,
  ): Promise<ArrayBuffer> {
    if (!apiKey) {
      throw new Error('MiniMax API key is required');
    }

    const talk = input as Talk;
    const text = talk.message.trim();

    // Validate text length (max 5000 characters)
    if (text.length > 5000) {
      throw new Error('Text exceeds maximum length of 5000 characters');
    }

    // Get emotion from talk.style and adjust voice settings
    const emotionVoiceSettings = this.getVoiceSettings(
      talk.style || 'talk',
      talk.delivery,
      talk.emotionIntensity,
      talk.prosody,
    );

    const requestBody = {
      model: this.model,
      text: text,
      stream: false,
      voice_setting: this.buildVoiceSetting(
        speaker || this.defaultVoiceId,
        emotionVoiceSettings,
      ),
      audio_setting: this.buildAudioSetting(),
      language_boost: this.language,
    };

    const response = await fetchWithTimeout(this.getTtsApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMessage = `HTTP error ${response.status}`;
      try {
        const errorText = await response.text();
        console.error(
          'Failed to fetch TTS from MiniMax:',
          response.status,
          errorText,
        );
        errorMessage = `Failed to fetch TTS from MiniMax: ${response.status} - ${errorText}`;
      } catch (e) {
        console.error(
          'Failed to fetch TTS from MiniMax:',
          response.status,
          response.statusText,
        );
        errorMessage = `Failed to fetch TTS from MiniMax: ${response.status} - ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = await readJsonWithDeadline<{
      base_resp?: { status_code?: number; status_msg?: string };
      data?: { audio?: string };
    }>(response);

    // Check base_resp for API errors
    if (result.base_resp && result.base_resp.status_code !== 0) {
      const errorMsg = result.base_resp.status_msg || 'Unknown error';
      throw new Error(
        `MiniMax API error: ${result.base_resp.status_code} - ${errorMsg}`,
      );
    }

    // Get audio data from response
    if (!result.data || !result.data.audio) {
      console.error('Invalid response structure:', result);
      throw new Error('Audio data not found in MiniMax response');
    }

    // Convert hex string to ArrayBuffer
    try {
      return decodeHexToArrayBuffer(result.data.audio);
    } catch (error) {
      console.error('Failed to convert hex audio data:', error);
      throw new Error(`Failed to process audio data: ${error}`);
    }
  }

  /**
   * Stream MiniMax HTTP synthesis chunks. The API sends newline-delimited SSE
   * events; each event may contain one hex-encoded MP3 fragment.
   */
  async *fetchAudioStream(
    input: Talk,
    speaker: string,
    apiKey?: string,
  ): AsyncGenerator<ArrayBuffer> {
    if (!apiKey) throw new Error('MiniMax API key is required');
    const text = input.message.trim();
    if (!text) return;
    if (text.length > 10000)
      throw new Error('Text exceeds maximum length of 10000 characters');

    const voiceSettings = this.getVoiceSettings(
      input.style || 'talk',
      input.delivery,
      input.emotionIntensity,
      input.prosody,
    );
    const streamController = new AbortController();
    const requestTimer = setTimeout(() => streamController.abort(), 30_000);
    const response = await fetchWithTimeout(this.getTtsApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        text,
        stream: true,
        voice_setting: this.buildVoiceSetting(
          speaker || this.defaultVoiceId,
          voiceSettings,
        ),
        audio_setting: { ...this.buildAudioSetting(), format: 'mp3' },
        language_boost: this.language,
        subtitle_enable: false,
      }),
      signal: streamController.signal,
    }).finally(() => {
      clearTimeout(requestTimer);
    });
    if (!response.ok || !response.body) {
      throw new Error(`MiniMax streaming TTS failed: HTTP ${response.status}`);
    }

    // On quota/auth failures MiniMax returns a normal JSON object (HTTP 200)
    // instead of an SSE stream. Without this guard the iterator simply ended
    // with no audio, which looked like a silent, stuck virtual host.
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const result = (await response.json()) as {
        base_resp?: { status_code?: number; status_msg?: string };
      };
      const baseResp = result.base_resp;
      throw new Error(
        baseResp?.status_code
          ? `MiniMax API error: ${baseResp.status_code} - ${baseResp.status_msg || 'Unknown error'}`
          : 'MiniMax streaming TTS returned JSON without audio data',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    // At 128 kbps, 16 KiB is about one second of MP3. Yield that smaller
    // startup chunk so the host can acknowledge the viewer sooner, then use
    // 32 KiB chunks for stable real-time FlashHead rendering and playback.
    const firstChunkBytes = 16 * 1024;
    const steadyChunkBytes = 32 * 1024;
    let nextChunkBytes = firstChunkBytes;
    let audioParts: Uint8Array[] = [];
    let audioBytes = 0;
    let receivedIncrementalAudio = false;
    let streamComplete = false;
    let lastAudioAt = 0;
    const streamAudioIdleTimeoutMs = 8_000;
    const appendAudio = (audio: ArrayBuffer) => {
      const part = new Uint8Array(audio);
      audioParts.push(part);
      audioBytes += part.byteLength;
    };
    const flushAudio = (requestedBytes = audioBytes): ArrayBuffer | null => {
      if (audioBytes === 0) return null;
      const merged = new Uint8Array(audioBytes);
      let offset = 0;
      for (const part of audioParts) {
        merged.set(part, offset);
        offset += part.byteLength;
      }
      const take = Math.min(requestedBytes, merged.byteLength);
      const chunk = merged.slice(0, take);
      const remainder = merged.slice(take);
      audioParts = remainder.byteLength ? [remainder] : [];
      audioBytes = remainder.byteLength;
      return chunk.buffer;
    };
    const consumeEvent = (event: string): ArrayBuffer | null => {
      const payloadText = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (!payloadText || payloadText === '[DONE]') return null;
      const payload = JSON.parse(payloadText) as {
        base_resp?: { status_code?: number; status_msg?: string };
        data?: { audio?: string; status?: number };
      };
      if (
        payload.base_resp?.status_code &&
        payload.base_resp.status_code !== 0
      ) {
        throw new Error(
          `MiniMax API error: ${payload.base_resp.status_code} - ${payload.base_resp.status_msg || 'Unknown error'}`,
        );
      }
      if (payload.data?.status === 2) streamComplete = true;
      if (!payload.data?.audio) return null;
      // MiniMax can finish an HTTP stream with status=2 containing the full
      // MP3, after status=1 events already delivered the incremental audio.
      // Appending that terminal copy makes the avatar repeat the whole answer.
      // Keep status=2 when it is the only audio response (short synthesis).
      if (payload.data.status === 2 && receivedIncrementalAudio) return null;
      if (payload.data.status !== 2) receivedIncrementalAudio = true;
      lastAudioAt = Date.now();
      return decodeHexToArrayBuffer(payload.data.audio);
    };

    while (true) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const audioIdleRemainingMs = Math.max(
        0,
        streamAudioIdleTimeoutMs - (Date.now() - lastAudioAt),
      );
      const readResult = receivedIncrementalAudio
        ? await Promise.race([
            reader.read().then((result) => ({ kind: 'data' as const, result })),
            new Promise<{ kind: 'idle' }>((resolve) => {
              idleTimer = setTimeout(
                () => resolve({ kind: 'idle' }),
                audioIdleRemainingMs,
              );
            }),
          ]).finally(() => {
            if (idleTimer) clearTimeout(idleTimer);
          })
        : { kind: 'data' as const, result: await reader.read() };
      if (readResult.kind === 'idle') {
        // Some proxies keep a completed SSE connection alive with empty status
        // frames. Once real audio has arrived, only another audio fragment (not
        // an empty heartbeat) extends the useful stream lifetime.
        streamController.abort();
        void reader.cancel().catch(() => undefined);
        break;
      }
      const { value, done } = readResult.result;
      pending += decoder.decode(value, { stream: !done });
      const events = pending.split('\n\n');
      pending = events.pop() || '';
      for (const event of events) {
        const audio = consumeEvent(event);
        if (audio) {
          appendAudio(audio);
          while (audioBytes >= nextChunkBytes) {
            const chunk = flushAudio(nextChunkBytes);
            if (chunk) {
              yield chunk;
              nextChunkBytes = steadyChunkBytes;
            }
          }
        }
      }
      if (streamComplete) {
        streamController.abort();
        void reader.cancel().catch(() => undefined);
        break;
      }
      if (done) break;
    }
    if (!streamComplete && pending.trim()) {
      const audio = consumeEvent(pending);
      if (audio) appendAudio(audio);
    }
    while (audioBytes >= nextChunkBytes) {
      const chunk = flushAudio(nextChunkBytes);
      if (chunk) {
        yield chunk;
        nextChunkBytes = steadyChunkBytes;
      }
    }
    const finalChunk = flushAudio();
    if (finalChunk) yield finalChunk;
  }

  /**
   * Check if GroupId is configured
   * @returns boolean
   */
  hasGroupId(): boolean {
    return !!this.groupId;
  }

  /**
   * Get current endpoint setting
   * @returns MinimaxEndpoint
   */
  getEndpoint(): MinimaxEndpoint {
    return this.endpoint;
  }

  /**
   * Set custom API endpoint URL (VoiceEngine interface compatibility)
   * @param apiUrl custom API endpoint URL
   */
  setApiEndpoint(apiUrl: string): void {
    const normalized = apiUrl.trim();
    // Keep the documented region helpers for existing configurations, while
    // allowing an application to supply a same-origin gateway URL.
    if (normalized.includes('minimaxi.com')) {
      this.endpoint = 'china';
      this.apiEndpoint = undefined;
    } else if (normalized.includes('minimax.io')) {
      this.endpoint = 'global';
      this.apiEndpoint = undefined;
    } else if (normalized) {
      this.apiEndpoint = normalized;
    }
  }

  /**
   * Get voice settings based on emotion
   * @param emotion Emotion type
   * @returns Voice settings
   */
  private getVoiceSettings(
    emotion: string,
    delivery?: string,
    intensity = 0.5,
    prosody?: Talk['prosody'],
  ): {
    speed: number;
    vol: number;
    pitch: number;
    emotion: string;
  } {
    const strength = Math.min(1, Math.max(0, intensity));
    const normalizedEmotion = emotion.toLowerCase().trim();
    // MiniMax exposes a smaller emotion vocabulary than the host planner.
    // Keep the planner's more specific label in the screenplay, translating
    // it only at the provider boundary.
    const providerEmotion =
      normalizedEmotion === 'impatient'
        ? 'angry'
        : normalizedEmotion === 'embarrassed' || normalizedEmotion === 'awkward'
          ? 'surprised'
          : normalizedEmotion === 'talk' ||
              normalizedEmotion === 'relaxed' ||
              normalizedEmotion === 'bored'
            ? 'neutral'
            : ['happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'].includes(
                  normalizedEmotion,
                )
              ? normalizedEmotion
              : 'neutral';

    const byDelivery: Record<string, { speed: number; vol: number }> = {
      soft: { speed: 0.96, vol: 0.94 },
      warm: { speed: 0.98, vol: 0.98 },
      calm: { speed: 0.97, vol: 0.97 },
      serious: { speed: 0.97, vol: 0.98 },
      playful: { speed: 1.03, vol: 1.02 },
      teasing: { speed: 1.02, vol: 0.98 },
      excited: { speed: 1.05, vol: 1.05 },
      natural: { speed: 1, vol: 1 },
    };
    const deliverySettings =
      byDelivery[delivery?.toLowerCase().trim() || 'natural'] ??
      byDelivery.natural;
    const byEmotion: Record<string, { speed: number; vol: number }> = {
      sad: { speed: -0.035, vol: -0.04 },
      angry: { speed: 0.03, vol: 0.025 },
      surprised: { speed: 0.045, vol: 0.025 },
      bored: { speed: -0.05, vol: -0.06 },
      impatient: { speed: 0.05, vol: 0 },
      embarrassed: { speed: -0.025, vol: -0.045 },
      awkward: { speed: -0.04, vol: -0.05 },
      serious: { speed: -0.04, vol: -0.02 },
    };
    const emotionSettings = byEmotion[normalizedEmotion] ?? {
      speed: 0,
      vol: 0,
    };
    const acousticStrength = 0.45 + strength * 0.55;
    const prosodyValue = (key: keyof NonNullable<Talk['prosody']>) =>
      typeof prosody?.[key] === 'number'
        ? Math.min(1, Math.max(-1, prosody[key] as number))
        : 0;
    const pace = prosodyValue('pace');
    const volume = prosodyValue('volume');
    const tension = prosodyValue('tension');
    const energy = prosodyValue('energy');
    const assertiveness = prosodyValue('assertiveness');
    const breathiness = prosodyValue('breathiness');
    return {
      speed: Math.min(
        1.08,
        Math.max(
          0.94,
          deliverySettings.speed +
            emotionSettings.speed * acousticStrength +
            pace * 0.12 +
            energy * 0.06 +
            tension * 0.035 -
            breathiness * 0.025,
        ),
      ),
      vol: Math.min(
        1.08,
        Math.max(
          0.9,
          deliverySettings.vol +
            emotionSettings.vol * acousticStrength +
            volume * 0.12 +
            energy * 0.05 +
            assertiveness * 0.04 -
            breathiness * 0.04,
        ),
      ),
      // Pitch is part of the selected speaker's identity, not an acting
      // control. Keep it stable here; an explicit operator override in
      // buildVoiceSetting remains available for deliberate calibration.
      pitch: 0,
      emotion: providerEmotion,
    };
  }

  /**
   * Merge incoming voice overrides into the current override map
   * Passing undefined removes the override and falls back to defaults
   * @param settings Voice setting overrides
   */
  private updateVoiceOverrides(settings: MinimaxVoiceSettingsOptions): void {
    for (const [key, value] of Object.entries(settings) as [
      keyof MinimaxVoiceSettingsOptions,
      string | number | undefined,
    ][]) {
      if (value === undefined || value === null) {
        delete this.voiceOverrides[key];
      } else if (key === 'emotion' && typeof value === 'string') {
        this.voiceOverrides.emotion = value;
      } else if (key === 'speed' && typeof value === 'number') {
        this.voiceOverrides.speed = value;
      } else if (key === 'vol' && typeof value === 'number') {
        this.voiceOverrides.vol = value;
      } else if (key === 'pitch' && typeof value === 'number') {
        this.voiceOverrides.pitch = value;
      } else {
        throw new Error(`Invalid MiniMax voice override for ${key}`);
      }
    }
  }

  /**
   * Merge incoming audio overrides into the current override map
   * Passing undefined removes the override and falls back to defaults
   * @param settings Audio setting overrides
   */
  private updateAudioOverrides(settings: MinimaxAudioSettingsOptions): void {
    for (const [key, value] of Object.entries(settings) as [
      keyof MinimaxAudioSettingsOptions,
      (
        | MinimaxAudioSettingsOptions[keyof MinimaxAudioSettingsOptions]
        | undefined
      ),
    ][]) {
      if (value === undefined || value === null) {
        delete this.audioOverrides[key];
      } else {
        switch (key) {
          case 'sampleRate':
            this.audioOverrides.sampleRate = value as number;
            break;
          case 'bitrate':
            this.audioOverrides.bitrate = value as number;
            break;
          case 'format':
            this.audioOverrides.format = value as MinimaxAudioFormat;
            break;
          case 'channel':
            this.audioOverrides.channel = value as 1 | 2;
            break;
        }
      }
    }
  }

  getTestMessage(textVoiceText?: string): string {
    return textVoiceText || 'MiniMax Audioを使用します';
  }
}
