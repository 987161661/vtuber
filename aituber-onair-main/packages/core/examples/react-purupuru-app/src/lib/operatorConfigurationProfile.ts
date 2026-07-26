import type {
  AppSettings,
  ChatProviderOption,
  DigitalHumanProfile,
  StreamingPlatformOption,
  TTSEngineOption,
} from '../types/settings';

const PROFILE_KIND = 'aituber-operator-configuration';
const PROFILE_SCHEMA_VERSION = 1;
const MAX_PROFILE_BYTES = 1_000_000;
const SECRET_FIELD_PATTERN =
  /(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization)/iu;

const CHAT_PROVIDERS = new Set<ChatProviderOption>([
  'openai',
  'openai-compatible',
  'openrouter',
  'gemini',
  'gemini-nano',
  'claude',
  'zai',
  'kimi',
  'xai',
  'deepseek',
  'mistral',
  'sakana',
  'plamo',
]);
const TTS_ENGINES = new Set<TTSEngineOption>([
  'openai',
  'geminiTts',
  'openaiCompatible',
  'voicevox',
  'voicepeak',
  'aivisSpeech',
  'aivisCloud',
  'minimax',
  'xai',
  'unrealSpeech',
  'elevenLabs',
  'inworld',
  'gradium',
  'piperPlus',
  'none',
]);
const STREAMING_PLATFORMS = new Set<StreamingPlatformOption>([
  'none',
  'youtube',
  'twitch',
  'bilibili',
  'custom-sse',
]);
const PLATFORM_CONNECTION_TEMPLATE = {
  enabled: false,
  roomId: '',
  outbound: {
    viewerReplies: true,
    proactiveSpeech: false,
    operatorBroadcasts: false,
  },
};

type UnknownRecord = Record<string, unknown>;

type PortableConfiguration = Pick<
  AppSettings,
  'digitalHumans' | 'llm' | 'tts' | 'stream' | 'socialStream' | 'liveConnectors'
>;

export type OperatorSetupStep = {
  id: 'model' | 'voice' | 'character' | 'platform';
  label: string;
  status: 'ready' | 'attention';
  required: boolean;
  detail: string;
};

export type OperatorSetupAssessment = {
  status: 'ready' | 'needs-setup';
  readyRequiredSteps: number;
  requiredSteps: number;
  steps: OperatorSetupStep[];
};

