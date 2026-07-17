import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AITuberOnAirCore,
  AITuberOnAirCoreEvent,
  buildSpeechPlanV2,
  getDefaultXaiReasoningEffort,
  hasUnsafeSpeechArtifacts,
  isGPT5Model,
  isXaiReasoningEffortModel,
  MinimaxEngine,
  sanitizeSpeechText,
  type SpeechPlanV2BuilderHints,
} from '@aituber-onair/core';
import { ManneriDetector } from '@aituber-onair/manneri';
import type {
  VoiceServiceOptions,
  ElevenLabsApplyTextNormalization,
  GradiumOutputFormat,
  InworldAudioEncoding,
  InworldDeliveryMode,
  UnrealSpeechCodec,
  TalkStyle,
  XaiBitRate,
  XaiCodec,
  XaiSampleRate,
} from '@aituber-onair/core';
import type { Message as ManneriMessage } from '@aituber-onair/manneri';
import {
  buildCharacterSystemPrompt,
  type CharacterProfile,
  LINGLAN_PROFILE,
  LINGLAN_VISION_PROMPT,
} from '../config/characterProfile';
import type { ChatMessage } from '../types/chat';
import type { AppSettings, ChatProviderOption } from '../types/settings';
import {
  guardViewerResponse,
  type ResponseFactGuard,
} from '../lib/responseGuard';
import { formatTtsSpeechScript } from '../lib/ttsSpeechScript';
import type { PreparedSpeechPlan } from '../lib/operatorQueue';

interface ScreenplayLike {
  emotion?: string;
  text?: string;
  delivery?: string;
  emotionIntensity?: number;
  prosody?: Record<string, number>;
  motion?: string;
  gaze?: string;
  gesture?: string;
}

async function* closeAudioStreamAfterIdle(
  source: AsyncGenerator<ArrayBuffer>,
  idleTimeoutMs = 5_000,
): AsyncGenerator<ArrayBuffer> {
  const iterator = source[Symbol.asyncIterator]();
  let receivedAudio = false;
  while (true) {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const nextPromise = iterator
      .next()
      .then((result) => ({ kind: 'next' as const, result }));
    const outcome = receivedAudio
      ? await Promise.race([
          nextPromise,
          new Promise<{ kind: 'idle' }>((resolve) => {
            idleTimer = setTimeout(
              () => resolve({ kind: 'idle' }),
              idleTimeoutMs,
            );
          }),
        ]).finally(() => {
          if (idleTimer) clearTimeout(idleTimer);
        })
      : await nextPromise;
    if (outcome.kind === 'idle') {
      // Do not let a provider/proxy connection that stays open after its last
      // useful chunk hold the operator queue until the global watchdog fires.
      void iterator.return?.(new ArrayBuffer(0)).catch(() => undefined);
      return;
    }
    if (outcome.result.done) return;
    receivedAudio = true;
    yield outcome.result.value;
  }
}

interface UseAituberCoreOptions {
  profile: CharacterProfile;
  onAudioPlay: (arrayBuffer: ArrayBuffer) => Promise<void>;
  onAudioStream?: (audioStream: AsyncGenerator<ArrayBuffer>) => Promise<void>;
  onSpeechStart?: (screenplay: ScreenplayLike) => void;
  onSpeechEnd?: () => void;
  onSpeechInterrupted?: () => void;
  onSpeechChunk?: (
    stage: 'start' | 'end' | 'error',
    data: Record<string, unknown>,
  ) => void;
  settings: AppSettings;
  getApiKeyForProvider: (provider: ChatProviderOption) => string;
  onAssistantResponse?: (
    input: string,
    reply: string,
    metadata?: {
      viewerId?: string;
      viewerName?: string;
      source?: 'chat' | 'live' | 'vision';
      eventId?: string;
      commentAt?: number;
      receivedAt?: number;
      queuedAt?: number;
      selectedAt?: number;
      processingAt?: number;
      sourcesSeen?: string[];
      sourceLabel?: string;
      persistInteraction?: boolean;
    },
  ) => void;
  onChatError?: (
    error: unknown,
    metadata?: {
      eventId?: string;
    },
  ) => void;
  speechPlanV2Enabled?: boolean;
  personaPlannerEnabled?: boolean;
}

type ProcessChatOptions = {
  displayText?: string;
  memoryContext?: string;
  viewerId?: string;
  viewerName?: string;
  source?: 'chat' | 'live' | 'vision';
  eventId?: string;
  commentAt?: number;
  receivedAt?: number;
  queuedAt?: number;
  selectedAt?: number;
  processingAt?: number;
  sourcesSeen?: string[];
  sourceLabel?: string;
  factGuard?: ResponseFactGuard;
  speechPlanHints?: SpeechPlanV2BuilderHints;
  showInput?: boolean;
  persistInteraction?: boolean;
  /** Generate a moderator-visible draft without requesting TTS playback. */
  silent?: boolean;
  onPrepared?: (reply: string, speechPlan?: PreparedSpeechPlan) => void;
};

const GPT5_SAMPLE_PROVIDER_OPTIONS = { gpt5Preset: 'casual' as const };
const NO_REPLY_TOKEN = '[[NO_REPLY]]';

function emitRuntimeTrace(event: Record<string, unknown>) {
  void fetch('/api/live-runtime-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

function inspectSpeechPlanEnvelope(raw: unknown) {
  if (typeof raw !== 'string') return { kind: typeof raw, valid: false };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { kind: 'plain_text', valid: false };
  }
  try {
    const value = JSON.parse(trimmed) as {
      version?: unknown;
      beats?: unknown;
    };
    const beats = Array.isArray(value.beats) ? value.beats : [];
    const requiredFields = [
      'text',
      'emotion',
      'delivery',
      'emotion_intensity',
      'prosody',
      'motion',
      'gaze',
      'gesture',
      'vocal_tags',
      'pause_after_ms',
      'interruptible_after',
    ];
    const missingFields = beats.flatMap((beat, index) =>
      !beat || typeof beat !== 'object'
        ? [`beats[${index}]`]
        : requiredFields
            .filter((field) => !(field in beat))
            .map((field) => `beats[${index}].${field}`),
    );
    return {
      kind: 'json_object',
      valid: value.version === 2 && beats.length >= 1 && beats.length <= 3 && missingFields.length === 0,
      version: value.version,
      beatCount: beats.length,
      missingFields,
    };
  } catch {
    return { kind: 'invalid_json', valid: false };
  }
}

function toManneriMessages(
  messages: ChatMessage[],
  nextUserMessage: string,
): ManneriMessage[] {
  return [
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    })),
    { role: 'user' as const, content: nextUserMessage, timestamp: Date.now() },
  ];
}

