import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDefaultXaiReasoningEffort,
  isGPT5Model,
  isXaiReasoningEffortModel,
  type XaiReasoningEffort,
} from '@aituber-onair/core';
import { LINGLAN_PROFILE } from '../config/characterProfile';
import { ScreenVisionPanel } from './ScreenVisionPanel';
import { StreamSettings } from './StreamSettings';
import { MemoryCenter } from './MemoryCenter';
import { useGeminiNanoStatus } from '../hooks/useGeminiNanoStatus';
import type { useScreenVisionController } from '../hooks/useScreenVisionController';
import type { PuruPuruAvatarPackage } from '../lib/purupuruPackage';
import type { ChatProviderOption, TTSEngineOption } from '../types/settings';
import type { useSettings } from '../hooks/useSettings';
import type { useStreamerMemory } from '../hooks/useStreamerMemory';

type SettingsHook = ReturnType<typeof useSettings>;
type ScreenVisionController = ReturnType<typeof useScreenVisionController>;
const MINIMAX_QUEEN_VOICE_IDS = new Set(
  LINGLAN_PROFILE.voice.presets.map((preset) => preset.id),
);

interface SettingsPanelProps extends SettingsHook {
  isProcessing: boolean;
  backgroundImageUrl: string | null;
  streamErrorMessage?: string;
  avatarPackage: PuruPuruAvatarPackage | null;
  avatarPackageSource: 'default' | 'user' | null;
  avatarLoadError?: string | null;
  screenVisionController: ScreenVisionController;
  onBackgroundImageChange: (file: File | null) => void;
  onAvatarPackageChange: (file: File | null) => void;
  memory: ReturnType<typeof useStreamerMemory>;
}

const PROVIDERS: {
  value: ChatProviderOption;
  label: string;
  disabled?: boolean;
}[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-Compatible' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'gemini-nano', label: 'Gemini Nano' },
  { value: 'claude', label: 'Claude' },
  { value: 'xai', label: 'xAI' },
  { value: 'zai', label: 'Z.ai' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'sakana', label: 'Sakana AI（仅限 Node/后端）', disabled: true },
  { value: 'plamo', label: 'PLaMo' },
];

const TTS_ENGINES: { value: TTSEngineOption; label: string }[] = [
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'geminiTts', label: 'Gemini TTS' },
  { value: 'openaiCompatible', label: 'OpenAI-Compatible TTS' },
  { value: 'voicevox', label: 'VOICEVOX' },
  { value: 'voicepeak', label: 'VOICEPEAK' },
  { value: 'aivisSpeech', label: 'AivisSpeech' },
  { value: 'aivisCloud', label: 'Aivis Cloud' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'xai', label: 'xAI TTS' },
  { value: 'unrealSpeech', label: 'Unreal Speech' },
  { value: 'elevenLabs', label: 'ElevenLabs' },
  { value: 'inworld', label: 'Inworld' },
  { value: 'gradium', label: 'Gradium' },
  { value: 'piperPlus', label: 'Piper Plus' },
  { value: 'none', label: '不启用' },
];

const OPENAI_SPEAKERS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const GEMINI_TTS_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
] as const;
const GEMINI_TTS_SPEAKERS = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;
const XAI_SPEAKERS = ['ara', 'eve', 'leo', 'rex', 'sal'];
const XAI_CODECS = ['mp3', 'wav', 'pcm', 'mulaw', 'alaw'] as const;
const XAI_SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000] as const;
const XAI_BIT_RATES = [32000, 64000, 96000, 128000, 192000] as const;
const UNREAL_SPEECH_SPEAKERS = [
  'af_bella',
  'af_sarah',
  'am_adam',
  'am_michael',
] as const;
const UNREAL_SPEECH_CODECS = ['libmp3lame', 'pcm_mulaw', 'pcm_s16le'] as const;
const ELEVENLABS_MODELS = [
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
] as const;
const ELEVENLABS_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_22050_32',
  'pcm_16000',
  'ulaw_8000',
] as const;
const INWORLD_MODELS = [
  'inworld-tts-2',
  'inworld-tts-1.5-mini',
  'inworld-tts-1.5-max',
] as const;
const INWORLD_AUDIO_ENCODINGS = [
  'MP3',
  'OGG_OPUS',
  'FLAC',
  'LINEAR16',
  'WAV',
  'PCM',
  'ALAW',
  'MULAW',
] as const;
const INWORLD_DELIVERY_MODES = ['STABLE', 'BALANCED', 'CREATIVE'] as const;
const INWORLD_DELIVERY_MODE_LABELS: Record<
  (typeof INWORLD_DELIVERY_MODES)[number],
  string
> = {
  STABLE: '稳定',
  BALANCED: '平衡',
  CREATIVE: '创意',
};
const GRADIUM_VOICES: Record<string, string> = {
  YTpq7expH9539ERJ: 'Emma - 美式英语女声',
  LFZvm12tW_z0xfGo: 'Kent - 美式英语男声',
  jtEKaLYNn6iif5PR: 'Sydney - 美式英语女声',
  KWJiFWu2O9nMPYcR: 'John - 美式英语男声',
  ubuXFxVQwVYnZQhy: 'Eva - 英式英语女声',
  m86j6D7UZpGzHsNu: 'Jack - 英式英语男声',
  b35yykvVppLXyw_l: 'Elise - 法语女声',
  axlOaUiFyOZhy4nv: 'Leo - 法语男声',
  '-uP9MuGtBqAvEyxI': 'Mia - 德语女声',
  '0y1VZjPabOBU3rWy': 'Maximilian - 德语男声',
  B36pbz5_UoWn4BDl: 'Valentina - 墨西哥西班牙语女声',
  xu7iJ_fn2ElcWp2s: 'Sergio - 西班牙语男声',
  pYcGZz9VOo4n2ynh: 'Alice - 巴西葡萄牙语女声',
  'M-FvVo9c-jGR4PgP': 'Davi - 巴西葡萄牙语男声',
};
const GRADIUM_OUTPUT_FORMATS = [
  'wav',
  'pcm',
  'opus',
  'ulaw_8000',
  'mulaw_8000',
  'alaw_8000',
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
] as const;

const VOICEPEAK_SPEAKERS = [
  { id: 'f1', name: '日语女声 1' },
  { id: 'f2', name: '日语女声 2' },
  { id: 'f3', name: '日语女声 3' },
  { id: 'm1', name: '日语男声 1' },
  { id: 'm2', name: '日语男声 2' },
  { id: 'm3', name: '日语男声 3' },
  { id: 'c', name: '女孩' },
];

const AIVIS_CLOUD_PRESETS = [
  {
    id: 'kohaku',
    label: '琥珀',
    modelUuid: '22e8ed77-94fe-4ef2-871f-a86f94e9a579',
    speakerUuid: '',
    styleId: '',
  },
  {
    id: 'mao',
    label: '真央',
    modelUuid: 'a59cb814-0083-4369-8542-f51a29e72af7',
    speakerUuid: '',
    styleId: '',
  },
] as const;

interface VoiceSpeaker {
  name: string;
  speaker_uuid: string;
  styles: { name: string; id: number }[];
}

interface MinimaxVoice {
  voice_id: string;
  voice_name: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
}

interface InworldVoice {
  voiceId: string;
  displayName?: string;
  langCode?: string;
  gender?: string;
}