export type OperatorConfigurationImportResult =
  | {
      ok: true;
      name: string;
      settings: AppSettings;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configured(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLocalEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function modelReady(settings: AppSettings): boolean {
  const provider = settings.llm.provider;
  if (provider === 'gemini-nano') return true;
  if (
    provider === 'openai-compatible' &&
    isLocalEndpoint(settings.llm.endpoint)
  ) {
    return Boolean(settings.llm.model.trim());
  }
  return configured(
    settings.llm.apiKeys[
      provider as Exclude<ChatProviderOption, 'gemini-nano'>
    ],
  );
}

function voiceReady(settings: AppSettings): boolean {
  const localEngines = new Set<TTSEngineOption>([
    'none',
    'voicevox',
    'voicepeak',
    'aivisSpeech',
    'piperPlus',
  ]);
  if (localEngines.has(settings.tts.engine)) return true;
  if (
    settings.tts.engine === 'openaiCompatible' &&
    isLocalEndpoint(settings.tts.openAiCompatibleApiUrl)
  ) {
    return configured(settings.tts.openAiCompatibleModel);
  }
  if (settings.tts.engine === 'openai') {
    return configured(settings.llm.apiKeys.openai);
  }
  if (settings.tts.engine === 'geminiTts') {
    return configured(settings.llm.apiKeys.gemini);
  }
  if (settings.tts.engine === 'xai') {
    return configured(settings.llm.apiKeys.xai);
  }
  const credentialByEngine: Partial<Record<TTSEngineOption, unknown>> = {
    openaiCompatible: settings.tts.openAiCompatibleApiKey,
    aivisCloud: settings.tts.aivisCloudApiKey,
    minimax: settings.tts.minimaxApiKey,
    unrealSpeech: settings.tts.unrealSpeechApiKey,
    elevenLabs: settings.tts.elevenLabsApiKey,
    inworld: settings.tts.inworldApiKey,
    gradium: settings.tts.gradiumApiKey,
  };
  return configured(credentialByEngine[settings.tts.engine]);
}

function platformReady(settings: AppSettings): boolean {
  if (settings.stream.platform === 'none') return true;
  if (settings.stream.platform === 'youtube') {
    return (
      settings.stream.youtubeEnabled &&
      configured(settings.stream.youtubeLiveId) &&
      configured(settings.stream.youtubeApiKey)
    );
  }
  if (settings.stream.platform === 'twitch') {
    return (
      settings.stream.twitchEnabled &&
      configured(settings.stream.twitchChannel) &&
      configured(settings.stream.twitchAccessToken)
    );
  }
  if (settings.stream.platform === 'custom-sse') {
    return (
      settings.stream.customSseEnabled &&
      configured(settings.stream.customSseEndpoint)
    );
  }
  const connectorPlatform =
    settings.liveConnectors.ordinaryRoad.platforms[settings.stream.platform];
  return Boolean(
    connectorPlatform?.enabled && configured(connectorPlatform.roomId),
  );
}

export function assessOperatorSetup(
  settings: AppSettings,
): OperatorSetupAssessment {
  const activeProfile = settings.digitalHumans.profiles.find(
    (profile) => profile.id === settings.digitalHumans.activeId,
  );
  const modelIsReady = modelReady(settings);
  const voiceIsReady = voiceReady(settings);
  const characterIsReady = Boolean(
    activeProfile?.enabled &&
      activeProfile.displayName.trim() &&
      activeProfile.persona.identity.trim(),
  );
  const selectedPlatformReady = platformReady(settings);
  const steps: OperatorSetupStep[] = [
    {
      id: 'model',
      label: '模型',
      status: modelIsReady ? 'ready' : 'attention',
      required: true,
      detail: modelIsReady
        ? `${settings.llm.provider} · ${settings.llm.model}`
        : '需要选择模型并配置可用凭据',
    },
    {
      id: 'voice',
      label: '语音',
      status: voiceIsReady ? 'ready' : 'attention',
      required: true,
      detail:
        settings.tts.engine === 'none'
          ? '已选择无语音模式'
          : voiceIsReady
            ? `${settings.tts.engine} · ${settings.tts.speaker || '默认音色'}`
            : '当前语音引擎缺少凭据或本地服务配置',
    },
    {
      id: 'character',
      label: '角色',
      status: characterIsReady ? 'ready' : 'attention',
      required: true,
      detail: characterIsReady
        ? `${activeProfile?.displayName} · ${activeProfile?.title || '数字人'}`
        : '需要选择一个启用且身份完整的数字人',
    },
    {
      id: 'platform',
      label: '平台',
      status: selectedPlatformReady ? 'ready' : 'attention',
      required: false,
      detail:
        settings.stream.platform === 'none'
          ? '单机模式，可稍后连接直播平台'
          : selectedPlatformReady
            ? `${settings.stream.platform} 已完成基础配置`
            : `${settings.stream.platform} 尚未完成连接配置`,
    },
  ];
  const required = steps.filter((step) => step.required);
  const readyRequiredSteps = required.filter(
    (step) => step.status === 'ready',
  ).length;
  return {
    status: readyRequiredSteps === required.length ? 'ready' : 'needs-setup',
    readyRequiredSteps,
    requiredSteps: required.length,
    steps,
  };
}

function portableClone(value: unknown, key = ''): unknown {
  if (key === 'apiKeys' || SECRET_FIELD_PATTERN.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => portableClone(item))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([entryKey, entryValue]) => [
        entryKey,
        portableClone(entryValue, entryKey),
      ])
      .filter((entry) => entry[1] !== undefined),
  );
}