function buildManneriAugmentedInput(
  userInput: string,
  diversificationPrompt: string,
): string {
  return [
    '以下是避免会话重复的内部指示。不要向观众解释这段指示，只需在保持凌岚人设与事实边界的前提下自然反映。',
    diversificationPrompt,
    '',
    `观众的发言：${userInput}`,
  ].join('\n');
}

function getTtsApiKey(
  settings: AppSettings,
  getApiKeyForProvider: (provider: ChatProviderOption) => string,
): string {
  if (settings.tts.engine === 'openai') {
    return getApiKeyForProvider('openai');
  }
  if (settings.tts.engine === 'geminiTts') {
    return getApiKeyForProvider('gemini');
  }
  if (settings.tts.engine === 'openaiCompatible') {
    return settings.tts.openAiCompatibleApiKey || '';
  }
  if (settings.tts.engine === 'aivisCloud') {
    return settings.tts.aivisCloudApiKey || '';
  }
  if (settings.tts.engine === 'minimax') {
    return settings.tts.minimaxApiKey || '';
  }
  if (settings.tts.engine === 'xai') {
    return getApiKeyForProvider('xai');
  }
  if (settings.tts.engine === 'unrealSpeech') {
    return settings.tts.unrealSpeechApiKey || '';
  }
  if (settings.tts.engine === 'elevenLabs') {
    return settings.tts.elevenLabsApiKey || '';
  }
  if (settings.tts.engine === 'inworld') {
    return settings.tts.inworldApiKey || '';
  }
  if (settings.tts.engine === 'gradium') {
    return settings.tts.gradiumApiKey || '';
  }
  return getApiKeyForProvider(settings.llm.provider);
}

