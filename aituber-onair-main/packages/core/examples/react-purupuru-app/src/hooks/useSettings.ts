import {
  AITuberOnAirCore,
  type RefreshOpenRouterFreeModelsResult,
  type XaiReasoningEffort,
  getDefaultXaiReasoningEffort,
  refreshOpenRouterFreeModels,
} from '@aituber-onair/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LINGLAN_COMPANION_MEMORY,
  LINGLAN_COMPANION_PERSONA,
  LINGLAN_PROFILE,
  LINGLAN_VISION_PROMPT,
} from '../config/characterProfile';
import type {
  AppSettings,
  DigitalHumanProfile,
  DigitalHumanMemoryProfile,
  DigitalHumanPersona,
  AvatarViewTransform,
  ChatProviderOption,
  StreamingPlatformOption,
  SocialStreamSettings,
  LiveConnectorSettings,
  TTSEngineOption,
  VisualSettings,
} from '../types/settings';
import { createPlatformConnection } from '../services/live-platform/connectors';

type ApiKeyProvider = Exclude<ChatProviderOption, 'gemini-nano'>;

const STORAGE_KEY = 'react-purupuru-app-settings';
const PREVIOUS_LINGLAN_DEFAULT_SPEAKERS = new Set([
  'Chinese (Mandarin)_Mature_Woman',
  'female-yujie',
]);
const isIncompatibleMinimaxSpeaker = (speaker: string) =>
  speaker.toLowerCase().startsWith('male-');
const DEFAULT_AIVIS_CLOUD_MODEL_UUID = '22e8ed77-94fe-4ef2-871f-a86f94e9a579';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_GEMINI_TTS_LANGUAGE_CODE = 'ja-JP';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'local-model';
const DEFAULT_OPENAI_COMPATIBLE_ENDPOINT =
  'http://localhost:11434/v1/chat/completions';
const DEFAULT_OPENAI_COMPATIBLE_TTS_ENDPOINT =
  'http://localhost:8880/v1/audio/speech';
const DEFAULT_UNREAL_SPEECH_TTS_ENDPOINT =
  'https://api.v8.unrealspeech.com/stream';
const DEFAULT_ELEVENLABS_TTS_ENDPOINT =
  'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
const DEFAULT_INWORLD_TTS_ENDPOINT = 'https://api.inworld.ai/tts/v1/voice';
const DEFAULT_INWORLD_MODEL = 'inworld-tts-2';
const DEFAULT_INWORLD_AUDIO_ENCODING = 'MP3';
const DEFAULT_INWORLD_SAMPLE_RATE_HERTZ = '48000';
const DEFAULT_INWORLD_LANGUAGE = 'ja-JP';
const DEFAULT_GRADIUM_TTS_ENDPOINT =
  'https://api.gradium.ai/api/post/speech/tts';
const DEFAULT_GRADIUM_OUTPUT_FORMAT = 'wav';
const DEFAULT_PIPER_PLUS_BASE_PATH = `${import.meta.env.BASE_URL}piper/`;
const DEFAULT_PIPER_PLUS_MODEL_CONFIG_FILE = 'tsukuyomi-config.json';
const DEFAULT_PIPER_PLUS_MODEL_FILE = 'tsukuyomi-wavlm-300epoch.onnx';
const DEFAULT_PIPER_PLUS_VOICE_FILE = 'mei_normal.htsvoice';
const DEFAULT_OPENROUTER_MAX_CANDIDATES = 1;
const DEFAULT_OPENROUTER_MAX_WORKING = 10;
const LEGACY_SCREEN_VISION_PROMPT =
  '观看 OBS 虚拟摄像头画面，以主播身份做出简短自然的评论。';
const EMPTY_MODEL_IDS: string[] = [];
const AVATAR_VIEW_MIN_SCALE = 0.2;
const AVATAR_VIEW_MAX_SCALE = 3;
const AVATAR_VIEW_MAX_OFFSET = 100_000;

function preferLocalCredential(
  localValue: string | undefined,
  remoteValue: string | undefined,
): string {
  // A listener can safely inherit non-secret runtime settings, but an empty
  // producer snapshot must never erase a working credential stored by the
  // browser actually responsible for playback.
  return localValue?.trim() ? localValue : remoteValue || '';
}

function retainLocalTtsCredentials(
  remote: AppSettings,
  local: AppSettings,
): AppSettings {
  return {
    ...remote,
    tts: {
      ...remote.tts,
      openAiCompatibleApiKey: preferLocalCredential(
        local.tts.openAiCompatibleApiKey,
        remote.tts.openAiCompatibleApiKey,
      ),
      aivisCloudApiKey: preferLocalCredential(
        local.tts.aivisCloudApiKey,
        remote.tts.aivisCloudApiKey,
      ),
      minimaxApiKey: preferLocalCredential(
        local.tts.minimaxApiKey,
        remote.tts.minimaxApiKey,
      ),
      minimaxGroupId: preferLocalCredential(
        local.tts.minimaxGroupId,
        remote.tts.minimaxGroupId,
      ),
      unrealSpeechApiKey: preferLocalCredential(
        local.tts.unrealSpeechApiKey,
        remote.tts.unrealSpeechApiKey,
      ),
      elevenLabsApiKey: preferLocalCredential(
        local.tts.elevenLabsApiKey,
        remote.tts.elevenLabsApiKey,
      ),
      inworldApiKey: preferLocalCredential(
        local.tts.inworldApiKey,
        remote.tts.inworldApiKey,
      ),
      gradiumApiKey: preferLocalCredential(
        local.tts.gradiumApiKey,
        remote.tts.gradiumApiKey,
      ),
    },
  };
}
const LEGACY_LINGLAN_DESCRIPTION =
  '台风监测主播 · MiniMax · SoulX-FlashHead Lite';
const LINGLAN_COMPANION_DESCRIPTION =
  '有事业心的女皇型气象虚拟主播 · 台风监测专家 · MiniMax';
const LEGACY_LINGLAN_PERSONA: DigitalHumanPersona = {
  identity: '风暴女王，独立主持岚台的台风监测数字人主播。',
  liveFocus: '台风监测、风险解释、实用防灾准备与直播互动。',
  audienceRelationship:
    '观众是平等的直播间来宾；可以考验其是否认真，但不把安全信息作为交换。',
  speakingStyle: '冷静、利落、嘴硬心软；先给结论，再给关键依据。',
  signatureHabit: '低频使用“本王”；面对数据先核对时间、来源和实况/预报边界。',
  hardBoundaries:
    '不冒充官方机构；不编造台风数据；不攻击他人；风险和避险信息无条件提供。',
};
const LEGACY_LINGLAN_MEMORY: DigitalHumanMemoryProfile = {
  coreIdentity: '凌岚是岚台的风暴女王与独立台风监测主播，先核实再发言。',
  relationship:
    '她把运营者视为直播间的搭档；把观众视为平等来宾，尊重认真提问。',
  preferences: '偏好具体问题、可靠来源与可执行准备；反感谣言、恐慌和空泛套话。',
  episodes: '她在沿海台风夜经历过停电，因此格外重视准备、时间点与官方通知。',
  commitments: '风险、预警、撤离与避险信息始终优先且无条件提供。',
  knowledgeBoundaries:
    '只依据用户提供、画面可见或技能返回的资料；不冒充官方，不编造数据或他人隐私。',
};