function buildPortableConfiguration(
  settings: AppSettings,
): PortableConfiguration {
  return portableClone({
    digitalHumans: settings.digitalHumans,
    llm: {
      ...settings.llm,
      openRouterDynamicFreeModels: undefined,
    },
    tts: settings.tts,
    stream: settings.stream,
    socialStream: settings.socialStream,
    liveConnectors: settings.liveConnectors,
  }) as PortableConfiguration;
}

export function exportOperatorConfigurationProfile(
  settings: AppSettings,
  name: string,
  now = Date.now(),
): string {
  return JSON.stringify(
    {
      kind: PROFILE_KIND,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      name: name.trim().slice(0, 80) || 'AI 主播配置',
      exportedAt: new Date(now).toISOString(),
      security: {
        credentialsIncluded: false,
        importPolicy: 'preserve-local-credentials',
      },
      configuration: buildPortableConfiguration(settings),
    },
    null,
    2,
  );
}

function validProfile(value: unknown): value is DigitalHumanProfile {
  if (!isRecord(value) || !isRecord(value.persona) || !isRecord(value.memory)) {
    return false;
  }
  const persona = value.persona;
  const memory = value.memory;
  const profileStringFields = [
    'id',
    'displayName',
    'title',
    'description',
    'voiceSpeaker',
    'avatarLabel',
  ];
  const personaFields = [
    'identity',
    'liveFocus',
    'audienceRelationship',
    'speakingStyle',
    'signatureHabit',
    'hardBoundaries',
  ];
  const memoryFields = [
    'coreIdentity',
    'relationship',
    'preferences',
    'episodes',
    'commitments',
    'knowledgeBoundaries',
  ];
  return (
    profileStringFields.every((field) => configured(value[field])) &&
    personaFields.every((field) => configured(persona[field])) &&
    memoryFields.every((field) => typeof memory[field] === 'string') &&
    typeof value.enabled === 'boolean' &&
    Array.isArray(value.installedSkillIds) &&
    value.installedSkillIds.every((item) => typeof item === 'string')
  );
}