function buildVoiceOptions(
  tts: AppSettings['tts'],
  apiKey: string,
  onPlay: (audioBuffer: ArrayBuffer) => Promise<void>,
  onPlayStream?: (audioStream: AsyncGenerator<ArrayBuffer>) => Promise<void>,
): VoiceServiceOptions {
  const parsedAivisCloudStyleId = Number.parseInt(
    tts.aivisCloudStyleId || '',
    10,
  );
  const parsedOpenAiCompatibleSpeed = Number.parseFloat(
    tts.openAiCompatibleSpeed || '',
  );
  const parsedXaiSampleRate = Number.parseInt(
    String(tts.xaiSampleRate || ''),
    10,
  );
  const parsedXaiBitRate = Number.parseInt(String(tts.xaiBitRate || ''), 10);
  const parsedUnrealSpeechSpeed = Number.parseFloat(
    tts.unrealSpeechSpeed || '',
  );
  const parsedUnrealSpeechPitch = Number.parseFloat(
    tts.unrealSpeechPitch || '',
  );
  const parsedUnrealSpeechTemperature = Number.parseFloat(
    tts.unrealSpeechTemperature || '',
  );
  const parsedElevenLabsStability = Number.parseFloat(
    tts.elevenLabsStability || '',
  );
  const parsedElevenLabsSimilarityBoost = Number.parseFloat(
    tts.elevenLabsSimilarityBoost || '',
  );
  const parsedElevenLabsStyle = Number.parseFloat(tts.elevenLabsStyle || '');
  const parsedElevenLabsSpeed = Number.parseFloat(tts.elevenLabsSpeed || '');
  const parsedElevenLabsSeed = Number.parseInt(tts.elevenLabsSeed || '', 10);
  const parsedInworldSampleRateHertz = Number.parseInt(
    tts.inworldSampleRateHertz || '',
    10,
  );
  const parsedInworldBitRate = Number.parseInt(tts.inworldBitRate || '', 10);
  const parsedInworldSpeakingRate = Number.parseFloat(
    tts.inworldSpeakingRate || '',
  );
  const parsedInworldTemperature = Number.parseFloat(
    tts.inworldTemperature || '',
  );
  const parsedGradiumTemperature = Number.parseFloat(
    tts.gradiumTemperature || '',
  );
  const parsedGradiumVoiceSimilarity = Number.parseFloat(
    tts.gradiumVoiceSimilarity || '',
  );
  const parsedGradiumPaddingBonus = Number.parseFloat(
    tts.gradiumPaddingBonus || '',
  );
  const parsedPiperPlusSpeed = Number.parseFloat(tts.piperPlusSpeed || '');
  const parsedPiperPlusNoiseScale = Number.parseFloat(
    tts.piperPlusNoiseScale || '',
  );
  const trimmedSpeaker = tts.speaker.trim();

  return {
    engineType: tts.engine,
    speaker:
      tts.engine === 'openaiCompatible' && !trimmedSpeaker
        ? undefined
        : tts.speaker,
    apiKey,
    openAiCompatibleApiUrl: tts.openAiCompatibleApiUrl,
    openAiCompatibleModel: tts.openAiCompatibleModel,
    openAiCompatibleSpeed: Number.isNaN(parsedOpenAiCompatibleSpeed)
      ? undefined
      : parsedOpenAiCompatibleSpeed,
    geminiTtsModel: tts.geminiTtsModel,
    geminiTtsLanguageCode: tts.geminiTtsLanguageCode?.trim() || undefined,
    geminiTtsPrompt: tts.geminiTtsPrompt?.trim() || undefined,
    voicevoxApiUrl: tts.voicevoxApiUrl,
    voicepeakApiUrl: tts.voicepeakApiUrl,
    aivisSpeechApiUrl: tts.aivisSpeechApiUrl,
    groupId: tts.minimaxGroupId,
    // MinimaxEngine already defaults to the China endpoint. Do not also set
    // the region here: older cached engine handlers can apply it after the
    // gateway URL and silently undo the local routing contract.
    endpoint: undefined,
    // The active live page uses a same-origin gateway so a browser CORS or
    // streaming connection cannot turn a valid provider response into a
    // zero-byte playback stall. The gateway uses the verified local runtime
    // credential and is exercised by the stress-test preflight.
    minimaxApiUrl: tts.engine === 'minimax' ? '/api/minimax-tts' : undefined,
    minimaxModel:
      tts.engine === 'minimax' ? LINGLAN_PROFILE.voice.model : undefined,
    minimaxLanguageBoost:
      tts.engine === 'minimax'
        ? LINGLAN_PROFILE.voice.languageBoost
        : undefined,
    // MiniMax streaming is parsed by MinimaxEngine and delivered through the
    // existing audio queue. The local same-origin gateway was live-probed
    // before enabling this path so the browser receives incremental SSE data.
    minimaxStream: true,
    aivisCloudModelUuid: tts.aivisCloudModelUuid,
    aivisCloudSpeakerUuid: tts.aivisCloudSpeakerUuid,
    aivisCloudStyleId: Number.isNaN(parsedAivisCloudStyleId)
      ? undefined
      : parsedAivisCloudStyleId,
    xaiLanguage: tts.xaiLanguage?.trim() || undefined,
    xaiCodec: tts.xaiCodec as XaiCodec | undefined,
    xaiSampleRate: Number.isNaN(parsedXaiSampleRate)
      ? undefined
      : (parsedXaiSampleRate as XaiSampleRate),
    xaiBitRate:
      tts.xaiCodec === 'mp3' && !Number.isNaN(parsedXaiBitRate)
        ? (parsedXaiBitRate as XaiBitRate)
        : undefined,
    unrealSpeechApiUrl: tts.unrealSpeechApiUrl?.trim() || undefined,
    unrealSpeechBitrate: tts.unrealSpeechBitrate?.trim() || undefined,
    unrealSpeechSpeed: Number.isNaN(parsedUnrealSpeechSpeed)
      ? undefined
      : parsedUnrealSpeechSpeed,
    unrealSpeechPitch: Number.isNaN(parsedUnrealSpeechPitch)
      ? undefined
      : parsedUnrealSpeechPitch,
    unrealSpeechCodec:
      (tts.unrealSpeechCodec as UnrealSpeechCodec | undefined) || undefined,
    unrealSpeechTemperature: Number.isNaN(parsedUnrealSpeechTemperature)
      ? undefined
      : parsedUnrealSpeechTemperature,
    elevenLabsApiUrl: tts.elevenLabsApiUrl?.trim() || undefined,
    elevenLabsModel: tts.elevenLabsModel?.trim() || undefined,
    elevenLabsOutputFormat: tts.elevenLabsOutputFormat?.trim() || undefined,
    elevenLabsLanguageCode: tts.elevenLabsLanguageCode?.trim() || undefined,
    elevenLabsStability: Number.isNaN(parsedElevenLabsStability)
      ? undefined
      : parsedElevenLabsStability,
    elevenLabsSimilarityBoost: Number.isNaN(parsedElevenLabsSimilarityBoost)
      ? undefined
      : parsedElevenLabsSimilarityBoost,
    elevenLabsStyle: Number.isNaN(parsedElevenLabsStyle)
      ? undefined
      : parsedElevenLabsStyle,
    elevenLabsUseSpeakerBoost:
      tts.elevenLabsUseSpeakerBoost &&
      tts.elevenLabsUseSpeakerBoost !== 'default'
        ? tts.elevenLabsUseSpeakerBoost === 'true'
        : undefined,
    elevenLabsSpeed: Number.isNaN(parsedElevenLabsSpeed)
      ? undefined
      : parsedElevenLabsSpeed,
    elevenLabsSeed: Number.isNaN(parsedElevenLabsSeed)
      ? undefined
      : parsedElevenLabsSeed,
    elevenLabsApplyTextNormalization:
      tts.elevenLabsApplyTextNormalization &&
      tts.elevenLabsApplyTextNormalization !== 'default'
        ? (tts.elevenLabsApplyTextNormalization as ElevenLabsApplyTextNormalization)
        : undefined,
    inworldApiUrl: tts.inworldApiUrl?.trim() || undefined,
    inworldModel: tts.inworldModel?.trim() || undefined,
    inworldAudioEncoding:
      (tts.inworldAudioEncoding as InworldAudioEncoding | undefined) ||
      undefined,
    inworldSampleRateHertz: Number.isNaN(parsedInworldSampleRateHertz)
      ? undefined
      : parsedInworldSampleRateHertz,
    inworldBitRate: Number.isNaN(parsedInworldBitRate)
      ? undefined
      : parsedInworldBitRate,
    inworldSpeakingRate: Number.isNaN(parsedInworldSpeakingRate)
      ? undefined
      : parsedInworldSpeakingRate,
    inworldLanguage: tts.inworldLanguage?.trim() || undefined,
    inworldDeliveryMode:
      tts.inworldDeliveryMode && tts.inworldDeliveryMode !== 'default'
        ? (tts.inworldDeliveryMode as InworldDeliveryMode)
        : undefined,
    inworldTemperature: Number.isNaN(parsedInworldTemperature)
      ? undefined
      : parsedInworldTemperature,
    gradiumApiUrl: tts.gradiumApiUrl?.trim() || undefined,
    gradiumOutputFormat:
      (tts.gradiumOutputFormat as GradiumOutputFormat | undefined) || undefined,
    gradiumTemperature: Number.isNaN(parsedGradiumTemperature)
      ? undefined
      : parsedGradiumTemperature,
    gradiumVoiceSimilarity: Number.isNaN(parsedGradiumVoiceSimilarity)
      ? undefined
      : parsedGradiumVoiceSimilarity,
    gradiumPaddingBonus: Number.isNaN(parsedGradiumPaddingBonus)
      ? undefined
      : parsedGradiumPaddingBonus,
    gradiumRewriteRules: tts.gradiumRewriteRules?.trim() || undefined,
    piperPlusBasePath: tts.piperPlusBasePath?.trim() || undefined,
    piperPlusModelConfigFile: tts.piperPlusModelConfigFile?.trim() || undefined,
    piperPlusModelFile: tts.piperPlusModelFile?.trim() || undefined,
    piperPlusVoiceFile: tts.piperPlusVoiceFile?.trim() || undefined,
    piperPlusSpeed: Number.isNaN(parsedPiperPlusSpeed)
      ? undefined
      : parsedPiperPlusSpeed,
    piperPlusNoiseScale: Number.isNaN(parsedPiperPlusNoiseScale)
      ? undefined
      : parsedPiperPlusNoiseScale,
    onPlay,
    onPlayStream,
  } as VoiceServiceOptions;
}