function getOrderedModels(provider: ChatProviderOption): string[] {
  const models = AITuberOnAirCore.getSupportedModels(provider);
  if (provider === 'claude') {
    return [...models].reverse();
  }
  return models;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeFiniteNumber(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeAvatarViewTransform(
  value: Partial<AvatarViewTransform> | undefined,
): AvatarViewTransform {
  return {
    x: clampNumber(
      normalizeFiniteNumber(value?.x, 0),
      -AVATAR_VIEW_MAX_OFFSET,
      AVATAR_VIEW_MAX_OFFSET,
    ),
    y: clampNumber(
      normalizeFiniteNumber(value?.y, 0),
      -AVATAR_VIEW_MAX_OFFSET,
      AVATAR_VIEW_MAX_OFFSET,
    ),
    scale: clampNumber(
      normalizeFiniteNumber(value?.scale, 1),
      AVATAR_VIEW_MIN_SCALE,
      AVATAR_VIEW_MAX_SCALE,
    ),
  };
}

function normalizeVisualSettings(
  value: Partial<VisualSettings> | undefined,
  defaults: VisualSettings,
): VisualSettings {
  const merged = { ...defaults, ...value };
  const avatarView = normalizeAvatarViewTransform({
    x: merged.avatarViewX,
    y: merged.avatarViewY,
    scale: merged.avatarViewScale,
  });
  return {
    ...merged,
    avatarViewX: avatarView.x,
    avatarViewY: avatarView.y,
    avatarViewScale: avatarView.scale,
  };
}

function normalizeModelIds(modelIds: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const modelId of modelIds) {
    const trimmed = modelId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function mergeModelIds(base: string[], extras: string[]): string[] {
  const merged = [...base];
  const seen = new Set(base);

  for (const modelId of extras) {
    const trimmed = modelId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    merged.push(trimmed);
  }

  return merged;
}

function normalizeOpenRouterDynamicFreeModels(
  value: AppSettings['llm']['openRouterDynamicFreeModels'] | undefined,
): NonNullable<AppSettings['llm']['openRouterDynamicFreeModels']> {
  return {
    models: normalizeModelIds(value?.models || []),
    fetchedAt:
      typeof value?.fetchedAt === 'number' && Number.isFinite(value.fetchedAt)
        ? value.fetchedAt
        : 0,
    maxCandidates: normalizePositiveInteger(
      value?.maxCandidates,
      DEFAULT_OPENROUTER_MAX_CANDIDATES,
    ),
  };
}

function migrateLinglanCompanionProfile(
  profile: DigitalHumanProfile,
  defaults: DigitalHumanProfile,
): DigitalHumanProfile {
  if (profile.id !== LINGLAN_PROFILE.id) return profile;
  const persona = { ...profile.persona };
  const memory = { ...profile.memory };
  for (const key of Object.keys(LEGACY_LINGLAN_PERSONA) as Array<
    keyof DigitalHumanPersona
  >) {
    if (persona[key] === LEGACY_LINGLAN_PERSONA[key]) {
      persona[key] = LINGLAN_COMPANION_PERSONA[key];
    }
  }
  for (const key of Object.keys(LEGACY_LINGLAN_MEMORY) as Array<
    keyof DigitalHumanMemoryProfile
  >) {
    if (memory[key] === LEGACY_LINGLAN_MEMORY[key]) {
      memory[key] = LINGLAN_COMPANION_MEMORY[key];
    }
  }
  return {
    ...profile,
    description:
      profile.description === LEGACY_LINGLAN_DESCRIPTION
        ? defaults.description
        : profile.description,
    persona,
    memory,
    installedSkillIds: Array.from(
      new Set([
        ...(profile.installedSkillIds || []),
        ...(profile.id === LINGLAN_PROFILE.id ? ['typhoon-boss-radar'] : []),
      ]),
    ),
  };
}

function getDefaultSettings(): AppSettings {
  return {
    digitalHumans: {
      activeId: LINGLAN_PROFILE.id,
      profiles: [
        {
          id: LINGLAN_PROFILE.id,
          displayName: LINGLAN_PROFILE.displayName,
          title: LINGLAN_PROFILE.title,
          description: LINGLAN_COMPANION_DESCRIPTION,
          voiceSpeaker: LINGLAN_PROFILE.voice.defaultSpeaker,
          avatarLabel: '凌',
          enabled: true,
          persona: LINGLAN_COMPANION_PERSONA,
          memory: LINGLAN_COMPANION_MEMORY,
          installedSkillIds: ['typhoon-boss-radar'],
        },
      ],
    },
    llm: {
      provider: 'openai',
      model: 'gpt-4.1-nano',
      endpoint: DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
      xaiReasoningEffort: 'none',
      apiKeys: {
        openai: '',
        'openai-compatible': '',
        openrouter: '',
        gemini: '',
        claude: '',
        zai: '',
        kimi: '',
        xai: '',
        deepseek: '',
        mistral: '',
        sakana: '',
        plamo: '',
      },
      openRouterDynamicFreeModels: {
        models: [],
        fetchedAt: 0,
        maxCandidates: DEFAULT_OPENROUTER_MAX_CANDIDATES,
      },
    },
    tts: {
      engine: LINGLAN_PROFILE.voice.engine as TTSEngineOption,
      speaker: LINGLAN_PROFILE.voice.defaultSpeaker,
      openAiCompatibleApiKey: '',
      openAiCompatibleApiUrl: DEFAULT_OPENAI_COMPATIBLE_TTS_ENDPOINT,
      openAiCompatibleModel: DEFAULT_OPENAI_COMPATIBLE_MODEL,
      openAiCompatibleSpeed: '',
      geminiTtsModel: DEFAULT_GEMINI_TTS_MODEL,
      geminiTtsLanguageCode: DEFAULT_GEMINI_TTS_LANGUAGE_CODE,
      geminiTtsPrompt: '',
      aivisCloudApiKey: '',
      aivisCloudModelUuid: DEFAULT_AIVIS_CLOUD_MODEL_UUID,
      aivisCloudSpeakerUuid: '',
      aivisCloudStyleId: '',
      minimaxApiKey: '',
      minimaxGroupId: '',
      xaiLanguage: 'auto',
      xaiCodec: 'mp3',
      xaiSampleRate: 24000,
      xaiBitRate: 128000,
      unrealSpeechApiKey: '',
      unrealSpeechApiUrl: DEFAULT_UNREAL_SPEECH_TTS_ENDPOINT,
      unrealSpeechBitrate: '192k',
      unrealSpeechSpeed: '',
      unrealSpeechPitch: '',
      unrealSpeechCodec: 'libmp3lame',
      unrealSpeechTemperature: '',
      elevenLabsApiKey: '',
      elevenLabsApiUrl: DEFAULT_ELEVENLABS_TTS_ENDPOINT,
      elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
      elevenLabsOutputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
      elevenLabsLanguageCode: '',
      elevenLabsStability: '',
      elevenLabsSimilarityBoost: '',
      elevenLabsStyle: '',
      elevenLabsUseSpeakerBoost: 'default',
      elevenLabsSpeed: '',
      elevenLabsSeed: '',
      elevenLabsApplyTextNormalization: 'default',
      inworldApiKey: '',
      inworldApiUrl: DEFAULT_INWORLD_TTS_ENDPOINT,
      inworldModel: DEFAULT_INWORLD_MODEL,
      inworldAudioEncoding: DEFAULT_INWORLD_AUDIO_ENCODING,
      inworldSampleRateHertz: DEFAULT_INWORLD_SAMPLE_RATE_HERTZ,
      inworldBitRate: '',
      inworldSpeakingRate: '',
      inworldLanguage: DEFAULT_INWORLD_LANGUAGE,
      inworldDeliveryMode: 'default',
      inworldTemperature: '',
      gradiumApiKey: '',
      gradiumApiUrl: DEFAULT_GRADIUM_TTS_ENDPOINT,
      gradiumOutputFormat: DEFAULT_GRADIUM_OUTPUT_FORMAT,
      gradiumTemperature: '',
      gradiumVoiceSimilarity: '',
      gradiumPaddingBonus: '',
      gradiumRewriteRules: '',
      piperPlusBasePath: DEFAULT_PIPER_PLUS_BASE_PATH,
      piperPlusModelConfigFile: DEFAULT_PIPER_PLUS_MODEL_CONFIG_FILE,
      piperPlusModelFile: DEFAULT_PIPER_PLUS_MODEL_FILE,
      piperPlusVoiceFile: DEFAULT_PIPER_PLUS_VOICE_FILE,
      piperPlusSpeed: '',
      piperPlusNoiseScale: '',
    },
    visual: {
      backgroundMode: 'default',
      layoutMode: 'chat',
      showInputInBroadcast: false,
      idleMotionEnabled: true,
      avatarViewX: 0,
      avatarViewY: 0,
      avatarViewScale: 1,
    },
    screenVision: {
      deviceId: '',
      prompt: LINGLAN_VISION_PROMPT,
      autoIntervalMs: 0,
      enabled: false,
    },
    stream: {
      platform: 'none',
      youtubeApiKey: '',
      youtubeLiveId: '',
      youtubeEnabled: false,
      youtubeCommentIntervalMs: 20_000,
      twitchClientId: '',
      twitchAccessToken: '',
      twitchChannel: '',
      twitchEnabled: false,
      twitchCommentIntervalMs: 20_000,
      bilibiliEnabled: false,
      bilibiliReplyEnabled: false,
      bilibiliGatewayUrl: '/api/bilibili',
      customSseEndpoint: '',
      customSseEnabled: false,
    },
    socialStream: {
      enabled: false,
      sessionId: '',
      serverUrl: 'wss://io.socialstream.ninja',
      platforms: [],
    },
    liveConnectors: {
      schemaVersion: 1,
      ordinaryRoad: {
        enabled: false,
        gatewayUrl: '/api/live-connectors/ordinaryroad',
        platforms: {
          bilibili: createPlatformConnection('', false),
          douyu: createPlatformConnection(),
          huya: createPlatformConnection(),
          douyin: createPlatformConnection(),
          kuaishou: createPlatformConnection(),
        },
      },
      socialStreamNinja: {
        enabled: false,
        sessionId: '',
        serverUrl: 'wss://io.socialstream.ninja',
        platforms: {},
      },
    },
    commentIntelligence: {
      enabled: true,
      mode: 'rules',
      useSameLLMSettings: true,
      streamTopic: '',
      streamTitle: '',
      topicFilter: 'prefer',
      maxCommentsPerBatch: 50,
      analysisIntervalMs: 1000,
      minCommentsForLLMAnalysis: 8,
      blockHighRiskViewers: true,
      viewerBlockDurationMs: 10 * 60 * 1000,
    },
    manneri: {
      enabled: true,
      similarityThreshold: 0.75,
      lookbackWindow: 10,
      interventionCooldownMs: 5 * 60 * 1000,
      minMessageLength: 10,
    },
    emptyRoomAwareness: {
      enabled: true,
      minIntervalMs: 2 * 60_000,
      maxIntervalMs: 10 * 60_000,
      interfaceWeight: 40,
      memoryWeight: 35,
      inspirationWeight: 25,
      audienceWeight: 30,
    },
  };
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>;
      const defaults = getDefaultSettings();
      const tts = { ...defaults.tts, ...saved.tts };
      if (
        tts.engine === 'minimax' &&
        (!tts.speaker ||
          PREVIOUS_LINGLAN_DEFAULT_SPEAKERS.has(tts.speaker) ||
          isIncompatibleMinimaxSpeaker(tts.speaker))
      ) {
        tts.speaker = LINGLAN_PROFILE.voice.defaultSpeaker;
      }
      const screenVision = {
        ...defaults.screenVision,
        ...saved.screenVision,
      };
      if (
        !screenVision.prompt ||
        screenVision.prompt === LEGACY_SCREEN_VISION_PROMPT
      ) {
        screenVision.prompt = LINGLAN_VISION_PROMPT;
      }
      const digitalHumans = {
        activeId:
          typeof saved.digitalHumans?.activeId === 'string'
            ? saved.digitalHumans.activeId
            : defaults.digitalHumans.activeId,
        profiles:
          Array.isArray(saved.digitalHumans?.profiles) &&
          saved.digitalHumans.profiles.length
            ? saved.digitalHumans.profiles
                .filter((profile): profile is DigitalHumanProfile =>
                  Boolean(
                    profile &&
                      typeof profile.id === 'string' &&
                      typeof profile.displayName === 'string',
                  ),
                )
                .map((profile) =>
                  migrateLinglanCompanionProfile(
                    {
                      ...defaults.digitalHumans.profiles[0],
                      ...profile,
                      enabled: profile.enabled !== false,
                      persona: {
                        ...defaults.digitalHumans.profiles[0].persona,
                        ...profile.persona,
                      },
                      memory: {
                        ...defaults.digitalHumans.profiles[0].memory,
                        ...profile.memory,
                      },
                    },
                    defaults.digitalHumans.profiles[0],
                  ),
                )
            : defaults.digitalHumans.profiles,
      };
      const activeProfile = digitalHumans.profiles.find(
        (profile) => profile.id === digitalHumans.activeId,
      );
      // A profile's selected voice is the source of truth. Old saved settings
      // could retain a previous global speaker and make the UI lie about the
      // voice that would actually be synthesized.
      if (activeProfile?.voiceSpeaker) {
        tts.speaker = activeProfile.voiceSpeaker;
      }
      const savedConnectors = saved.liveConnectors;
      const legacyBilibiliEnabled = Boolean(saved.stream?.bilibiliEnabled);
      const legacyBilibiliReplyEnabled = Boolean(
        saved.stream?.bilibiliReplyEnabled,
      );
      const normalizeConnectionMap = (
        current: Record<string, Partial<ReturnType<typeof createPlatformConnection>>> | undefined,
        fallback: Record<string, ReturnType<typeof createPlatformConnection>>,
      ) =>
        Object.fromEntries(
          Object.entries({ ...fallback, ...(current ?? {}) }).map(
            ([platformId, value]) => [
              platformId,
              createPlatformConnection(value.roomId, value.enabled, value.outbound),
            ],
          ),
        );
      const needsLegacyConnectorMigration = savedConnectors?.schemaVersion !== 1;
      const liveConnectors: LiveConnectorSettings = {
        schemaVersion: 1,
        ordinaryRoad: {
          ...defaults.liveConnectors.ordinaryRoad,
          ...savedConnectors?.ordinaryRoad,
          enabled:
            savedConnectors?.ordinaryRoad?.enabled ?? legacyBilibiliEnabled,
          gatewayUrl:
            savedConnectors?.ordinaryRoad?.gatewayUrl ||
            (saved.stream?.bilibiliGatewayUrl === '/api/bilibili'
              ? defaults.liveConnectors.ordinaryRoad.gatewayUrl
              : saved.stream?.bilibiliGatewayUrl) ||
            defaults.liveConnectors.ordinaryRoad.gatewayUrl,
          platforms: normalizeConnectionMap(
            savedConnectors?.ordinaryRoad?.platforms,
            {
              ...defaults.liveConnectors.ordinaryRoad.platforms,
              bilibili: createPlatformConnection('', legacyBilibiliEnabled, {
                viewerReplies: legacyBilibiliReplyEnabled,
                proactiveSpeech: legacyBilibiliReplyEnabled,
                operatorBroadcasts: legacyBilibiliReplyEnabled,
              }),
            },
          ),
        },
        socialStreamNinja: {
          ...defaults.liveConnectors.socialStreamNinja,
          ...savedConnectors?.socialStreamNinja,
          enabled:
            savedConnectors?.socialStreamNinja?.enabled ??
            Boolean(saved.socialStream?.enabled),
          sessionId:
            savedConnectors?.socialStreamNinja?.sessionId ||
            saved.socialStream?.sessionId ||
            '',
          serverUrl:
            savedConnectors?.socialStreamNinja?.serverUrl ||
            saved.socialStream?.serverUrl ||
            defaults.liveConnectors.socialStreamNinja.serverUrl,
          platforms: normalizeConnectionMap(
            savedConnectors?.socialStreamNinja?.platforms,
            Object.fromEntries(
              (saved.socialStream?.platforms ?? []).map((platformId) => [
                platformId,
                createPlatformConnection('', true),
              ]),
            ),
          ),
        },
      };
      if (needsLegacyConnectorMigration) {
        const bilibili = liveConnectors.ordinaryRoad.platforms.bilibili;
        bilibili.enabled = bilibili.enabled || legacyBilibiliEnabled;
        liveConnectors.ordinaryRoad.enabled =
          liveConnectors.ordinaryRoad.enabled || legacyBilibiliEnabled;
        if (legacyBilibiliReplyEnabled) {
          bilibili.outbound = {
            viewerReplies: true,
            proactiveSpeech: true,
            operatorBroadcasts: true,
          };
        }
      }
      return {
        digitalHumans,
        llm: {
          ...defaults.llm,
          ...saved.llm,
          apiKeys: { ...defaults.llm.apiKeys, ...saved.llm?.apiKeys },
          openRouterDynamicFreeModels: normalizeOpenRouterDynamicFreeModels(
            saved.llm?.openRouterDynamicFreeModels,
          ),
        },
        tts,
        visual: normalizeVisualSettings(saved.visual, defaults.visual),
        screenVision,
        stream: { ...defaults.stream, ...saved.stream },
        socialStream: {
          ...defaults.socialStream,
          ...saved.socialStream,
          platforms: Array.isArray(saved.socialStream?.platforms)
            ? saved.socialStream.platforms.filter(
                (platform): platform is string => typeof platform === 'string',
              )
            : defaults.socialStream.platforms,
        },
        liveConnectors,
        commentIntelligence: {
          ...defaults.commentIntelligence,
          ...saved.commentIntelligence,
        },
        manneri: { ...defaults.manneri, ...saved.manneri },
        emptyRoomAwareness: (() => {
          const merged = {
            ...defaults.emptyRoomAwareness,
            ...saved.emptyRoomAwareness,
          };
          const minIntervalMs = Math.max(
            2 * 60_000,
            normalizePositiveInteger(merged.minIntervalMs, 2 * 60_000),
          );
          return {
            ...merged,
            minIntervalMs,
            maxIntervalMs: Math.max(
              minIntervalMs,
              normalizePositiveInteger(merged.maxIntervalMs, 10 * 60_000),
            ),
            audienceWeight: clampNumber(merged.audienceWeight, 0, 100),
          };
        })(),
      };
    }
  } catch {
    // ignore parse errors
  }
  return getDefaultSettings();
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

type RuntimeSettingsRole = 'producer' | 'consumer' | 'standalone';

export function useSettings(runtimeRole: RuntimeSettingsRole = 'standalone') {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [openRouterRefreshError, setOpenRouterRefreshError] = useState('');
  const [
    isRefreshingOpenRouterFreeModels,
    setIsRefreshingOpenRouterFreeModels,
  ] = useState(false);
  const openRouterDynamicModels = useMemo(
    () => settings.llm.openRouterDynamicFreeModels?.models || EMPTY_MODEL_IDS,
    [settings.llm.openRouterDynamicFreeModels?.models],
  );

  const availableModels = useMemo(() => {
    const models = getOrderedModels(settings.llm.provider);
    if (settings.llm.provider === 'openrouter') {
      return mergeModelIds(models, openRouterDynamicModels);
    }
    if (settings.llm.provider !== 'openai-compatible') {
      return models;
    }
    if (settings.llm.model) {
      return [settings.llm.model];
    }
    return [DEFAULT_OPENAI_COMPATIBLE_MODEL];
  }, [settings.llm.provider, settings.llm.model, openRouterDynamicModels]);

  // Persist settings on change
  useEffect(() => {
    saveSettings(settings);
    if (runtimeRole === 'producer') {
      void fetch('/api/runtime-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }).catch(() => undefined);
    }
  }, [runtimeRole, settings]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch('/api/runtime-settings', {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const remote = (await response.json()) as AppSettings;
        if (cancelled) return;
        const local = loadSettings();
        const runtimeSettings: AppSettings = retainLocalTtsCredentials(
          remote,
          local,
        );
        const normalizedRuntimeSettings: AppSettings = {
          ...runtimeSettings,
          visual: {
            ...runtimeSettings.visual,
            avatarViewX: 0,
            avatarViewY: 0,
            avatarViewScale: 1,
          },
          stream: runtimeSettings.stream,
        };
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(normalizedRuntimeSettings),
        );
        setSettings(loadSettings());
      } catch {
        // Keep the last settings cached by the OBS browser source.
      }
    };
    void sync();
    const syncOnSettingsChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) void sync();
    };
    window.addEventListener('storage', syncOnSettingsChange);
    const timer = window.setInterval(sync, 10_000);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', syncOnSettingsChange);
      window.clearInterval(timer);
    };
  }, [runtimeRole]);

  const updateLLMProvider = useCallback(
    (provider: ChatProviderOption) => {
      const baseModels = getOrderedModels(provider);
      const models =
        provider === 'openrouter'
          ? mergeModelIds(baseModels, openRouterDynamicModels)
          : baseModels;
      const nextModel =
        provider === 'openai-compatible'
          ? DEFAULT_OPENAI_COMPATIBLE_MODEL
          : models[0] || '';
      setSettings((prev) => ({
        ...prev,
        llm: {
          ...prev.llm,
          provider,
          model: nextModel,
          xaiReasoningEffort:
            provider === 'xai'
              ? getDefaultXaiReasoningEffort(nextModel) || 'none'
              : prev.llm.xaiReasoningEffort,
          endpoint:
            provider === 'openai-compatible'
              ? prev.llm.endpoint || DEFAULT_OPENAI_COMPATIBLE_ENDPOINT
              : prev.llm.endpoint,
        },
      }));
    },
    [openRouterDynamicModels],
  );

  const updateLLMModel = useCallback((model: string) => {
    setSettings((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        model,
        xaiReasoningEffort:
          prev.llm.provider === 'xai'
            ? getDefaultXaiReasoningEffort(model) || 'none'
            : prev.llm.xaiReasoningEffort,
      },
    }));
  }, []);

  const updateXaiReasoningEffort = useCallback(
    (xaiReasoningEffort: XaiReasoningEffort) => {
      setSettings((prev) => ({
        ...prev,
        llm: { ...prev.llm, xaiReasoningEffort },
      }));
    },
    [],
  );

  const updateLLMApiKey = useCallback(
    (provider: ChatProviderOption, key: string) => {
      if (provider === 'gemini-nano') {
        return;
      }
      setSettings((prev) => ({
        ...prev,
        llm: {
          ...prev.llm,
          apiKeys: {
            ...prev.llm.apiKeys,
            [provider as ApiKeyProvider]: key,
          },
        },
      }));
    },
    [],
  );

  const updateLLMEndpoint = useCallback((endpoint: string) => {
    setSettings((prev) => ({
      ...prev,
      llm: { ...prev.llm, endpoint },
    }));
  }, []);

  const refreshOpenRouterDynamicFreeModels = useCallback(async () => {
    const apiKey = settings.llm.apiKeys.openrouter?.trim() || '';
    if (!apiKey) {
      const message = '需要填写 OpenRouter API 密钥。';
      setOpenRouterRefreshError(message);
      return null;
    }

    setIsRefreshingOpenRouterFreeModels(true);
    setOpenRouterRefreshError('');

    try {
      const maxCandidates = normalizePositiveInteger(
        settings.llm.openRouterDynamicFreeModels?.maxCandidates,
        DEFAULT_OPENROUTER_MAX_CANDIDATES,
      );
      const result: RefreshOpenRouterFreeModelsResult =
        await refreshOpenRouterFreeModels({
          apiKey,
          maxCandidates,
          maxWorking: DEFAULT_OPENROUTER_MAX_WORKING,
        });

      setSettings((prev) => ({
        ...prev,
        llm: {
          ...prev.llm,
          openRouterDynamicFreeModels: {
            ...normalizeOpenRouterDynamicFreeModels(
              prev.llm.openRouterDynamicFreeModels,
            ),
            models: normalizeModelIds(result.working),
            fetchedAt: result.fetchedAt,
          },
        },
      }));

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOpenRouterRefreshError(message);
      return null;
    } finally {
      setIsRefreshingOpenRouterFreeModels(false);
    }
  }, [
    settings.llm.apiKeys.openrouter,
    settings.llm.openRouterDynamicFreeModels?.maxCandidates,
  ]);

  const updateOpenRouterMaxCandidates = useCallback((maxCandidates: number) => {
    const normalized = normalizePositiveInteger(
      maxCandidates,
      DEFAULT_OPENROUTER_MAX_CANDIDATES,
    );
    setSettings((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        openRouterDynamicFreeModels: {
          ...normalizeOpenRouterDynamicFreeModels(
            prev.llm.openRouterDynamicFreeModels,
          ),
          maxCandidates: normalized,
        },
      },
    }));
  }, []);

  const updateTTSEngine = useCallback((engine: TTSEngineOption) => {
    const defaultSpeaker: Record<string, string> = {
      openai: 'alloy',
      geminiTts: 'Zephyr',
      openaiCompatible: '',
      voicepeak: 'f1',
      voicevox: '',
      aivisSpeech: '',
      aivisCloud: DEFAULT_AIVIS_CLOUD_MODEL_UUID,
      minimax: LINGLAN_PROFILE.voice.defaultSpeaker,
      xai: 'eve',
      unrealSpeech: 'af_bella',
      elevenLabs: '',
      inworld: '',
      gradium: 'YTpq7expH9539ERJ',
      piperPlus: 'default',
      none: '',
    };
    setSettings((prev) => ({
      ...prev,
      tts: {
        ...prev.tts,
        engine,
        speaker: defaultSpeaker[engine] ?? '',
        openAiCompatibleApiUrl:
          engine === 'openaiCompatible'
            ? prev.tts.openAiCompatibleApiUrl ||
              DEFAULT_OPENAI_COMPATIBLE_TTS_ENDPOINT
            : prev.tts.openAiCompatibleApiUrl,
        openAiCompatibleModel:
          engine === 'openaiCompatible'
            ? prev.tts.openAiCompatibleModel || DEFAULT_OPENAI_COMPATIBLE_MODEL
            : prev.tts.openAiCompatibleModel,
        openAiCompatibleSpeed:
          engine === 'openaiCompatible'
            ? prev.tts.openAiCompatibleSpeed || ''
            : prev.tts.openAiCompatibleSpeed,
        geminiTtsModel:
          engine === 'geminiTts'
            ? prev.tts.geminiTtsModel || DEFAULT_GEMINI_TTS_MODEL
            : prev.tts.geminiTtsModel,
        geminiTtsLanguageCode:
          engine === 'geminiTts'
            ? prev.tts.geminiTtsLanguageCode || DEFAULT_GEMINI_TTS_LANGUAGE_CODE
            : prev.tts.geminiTtsLanguageCode,
        geminiTtsPrompt:
          engine === 'geminiTts'
            ? prev.tts.geminiTtsPrompt || ''
            : prev.tts.geminiTtsPrompt,
        aivisCloudModelUuid:
          engine === 'aivisCloud'
            ? prev.tts.aivisCloudModelUuid || DEFAULT_AIVIS_CLOUD_MODEL_UUID
            : prev.tts.aivisCloudModelUuid,
        aivisCloudSpeakerUuid:
          engine === 'aivisCloud'
            ? prev.tts.aivisCloudSpeakerUuid || ''
            : prev.tts.aivisCloudSpeakerUuid,
        aivisCloudStyleId:
          engine === 'aivisCloud'
            ? prev.tts.aivisCloudStyleId || ''
            : prev.tts.aivisCloudStyleId,
        xaiLanguage:
          engine === 'xai'
            ? prev.tts.xaiLanguage || 'auto'
            : prev.tts.xaiLanguage,
        xaiCodec:
          engine === 'xai' ? prev.tts.xaiCodec || 'mp3' : prev.tts.xaiCodec,
        xaiSampleRate:
          engine === 'xai'
            ? prev.tts.xaiSampleRate || 24000
            : prev.tts.xaiSampleRate,
        xaiBitRate:
          engine === 'xai'
            ? prev.tts.xaiBitRate || 128000
            : prev.tts.xaiBitRate,
        unrealSpeechApiUrl:
          engine === 'unrealSpeech'
            ? prev.tts.unrealSpeechApiUrl || DEFAULT_UNREAL_SPEECH_TTS_ENDPOINT
            : prev.tts.unrealSpeechApiUrl,
        unrealSpeechBitrate:
          engine === 'unrealSpeech'
            ? prev.tts.unrealSpeechBitrate || '192k'
            : prev.tts.unrealSpeechBitrate,
        unrealSpeechCodec:
          engine === 'unrealSpeech'
            ? prev.tts.unrealSpeechCodec || 'libmp3lame'
            : prev.tts.unrealSpeechCodec,
        elevenLabsApiUrl:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsApiUrl || DEFAULT_ELEVENLABS_TTS_ENDPOINT
            : prev.tts.elevenLabsApiUrl,
        elevenLabsModel:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsModel || DEFAULT_ELEVENLABS_MODEL
            : prev.tts.elevenLabsModel,
        elevenLabsOutputFormat:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsOutputFormat ||
              DEFAULT_ELEVENLABS_OUTPUT_FORMAT
            : prev.tts.elevenLabsOutputFormat,
        elevenLabsUseSpeakerBoost:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsUseSpeakerBoost || 'default'
            : prev.tts.elevenLabsUseSpeakerBoost,
        elevenLabsApplyTextNormalization:
          engine === 'elevenLabs'
            ? prev.tts.elevenLabsApplyTextNormalization || 'default'
            : prev.tts.elevenLabsApplyTextNormalization,
        inworldApiUrl:
          engine === 'inworld'
            ? prev.tts.inworldApiUrl || DEFAULT_INWORLD_TTS_ENDPOINT
            : prev.tts.inworldApiUrl,
        inworldModel:
          engine === 'inworld'
            ? prev.tts.inworldModel || DEFAULT_INWORLD_MODEL
            : prev.tts.inworldModel,
        inworldAudioEncoding:
          engine === 'inworld'
            ? prev.tts.inworldAudioEncoding || DEFAULT_INWORLD_AUDIO_ENCODING
            : prev.tts.inworldAudioEncoding,
        inworldSampleRateHertz:
          engine === 'inworld'
            ? prev.tts.inworldSampleRateHertz ||
              DEFAULT_INWORLD_SAMPLE_RATE_HERTZ
            : prev.tts.inworldSampleRateHertz,
        inworldLanguage:
          engine === 'inworld'
            ? prev.tts.inworldLanguage || DEFAULT_INWORLD_LANGUAGE
            : prev.tts.inworldLanguage,
        inworldDeliveryMode:
          engine === 'inworld'
            ? prev.tts.inworldDeliveryMode || 'default'
            : prev.tts.inworldDeliveryMode,
        gradiumApiUrl:
          engine === 'gradium'
            ? prev.tts.gradiumApiUrl || DEFAULT_GRADIUM_TTS_ENDPOINT
            : prev.tts.gradiumApiUrl,
        gradiumOutputFormat:
          engine === 'gradium'
            ? prev.tts.gradiumOutputFormat || DEFAULT_GRADIUM_OUTPUT_FORMAT
            : prev.tts.gradiumOutputFormat,
        gradiumTemperature:
          engine === 'gradium'
            ? prev.tts.gradiumTemperature || ''
            : prev.tts.gradiumTemperature,
        gradiumVoiceSimilarity:
          engine === 'gradium'
            ? prev.tts.gradiumVoiceSimilarity || ''
            : prev.tts.gradiumVoiceSimilarity,
        gradiumPaddingBonus:
          engine === 'gradium'
            ? prev.tts.gradiumPaddingBonus || ''
            : prev.tts.gradiumPaddingBonus,
        gradiumRewriteRules:
          engine === 'gradium'
            ? prev.tts.gradiumRewriteRules || ''
            : prev.tts.gradiumRewriteRules,
        piperPlusBasePath:
          engine === 'piperPlus'
            ? prev.tts.piperPlusBasePath || DEFAULT_PIPER_PLUS_BASE_PATH
            : prev.tts.piperPlusBasePath,
        piperPlusModelConfigFile:
          engine === 'piperPlus'
            ? prev.tts.piperPlusModelConfigFile ||
              DEFAULT_PIPER_PLUS_MODEL_CONFIG_FILE
            : prev.tts.piperPlusModelConfigFile,
        piperPlusModelFile:
          engine === 'piperPlus'
            ? prev.tts.piperPlusModelFile || DEFAULT_PIPER_PLUS_MODEL_FILE
            : prev.tts.piperPlusModelFile,
        piperPlusVoiceFile:
          engine === 'piperPlus'
            ? prev.tts.piperPlusVoiceFile || DEFAULT_PIPER_PLUS_VOICE_FILE
            : prev.tts.piperPlusVoiceFile,
        piperPlusSpeed:
          engine === 'piperPlus'
            ? prev.tts.piperPlusSpeed || ''
            : prev.tts.piperPlusSpeed,
        piperPlusNoiseScale:
          engine === 'piperPlus'
            ? prev.tts.piperPlusNoiseScale || ''
            : prev.tts.piperPlusNoiseScale,
      },
    }));
  }, []);

  const updateTTSSpeaker = useCallback((speaker: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, speaker },
    }));
  }, []);

  const updateOpenAiCompatibleApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleApiKey: key },
    }));
  }, []);

  const updateOpenAiCompatibleApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleApiUrl: url },
    }));
  }, []);

  const updateOpenAiCompatibleModel = useCallback((model: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleModel: model },
    }));
  }, []);

  const updateOpenAiCompatibleSpeed = useCallback((speed: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, openAiCompatibleSpeed: speed },
    }));
  }, []);

  const updateGeminiTtsModel = useCallback((model: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, geminiTtsModel: model },
    }));
  }, []);

  const updateGeminiTtsLanguageCode = useCallback((languageCode: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, geminiTtsLanguageCode: languageCode },
    }));
  }, []);

  const updateGeminiTtsPrompt = useCallback((prompt: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, geminiTtsPrompt: prompt },
    }));
  }, []);

  const updateVoicevoxApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, voicevoxApiUrl: url },
    }));
  }, []);

  const updateVoicepeakApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, voicepeakApiUrl: url },
    }));
  }, []);

  const updateAivisSpeechApiUrl = useCallback((url: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisSpeechApiUrl: url },
    }));
  }, []);

  const updateAivisCloudApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudApiKey: key },
    }));
  }, []);

  const updateAivisCloudModelUuid = useCallback((modelUuid: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudModelUuid: modelUuid },
    }));
  }, []);

  const updateAivisCloudSpeakerUuid = useCallback((speakerUuid: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudSpeakerUuid: speakerUuid },
    }));
  }, []);

  const updateAivisCloudStyleId = useCallback((styleId: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, aivisCloudStyleId: styleId },
    }));
  }, []);

  const updateMinimaxApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, minimaxApiKey: key },
    }));
  }, []);

  const updateMinimaxGroupId = useCallback((groupId: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, minimaxGroupId: groupId },
    }));
  }, []);

  const updateXaiLanguage = useCallback((language: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiLanguage: language },
    }));
  }, []);

  const updateXaiCodec = useCallback((codec: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiCodec: codec },
    }));
  }, []);

  const updateXaiSampleRate = useCallback((sampleRate: number) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiSampleRate: sampleRate },
    }));
  }, []);

  const updateXaiBitRate = useCallback((bitRate: number) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, xaiBitRate: bitRate },
    }));
  }, []);

  const updateTtsField = useCallback(
    <TKey extends keyof AppSettings['tts']>(
      key: TKey,
      value: AppSettings['tts'][TKey],
    ) => {
      setSettings((prev) => ({
        ...prev,
        tts: { ...prev.tts, [key]: value },
      }));
    },
    [],
  );

  const updatePiperPlusBasePath = useCallback((basePath: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusBasePath: basePath },
    }));
  }, []);

  const updatePiperPlusModelConfigFile = useCallback(
    (modelConfigFile: string) => {
      setSettings((prev) => ({
        ...prev,
        tts: { ...prev.tts, piperPlusModelConfigFile: modelConfigFile },
      }));
    },
    [],
  );

  const updatePiperPlusModelFile = useCallback((modelFile: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusModelFile: modelFile },
    }));
  }, []);

  const updatePiperPlusVoiceFile = useCallback((voiceFile: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusVoiceFile: voiceFile },
    }));
  }, []);

  const updatePiperPlusSpeed = useCallback((speed: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusSpeed: speed },
    }));
  }, []);

  const updatePiperPlusNoiseScale = useCallback((noiseScale: string) => {
    setSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, piperPlusNoiseScale: noiseScale },
    }));
  }, []);

  const updateVisualBackgroundMode = useCallback(
    (backgroundMode: AppSettings['visual']['backgroundMode']) => {
      setSettings((prev) => ({
        ...prev,
        visual: { ...prev.visual, backgroundMode },
      }));
    },
    [],
  );

  const updateVisualLayoutMode = useCallback(
    (layoutMode: AppSettings['visual']['layoutMode']) => {
      setSettings((prev) => ({
        ...prev,
        visual: { ...prev.visual, layoutMode },
      }));
    },
    [],
  );

  const updateVisualShowInputInBroadcast = useCallback(
    (showInputInBroadcast: boolean) => {
      setSettings((prev) => ({
        ...prev,
        visual: { ...prev.visual, showInputInBroadcast },
      }));
    },
    [],
  );

  const updateVisualIdleMotionEnabled = useCallback(
    (idleMotionEnabled: boolean) => {
      setSettings((prev) => ({
        ...prev,
        visual: { ...prev.visual, idleMotionEnabled },
      }));
    },
    [],
  );

  const updateVisualAvatarView = useCallback(
    (avatarView: AvatarViewTransform) => {
      const normalized = normalizeAvatarViewTransform(avatarView);
      setSettings((prev) => ({
        ...prev,
        visual: {
          ...prev.visual,
          avatarViewX: normalized.x,
          avatarViewY: normalized.y,
          avatarViewScale: normalized.scale,
        },
      }));
    },
    [],
  );

  const resetVisualAvatarView = useCallback(() => {
    updateVisualAvatarView({ x: 0, y: 0, scale: 1 });
  }, [updateVisualAvatarView]);

  const updateScreenVisionDeviceId = useCallback((deviceId: string) => {
    setSettings((prev) => ({
      ...prev,
      screenVision: { ...prev.screenVision, deviceId },
    }));
  }, []);

  const updateScreenVisionPrompt = useCallback((prompt: string) => {
    setSettings((prev) => ({
      ...prev,
      screenVision: { ...prev.screenVision, prompt },
    }));
  }, []);

  const updateScreenVisionAutoIntervalMs = useCallback(
    (autoIntervalMs: number) => {
      setSettings((prev) => ({
        ...prev,
        screenVision: { ...prev.screenVision, autoIntervalMs },
      }));
    },
    [],
  );

  const updateScreenVisionEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      screenVision: { ...prev.screenVision, enabled },
    }));
  }, []);

  const updateStreamPlatform = useCallback(
    (platform: StreamingPlatformOption) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, platform },
      }));
    },
    [],
  );

  const updateYoutubeApiKey = useCallback((youtubeApiKey: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, youtubeApiKey },
    }));
  }, []);

  const updateYoutubeLiveId = useCallback((youtubeLiveId: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, youtubeLiveId },
    }));
  }, []);

  const updateYoutubeEnabled = useCallback((youtubeEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, youtubeEnabled },
    }));
  }, []);

  const updateYoutubeCommentIntervalMs = useCallback(
    (youtubeCommentIntervalMs: number) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, youtubeCommentIntervalMs },
      }));
    },
    [],
  );

  const updateTwitchClientId = useCallback((twitchClientId: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchClientId },
    }));
  }, []);

  const updateTwitchAccessToken = useCallback((twitchAccessToken: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchAccessToken },
    }));
  }, []);

  const updateTwitchChannel = useCallback((twitchChannel: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchChannel },
    }));
  }, []);

  const updateTwitchEnabled = useCallback((twitchEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, twitchEnabled },
    }));
  }, []);

  const updateTwitchCommentIntervalMs = useCallback(
    (twitchCommentIntervalMs: number) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, twitchCommentIntervalMs },
      }));
    },
    [],
  );

  const updateBilibiliEnabled = useCallback((bilibiliEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: {
        ...prev.stream,
        bilibiliEnabled,
        bilibiliReplyEnabled: bilibiliEnabled
          ? prev.stream.bilibiliReplyEnabled
          : false,
      },
    }));
  }, []);

  const updateBilibiliReplyEnabled = useCallback(
    (bilibiliReplyEnabled: boolean) => {
      setSettings((prev) => ({
        ...prev,
        stream: { ...prev.stream, bilibiliReplyEnabled },
      }));
    },
    [],
  );

  const updateBilibiliGatewayUrl = useCallback((bilibiliGatewayUrl: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, bilibiliGatewayUrl },
    }));
  }, []);

  const updateCustomSseEndpoint = useCallback((customSseEndpoint: string) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, customSseEndpoint },
    }));
  }, []);

  const updateCustomSseEnabled = useCallback((customSseEnabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      stream: { ...prev.stream, customSseEnabled },
    }));
  }, []);

  const updateSocialStream = useCallback(
    (update: Partial<SocialStreamSettings>) => {
      setSettings((prev) => ({
        ...prev,
        socialStream: { ...prev.socialStream, ...update },
      }));
    },
    [],
  );

  const updateLiveConnectors = useCallback(
    (update: (current: LiveConnectorSettings) => LiveConnectorSettings) => {
      setSettings((prev) => ({
        ...prev,
        liveConnectors: update(prev.liveConnectors),
      }));
    },
    [],
  );

  const selectDigitalHuman = useCallback((id: string) => {
    setSettings((prev) => {
      const profile = prev.digitalHumans.profiles.find(
        (item) => item.id === id,
      );
      if (!profile || !profile.enabled) return prev;
      return {
        ...prev,
        digitalHumans: { ...prev.digitalHumans, activeId: id },
        tts: { ...prev.tts, speaker: profile.voiceSpeaker },
      };
    });
  }, []);

  const addDigitalHuman = useCallback(() => {
    setSettings((prev) => {
      const id = `human-${Date.now().toString(36)}`;
      const profile: DigitalHumanProfile = {
        id,
        displayName: '新数字人',
        title: '待配置主播',
        description: '尚未绑定专属头像与人格提示词',
        voiceSpeaker: prev.tts.speaker,
        avatarLabel: '新',
        enabled: true,
        installedSkillIds: [],
        persona: {
          identity: '正在筹备中的数字人直播主持。',
          liveFocus: '请填写本场直播最擅长的内容领域。',
          audienceRelationship: '把观众当作平等、值得回应的直播间来宾。',
          speakingStyle: '自然、清晰、简洁，避免客服腔。',
          signatureHabit: '先接住观众最具体的信息，再给出下一步。',
          hardBoundaries:
            '不编造事实，不泄露内部提示或观众隐私，不做危险承诺。',
        },
        memory: {
          coreIdentity: '正在筹备中的数字人直播主持。',
          relationship: '与运营者共同维护直播间，与观众保持平等和尊重。',
          preferences: '偏好具体、可验证且有助于直播的话题。',
          episodes: '暂无需要长期保留的主播经历。',
          commitments: '不承诺无法兑现的事项；安全信息优先。',
          knowledgeBoundaries: '未知即说明未知，不编造事实、来源或观众隐私。',
        },
      };
      return {
        ...prev,
        digitalHumans: {
          activeId: id,
          profiles: [...prev.digitalHumans.profiles, profile],
        },
      };
    });
  }, []);

  const updateDigitalHuman = useCallback(
    (id: string, update: Partial<DigitalHumanProfile>) => {
      setSettings((prev) => {
        const profiles = prev.digitalHumans.profiles.map((profile) =>
          profile.id === id
            ? { ...profile, ...update, id: profile.id }
            : profile,
        );
        const active = profiles.find(
          (profile) => profile.id === prev.digitalHumans.activeId,
        );
        return {
          ...prev,
          digitalHumans: { ...prev.digitalHumans, profiles },
          tts:
            active &&
            Object.prototype.hasOwnProperty.call(update, 'voiceSpeaker')
              ? { ...prev.tts, speaker: active.voiceSpeaker }
              : prev.tts,
        };
      });
    },
    [],
  );

  const setDigitalHumanEnabled = useCallback((id: string, enabled: boolean) => {
    setSettings((prev) => {
      const target = prev.digitalHumans.profiles.find(
        (profile) => profile.id === id,
      );
      if (!target || target.enabled === enabled) return prev;
      const nextProfiles = prev.digitalHumans.profiles.map((profile) =>
        profile.id === id ? { ...profile, enabled } : profile,
      );
      const fallback = nextProfiles.find((profile) => profile.enabled);
      if (!fallback) return prev;
      const activeId =
        prev.digitalHumans.activeId === id && !enabled
          ? fallback.id
          : prev.digitalHumans.activeId;
      const active =
        nextProfiles.find((profile) => profile.id === activeId) || fallback;
      return {
        ...prev,
        digitalHumans: { activeId: active.id, profiles: nextProfiles },
        tts:
          active.id !== prev.digitalHumans.activeId
            ? { ...prev.tts, speaker: active.voiceSpeaker }
            : prev.tts,
      };
    });
  }, []);

  const removeDigitalHuman = useCallback((id: string) => {
    setSettings((prev) => {
      const target = prev.digitalHumans.profiles.find(
        (profile) => profile.id === id,
      );
      if (
        !target ||
        id === LINGLAN_PROFILE.id ||
        prev.digitalHumans.profiles.length <= 1
      )
        return prev;
      const profiles = prev.digitalHumans.profiles.filter(
        (profile) => profile.id !== id,
      );
      const active =
        prev.digitalHumans.activeId === id
          ? profiles.find((profile) => profile.enabled) || profiles[0]
          : profiles.find(
              (profile) => profile.id === prev.digitalHumans.activeId,
            ) || profiles[0];
      return {
        ...prev,
        digitalHumans: { activeId: active.id, profiles },
        tts:
          active.id !== prev.digitalHumans.activeId
            ? { ...prev.tts, speaker: active.voiceSpeaker }
            : prev.tts,
      };
    });
  }, []);

  const updateCommentIntelligenceEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      commentIntelligence: { ...prev.commentIntelligence, enabled },
    }));
  }, []);

  const updateCommentIntelligenceMode = useCallback(
    (mode: AppSettings['commentIntelligence']['mode']) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: { ...prev.commentIntelligence, mode },
      }));
    },
    [],
  );

  const updateCommentIntelligenceStreamTopic = useCallback(
    (streamTopic: string) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: { ...prev.commentIntelligence, streamTopic },
      }));
    },
    [],
  );

  const updateCommentIntelligenceStreamTitle = useCallback(
    (streamTitle: string) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: { ...prev.commentIntelligence, streamTitle },
      }));
    },
    [],
  );

  const updateCommentIntelligenceTopicFilter = useCallback(
    (topicFilter: AppSettings['commentIntelligence']['topicFilter']) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: { ...prev.commentIntelligence, topicFilter },
      }));
    },
    [],
  );

  const updateCommentIntelligenceAnalysisIntervalMs = useCallback(
    (analysisIntervalMs: number) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: {
          ...prev.commentIntelligence,
          analysisIntervalMs: normalizePositiveInteger(
            analysisIntervalMs,
            getDefaultSettings().commentIntelligence.analysisIntervalMs,
          ),
        },
      }));
    },
    [],
  );

  const updateCommentIntelligenceMaxCommentsPerBatch = useCallback(
    (maxCommentsPerBatch: number) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: {
          ...prev.commentIntelligence,
          maxCommentsPerBatch: normalizePositiveInteger(
            maxCommentsPerBatch,
            getDefaultSettings().commentIntelligence.maxCommentsPerBatch,
          ),
        },
      }));
    },
    [],
  );

  const updateCommentIntelligenceMinCommentsForLLMAnalysis = useCallback(
    (minCommentsForLLMAnalysis: number) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: {
          ...prev.commentIntelligence,
          minCommentsForLLMAnalysis: normalizePositiveInteger(
            minCommentsForLLMAnalysis,
            getDefaultSettings().commentIntelligence.minCommentsForLLMAnalysis,
          ),
        },
      }));
    },
    [],
  );

  const updateCommentIntelligenceBlockHighRiskViewers = useCallback(
    (blockHighRiskViewers: boolean) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: {
          ...prev.commentIntelligence,
          blockHighRiskViewers,
        },
      }));
    },
    [],
  );

  const updateCommentIntelligenceViewerBlockDurationMs = useCallback(
    (viewerBlockDurationMs: number) => {
      setSettings((prev) => ({
        ...prev,
        commentIntelligence: {
          ...prev.commentIntelligence,
          viewerBlockDurationMs: normalizePositiveInteger(
            viewerBlockDurationMs,
            getDefaultSettings().commentIntelligence.viewerBlockDurationMs,
          ),
        },
      }));
    },
    [],
  );

  const updateManneriEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      manneri: { ...prev.manneri, enabled },
    }));
  }, []);

  const updateManneriSimilarityThreshold = useCallback(
    (similarityThreshold: number) => {
      setSettings((prev) => ({
        ...prev,
        manneri: {
          ...prev.manneri,
          similarityThreshold: Math.min(1, Math.max(0.1, similarityThreshold)),
        },
      }));
    },
    [],
  );

  const updateManneriLookbackWindow = useCallback((lookbackWindow: number) => {
    setSettings((prev) => ({
      ...prev,
      manneri: {
        ...prev.manneri,
        lookbackWindow: normalizePositiveInteger(
          lookbackWindow,
          getDefaultSettings().manneri.lookbackWindow,
        ),
      },
    }));
  }, []);

  const updateManneriInterventionCooldownMs = useCallback(
    (interventionCooldownMs: number) => {
      setSettings((prev) => ({
        ...prev,
        manneri: {
          ...prev.manneri,
          interventionCooldownMs: normalizePositiveInteger(
            interventionCooldownMs,
            getDefaultSettings().manneri.interventionCooldownMs,
          ),
        },
      }));
    },
    [],
  );

  const updateManneriMinMessageLength = useCallback(
    (minMessageLength: number) => {
      setSettings((prev) => ({
        ...prev,
        manneri: {
          ...prev.manneri,
          minMessageLength: normalizePositiveInteger(
            minMessageLength,
            getDefaultSettings().manneri.minMessageLength,
          ),
        },
      }));
    },
    [],
  );

  const updateEmptyRoomAwareness = useCallback(
    (update: Partial<AppSettings['emptyRoomAwareness']>) => {
      setSettings((prev) => {
        const merged = { ...prev.emptyRoomAwareness, ...update };
        const minIntervalMs = clampNumber(
          normalizePositiveInteger(merged.minIntervalMs, 2 * 60_000),
          2 * 60_000,
          60 * 60_000,
        );
        const maxIntervalMs = Math.max(
          minIntervalMs,
          clampNumber(
            normalizePositiveInteger(merged.maxIntervalMs, 10 * 60_000),
            60_000,
            60 * 60_000,
          ),
        );
        return {
          ...prev,
          emptyRoomAwareness: {
            ...merged,
            minIntervalMs,
            maxIntervalMs,
            interfaceWeight: clampNumber(merged.interfaceWeight, 0, 100),
            memoryWeight: clampNumber(merged.memoryWeight, 0, 100),
            inspirationWeight: clampNumber(merged.inspirationWeight, 0, 100),
            audienceWeight: clampNumber(merged.audienceWeight, 0, 100),
          },
        };
      });
    },
    [],
  );

  const getApiKeyForProvider = useCallback(
    (provider: ChatProviderOption): string => {
      if (provider === 'gemini-nano') {
        return '';
      }
      return settings.llm.apiKeys[provider as ApiKeyProvider] || '';
    },
    [settings.llm.apiKeys],
  );

  return {
    settings,
    availableModels,
    updateLLMProvider,
    updateLLMModel,
    updateLLMApiKey,
    updateLLMEndpoint,
    updateXaiReasoningEffort,
    refreshOpenRouterDynamicFreeModels,
    isRefreshingOpenRouterFreeModels,
    openRouterRefreshError,
    updateOpenRouterMaxCandidates,
    updateTTSEngine,
    updateTTSSpeaker,
    updateOpenAiCompatibleApiKey,
    updateOpenAiCompatibleApiUrl,
    updateOpenAiCompatibleModel,
    updateOpenAiCompatibleSpeed,
    updateGeminiTtsModel,
    updateGeminiTtsLanguageCode,
    updateGeminiTtsPrompt,
    updateVoicevoxApiUrl,
    updateVoicepeakApiUrl,
    updateAivisSpeechApiUrl,
    updateAivisCloudApiKey,
    updateAivisCloudModelUuid,
    updateAivisCloudSpeakerUuid,
    updateAivisCloudStyleId,
    updateMinimaxApiKey,
    updateMinimaxGroupId,
    updateXaiLanguage,
    updateXaiCodec,
    updateXaiSampleRate,
    updateXaiBitRate,
    updateTtsField,
    updatePiperPlusBasePath,
    updatePiperPlusModelConfigFile,
    updatePiperPlusModelFile,
    updatePiperPlusVoiceFile,
    updatePiperPlusSpeed,
    updatePiperPlusNoiseScale,
    updateVisualBackgroundMode,
    updateVisualLayoutMode,
    updateVisualShowInputInBroadcast,
    updateVisualIdleMotionEnabled,
    updateVisualAvatarView,
    resetVisualAvatarView,
    updateScreenVisionDeviceId,
    updateScreenVisionPrompt,
    updateScreenVisionAutoIntervalMs,
    updateScreenVisionEnabled,
    updateStreamPlatform,
    updateYoutubeApiKey,
    updateYoutubeLiveId,
    updateYoutubeEnabled,
    updateYoutubeCommentIntervalMs,
    updateTwitchClientId,
    updateTwitchAccessToken,
    updateTwitchChannel,
    updateTwitchEnabled,
    updateTwitchCommentIntervalMs,
    updateBilibiliEnabled,
    updateBilibiliReplyEnabled,
    updateBilibiliGatewayUrl,
    updateCustomSseEndpoint,
    updateCustomSseEnabled,
    updateSocialStream,
    updateLiveConnectors,
    selectDigitalHuman,
    addDigitalHuman,
    updateDigitalHuman,
    setDigitalHumanEnabled,
    removeDigitalHuman,
    updateCommentIntelligenceEnabled,
    updateCommentIntelligenceMode,
    updateCommentIntelligenceStreamTopic,
    updateCommentIntelligenceStreamTitle,
    updateCommentIntelligenceTopicFilter,
    updateCommentIntelligenceAnalysisIntervalMs,
    updateCommentIntelligenceMaxCommentsPerBatch,
    updateCommentIntelligenceMinCommentsForLLMAnalysis,
    updateCommentIntelligenceBlockHighRiskViewers,
    updateCommentIntelligenceViewerBlockDurationMs,
    updateManneriEnabled,
    updateManneriSimilarityThreshold,
    updateManneriLookbackWindow,
    updateManneriInterventionCooldownMs,
    updateManneriMinMessageLength,
    updateEmptyRoomAwareness,
    getApiKeyForProvider,
  };
}