function mergeKnownShape(
  current: unknown,
  candidate: unknown,
  warnings: string[],
  path: string,
): unknown {
  if (!isRecord(current) || !isRecord(candidate)) return current;
  const next: UnknownRecord = { ...current };
  for (const [key, value] of Object.entries(candidate)) {
    const fieldPath = `${path}.${key}`;
    if (key === 'apiKeys' || SECRET_FIELD_PATTERN.test(key)) {
      warnings.push(`${fieldPath} 已忽略，导入不会覆盖本机凭据`);
      continue;
    }
    if (!(key in current)) {
      warnings.push(`${fieldPath} 不是当前版本支持的字段`);
      continue;
    }
    const existing = current[key];
    if (Array.isArray(existing)) {
      if (!Array.isArray(value)) {
        warnings.push(`${fieldPath} 类型无效`);
      } else if (key === 'profiles') {
        const profiles = value.filter(validProfile);
        if (!profiles.length) {
          warnings.push(`${fieldPath} 没有可用角色`);
        } else {
          const template = isRecord(existing[0]) ? existing[0] : profiles[0];
          next[key] = profiles.map((profile) =>
            mergeKnownShape(template, profile, warnings, `${fieldPath}[]`),
          );
        }
      } else if (value.every((item) => typeof item === 'string')) {
        next[key] = [...new Set(value)];
      } else {
        warnings.push(`${fieldPath} 仅接受字符串列表`);
      }
      continue;
    }
    if (isRecord(existing)) {
      if (!isRecord(value)) {
        warnings.push(`${fieldPath} 类型无效`);
      } else if (key === 'platforms') {
        const fallback =
          Object.values(existing).find(isRecord) ??
          PLATFORM_CONNECTION_TEMPLATE;
        next[key] = Object.fromEntries(
          Object.entries(value)
            .filter(([, connection]) => isRecord(connection))
            .map(([platformId, connection]) => [
              platformId,
              mergeKnownShape(
                isRecord(existing[platformId])
                  ? existing[platformId]
                  : fallback,
                connection,
                warnings,
                `${fieldPath}.${platformId}`,
              ),
            ]),
        );
      } else {
        next[key] = mergeKnownShape(existing, value, warnings, fieldPath);
      }
      continue;
    }
    if (typeof value !== typeof existing || value === null) {
      warnings.push(`${fieldPath} 类型无效`);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function validateEnumerations(candidate: UnknownRecord): string | null {
  const llm = isRecord(candidate.llm) ? candidate.llm : null;
  if (
    llm?.provider !== undefined &&
    (!configured(llm.provider) ||
      !CHAT_PROVIDERS.has(llm.provider as ChatProviderOption))
  ) {
    return '配置档案包含不支持的模型提供方';
  }
  const tts = isRecord(candidate.tts) ? candidate.tts : null;
  if (
    tts?.engine !== undefined &&
    (!configured(tts.engine) || !TTS_ENGINES.has(tts.engine as TTSEngineOption))
  ) {
    return '配置档案包含不支持的语音引擎';
  }
  const stream = isRecord(candidate.stream) ? candidate.stream : null;
  if (
    stream?.platform !== undefined &&
    (!configured(stream.platform) ||
      !STREAMING_PLATFORMS.has(stream.platform as StreamingPlatformOption))
  ) {
    return '配置档案包含不支持的直播平台';
  }
  return null;
}

export function importOperatorConfigurationProfile(
  serialized: string,
  current: AppSettings,
): OperatorConfigurationImportResult {
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROFILE_BYTES) {
    return { ok: false, error: '配置档案超过 1 MB，已拒绝导入' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, error: '配置档案不是有效的 JSON 文件' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: '配置档案格式无效' };
  }
  if (
    parsed.kind !== PROFILE_KIND ||
    parsed.schemaVersion !== PROFILE_SCHEMA_VERSION
  ) {
    return { ok: false, error: '不支持的配置档案类型或版本' };
  }
  if (!isRecord(parsed.configuration)) {
    return { ok: false, error: '配置档案缺少 configuration' };
  }
  const configuration = parsed.configuration;
  const enumerationError = validateEnumerations(configuration);
  if (enumerationError) return { ok: false, error: enumerationError };

  const supportedSections = [
    'digitalHumans',
    'llm',
    'tts',
    'stream',
    'socialStream',
    'liveConnectors',
  ] as const;
  if (!supportedSections.some((key) => isRecord(configuration[key]))) {
    return { ok: false, error: '配置档案不包含可导入的设置' };
  }

  const warnings: string[] = [];
  const next = structuredClone(current);
  for (const section of supportedSections) {
    const candidate = configuration[section];
    if (!isRecord(candidate)) continue;
    next[section] = mergeKnownShape(
      current[section],
      candidate,
      warnings,
      `configuration.${section}`,
    ) as never;
  }

  const profiles = next.digitalHumans.profiles;
  if (!profiles.some((profile) => profile.id === next.digitalHumans.activeId)) {
    next.digitalHumans.activeId =
      profiles.find((profile) => profile.enabled)?.id ??
      profiles[0]?.id ??
      current.digitalHumans.activeId;
    warnings.push('活动角色不存在，已自动选择可用角色');
  }
  const activeProfile = profiles.find(
    (profile) => profile.id === next.digitalHumans.activeId,
  );
  if (activeProfile?.voiceSpeaker) {
    next.tts.speaker = activeProfile.voiceSpeaker;
  }

  return {
    ok: true,
    name: configured(parsed.name)
      ? String(parsed.name).slice(0, 80)
      : 'AI 主播配置',
    settings: next,
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}