function extractScreenplay(data: unknown): ScreenplayLike | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const maybeWrapped = data as { screenplay?: unknown };
  const source = maybeWrapped.screenplay ?? data;
  if (!source || typeof source !== 'object') {
    return null;
  }

  const screenplay = source as {
    emotion?: unknown;
    text?: unknown;
    delivery?: unknown;
    emotionIntensity?: unknown;
    prosody?: unknown;
    motion?: unknown;
    gaze?: unknown;
    gesture?: unknown;
  };
  const emotion =
    typeof screenplay.emotion === 'string' ? screenplay.emotion : undefined;
  const text =
    typeof screenplay.text === 'string'
      ? sanitizeSpeechText(screenplay.text) || undefined
      : undefined;

  if (!emotion && !text) {
    return null;
  }

  const emotionIntensity =
    typeof screenplay.emotionIntensity === 'number'
      ? Math.min(1, Math.max(0, screenplay.emotionIntensity))
      : undefined;
  const delivery =
    typeof screenplay.delivery === 'string' ? screenplay.delivery : undefined;
  const prosody =
    screenplay.prosody &&
    typeof screenplay.prosody === 'object' &&
    !Array.isArray(screenplay.prosody)
      ? Object.fromEntries(
          Object.entries(screenplay.prosody as Record<string, unknown>)
            .filter(
              ([key, value]) =>
                [
                  'pace',
                  'pitch',
                  'volume',
                  'warmth',
                  'tension',
                  'energy',
                  'assertiveness',
                  'breathiness',
                ].includes(key) &&
                typeof value === 'number' &&
                Number.isFinite(value),
            )
            .map(([key, value]) => [
              key,
              Math.min(1, Math.max(-1, value as number)),
            ]),
        )
      : undefined;

  const motion =
    typeof screenplay.motion === 'string' ? screenplay.motion : undefined;
  const gaze =
    typeof screenplay.gaze === 'string' ? screenplay.gaze : undefined;
  const gesture =
    typeof screenplay.gesture === 'string' ? screenplay.gesture : undefined;

  return {
    emotion,
    text,
    delivery,
    emotionIntensity,
    prosody,
    motion,
    gaze,
    gesture,
  };
}

