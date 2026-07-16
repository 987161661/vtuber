import type { XaiReasoningEffort } from '@aituber-onair/core';

export type ChatProviderOption =
  | 'openai'
  | 'openai-compatible'
  | 'openrouter'
  | 'gemini'
  | 'gemini-nano'
  | 'claude'
  | 'zai'
  | 'kimi'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'sakana'
  | 'plamo';
export type TTSEngineOption =
  | 'openai'
  | 'geminiTts'
  | 'openaiCompatible'
  | 'voicevox'
  | 'voicepeak'
  | 'aivisSpeech'
  | 'aivisCloud'
  | 'minimax'
  | 'xai'
  | 'unrealSpeech'
  | 'elevenLabs'
  | 'inworld'
  | 'gradium'
  | 'piperPlus'
  | 'none';
export type StreamingPlatformOption =
  | 'none'
  | 'youtube'
  | 'twitch'
  | 'bilibili'
  | 'custom-sse';

export interface ProviderApiKeys {
  openai?: string;
  'openai-compatible'?: string;
  openrouter?: string;
  gemini?: string;
  claude?: string;
  zai?: string;
  kimi?: string;
  xai?: string;
  deepseek?: string;
  mistral?: string;
  sakana?: string;
  plamo?: string;
}

export interface LLMSettings {
  provider: ChatProviderOption;
  model: string;
  endpoint?: string;
  xaiReasoningEffort?: XaiReasoningEffort;
  apiKeys: ProviderApiKeys;
  openRouterDynamicFreeModels?: {
    models: string[];
    fetchedAt: number;
    maxCandidates: number;
  };
}

export interface TTSSettings {
  engine: TTSEngineOption;
  speaker: string;
  openAiCompatibleApiKey?: string;
  openAiCompatibleApiUrl?: string;
  openAiCompatibleModel?: string;
  openAiCompatibleSpeed?: string;
  geminiTtsModel?: string;
  geminiTtsLanguageCode?: string;
  geminiTtsPrompt?: string;
  voicevoxApiUrl?: string;
  voicepeakApiUrl?: string;
  aivisSpeechApiUrl?: string;
  aivisCloudApiKey?: string;
  aivisCloudModelUuid?: string;
  aivisCloudSpeakerUuid?: string;
  aivisCloudStyleId?: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  xaiLanguage?: string;
  xaiCodec?: string;
  xaiSampleRate?: number;
  xaiBitRate?: number;
  unrealSpeechApiKey?: string;
  unrealSpeechApiUrl?: string;
  unrealSpeechBitrate?: string;
  unrealSpeechSpeed?: string;
  unrealSpeechPitch?: string;
  unrealSpeechCodec?: string;
  unrealSpeechTemperature?: string;
  elevenLabsApiKey?: string;
  elevenLabsApiUrl?: string;
  elevenLabsModel?: string;
  elevenLabsOutputFormat?: string;
  elevenLabsLanguageCode?: string;
  elevenLabsStability?: string;
  elevenLabsSimilarityBoost?: string;
  elevenLabsStyle?: string;
  elevenLabsUseSpeakerBoost?: 'default' | 'true' | 'false';
  elevenLabsSpeed?: string;
  elevenLabsSeed?: string;
  elevenLabsApplyTextNormalization?: 'default' | 'auto' | 'on' | 'off';
  inworldApiKey?: string;
  inworldApiUrl?: string;
  inworldModel?: string;
  inworldAudioEncoding?: string;
  inworldSampleRateHertz?: string;
  inworldBitRate?: string;
  inworldSpeakingRate?: string;
  inworldLanguage?: string;
  inworldDeliveryMode?: 'default' | 'STABLE' | 'BALANCED' | 'CREATIVE';
  inworldTemperature?: string;
  gradiumApiKey?: string;
  gradiumApiUrl?: string;
  gradiumOutputFormat?: string;
  gradiumTemperature?: string;
  gradiumVoiceSimilarity?: string;
  gradiumPaddingBonus?: string;
  gradiumRewriteRules?: string;
  piperPlusBasePath?: string;
  piperPlusModelConfigFile?: string;
  piperPlusModelFile?: string;
  piperPlusVoiceFile?: string;
  piperPlusSpeed?: string;
  piperPlusNoiseScale?: string;
}

export interface StreamSettings {
  platform: StreamingPlatformOption;
  youtubeApiKey: string;
  youtubeLiveId: string;
  youtubeEnabled: boolean;
  youtubeCommentIntervalMs: number;
  twitchClientId: string;
  twitchAccessToken: string;
  twitchChannel: string;
  twitchEnabled: boolean;
  twitchCommentIntervalMs: number;
  bilibiliEnabled: boolean;
  bilibiliReplyEnabled: boolean;
  bilibiliGatewayUrl: string;
  customSseEndpoint: string;
  customSseEnabled: boolean;
}