type SectionKey =
  | 'llm'
  | 'tts'
  | 'visual'
  | 'stream'
  | 'commentIntelligence'
  | 'manneri';

export function SettingsPanel({
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
  resetVisualAvatarView,
  updateScreenVisionDeviceId,
  updateScreenVisionPrompt,
  updateScreenVisionAutoIntervalMs,
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
  updateCustomSseEndpoint,
  updateCustomSseEnabled,
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
  getApiKeyForProvider,
  isProcessing,
  backgroundImageUrl,
  streamErrorMessage,
  avatarPackage,
  avatarPackageSource,
  avatarLoadError,
  screenVisionController,
  onBackgroundImageChange,
  onAvatarPackageChange,
  memory,
}: SettingsPanelProps) {
  const disabled = isProcessing;
  const isOpenAIGPT5Model =
    settings.llm.provider === 'openai' && isGPT5Model(settings.llm.model);
  const isXaiReasoningEffortModelSelected =
    settings.llm.provider === 'xai' &&
    isXaiReasoningEffortModel(settings.llm.model);
  const xaiReasoningEffortValue: XaiReasoningEffort =
    isXaiReasoningEffortModelSelected
      ? settings.llm.xaiReasoningEffort ||
        getDefaultXaiReasoningEffort(settings.llm.model) ||
        'none'
      : 'none';
  const openRouterApiKey = getApiKeyForProvider('openrouter').trim();
  const openRouterDynamicFreeModels =
    settings.llm.openRouterDynamicFreeModels?.models || [];
  const openRouterFetchedAt =
    settings.llm.openRouterDynamicFreeModels?.fetchedAt || 0;
  const openRouterMaxCandidates =
    settings.llm.openRouterDynamicFreeModels?.maxCandidates || 1;
  const geminiNano = useGeminiNanoStatus(
    settings.llm.provider === 'gemini-nano',
  );

  const [voicevoxSpeakers, setVoicevoxSpeakers] = useState<VoiceSpeaker[]>([]);
  const [aivisSpeakers, setAivisSpeakers] = useState<VoiceSpeaker[]>([]);
  const [minimaxVoices, setMinimaxVoices] = useState<MinimaxVoice[]>([]);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>(
    [],
  );
  const [inworldVoices, setInworldVoices] = useState<InworldVoice[]>([]);
  const [fetchError, setFetchError] = useState('');
  const [isFetchingMinimaxVoices, setIsFetchingMinimaxVoices] = useState(false);
  const [isFetchingElevenLabsVoices, setIsFetchingElevenLabsVoices] =
    useState(false);
  const [isFetchingInworldVoices, setIsFetchingInworldVoices] = useState(false);
  const speakerRef = useRef(settings.tts.speaker);
  const [expandedSections, setExpandedSections] = useState<
    Record<SectionKey, boolean>
  >({
    llm: true,
    tts: true,
    visual: true,
    stream: true,
    commentIntelligence: true,
    manneri: true,
  });

  useEffect(() => {
    speakerRef.current = settings.tts.speaker;
  }, [settings.tts.speaker]);

  const selectedAivisCloudPresetId = useMemo(() => {
    const matched = AIVIS_CLOUD_PRESETS.find(
      (preset) =>
        preset.modelUuid === (settings.tts.aivisCloudModelUuid || '') &&
        preset.speakerUuid === (settings.tts.aivisCloudSpeakerUuid || '') &&
        preset.styleId === (settings.tts.aivisCloudStyleId || ''),
    );
    return matched?.id || AIVIS_CLOUD_PRESETS[0].id;
  }, [
    settings.tts.aivisCloudModelUuid,
    settings.tts.aivisCloudSpeakerUuid,
    settings.tts.aivisCloudStyleId,
  ]);

  // Fetch speaker list for VOICEVOX / AivisSpeech
  useEffect(() => {
    if (
      settings.tts.engine !== 'voicevox' &&
      settings.tts.engine !== 'aivisSpeech'
    ) {
      return;
    }

    const controller = new AbortController();

    const fetchSpeakers = async () => {
      const isVoicevox = settings.tts.engine === 'voicevox';
      const baseUrl = isVoicevox
        ? settings.tts.voicevoxApiUrl || 'http://localhost:50021'
        : settings.tts.aivisSpeechApiUrl || 'http://localhost:10101';

      try {
        const response = await fetch(`${baseUrl}/speakers`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const speakers = (await response.json()) as VoiceSpeaker[];
        if (controller.signal.aborted) return;

        if (isVoicevox) {
          setVoicevoxSpeakers(speakers);
        } else {
          setAivisSpeakers(speakers);
        }
        setFetchError('');

        if (!speakerRef.current && speakers.length > 0) {
          const firstId = speakers[0]?.styles?.[0]?.id;
          if (firstId != null) updateTTSSpeaker(String(firstId));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (isVoicevox) {
          setVoicevoxSpeakers([]);
          setFetchError(`VOICEVOX 连接错误：${message}`);
        } else {
          setAivisSpeakers([]);
          setFetchError(`AivisSpeech 连接错误：${message}`);
        }
      }
    };

    void fetchSpeakers();

    return () => {
      controller.abort();
    };
  }, [
    settings.tts.engine,
    settings.tts.voicevoxApiUrl,
    settings.tts.aivisSpeechApiUrl,
    updateTTSSpeaker,
  ]);

  // Fetch MiniMax speaker list after API key is entered
  useEffect(() => {
    if (settings.tts.engine !== 'minimax') {
      return;
    }

    const apiKey = settings.tts.minimaxApiKey?.trim();
    if (!apiKey) {
      setMinimaxVoices([]);
      return;
    }

    const controller = new AbortController();

    const fetchMinimaxVoices = async () => {
      setIsFetchingMinimaxVoices(true);
      try {
        const response = await fetch(
          'https://api.minimaxi.com/v1/get_voice',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ voice_type: 'all' }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          base_resp?: { status_code?: number; status_msg?: string };
          system_voice?: MinimaxVoice[];
          voice_cloning?: MinimaxVoice[];
          voice_generation?: MinimaxVoice[];
        };
        if (controller.signal.aborted) return;

        if (payload.base_resp && payload.base_resp.status_code !== 0) {
          throw new Error(payload.base_resp.status_msg || 'MiniMax API 返回错误');
        }

        const voices = [
          ...(payload.system_voice || []),
          ...(payload.voice_cloning || []),
          ...(payload.voice_generation || []),
        ].map((voice) => ({
          voice_id: voice.voice_id,
          voice_name: voice.voice_name || voice.voice_id,
        }));
        setMinimaxVoices(voices);
        setFetchError('');

        if (
          voices.length > 0 &&
          !voices.some((voice) => voice.voice_id === speakerRef.current)
        ) {
          updateTTSSpeaker(voices[0].voice_id);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setMinimaxVoices([]);
        setFetchError(`MiniMax 连接错误：${message}`);
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingMinimaxVoices(false);
        }
      }
    };

    void fetchMinimaxVoices();

    return () => {
      controller.abort();
    };
  }, [settings.tts.engine, settings.tts.minimaxApiKey, updateTTSSpeaker]);

  // Fetch ElevenLabs voice list after API key is entered
  useEffect(() => {
    if (settings.tts.engine !== 'elevenLabs') {
      return;
    }

    const apiKey = settings.tts.elevenLabsApiKey?.trim();
    if (!apiKey) {
      queueMicrotask(() => {
        setElevenLabsVoices([]);
      });
      return;
    }

    const controller = new AbortController();

    const fetchElevenLabsVoices = async () => {
      setIsFetchingElevenLabsVoices(true);
      try {
        const response = await fetch(
          'https://api.elevenlabs.io/v2/voices?page_size=100',
          {
            method: 'GET',
            headers: {
              'xi-api-key': apiKey,
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          voices?: ElevenLabsVoice[];
        };
        if (controller.signal.aborted) return;

        const voices = payload.voices || [];
        setElevenLabsVoices(voices);
        setFetchError('');

        if (
          voices.length > 0 &&
          !voices.some((voice) => voice.voice_id === speakerRef.current)
        ) {
          updateTTSSpeaker(voices[0].voice_id);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setElevenLabsVoices([]);
        setFetchError(`ElevenLabs 连接错误：${message}`);
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingElevenLabsVoices(false);
        }
      }
    };

    void fetchElevenLabsVoices();

    return () => {
      controller.abort();
    };
  }, [settings.tts.engine, settings.tts.elevenLabsApiKey, updateTTSSpeaker]);

  useEffect(() => {
    if (settings.tts.engine !== 'inworld') {
      return;
    }

    const apiKey = settings.tts.inworldApiKey?.trim();
    if (!apiKey) {
      queueMicrotask(() => {
        setInworldVoices([]);
      });
      return;
    }

    const controller = new AbortController();

    const fetchInworldVoices = async () => {
      setIsFetchingInworldVoices(true);
      try {
        const url = new URL('https://api.inworld.ai/voices/v1/voices');
        url.searchParams.set('orderBy', 'display_name asc');
        url.searchParams.set('pageSize', '2000');
        if (settings.tts.inworldLanguage?.trim()) {
          url.searchParams.set(
            'filter',
            `lang_code = "${settings.tts.inworldLanguage.trim()}"`,
          );
        }

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Basic ${apiKey}` },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          voices?: InworldVoice[];
        };
        if (controller.signal.aborted) return;

        const voices = payload.voices || [];
        setInworldVoices(voices);
        setFetchError('');

        if (
          voices.length > 0 &&
          !voices.some((voice) => voice.voiceId === speakerRef.current)
        ) {
          updateTTSSpeaker(voices[0].voiceId);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setInworldVoices([]);
        setFetchError(`Inworld 连接错误：${message}`);
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingInworldVoices(false);
        }
      }
    };

    void fetchInworldVoices();

    return () => {
      controller.abort();
    };
  }, [
    settings.tts.engine,
    settings.tts.inworldApiKey,
    settings.tts.inworldLanguage,
    updateTTSSpeaker,
  ]);

  const handleAivisCloudPresetChange = (presetId: string) => {
    const preset = AIVIS_CLOUD_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    updateAivisCloudModelUuid(preset.modelUuid);
    updateAivisCloudSpeakerUuid(preset.speakerUuid);
    updateAivisCloudStyleId(preset.styleId);
    updateTTSSpeaker(preset.modelUuid);
  };

  const toggleSection = (section: SectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="settings-panel">
      {/* LLM Section */}
      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('llm')}
          aria-expanded={expandedSections.llm}
        >
          <h3>大语言模型（LLM）</h3>
          <span
            className={`settings-section-chevron${expandedSections.llm ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.llm && (
          <>
            <div className="settings-field">
              <label htmlFor="llm-provider">服务提供商</label>
              <select
                id="llm-provider"
                value={settings.llm.provider}
                onChange={(e) =>
                  updateLLMProvider(e.target.value as ChatProviderOption)
                }
                disabled={disabled}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value} disabled={p.disabled}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {settings.llm.provider === 'openai-compatible' ? (
              <div className="settings-field">
                <label htmlFor="llm-model">模型</label>
                <input
                  id="llm-model"
                  type="text"
                  value={settings.llm.model}
                  onChange={(e) => updateLLMModel(e.target.value)}
                  placeholder="local-model"
                  disabled={disabled}
                />
              </div>
            ) : (
              <div className="settings-field">
                <label htmlFor="llm-model">模型</label>
                <select
                  id="llm-model"
                  value={settings.llm.model}
                  onChange={(e) => updateLLMModel(e.target.value)}
                  disabled={disabled}
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isOpenAIGPT5Model && (
              <p className="settings-field-hint">
                本项目中 GPT-5 模型使用日常对话预设，并生成极简短回复。
              </p>
            )}

            {settings.llm.provider === 'xai' && (
              <div className="settings-field">
                <label htmlFor="xai-reasoning-effort">
                  xAI 推理强度
                </label>
                <select
                  id="xai-reasoning-effort"
                  value={xaiReasoningEffortValue}
                  onChange={(e) =>
                    updateXaiReasoningEffort(
                      e.target.value as XaiReasoningEffort,
                    )
                  }
                  disabled={disabled || !isXaiReasoningEffortModelSelected}
                >
                  <option value="none">不启用</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
                <p className="settings-field-hint">
                  {isXaiReasoningEffortModelSelected
                    ? 'Grok 4.3 默认不启用推理，以降低延迟。'
                    : '当前 xAI 模型不支持调节推理强度。'}
                </p>
              </div>
            )}

            {settings.llm.provider === 'openrouter' && (
              <div className="settings-field">
                <label htmlFor="llm-apikey">
                  API 密钥（{settings.llm.provider}）
                </label>
                <input
                  id="llm-apikey"
                  type="password"
                  value={getApiKeyForProvider(settings.llm.provider)}
                  onChange={(e) =>
                    updateLLMApiKey(settings.llm.provider, e.target.value)
                  }
                  placeholder="XXX-..."
                  disabled={disabled}
                />
              </div>
            )}

            {settings.llm.provider === 'openrouter' && (
              <>
                <div className="settings-field">
                  <label htmlFor="openrouter-max-candidates">
                    最大候选模型数
                  </label>
                  <input
                    id="openrouter-max-candidates"
                    type="number"
                    min={1}
                    value={openRouterMaxCandidates}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      updateOpenRouterMaxCandidates(
                        Number.isFinite(parsed) ? parsed : 1,
                      );
                    }}
                    disabled={disabled || isRefreshingOpenRouterFreeModels}
                  />
                </div>
                <div className="settings-field">
                  <button
                    type="button"
                    className="settings-action-button"
                    onClick={() => {
                      void refreshOpenRouterDynamicFreeModels();
                    }}
                    disabled={
                      disabled ||
                      isRefreshingOpenRouterFreeModels ||
                      !openRouterApiKey
                    }
                  >
                    {isRefreshingOpenRouterFreeModels
                      ? '正在获取……'
                      : '获取免费模型'}
                  </button>
                  {!openRouterApiKey && (
                    <p className="settings-field-hint">
                      请先填写 OpenRouter API 密钥，再获取免费模型。
                    </p>
                  )}
                  {openRouterRefreshError && (
                    <p className="settings-field-error">
                      {openRouterRefreshError}
                    </p>
                  )}
                  <p className="settings-field-hint">
                    动态免费模型数：{openRouterDynamicFreeModels.length}
                  </p>
                  {openRouterFetchedAt > 0 && (
                    <p className="settings-field-hint">
                      上次获取时间：{' '}
                      {new Date(openRouterFetchedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </>
            )}

            {settings.llm.provider === 'openai-compatible' && (
              <div className="settings-field">
                <label htmlFor="llm-endpoint">接口地址</label>
                <input
                  id="llm-endpoint"
                  type="text"
                  value={settings.llm.endpoint || ''}
                  onChange={(e) => updateLLMEndpoint(e.target.value)}
                  placeholder="http://localhost:11434/v1/chat/completions"
                  disabled={disabled}
                />
              </div>
            )}

            {settings.llm.provider === 'gemini-nano' && (
              <>
                <div className="settings-field">
                  <small>
                    Gemini Nano 使用浏览器内置 AI，无需 API 密钥。
                  </small>
                </div>
                <div className="settings-field">
                  <small>{geminiNano.statusText}</small>
                  {geminiNano.downloadProgress != null && (
                    <small>{geminiNano.downloadProgress}%</small>
                  )}
                  {geminiNano.status === 'downloadable' && (
                    <button
                      type="button"
                      className="settings-action-button"
                      onClick={() => geminiNano.prepareModel()}
                      disabled={disabled || geminiNano.isPreparing}
                    >
                      {geminiNano.isPreparing
                        ? '正在准备……'
                        : '准备模型'}
                    </button>
                  )}
                  <small>
                    需要 Chrome 138 或更高版本。打开 `chrome://flags`，将
                    `#optimization-guide-on-device-model` 和
                    `#prompt-api-for-gemini-nano` 设为 `Enabled`，然后重启 Chrome。
                  </small>
                  <small>
                    启用上述标志后，点击“准备模型”即可开始下载。首次下载可能需要数分钟。
                  </small>
                </div>
              </>
            )}

            {settings.llm.provider !== 'openrouter' &&
              settings.llm.provider !== 'gemini-nano' && (
                <div className="settings-field">
                  <label htmlFor="llm-apikey">
                    API 密钥（{settings.llm.provider}）
                    {settings.llm.provider === 'openai-compatible'
                      ? '（可选）'
                      : ''}
                  </label>
                  <input
                    id="llm-apikey"
                    type="password"
                    value={getApiKeyForProvider(settings.llm.provider)}
                    onChange={(e) =>
                      updateLLMApiKey(settings.llm.provider, e.target.value)
                    }
                    placeholder={
                      settings.llm.provider === 'openai-compatible'
                        ? '仅在服务要求时填写'
                        : 'XXX-...'
                    }
                    disabled={disabled}
                  />
                </div>
              )}
          </>
        )}
      </div>

      {/* TTS Section */}
      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('tts')}
          aria-expanded={expandedSections.tts}
        >
          <h3>语音合成（TTS）</h3>
          <span
            className={`settings-section-chevron${expandedSections.tts ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.tts && (
          <>
            <div className="settings-field">
              <label htmlFor="tts-engine">语音引擎</label>
              <select
                id="tts-engine"
                value={settings.tts.engine}
                onChange={(e) =>
                  updateTTSEngine(e.target.value as TTSEngineOption)
                }
                disabled={disabled}
              >
                {TTS_ENGINES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {settings.tts.engine === 'openai' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-openai-apikey">OpenAI API 密钥</label>
                  <input
                    id="tts-openai-apikey"
                    type="password"
                    value={getApiKeyForProvider('openai')}
                    onChange={(e) => updateLLMApiKey('openai', e.target.value)}
                    placeholder="请输入 OpenAI API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-speaker">音色</label>
                  <select
                    id="tts-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {OPENAI_SPEAKERS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {settings.tts.engine === 'geminiTts' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-apikey">Gemini API 密钥</label>
                  <input
                    id="tts-gemini-apikey"
                    type="password"
                    value={getApiKeyForProvider('gemini')}
                    onChange={(e) => updateLLMApiKey('gemini', e.target.value)}
                    placeholder="请输入 Google API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-speaker">音色</label>
                  <select
                    id="tts-gemini-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {GEMINI_TTS_SPEAKERS.map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {speaker}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-model">模型</label>
                  <select
                    id="tts-gemini-model"
                    value={settings.tts.geminiTtsModel || GEMINI_TTS_MODELS[0]}
                    onChange={(e) => updateGeminiTtsModel(e.target.value)}
                    disabled={disabled}
                  >
                    {GEMINI_TTS_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-language">语言代码</label>
                  <input
                    id="tts-gemini-language"
                    type="text"
                    value={settings.tts.geminiTtsLanguageCode || ''}
                    onChange={(e) =>
                      updateGeminiTtsLanguageCode(e.target.value)
                    }
                    placeholder="ja-JP"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gemini-prompt">
                    语音风格提示词
                  </label>
                  <input
                    id="tts-gemini-prompt"
                    type="text"
                    value={settings.tts.geminiTtsPrompt || ''}
                    onChange={(e) => updateGeminiTtsPrompt(e.target.value)}
                    placeholder="例如：请用清冷、从容而自信的女声说话"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'xai' && (
              <>
                {settings.llm.provider !== 'xai' && (
                  <div className="settings-field">
                    <label htmlFor="tts-xai-apikey">xAI API 密钥</label>
                    <input
                      id="tts-xai-apikey"
                      type="password"
                      value={getApiKeyForProvider('xai')}
                      onChange={(e) => updateLLMApiKey('xai', e.target.value)}
                      placeholder="xai-..."
                      disabled={disabled}
                    />
                  </div>
                )}
                <div className="settings-field">
                  <label htmlFor="tts-xai-speaker">音色</label>
                  <select
                    id="tts-xai-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {XAI_SPEAKERS.map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {speaker}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-xai-language">语言</label>
                  <input
                    id="tts-xai-language"
                    type="text"
                    value={settings.tts.xaiLanguage || ''}
                    onChange={(e) => updateXaiLanguage(e.target.value)}
                    placeholder="auto"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-xai-codec">编解码器</label>
                  <select
                    id="tts-xai-codec"
                    value={settings.tts.xaiCodec || 'mp3'}
                    onChange={(e) => updateXaiCodec(e.target.value)}
                    disabled={disabled}
                  >
                    {XAI_CODECS.map((codec) => (
                      <option key={codec} value={codec}>
                        {codec}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-xai-sample-rate">采样率</label>
                  <select
                    id="tts-xai-sample-rate"
                    value={String(settings.tts.xaiSampleRate || 24000)}
                    onChange={(e) =>
                      updateXaiSampleRate(Number.parseInt(e.target.value, 10))
                    }
                    disabled={disabled}
                  >
                    {XAI_SAMPLE_RATES.map((sampleRate) => (
                      <option key={sampleRate} value={sampleRate}>
                        {sampleRate}
                      </option>
                    ))}
                  </select>
                </div>
                {(settings.tts.xaiCodec || 'mp3') === 'mp3' && (
                  <div className="settings-field">
                    <label htmlFor="tts-xai-bit-rate">比特率</label>
                    <select
                      id="tts-xai-bit-rate"
                      value={String(settings.tts.xaiBitRate || 128000)}
                      onChange={(e) =>
                        updateXaiBitRate(Number.parseInt(e.target.value, 10))
                      }
                      disabled={disabled}
                    >
                      {XAI_BIT_RATES.map((bitRate) => (
                        <option key={bitRate} value={bitRate}>
                          {bitRate}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {settings.tts.engine === 'unrealSpeech' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-apikey">API 密钥</label>
                  <input
                    id="tts-unreal-apikey"
                    type="password"
                    value={settings.tts.unrealSpeechApiKey || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechApiKey', e.target.value)
                    }
                    placeholder="请输入 Unreal Speech API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-speaker">音色</label>
                  <select
                    id="tts-unreal-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {UNREAL_SPEECH_SPEAKERS.map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {speaker}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-url">API 地址</label>
                  <input
                    id="tts-unreal-url"
                    type="text"
                    value={settings.tts.unrealSpeechApiUrl || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechApiUrl', e.target.value)
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-codec">编解码器</label>
                  <select
                    id="tts-unreal-codec"
                    value={settings.tts.unrealSpeechCodec || 'libmp3lame'}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechCodec', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {UNREAL_SPEECH_CODECS.map((codec) => (
                      <option key={codec} value={codec}>
                        {codec}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-bitrate">比特率</label>
                  <input
                    id="tts-unreal-bitrate"
                    type="text"
                    value={settings.tts.unrealSpeechBitrate || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechBitrate', e.target.value)
                    }
                    placeholder="192k"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-speed">语速</label>
                  <input
                    id="tts-unreal-speed"
                    type="number"
                    step="0.05"
                    value={settings.tts.unrealSpeechSpeed || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechSpeed', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-pitch">音高</label>
                  <input
                    id="tts-unreal-pitch"
                    type="number"
                    step="0.05"
                    value={settings.tts.unrealSpeechPitch || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechPitch', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-unreal-temperature">随机性</label>
                  <input
                    id="tts-unreal-temperature"
                    type="number"
                    step="0.05"
                    value={settings.tts.unrealSpeechTemperature || ''}
                    onChange={(e) =>
                      updateTtsField('unrealSpeechTemperature', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'elevenLabs' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-apikey">API 密钥</label>
                  <input
                    id="tts-eleven-apikey"
                    type="password"
                    value={settings.tts.elevenLabsApiKey || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsApiKey', e.target.value)
                    }
                    placeholder="请输入 ElevenLabs API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-speaker">音色</label>
                  <select
                    id="tts-eleven-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={
                      disabled ||
                      !settings.tts.elevenLabsApiKey ||
                      isFetchingElevenLabsVoices ||
                      elevenLabsVoices.length === 0
                    }
                  >
                    {!settings.tts.elevenLabsApiKey && (
                      <option value="">请先输入 API 密钥</option>
                    )}
                    {settings.tts.elevenLabsApiKey &&
                      isFetchingElevenLabsVoices && (
                        <option value="">正在获取……</option>
                      )}
                    {settings.tts.elevenLabsApiKey &&
                      !isFetchingElevenLabsVoices &&
                      elevenLabsVoices.length === 0 && (
                        <option value="">无法获取音色列表</option>
                      )}
                    {elevenLabsVoices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.category
                          ? `${voice.name} (${voice.category})`
                          : voice.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-url">API 地址</label>
                  <input
                    id="tts-eleven-url"
                    type="text"
                    value={settings.tts.elevenLabsApiUrl || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsApiUrl', e.target.value)
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-model">模型</label>
                  <select
                    id="tts-eleven-model"
                    value={settings.tts.elevenLabsModel || ELEVENLABS_MODELS[0]}
                    onChange={(e) =>
                      updateTtsField('elevenLabsModel', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {ELEVENLABS_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-format">输出格式</label>
                  <select
                    id="tts-eleven-format"
                    value={
                      settings.tts.elevenLabsOutputFormat ||
                      ELEVENLABS_OUTPUT_FORMATS[0]
                    }
                    onChange={(e) =>
                      updateTtsField('elevenLabsOutputFormat', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {ELEVENLABS_OUTPUT_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-language">语言代码</label>
                  <input
                    id="tts-eleven-language"
                    type="text"
                    value={settings.tts.elevenLabsLanguageCode || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsLanguageCode', e.target.value)
                    }
                    placeholder="ja"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-stability">稳定性</label>
                  <input
                    id="tts-eleven-stability"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.tts.elevenLabsStability || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsStability', e.target.value)
                    }
                    placeholder="0.5"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-similarity">
                    音色相似度增强
                  </label>
                  <input
                    id="tts-eleven-similarity"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.tts.elevenLabsSimilarityBoost || ''}
                    onChange={(e) =>
                      updateTtsField(
                        'elevenLabsSimilarityBoost',
                        e.target.value,
                      )
                    }
                    placeholder="0.75"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-style">风格强度</label>
                  <input
                    id="tts-eleven-style"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.tts.elevenLabsStyle || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsStyle', e.target.value)
                    }
                    placeholder="0"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-speed">语速</label>
                  <input
                    id="tts-eleven-speed"
                    type="number"
                    min="0.7"
                    max="1.2"
                    step="0.01"
                    value={settings.tts.elevenLabsSpeed || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsSpeed', e.target.value)
                    }
                    placeholder="1.0"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-seed">随机种子</label>
                  <input
                    id="tts-eleven-seed"
                    type="number"
                    value={settings.tts.elevenLabsSeed || ''}
                    onChange={(e) =>
                      updateTtsField('elevenLabsSeed', e.target.value)
                    }
                    placeholder="可选"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-speaker-boost">
                    音色增强
                  </label>
                  <select
                    id="tts-eleven-speaker-boost"
                    value={settings.tts.elevenLabsUseSpeakerBoost || 'default'}
                    onChange={(e) =>
                      updateTtsField(
                        'elevenLabsUseSpeakerBoost',
                        e.target.value as 'default' | 'true' | 'false',
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="default">默认</option>
                    <option value="true">开启</option>
                    <option value="false">关闭</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-eleven-normalization">
                    文本规范化
                  </label>
                  <select
                    id="tts-eleven-normalization"
                    value={
                      settings.tts.elevenLabsApplyTextNormalization || 'default'
                    }
                    onChange={(e) =>
                      updateTtsField(
                        'elevenLabsApplyTextNormalization',
                        e.target.value as 'default' | 'auto' | 'on' | 'off',
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="default">默认</option>
                    <option value="auto">自动</option>
                    <option value="on">开启</option>
                    <option value="off">关闭</option>
                  </select>
                </div>
              </>
            )}

            {settings.tts.engine === 'inworld' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-apikey">API 密钥</label>
                  <input
                    id="tts-inworld-apikey"
                    type="password"
                    value={settings.tts.inworldApiKey || ''}
                    onChange={(e) =>
                      updateTtsField('inworldApiKey', e.target.value)
                    }
                    placeholder="请输入 Inworld Basic Base64 凭据"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-speaker">音色</label>
                  <select
                    id="tts-inworld-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={
                      disabled ||
                      !settings.tts.inworldApiKey ||
                      isFetchingInworldVoices ||
                      inworldVoices.length === 0
                    }
                  >
                    {!settings.tts.inworldApiKey && (
                      <option value="">请先输入 API 密钥</option>
                    )}
                    {settings.tts.inworldApiKey && isFetchingInworldVoices && (
                      <option value="">正在获取……</option>
                    )}
                    {settings.tts.inworldApiKey &&
                      !isFetchingInworldVoices &&
                      inworldVoices.length === 0 && (
                        <option value="">无法获取音色列表</option>
                      )}
                    {inworldVoices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.displayName || voice.voiceId}
                        {voice.langCode ? ` (${voice.langCode})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-url">API 地址</label>
                  <input
                    id="tts-inworld-url"
                    type="text"
                    value={settings.tts.inworldApiUrl || ''}
                    onChange={(e) =>
                      updateTtsField('inworldApiUrl', e.target.value)
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-model">模型</label>
                  <select
                    id="tts-inworld-model"
                    value={settings.tts.inworldModel || INWORLD_MODELS[0]}
                    onChange={(e) =>
                      updateTtsField('inworldModel', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {INWORLD_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-encoding">音频编码</label>
                  <select
                    id="tts-inworld-encoding"
                    value={
                      settings.tts.inworldAudioEncoding ||
                      INWORLD_AUDIO_ENCODINGS[0]
                    }
                    onChange={(e) =>
                      updateTtsField('inworldAudioEncoding', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {INWORLD_AUDIO_ENCODINGS.map((encoding) => (
                      <option key={encoding} value={encoding}>
                        {encoding}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-language">语言</label>
                  <input
                    id="tts-inworld-language"
                    type="text"
                    value={settings.tts.inworldLanguage || ''}
                    onChange={(e) =>
                      updateTtsField('inworldLanguage', e.target.value)
                    }
                    placeholder="ja-JP"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-sample-rate">采样率</label>
                  <input
                    id="tts-inworld-sample-rate"
                    type="number"
                    value={settings.tts.inworldSampleRateHertz || ''}
                    onChange={(e) =>
                      updateTtsField('inworldSampleRateHertz', e.target.value)
                    }
                    placeholder="48000"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-bitrate">比特率</label>
                  <input
                    id="tts-inworld-bitrate"
                    type="number"
                    value={settings.tts.inworldBitRate || ''}
                    onChange={(e) =>
                      updateTtsField('inworldBitRate', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-speaking-rate">
                    语速
                  </label>
                  <input
                    id="tts-inworld-speaking-rate"
                    type="number"
                    step="0.05"
                    value={settings.tts.inworldSpeakingRate || ''}
                    onChange={(e) =>
                      updateTtsField('inworldSpeakingRate', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-delivery">输出模式</label>
                  <select
                    id="tts-inworld-delivery"
                    value={settings.tts.inworldDeliveryMode || 'default'}
                    onChange={(e) =>
                      updateTtsField(
                        'inworldDeliveryMode',
                        e.target.value as
                          | 'default'
                          | 'STABLE'
                          | 'BALANCED'
                          | 'CREATIVE',
                      )
                    }
                    disabled={disabled}
                  >
                    <option value="default">默认</option>
                    {INWORLD_DELIVERY_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {INWORLD_DELIVERY_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-inworld-temperature">随机性</label>
                  <input
                    id="tts-inworld-temperature"
                    type="number"
                    step="0.05"
                    value={settings.tts.inworldTemperature || ''}
                    onChange={(e) =>
                      updateTtsField('inworldTemperature', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'gradium' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-apikey">API 密钥</label>
                  <input
                    id="tts-gradium-apikey"
                    type="password"
                    value={settings.tts.gradiumApiKey || ''}
                    onChange={(e) =>
                      updateTtsField('gradiumApiKey', e.target.value)
                    }
                    placeholder="请输入 Gradium API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-speaker">音色</label>
                  <select
                    id="tts-gradium-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {Object.entries(GRADIUM_VOICES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-url">API 地址</label>
                  <input
                    id="tts-gradium-url"
                    type="text"
                    value={settings.tts.gradiumApiUrl || ''}
                    onChange={(e) =>
                      updateTtsField('gradiumApiUrl', e.target.value)
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-output">输出格式</label>
                  <select
                    id="tts-gradium-output"
                    value={settings.tts.gradiumOutputFormat || 'wav'}
                    onChange={(e) =>
                      updateTtsField('gradiumOutputFormat', e.target.value)
                    }
                    disabled={disabled}
                  >
                    {GRADIUM_OUTPUT_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-temperature">随机性</label>
                  <input
                    id="tts-gradium-temperature"
                    type="number"
                    min="0"
                    max="1.4"
                    step="0.05"
                    value={settings.tts.gradiumTemperature || ''}
                    onChange={(e) =>
                      updateTtsField('gradiumTemperature', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-similarity">
                    音色相似度
                  </label>
                  <input
                    id="tts-gradium-similarity"
                    type="number"
                    min="1"
                    max="4"
                    step="0.05"
                    value={settings.tts.gradiumVoiceSimilarity || ''}
                    onChange={(e) =>
                      updateTtsField('gradiumVoiceSimilarity', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-padding">填充补偿</label>
                  <input
                    id="tts-gradium-padding"
                    type="number"
                    min="-2"
                    max="2"
                    step="0.05"
                    value={settings.tts.gradiumPaddingBonus || ''}
                    onChange={(e) =>
                      updateTtsField('gradiumPaddingBonus', e.target.value)
                    }
                    placeholder="默认"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-gradium-rewrite">重写规则</label>
                  <input
                    id="tts-gradium-rewrite"
                    type="text"
                    value={settings.tts.gradiumRewriteRules || ''}
                    onChange={(e) =>
                      updateTtsField('gradiumRewriteRules', e.target.value)
                    }
                    placeholder="en"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'piperPlus' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-piper-base-path">资源根路径</label>
                  <input
                    id="tts-piper-base-path"
                    type="text"
                    value={settings.tts.piperPlusBasePath || ''}
                    onChange={(e) => updatePiperPlusBasePath(e.target.value)}
                    placeholder="/piper/"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-config">模型配置文件</label>
                  <input
                    id="tts-piper-config"
                    type="text"
                    value={settings.tts.piperPlusModelConfigFile || ''}
                    onChange={(e) =>
                      updatePiperPlusModelConfigFile(e.target.value)
                    }
                    placeholder="tsukuyomi-config.json"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-model">模型文件</label>
                  <input
                    id="tts-piper-model"
                    type="text"
                    value={settings.tts.piperPlusModelFile || ''}
                    onChange={(e) => updatePiperPlusModelFile(e.target.value)}
                    placeholder="tsukuyomi-wavlm-300epoch.onnx"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-voice">HTS 音色文件</label>
                  <input
                    id="tts-piper-voice"
                    type="text"
                    value={settings.tts.piperPlusVoiceFile || ''}
                    onChange={(e) => updatePiperPlusVoiceFile(e.target.value)}
                    placeholder="mei_normal.htsvoice"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-speed">语速</label>
                  <input
                    id="tts-piper-speed"
                    type="number"
                    step="0.05"
                    value={settings.tts.piperPlusSpeed || ''}
                    onChange={(e) => updatePiperPlusSpeed(e.target.value)}
                    placeholder="1.0"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-piper-noise-scale">噪声强度</label>
                  <input
                    id="tts-piper-noise-scale"
                    type="number"
                    step="0.05"
                    value={settings.tts.piperPlusNoiseScale || ''}
                    onChange={(e) => updatePiperPlusNoiseScale(e.target.value)}
                    placeholder="0.667"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <small>
                    由于体积和第三方许可证限制，项目不包含运行时资源。请参考 README 中的 Piper Plus 安装说明，
                    在 `public/piper/` 下放置 `dist/`、`src/`、`assets/` 和 `models/`。
                  </small>
                </div>
              </>
            )}

            {settings.tts.engine === 'openaiCompatible' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-apikey">
                    API 密钥（可选）
                  </label>
                  <input
                    id="tts-openai-compatible-apikey"
                    type="password"
                    value={settings.tts.openAiCompatibleApiKey || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleApiKey(e.target.value)
                    }
                    placeholder="留空则不发送 Authorization 请求头"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-url">
                    接口地址
                  </label>
                  <input
                    id="tts-openai-compatible-url"
                    type="text"
                    value={settings.tts.openAiCompatibleApiUrl || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleApiUrl(e.target.value)
                    }
                    placeholder="http://localhost:8880/v1/audio/speech"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-model">模型</label>
                  <input
                    id="tts-openai-compatible-model"
                    type="text"
                    value={settings.tts.openAiCompatibleModel || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleModel(e.target.value)
                    }
                    placeholder="local-model"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-speaker">
                    音色（可选）
                  </label>
                  <input
                    id="tts-openai-compatible-speaker"
                    type="text"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    placeholder="留空则不发送 voice 字段"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-openai-compatible-speed">
                    语速（0.25–4.0）
                  </label>
                  <input
                    id="tts-openai-compatible-speed"
                    type="number"
                    min="0.25"
                    max="4"
                    step="0.05"
                    value={settings.tts.openAiCompatibleSpeed || ''}
                    onChange={(e) =>
                      updateOpenAiCompatibleSpeed(e.target.value)
                    }
                    placeholder="1.0"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'voicevox' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-voicevox-speaker">音色</label>
                  <select
                    id="tts-voicevox-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {voicevoxSpeakers.length > 0 ? (
                      voicevoxSpeakers.flatMap((sp) =>
                        (sp.styles || []).map((style) => (
                          <option
                            key={`${sp.speaker_uuid}-${style.id}`}
                            value={String(style.id)}
                          >
                            {sp.name} - {style.name}
                          </option>
                        )),
                      )
                    ) : (
                      <option value="">正在从服务器获取……</option>
                    )}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-voicevox-url">API 地址</label>
                  <input
                    id="tts-voicevox-url"
                    type="text"
                    value={settings.tts.voicevoxApiUrl || ''}
                    onChange={(e) => updateVoicevoxApiUrl(e.target.value)}
                    placeholder="http://localhost:50021"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'voicepeak' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-voicepeak-speaker">音色</label>
                  <select
                    id="tts-voicepeak-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {VOICEPEAK_SPEAKERS.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-voicepeak-url">API 地址</label>
                  <input
                    id="tts-voicepeak-url"
                    type="text"
                    value={settings.tts.voicepeakApiUrl || ''}
                    onChange={(e) => updateVoicepeakApiUrl(e.target.value)}
                    placeholder="http://localhost:20202"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'aivisSpeech' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-aivis-speaker">音色</label>
                  <select
                    id="tts-aivis-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {aivisSpeakers.length > 0 ? (
                      aivisSpeakers.flatMap((sp) =>
                        (sp.styles || []).map((style) => (
                          <option
                            key={`${sp.speaker_uuid}-${style.id}`}
                            value={String(style.id)}
                          >
                            {sp.name} - {style.name}
                          </option>
                        )),
                      )
                    ) : (
                      <option value="">正在从服务器获取……</option>
                    )}
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-aivis-url">API 地址</label>
                  <input
                    id="tts-aivis-url"
                    type="text"
                    value={settings.tts.aivisSpeechApiUrl || ''}
                    onChange={(e) => updateAivisSpeechApiUrl(e.target.value)}
                    placeholder="http://localhost:10101"
                    disabled={disabled}
                  />
                </div>
              </>
            )}

            {settings.tts.engine === 'minimax' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-minimax-apikey">API 密钥</label>
                  <input
                    id="tts-minimax-apikey"
                    type="password"
                    value={settings.tts.minimaxApiKey || ''}
                    onChange={(e) => updateMinimaxApiKey(e.target.value)}
                    placeholder="请输入 MiniMax API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-minimax-groupid">
                    Group ID（可留空）
                  </label>
                  <input
                    id="tts-minimax-groupid"
                    type="text"
                    value={settings.tts.minimaxGroupId || ''}
                    onChange={(e) => updateMinimaxGroupId(e.target.value)}
                    placeholder="当前 MiniMax HTTP TTS 不需要填写"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-minimax-speaker">
                    MiniMax 音色（凌岚女王）
                  </label>
                  <select
                    id="tts-minimax-speaker"
                    value={settings.tts.speaker}
                    onChange={(e) => updateTTSSpeaker(e.target.value)}
                    disabled={disabled}
                  >
                    {LINGLAN_PROFILE.voice.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label} — {preset.id}
                      </option>
                    ))}
                    {!settings.tts.minimaxApiKey && (
                      <option value="">
                        输入 API 密钥后获取音色列表
                      </option>
                    )}
                    {settings.tts.minimaxApiKey && isFetchingMinimaxVoices && (
                      <option value="">正在获取音色列表……</option>
                    )}
                    {settings.tts.minimaxApiKey &&
                      !isFetchingMinimaxVoices &&
                      minimaxVoices.length === 0 && (
                        <option value="">无法获取音色列表</option>
                      )}
                    {minimaxVoices
                      .filter(
                        (voice) => !MINIMAX_QUEEN_VOICE_IDS.has(voice.voice_id),
                      )
                      .map((voice) => (
                        <option key={voice.voice_id} value={voice.voice_id}>
                          {voice.voice_name}
                        </option>
                      ))}
                  </select>
                </div>
              </>
            )}

            {settings.tts.engine === 'aivisCloud' && (
              <>
                <div className="settings-field">
                  <label htmlFor="tts-aiviscloud-apikey">API 密钥</label>
                  <input
                    id="tts-aiviscloud-apikey"
                    type="password"
                    value={settings.tts.aivisCloudApiKey || ''}
                    onChange={(e) => updateAivisCloudApiKey(e.target.value)}
                    placeholder="请输入 Aivis Cloud API 密钥"
                    disabled={disabled}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="tts-aiviscloud-preset">音色</label>
                  <select
                    id="tts-aiviscloud-preset"
                    value={selectedAivisCloudPresetId}
                    onChange={(e) =>
                      handleAivisCloudPresetChange(e.target.value)
                    }
                    disabled={disabled}
                  >
                    {AIVIS_CLOUD_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {fetchError &&
              (settings.tts.engine === 'voicevox' ||
                settings.tts.engine === 'aivisSpeech' ||
                settings.tts.engine === 'minimax') && (
                <div
                  style={{
                    color: '#e94560',
                    fontSize: '0.75rem',
                    marginTop: 4,
                  }}
                >
                  {fetchError}
                </div>
              )}
          </>
        )}
      </div>

      <div className="settings-section">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSection('visual')}
          aria-expanded={expandedSections.visual}
        >
          <h3>画面与形象</h3>
          <span
            className={`settings-section-chevron${expandedSections.visual ? ' is-open' : ''}`}
          >
            ⌄
          </span>
        </button>

        {expandedSections.visual && (
          <>
            <div className="settings-field">
              <label htmlFor="visual-background-mode">背景模式</label>
              <select
                id="visual-background-mode"
                value={settings.visual.backgroundMode}
                onChange={(e) =>
                  updateVisualBackgroundMode(
                    e.target.value as 'default' | 'green',
                  )
                }
                disabled={disabled}
              >
                <option value="default">普通背景</option>
                <option value="green">绿幕背景</option>
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="visual-layout-mode">布局模式</label>
              <select
                id="visual-layout-mode"
                value={settings.visual.layoutMode}
                onChange={(e) =>
                  updateVisualLayoutMode(e.target.value as 'chat' | 'broadcast')
                }
                disabled={disabled}
              >
                <option value="chat">对话布局</option>
                <option value="broadcast">单人直播布局</option>
              </select>
            </div>

            <label className="settings-checkbox-field">
              <input
                type="checkbox"
                checked={settings.visual.showInputInBroadcast}
                onChange={(e) =>
                  updateVisualShowInputInBroadcast(e.target.checked)
                }
                disabled={
                  disabled || settings.visual.layoutMode !== 'broadcast'
                }
              />
              <span>单人直播时显示输入框</span>
            </label>

            <label className="settings-checkbox-field">
              <input
                type="checkbox"
                checked={settings.visual.idleMotionEnabled}
                onChange={(e) =>
                  updateVisualIdleMotionEnabled(e.target.checked)
                }
                disabled={disabled}
              />
              <span>待机动作</span>
            </label>
            <p className="settings-field-hint">
              此设置的优先级高于形象包内的 idleMotionEnabled 配置。
            </p>

            <button
              type="button"
              className="settings-clear-button settings-inline-button"
              onClick={resetVisualAvatarView}
              disabled={disabled || !avatarPackage}
            >
              重置形象位置
            </button>
            <p className="settings-field-hint">
              将拖动位置和滚轮缩放比例恢复为初始值。
            </p>

            <div className="settings-field">
              <label htmlFor="background-image">背景图片</label>
              <div className="settings-file-picker-row">
                <input
                  id="background-image"
                  className="settings-file-input-hidden"
                  type="file"
                  accept="image/*"
                  disabled={disabled}
                  onChange={(e) => {
                    onBackgroundImageChange(e.target.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
                <label
                  htmlFor="background-image"
                  className={`settings-file-trigger${disabled ? ' is-disabled' : ''}`}
                >
                  选择图片
                </label>
                <span className="settings-file-hint">PNG / JPG</span>
              </div>
              <div className="settings-file-actions">
                <span className="settings-file-status">
                  {backgroundImageUrl ? '已设置' : '未设置'}
                </span>
                {backgroundImageUrl && (
                  <button
                    type="button"
                    className="settings-clear-button"
                    onClick={() => onBackgroundImageChange(null)}
                    disabled={disabled}
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="purupuru-avatar">形象包</label>
              <div className="settings-file-picker-row">
                <input
                  id="purupuru-avatar"
                  className="settings-file-input-hidden"
                  type="file"
                  accept=".purupuru,application/zip"
                  disabled={disabled}
                  onChange={(e) => {
                    void onAvatarPackageChange(e.target.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
                <label
                  htmlFor="purupuru-avatar"
                  className={`settings-file-trigger${disabled ? ' is-disabled' : ''}`}
                >
                  选择 .purupuru 文件
                </label>
                <span className="settings-file-hint">ZIP 存储格式</span>
              </div>
              <div className="settings-file-actions">
                <span className="settings-file-status">
                  {avatarPackageSource === 'default'
                    ? '凌岚女王（默认）已加载'
                    : avatarPackage
                      ? `${avatarPackage.name} 已加载`
                      : '尚未加载形象'}
                </span>
                {avatarPackageSource === 'user' && (
                  <button
                    type="button"
                    className="settings-clear-button"
                    onClick={() => onAvatarPackageChange(null)}
                    disabled={disabled}
                  >
                    清除
                  </button>
                )}
              </div>
              {avatarPackage?.thumbnailUrl && (
                <img
                  className="settings-avatar-thumbnail"
                  src={avatarPackage.thumbnailUrl}
                  alt={`${avatarPackage.name} 缩略图`}
                />
              )}
              {avatarLoadError && (
                <p className="settings-inline-error">{avatarLoadError}</p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>画面视觉</h3>
        <ScreenVisionPanel
          disabled={disabled}
          settings={settings.screenVision}
          controller={screenVisionController}
          onDeviceIdChange={updateScreenVisionDeviceId}
          onPromptChange={updateScreenVisionPrompt}
          onAutoIntervalMsChange={updateScreenVisionAutoIntervalMs}
        />
      </div>

      <StreamSettings
        stream={settings.stream}
        commentIntelligence={settings.commentIntelligence}
        manneri={settings.manneri}
        disabled={disabled}
        isExpanded={expandedSections.stream}
        isCommentIntelligenceExpanded={expandedSections.commentIntelligence}
        isManneriExpanded={expandedSections.manneri}
        onToggleExpand={() => toggleSection('stream')}
        onToggleCommentIntelligence={() => toggleSection('commentIntelligence')}
        onToggleManneri={() => toggleSection('manneri')}
        streamErrorMessage={streamErrorMessage}
        updateStreamPlatform={updateStreamPlatform}
        updateYoutubeApiKey={updateYoutubeApiKey}
        updateYoutubeLiveId={updateYoutubeLiveId}
        updateYoutubeEnabled={updateYoutubeEnabled}
        updateYoutubeCommentIntervalMs={updateYoutubeCommentIntervalMs}
        updateTwitchClientId={updateTwitchClientId}
        updateTwitchAccessToken={updateTwitchAccessToken}
        updateTwitchChannel={updateTwitchChannel}
        updateTwitchEnabled={updateTwitchEnabled}
        updateTwitchCommentIntervalMs={updateTwitchCommentIntervalMs}
        updateBilibiliEnabled={updateBilibiliEnabled}
        updateCustomSseEndpoint={updateCustomSseEndpoint}
        updateCustomSseEnabled={updateCustomSseEnabled}
        updateCommentIntelligenceEnabled={updateCommentIntelligenceEnabled}
        updateCommentIntelligenceMode={updateCommentIntelligenceMode}
        updateCommentIntelligenceStreamTopic={
          updateCommentIntelligenceStreamTopic
        }
        updateCommentIntelligenceStreamTitle={
          updateCommentIntelligenceStreamTitle
        }
        updateCommentIntelligenceTopicFilter={
          updateCommentIntelligenceTopicFilter
        }
        updateCommentIntelligenceAnalysisIntervalMs={
          updateCommentIntelligenceAnalysisIntervalMs
        }
        updateCommentIntelligenceMaxCommentsPerBatch={
          updateCommentIntelligenceMaxCommentsPerBatch
        }
        updateCommentIntelligenceMinCommentsForLLMAnalysis={
          updateCommentIntelligenceMinCommentsForLLMAnalysis
        }
        updateCommentIntelligenceBlockHighRiskViewers={
          updateCommentIntelligenceBlockHighRiskViewers
        }
        updateCommentIntelligenceViewerBlockDurationMs={
          updateCommentIntelligenceViewerBlockDurationMs
        }
        updateManneriEnabled={updateManneriEnabled}
        updateManneriSimilarityThreshold={updateManneriSimilarityThreshold}
        updateManneriLookbackWindow={updateManneriLookbackWindow}
        updateManneriInterventionCooldownMs={
          updateManneriInterventionCooldownMs
        }
        updateManneriMinMessageLength={updateManneriMinMessageLength}
      />
      <MemoryCenter memory={memory} />
    </div>
  );
}