function extractViewerFacingText(
  rawText: string,
  suppressIncompleteStructuredOutput = false,
): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(withoutFence) as {
      text?: unknown;
      screenplay?: { text?: unknown };
    };
    const parsedText =
      typeof parsed.text === 'string'
        ? parsed.text
        : typeof parsed.screenplay?.text === 'string'
          ? parsed.screenplay.text
          : '';
    return sanitizeViewerFacingText(parsedText);
  } catch {
    if (
      suppressIncompleteStructuredOutput &&
      (/^(?:\{|\[)/.test(withoutFence) || trimmed.startsWith('```'))
    ) {
      return '';
    }
    return sanitizeViewerFacingText(trimmed);
  }
}

function sanitizeViewerFacingText(text: string): string {
  const cleaned = sanitizeSpeechText(text);
  return hasUnsafeSpeechArtifacts(cleaned)
    ? '这条回复出了点问题，稍后再说。'
    : cleaned;
}

export function useAituberCore({
  onAudioPlay,
  onAudioStream,
  onSpeechStart,
  onSpeechEnd,
  onSpeechInterrupted,
  onSpeechChunk,
  settings,
  profile,
  getApiKeyForProvider,
  onAssistantResponse,
  onChatError,
  speechPlanV2Enabled = true,
  personaPlannerEnabled = true,
}: UseAituberCoreOptions) {
  const coreRef = useRef<AITuberOnAirCore | null>(null);
  const manneriDetectorRef = useRef<ManneriDetector | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const messageIdSequenceRef = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const [partialResponse, setPartialResponse] = useState('');
  const [coreGeneration, setCoreGeneration] = useState(0);
  const [isCoreReady, setIsCoreReady] = useState(false);

  // Keep the latest onAudioPlay callback in a ref
  const onAudioPlayRef = useRef(onAudioPlay);
  onAudioPlayRef.current = onAudioPlay;
  const onAudioStreamRef = useRef(onAudioStream);
  onAudioStreamRef.current = onAudioStream;
  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;
  const onSpeechEndRef = useRef(onSpeechEnd);
  onSpeechEndRef.current = onSpeechEnd;
  const onSpeechInterruptedRef = useRef(onSpeechInterrupted);
  onSpeechInterruptedRef.current = onSpeechInterrupted;
  const onSpeechChunkRef = useRef(onSpeechChunk);
  onSpeechChunkRef.current = onSpeechChunk;
  const onAssistantResponseRef = useRef(onAssistantResponse);
  onAssistantResponseRef.current = onAssistantResponse;
  const onChatErrorRef = useRef(onChatError);
  onChatErrorRef.current = onChatError;
  const pendingMemoryRef = useRef<{
    input: string;
    viewerId?: string;
    viewerName?: string;
    source?: 'chat' | 'live' | 'vision';
    eventId?: string;
    commentAt?: number;
    receivedAt?: number;
    queuedAt?: number;
    selectedAt?: number;
    processingAt?: number;
    sourcesSeen?: string[];
    sourceLabel?: string;
    factGuard?: ResponseFactGuard;
    speechPlanHints?: SpeechPlanV2BuilderHints;
    persistInteraction?: boolean;
    onPrepared?: (reply: string, speechPlan?: PreparedSpeechPlan) => void;
  } | null>(null);
  const lastGuardedResponseRef = useRef<{
    eventId?: string;
    text: string;
  } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!settings.manneri.enabled) {
      manneriDetectorRef.current = null;
      return;
    }

    manneriDetectorRef.current = new ManneriDetector({
      similarityThreshold: settings.manneri.similarityThreshold,
      lookbackWindow: settings.manneri.lookbackWindow,
      interventionCooldown: settings.manneri.interventionCooldownMs,
      minMessageLength: settings.manneri.minMessageLength,
      language: 'ja',
      customPrompts: {
        ja: { intervention: profile.manneriPrompts },
      },
    });
  }, [
    settings.manneri.enabled,
    settings.manneri.similarityThreshold,
    settings.manneri.lookbackWindow,
    settings.manneri.interventionCooldownMs,
    settings.manneri.minMessageLength,
    profile.manneriPrompts,
  ]);

  const llmApiKey = getApiKeyForProvider(settings.llm.provider);
  const ttsApiKey = getTtsApiKey(settings, getApiKeyForProvider);
  const isOpenAICompatibleProvider =
    settings.llm.provider === 'openai-compatible';
  const isApiKeyOptionalProvider =
    isOpenAICompatibleProvider || settings.llm.provider === 'gemini-nano';
  const openAICompatibleEndpoint = settings.llm.endpoint?.trim() || '';
  const resolvedModel =
    settings.llm.provider === 'openai-compatible'
      ? settings.llm.model.trim() || 'local-model'
      : settings.llm.model;
  const isOpenAIGPT5Model =
    settings.llm.provider === 'openai' && isGPT5Model(resolvedModel);
  const xaiProviderOptions =
    settings.llm.provider === 'xai' && isXaiReasoningEffortModel(resolvedModel)
      ? {
          reasoning_effort:
            settings.llm.xaiReasoningEffort ||
            getDefaultXaiReasoningEffort(resolvedModel) ||
            'none',
        }
      : undefined;
  const providerOptions = isOpenAICompatibleProvider
    ? {
        endpoint: openAICompatibleEndpoint,
        // The screenplay contract is machine-consumed. Prompt-only JSON
        // instructions are probabilistic, especially for empathetic replies;
        // request the OpenAI-compatible provider's JSON mode as well.
        responseFormat: { type: 'json_object' as const },
        protocolAudit: (audit: {
          phase: 'request' | 'response_headers';
          provider: string;
          model: string;
          endpointHost: string;
          stream: boolean;
          responseFormatType?: string;
          status?: number;
          contentType?: string | null;
        }) =>
          emitRuntimeTrace({
            stage: 'llm_protocol_transport_audit',
            actor: { type: 'system', id: 'openai-compatible-transport' },
            at: Date.now(),
            ...audit,
          }),
      }
    : isOpenAIGPT5Model
      ? GPT5_SAMPLE_PROVIDER_OPTIONS
      : xaiProviderOptions;
  const createMessageId = useCallback(() => {
    messageIdSequenceRef.current += 1;
    return `${Date.now()}-${messageIdSequenceRef.current}`;
  }, []);

  // Effect 1: Recreate core when LLM settings change
  useEffect(() => {
    if (!isApiKeyOptionalProvider && !llmApiKey) {
      coreRef.current?.offAll();
      coreRef.current = null;
      setIsCoreReady(false);
      console.error(
        `API key is not set for provider: ${settings.llm.provider}`,
      );
      return;
    }

    if (isOpenAICompatibleProvider && !openAICompatibleEndpoint) {
      coreRef.current?.offAll();
      coreRef.current = null;
      setIsCoreReady(false);
      console.error('Endpoint URL is required for openai-compatible provider');
      return;
    }

    // ChatProcessor has already produced a validated structured response by
    // the time this transform runs. Deliver its draft here instead of waiting
    // for a later async core event: some provider/core combinations finish
    // processing before that event reaches the browser listener. Clearing the
    // callback makes the later ASSISTANT_RESPONSE event idempotent.
    const deliverPreparedDraft = (
      text: string,
      speechPlan?: PreparedSpeechPlan,
    ) => {
      const pending = pendingMemoryRef.current;
      const reply = text.trim();
      if (!pending?.onPrepared || !reply) return;
      const onPrepared = pending.onPrepared;
      pending.onPrepared = undefined;
      onPrepared(reply, speechPlan);
    };

    const deliverVerifiedFactFallback = (error: unknown): boolean => {
      const pending = pendingMemoryRef.current;
      const requiredAnswer = sanitizeSpeechText(
        pending?.factGuard?.requiredAnswer ?? '',
      );
      if (
        !pending?.onPrepared ||
        !pending.factGuard?.isWeather ||
        !requiredAnswer
      ) {
        return false;
      }
      const guarded = guardViewerResponse(requiredAnswer, pending.factGuard);
      const localSpeechPlan = buildSpeechPlanV2(
        guarded.text,
        pending.speechPlanHints,
      );
      const preparedSpeechPlan: PreparedSpeechPlan = {
        version: 2,
        beats: localSpeechPlan.beats.map((beat) => ({
          ...beat,
          text: sanitizeSpeechText(beat.text),
          ttsText: formatTtsSpeechScript(beat.text),
          prosody: beat.prosody
            ? Object.fromEntries(Object.entries(beat.prosody))
            : undefined,
        })),
      };
      emitRuntimeTrace({
        eventId: pending.eventId,
        stage: 'verified_fact_generation_fallback',
        actor: { type: 'system', id: 'response-guard' },
        at: Date.now(),
        reason: 'model-generation-failed-after-authoritative-tool-result',
        error: error instanceof Error ? error.message : String(error),
        output: { text: guarded.text },
        factGuard: pending.factGuard,
      });
      deliverPreparedDraft(guarded.text, preparedSpeechPlan);
      pendingMemoryRef.current = null;
      lastGuardedResponseRef.current = null;
      setPartialResponse('');
      return true;
    };

    const core = new AITuberOnAirCore({
      apiKey: llmApiKey.trim(),
      chatProvider: settings.llm.provider,
      model: resolvedModel,
      providerOptions,
      chatOptions: {
        systemPrompt: buildCharacterSystemPrompt(profile, {
          speechPlanV2Enabled,
          personaPlannerEnabled,
        }),
        // M3 writes only the short spoken draft. SpeechPlanV2 is constructed
        // locally, so the model no longer needs hundreds of tokens for JSON.
        maxTokens: 320,
      },
      voiceOptions: buildVoiceOptions(
        settings.tts,
        ttsApiKey,
        async (audioBuffer: ArrayBuffer) => {
          await onAudioPlayRef.current(audioBuffer);
        },
        onAudioStream
          ? async (audioStream: AsyncGenerator<ArrayBuffer>) => {
              await onAudioStreamRef.current?.(audioStream);
            }
          : undefined,
      ),
      responseSpeechPlanTransform: speechPlanV2Enabled
        ? (speechPlan) => {
            const pending = pendingMemoryRef.current;
            const combinedText = speechPlan.beats
              .map((beat) => beat.text.trim())
              .filter(Boolean)
              .join(' ');
            const localSpeechPlan = buildSpeechPlanV2(
              combinedText,
              pending?.speechPlanHints,
            );
            const guarded = guardViewerResponse(
              localSpeechPlan.beats.map((beat) => beat.text).join(' '),
              pending?.factGuard,
            );
            lastGuardedResponseRef.current = {
              eventId: pending?.eventId,
              text: guarded.text,
            };
            emitRuntimeTrace({
              eventId: pending?.eventId,
              stage: 'speech_plan_transform',
              actor: { type: 'system', id: 'response-guard' },
              at: Date.now(),
              input: {
                version: localSpeechPlan.version,
                beats: localSpeechPlan.beats,
              },
              sanitizedText: guarded.sanitizedText,
              output: { text: guarded.text },
              rewritten: guarded.rewritten,
              reasons: guarded.reasons,
              factGuard: pending?.factGuard,
            });
            const preparedSpeechPlan: PreparedSpeechPlan =
              guarded.rewritten || guarded.text !== combinedText
                ? {
                    version: 2,
                    beats: [
                      {
                        ...localSpeechPlan.beats[0],
                        text: guarded.text,
                        ttsText: formatTtsSpeechScript(guarded.text),
                        prosody: localSpeechPlan.beats[0].prosody
                          ? Object.fromEntries(
                              Object.entries(localSpeechPlan.beats[0].prosody),
                            )
                          : undefined,
                        pauseAfterMs: 0,
                        interruptibleAfter: true,
                      },
                    ],
                  }
                : {
                    version: 2,
                    beats: localSpeechPlan.beats.map((beat) => {
                      const text = sanitizeSpeechText(beat.text);
                      return {
                        ...beat,
                        text,
                        ttsText: formatTtsSpeechScript(text),
                        prosody: beat.prosody
                          ? Object.fromEntries(Object.entries(beat.prosody))
                          : undefined,
                      };
                    }),
                  };
            deliverPreparedDraft(guarded.text, preparedSpeechPlan);
            if (guarded.rewritten || guarded.text !== combinedText) {
              return preparedSpeechPlan;
            }
            return preparedSpeechPlan;
          }
        : undefined,
      responseScreenplayTransform: (screenplay) => {
        const pending = pendingMemoryRef.current;
        const guarded = guardViewerResponse(
          screenplay.ttsText || screenplay.text,
          pending?.factGuard,
        );
        const ttsText = formatTtsSpeechScript(guarded.text);
        lastGuardedResponseRef.current = {
          eventId: pending?.eventId,
          text: guarded.text,
        };
        emitRuntimeTrace({
          eventId: pending?.eventId,
          stage: 'response_transform',
          actor: { type: 'system', id: 'response-guard' },
          at: Date.now(),
          input: {
            screenplayText: screenplay.text,
            screenplayTtsText: screenplay.ttsText,
          },
          sanitizedText: guarded.sanitizedText,
          output: {
            text: guarded.text,
            ttsText,
          },
          rewritten: guarded.rewritten,
          reasons: guarded.reasons,
          factGuard: pending?.factGuard,
        });
        deliverPreparedDraft(guarded.text);
        if (guarded.rewritten) {
          emitRuntimeTrace({
            eventId: pending?.eventId,
            stage: guarded.unsafeArtifacts
              ? 'sanitizer_failure'
              : 'fact_validation_rewrite',
            actor: { type: 'system', id: 'response-guard' },
            at: Date.now(),
            before: screenplay.ttsText || screenplay.text,
            after: guarded.text,
            reasons: guarded.reasons,
          });
        }
        return {
          ...screenplay,
          text: guarded.text,
          ttsText,
        };
      },
      speechChunking: {
        // MiniMax HTTP TTS is verified to return a stable complete MP3. Keep
        // one reply in one synthesis transaction; browser-side consecutive
        // requests can otherwise leave a later beat hanging without an HTTP
        // error, even when the provider itself is healthy.
        enabled: false,
        locale: 'zh',
      },
      debug: false,
    } as ConstructorParameters<typeof AITuberOnAirCore>[0]);

    // Subscribe to core events
    core.on(AITuberOnAirCoreEvent.PROCESSING_START, () => {
      processingRef.current = true;
      setIsProcessing(true);
      setPartialResponse('');
    });

    core.on(AITuberOnAirCoreEvent.PROCESSING_END, () => {
      processingRef.current = false;
      setIsProcessing(false);
      setPartialResponse('');
    });

    core.on(AITuberOnAirCoreEvent.ASSISTANT_PARTIAL, (data: unknown) => {
      const rawText =
        typeof data === 'string'
          ? data
          : ((data as { message?: string; rawText?: string })?.message ??
            (data as { rawText?: string })?.rawText ??
            String(data));
      // Never render incomplete JSON envelopes or model-internal XML blocks.
      setPartialResponse(extractViewerFacingText(rawText, true));
    });

    core.on(AITuberOnAirCoreEvent.ASSISTANT_RESPONSE, (data: unknown) => {
      let content: string;
      if (typeof data === 'string') {
        content = data;
      } else {
        const d = data as {
          message?: { content?: string } | string;
          screenplay?: { text?: string };
          rawText?: string;
          modelRawText?: string;
          finishReason?: unknown;
          responseStatus?: unknown;
          incompleteDetails?: unknown;
          usage?: unknown;
        };
        const msg = d?.message;
        const cleanText = d?.screenplay?.text?.trim();
        content =
          cleanText ||
          ((typeof msg === 'string' ? msg : msg?.content) ??
            d?.rawText ??
            String(data));
      }
      const noReply = content.trim() === NO_REPLY_TOKEN;
      const pending = pendingMemoryRef.current;
      const responseData =
        data && typeof data === 'object'
          ? (data as {
              message?: { content?: string } | string;
              screenplay?: { text?: string; ttsText?: string };
              rawText?: string;
              modelRawText?: string;
              finishReason?: unknown;
              responseStatus?: unknown;
              incompleteDetails?: unknown;
              usage?: unknown;
            })
          : null;
      emitRuntimeTrace({
        eventId: pending?.eventId,
        stage: 'model_output',
        actor: { type: 'system', id: 'chat-model' },
        at: Date.now(),
        provider: settings.llm.provider,
        model: settings.llm.model,
        // Raw provider text may contain private reasoning envelopes. Keep only
        // the derived protocol inspection and the viewer-facing parse in the
        // runtime log; the raw chain is neither an audit fact nor UI data.
        speechPlanEnvelope: inspectSpeechPlanEnvelope(
          responseData?.modelRawText ??
            (typeof data === 'string' ? data : undefined),
        ),
        parsedText:
          typeof responseData?.message === 'string'
            ? responseData.message
            : responseData?.message?.content,
        transformedScreenplay: responseData?.screenplay,
        finalText: content,
        finishReason: responseData?.finishReason,
        responseStatus: responseData?.responseStatus,
        incompleteDetails: responseData?.incompleteDetails,
        usage: responseData?.usage,
      });
      const lastGuardedResponse = lastGuardedResponseRef.current;
      let guardedFallback = '';
      if (
        pending &&
        lastGuardedResponse &&
        lastGuardedResponse.eventId === pending.eventId
      ) {
        guardedFallback = lastGuardedResponse.text;
      }
      const viewerContent = noReply
        ? ''
        : extractViewerFacingText(content) || guardedFallback;
      if (viewerContent) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: 'assistant',
            content: viewerContent,
            timestamp: Date.now(),
          },
        ]);
      }
      if (pending && viewerContent && pending.persistInteraction !== false) {
        onAssistantResponseRef.current?.(pending.input, viewerContent, pending);
      }
      // Consume the prepared-draft callback before clearing its correlation
      // record. Some providers reach this event without running the response
      // transform, so this is the final authoritative delivery path.
      deliverPreparedDraft(noReply ? NO_REPLY_TOKEN : viewerContent);
      pendingMemoryRef.current = null;
      lastGuardedResponseRef.current = null;
      setPartialResponse('');
    });

    core.on(AITuberOnAirCoreEvent.SPEECH_START, (data: unknown) => {
      const screenplay = extractScreenplay(data);
      if (screenplay) {
        onSpeechStartRef.current?.(screenplay);
      }
    });

    core.on(AITuberOnAirCoreEvent.SPEECH_END, () => {
      onSpeechEndRef.current?.();
    });
    core.on(AITuberOnAirCoreEvent.SPEECH_INTERRUPTED, () => {
      onSpeechInterruptedRef.current?.();
    });

    const forwardSpeechChunk = (
      stage: 'start' | 'end' | 'error',
      data: unknown,
    ) => {
      const value = (data || {}) as Record<string, unknown>;
      const rawError = value.error;
      const error =
        rawError instanceof Error
          ? rawError.message
          : typeof rawError === 'string'
            ? rawError
            : rawError == null
              ? undefined
              : String(rawError);
      // Error instances serialize as `{}` in the runtime event JSONL. Convert
      // them at the boundary so a failed TTS beat stays diagnosable.
      onSpeechChunkRef.current?.(stage, error ? { ...value, error } : value);
    };
    core.on('speechChunkStart' as AITuberOnAirCoreEvent, (data: unknown) =>
      forwardSpeechChunk('start', data),
    );
    core.on('speechChunkEnd' as AITuberOnAirCoreEvent, (data: unknown) =>
      forwardSpeechChunk('end', data),
    );
    core.on('speechChunkError' as AITuberOnAirCoreEvent, (data: unknown) =>
      forwardSpeechChunk('error', data),
    );

    core.on(AITuberOnAirCoreEvent.ERROR, (error: unknown) => {
      console.error('AITuberOnAirCore error:', error);
      const errorText =
        error instanceof Error ? error.message : JSON.stringify(error);
      if (/\b429\b|rate.?limit|too many requests|限流/i.test(errorText)) {
        void fetch('/api/live-runtime-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: pendingMemoryRef.current?.eventId,
            stage: 'tts_rate_limit',
            at: Date.now(),
            error: errorText.slice(0, 500),
          }),
        }).catch(() => undefined);
      }
      setIsProcessing(false);
      if (deliverVerifiedFactFallback(error)) {
        onSpeechEndRef.current?.();
        return;
      }
      onChatErrorRef.current?.(error, {
        eventId: pendingMemoryRef.current?.eventId,
      });
      onSpeechEndRef.current?.();
    });

    coreRef.current = core;
    setIsCoreReady(true);

    return () => {
      core.offAll();
      if (coreRef.current === core) coreRef.current = null;
      setIsCoreReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.llm.provider,
    settings.llm.model,
    settings.llm.endpoint,
    settings.llm.xaiReasoningEffort,
    llmApiKey,
    isApiKeyOptionalProvider,
    createMessageId,
    profile,
    coreGeneration,
    speechPlanV2Enabled,
    personaPlannerEnabled,
  ]);

  // Effect 2: Update voice service when TTS settings change (no core recreation)
  useEffect(() => {
    if (!coreRef.current) return;
    coreRef.current.updateVoiceService(
      buildVoiceOptions(
        settings.tts,
        ttsApiKey,
        async (audioBuffer: ArrayBuffer) => {
          await onAudioPlayRef.current(audioBuffer);
        },
        onAudioStream
          ? async (audioStream: AsyncGenerator<ArrayBuffer>) => {
              await onAudioStreamRef.current?.(audioStream);
            }
          : undefined,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.tts.engine,
    settings.tts.speaker,
    settings.tts.openAiCompatibleApiUrl,
    settings.tts.openAiCompatibleModel,
    settings.tts.openAiCompatibleSpeed,
    settings.tts.voicevoxApiUrl,
    settings.tts.voicepeakApiUrl,
    settings.tts.aivisSpeechApiUrl,
    settings.tts.aivisCloudModelUuid,
    settings.tts.aivisCloudSpeakerUuid,
    settings.tts.aivisCloudStyleId,
    settings.tts.minimaxGroupId,
    settings.tts.xaiLanguage,
    settings.tts.xaiCodec,
    settings.tts.xaiSampleRate,
    settings.tts.xaiBitRate,
    ttsApiKey,
  ]);

  const processChat = useCallback(
    async (text: string, options?: ProcessChatOptions): Promise<boolean> => {
      if (!coreRef.current || processingRef.current || !text.trim())
        return false;

      const displayText = (options?.displayText ?? text).trim();
      lastGuardedResponseRef.current = null;
      pendingMemoryRef.current = {
        input: displayText,
        viewerId: options?.viewerId,
        viewerName: options?.viewerName,
        source: options?.source ?? 'chat',
        eventId: options?.eventId,
        commentAt: options?.commentAt,
        receivedAt: options?.receivedAt,
        queuedAt: options?.queuedAt,
        selectedAt: options?.selectedAt,
        processingAt: options?.processingAt,
        sourcesSeen: options?.sourcesSeen,
        sourceLabel: options?.sourceLabel,
        factGuard: options?.factGuard,
        speechPlanHints: options?.speechPlanHints,
        persistInteraction: options?.persistInteraction,
        onPrepared: options?.onPrepared,
      };
      let transientContext = options?.memoryContext ?? '';
      const manneriDetector = manneriDetectorRef.current;

      if (manneriDetector) {
        try {
          const manneriMessages = toManneriMessages(
            messagesRef.current,
            displayText,
          );
          if (manneriDetector.shouldIntervene(manneriMessages)) {
            const prompt =
              manneriDetector.generateDiversificationPrompt(manneriMessages);
            transientContext += `\n\n${buildManneriAugmentedInput(
              displayText,
              prompt.content,
            )}`;
          }
        } catch (err) {
          console.warn('Manneri detection failed:', err);
        }
      }

      // Append the user message to the chat log
      if (options?.showInput !== false) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: 'user',
            content: displayText,
            timestamp: Date.now(),
            sourceLabel: options?.sourceLabel,
          },
        ]);
      }

      try {
        // `displayText` is deliberately the short, operator-facing label for
        // system-originated turns (for example, "空场自语（inspiration）").
        // The actual `text` may instead be a bounded internal prompt carrying
        // the current clock and the quiet-room cue. Sending the label here
        // discards that context and makes the model invent a plausible time.
        const modelInput = text.trim();
        emitRuntimeTrace({
          eventId: options?.eventId,
          stage: 'model_request',
          actor: { type: 'system', id: 'chat-runtime' },
          at: Date.now(),
          provider: settings.llm.provider,
          model: settings.llm.model,
          viewerInput: displayText,
          modelInput,
          systemPrompt: buildCharacterSystemPrompt(profile, {
            speechPlanV2Enabled,
            personaPlannerEnabled,
          }),
          transientContext,
          factGuard: options?.factGuard,
          source: options?.source ?? 'chat',
          sourceLabel: options?.sourceLabel,
        });
        return await coreRef.current.processChat(modelInput, {
          speak: !options?.silent,
          transientContext,
        });
      } catch (err) {
        console.error('processChat error:', err);
        onChatErrorRef.current?.(err, { eventId: options?.eventId });
        setIsProcessing(false);
        return false;
      }
    },
    [
      createMessageId,
      profile,
      settings.llm.model,
      settings.llm.provider,
      speechPlanV2Enabled,
      personaPlannerEnabled,
    ],
  );

  const processVisionChat = useCallback(
    async (imageDataUrl: string, prompt = LINGLAN_VISION_PROMPT) => {
      if (!coreRef.current || !imageDataUrl) return;

      const trimmedPrompt = prompt.trim() || LINGLAN_VISION_PROMPT;
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: 'user',
          content: '观察直播画面',
          timestamp: Date.now(),
        },
      ]);

      try {
        await coreRef.current.processVisionChat(imageDataUrl, trimmedPrompt);
      } catch (err) {
        console.error('processVisionChat error:', err);
        setIsProcessing(false);
      }
    },
    [createMessageId],
  );

  const speakPrepared = useCallback(
    async (text: string, preparedSpeechPlan?: PreparedSpeechPlan) => {
      const spokenText = text.trim();
      if (!spokenText) return;
      // Operator playback reuses the package-level MiniMax SSE parser instead
      // of maintaining a second response protocol in the example app. This
      // keeps explicit error propagation while allowing audio playback before
      // the provider has synthesized the entire reply.
      if (settings.tts.engine === 'minimax') {
        const beats =
          preparedSpeechPlan?.version === 2 &&
          preparedSpeechPlan.beats.length > 0
            ? preparedSpeechPlan.beats
            : [{ text: spokenText, ttsText: spokenText }];
        let activeChunk: Record<string, unknown> | undefined;
        try {
          onSpeechStartRef.current?.({ text: spokenText });
          for (const [index, beat] of beats.entries()) {
            const text = beat.text.trim();
            if (!text) continue;
            const chunk = {
              index,
              count: beats.length,
              text,
              screenplay: beat,
              interruptibleAfter: beat.interruptibleAfter,
              startedAt: Date.now(),
              bridge: 'minimax-stream',
            };
            activeChunk = chunk;
            const engine = new MinimaxEngine();
            engine.setApiEndpoint('/api/minimax-tts');
            engine.setModel('speech-2.8-turbo');
            engine.setLanguageBoost(LINGLAN_PROFILE.voice.languageBoost);
            engine.setAudioSettings({
              sampleRate: 44100,
              bitrate: 128000,
              format: 'mp3',
              channel: 1,
            });
            const audioStream = engine.fetchAudioStream(
              {
                style: ([
                  'talk', 'neutral', 'happy', 'sad', 'angry', 'surprised',
                  'relaxed', 'bored', 'impatient', 'embarrassed', 'awkward', 'serious',
                ].includes(beat.emotion || '')
                  ? beat.emotion
                  : 'talk') as TalkStyle,
                message: beat.ttsText || text,
                delivery: beat.delivery,
                emotionIntensity: beat.emotionIntensity,
                prosody: beat.prosody,
              },
              settings.tts.speaker,
              ttsApiKey,
            );
            const boundedAudioStream = closeAudioStreamAfterIdle(audioStream);
            onSpeechChunkRef.current?.('start', chunk);
            if (onAudioStreamRef.current) {
              await onAudioStreamRef.current(boundedAudioStream);
            } else {
              const parts: Uint8Array[] = [];
              let byteLength = 0;
              for await (const part of boundedAudioStream) {
                const bytes = new Uint8Array(part);
                parts.push(bytes);
                byteLength += bytes.byteLength;
              }
              if (byteLength < 16) throw new Error('minimax_stream_empty');
              const audio = new Uint8Array(byteLength);
              let offset = 0;
              for (const part of parts) {
                audio.set(part, offset);
                offset += part.byteLength;
              }
              await onAudioPlayRef.current(audio.buffer);
            }
            onSpeechChunkRef.current?.('end', { ...chunk, endedAt: Date.now() });
            activeChunk = undefined;
            const pauseAfterMs = beat.pauseAfterMs ?? 0;
            if (index < beats.length - 1 && pauseAfterMs) {
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, Math.min(2_500, Math.max(0, pauseAfterMs))),
              );
            }
          }
          onSpeechEndRef.current?.();
        } catch (error) {
          if (activeChunk) {
            onSpeechChunkRef.current?.('error', {
              ...activeChunk,
              endedAt: Date.now(),
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
        return;
      }
      if (!coreRef.current) return;
      await coreRef.current.speakTextWithOptions(spokenText, {
        enableAnimation: true,
      });
    },
    [settings.tts.engine, settings.tts.speaker, ttsApiKey],
  );

  // A provider request can outlive its transport timeout.  Retire that core
  // instance so its private processing lock cannot reject every later queue
  // item while the React-facing state looks idle.
  const recoverChatRuntime = useCallback(() => {
    pendingMemoryRef.current = null;
    lastGuardedResponseRef.current = null;
    processingRef.current = false;
    coreRef.current?.offAll();
    coreRef.current = null;
    setIsProcessing(false);
    setPartialResponse('');
    setIsCoreReady(false);
    setCoreGeneration((generation) => generation + 1);
  }, []);

  const interruptSpeech = useCallback(
    (mode: 'immediate' | 'beat-boundary' = 'beat-boundary') => {
      coreRef.current?.interruptSpeech(mode);
    },
    [],
  );

  return {
    messages,
    isProcessing,
    partialResponse,
    processChat,
    speakPrepared,
    processVisionChat,
    isCoreReady,
    recoverChatRuntime,
    interruptSpeech,
  };
}