export interface SocialStreamSettings {
  enabled: boolean;
  sessionId: string;
  serverUrl: string;
  /** Platforms handled by SSN must not also run through a native adapter. */
  platforms: string[];
}

export type LiveConnectorId = 'ordinaryroad' | 'social-stream-ninja';
export type LivePlatformId =
  | 'bilibili'
  | 'douyu'
  | 'huya'
  | 'douyin'
  | 'kuaishou'
  | string;

export interface PlatformOutboundPolicy {
  viewerReplies: boolean;
  proactiveSpeech: boolean;
  operatorBroadcasts: boolean;
}

export interface PlatformConnectionSettings {
  enabled: boolean;
  roomId: string;
  outbound: PlatformOutboundPolicy;
}

export interface OrdinaryRoadConnectorSettings {
  enabled: boolean;
  gatewayUrl: string;
  platforms: Record<string, PlatformConnectionSettings>;
}

export interface SocialStreamNinjaConnectorSettings {
  enabled: boolean;
  sessionId: string;
  serverUrl: string;
  platforms: Record<string, PlatformConnectionSettings>;
}

export interface LiveConnectorSettings {
  schemaVersion: 1;
  ordinaryRoad: OrdinaryRoadConnectorSettings;
  socialStreamNinja: SocialStreamNinjaConnectorSettings;
}

export interface CommentIntelligenceSettings {
  enabled: boolean;
  mode: 'rules' | 'hybrid' | 'llm-assisted';
  useSameLLMSettings: boolean;
  streamTopic: string;
  streamTitle: string;
  topicFilter: 'off' | 'prefer' | 'require';
  maxCommentsPerBatch: number;
  analysisIntervalMs: number;
  minCommentsForLLMAnalysis: number;
  blockHighRiskViewers: boolean;
  viewerBlockDurationMs: number;
}

export interface ManneriSettings {
  enabled: boolean;
  similarityThreshold: number;
  lookbackWindow: number;
  interventionCooldownMs: number;
  minMessageLength: number;
}

/** A selectable, user-authored module inserted into the quiet-room prompt. */
export interface EmptyRoomBehaviorStrategy {
  id: string;
  name: string;
  prompt: string;
  /** Relative chance among enabled strategies. Zero keeps the draft without scheduling it. */
  probability: number;
  enabled: boolean;
}

export interface EmptyRoomAwarenessSettings {
  enabled: boolean;
  /** Which audience state permits a proactive turn. */
  audiencePolicy: 'any' | 'empty_only' | 'audience_only';
  /** Optional local-time window; equal start/end means the whole day. */
  scheduleEnabled: boolean;
  scheduleStartHour: number;
  scheduleEndHour: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  proactiveCooldownMs: number;
  maxProactiveTurns: number;
  maxSentences: 1 | 2 | 3;
  behaviorStrategies: EmptyRoomBehaviorStrategy[];
  /** @deprecated Replaced by behaviorStrategies; retained to migrate existing settings. */
  interfaceWeight: number;
  memoryWeight: number;
  inspirationWeight: number;
  audienceWeight: number;
}

export interface VisualSettings {
  backgroundMode: 'default' | 'green';
  layoutMode: 'chat' | 'broadcast';
  showInputInBroadcast: boolean;
  idleMotionEnabled: boolean;
  avatarViewX: number;
  avatarViewY: number;
  avatarViewScale: number;
}

export interface AvatarViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface ScreenVisionSettings {
  deviceId: string;
  prompt: string;
  autoIntervalMs: number;
  enabled: boolean;
}

export interface DigitalHumanProfile {
  id: string;
  displayName: string;
  title: string;
  description: string;
  voiceSpeaker: string;
  avatarLabel: string;
  avatarAssetName?: string;
  enabled: boolean;
  persona: DigitalHumanPersona;
  memory: DigitalHumanMemoryProfile;
  installedSkillIds: string[];
}

export interface DigitalHumanPersona {
  identity: string;
  liveFocus: string;
  audienceRelationship: string;
  speakingStyle: string;
  signatureHabit: string;
  hardBoundaries: string;
}

export interface DigitalHumanMemoryProfile {
  coreIdentity: string;
  relationship: string;
  preferences: string;
  episodes: string;
  commitments: string;
  knowledgeBoundaries: string;
}

export interface DigitalHumanSettings {
  activeId: string;
  profiles: DigitalHumanProfile[];
}

export interface AppSettings {
  digitalHumans: DigitalHumanSettings;
  llm: LLMSettings;
  tts: TTSSettings;
  visual: VisualSettings;
  screenVision: ScreenVisionSettings;
  stream: StreamSettings;
  socialStream: SocialStreamSettings;
  liveConnectors: LiveConnectorSettings;
  commentIntelligence: CommentIntelligenceSettings;
  manneri: ManneriSettings;
  emptyRoomAwareness: EmptyRoomAwarenessSettings;
}
