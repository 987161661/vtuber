import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { ControlRoom } from './components/ControlRoom';
import { SettingsPanel } from './components/SettingsPanel';
import type { StressRunState } from './components/StressTestPanel';
import {
  LINGLAN_PROFILE,
  createRuntimeCharacterProfile,
} from './config/characterProfile';
import { useAituberCore } from './hooks/useAituberCore';
import { useAudioLipsync } from './hooks/useAudioLipsync';
import { useHostExtensions } from './hooks/useHostExtensions';
import { useInteractionFeed } from './hooks/useInteractionFeed';
import { useInterval } from './hooks/useInterval';
import { useLiveCommentIntelligence } from './hooks/useLiveCommentIntelligence';
import { useLiveDirector } from './hooks/useLiveDirector';
import { useLiveHostCoordinator } from './hooks/useLiveHostCoordinator';
import { useLivePlatformEvents } from './hooks/useLivePlatformEvents';
import { useRuntimeOwnerLease } from './hooks/useRuntimeOwnerLease';
import { useScreenVisionController } from './hooks/useScreenVisionController';
import { useSettings } from './hooks/useSettings';
import { useSocialStreamBus } from './hooks/useSocialStreamBus';
import { useStreamerMemory } from './hooks/useStreamerMemory';
import { useTwitchComments } from './hooks/useTwitchComments';
import { useYoutubeComments } from './hooks/useYoutubeComments';
import { digitalHumanAvatarStore } from './lib/digitalHumanAvatarStore';
import {
  EmptyRoomAwarenessPlanner,
  isQuietRoomInteraction,
} from './lib/emptyRoomAwareness';
import { parseFlashHeadBundle } from './lib/flashheadBundle';
import { routeTyphoonSkillWithAgent } from './lib/skillRoutingAgent';
import { previewMinimaxVoice } from './lib/minimaxVoicePreview';
import type { PuruPuruAvatarPackage } from './lib/purupuruPackage';
import { loadPuruPuruPackage } from './lib/purupuruPackage';
import type {
  PuruPuruReaction,
  PuruPuruReactionDraft,
  ScreenplayLike,
} from './lib/purupuruReactions';
import {
  createPuruPuruReactionFromScreenplay,
  withReactionId,
} from './lib/purupuruReactions';
import {
  getHostBridgeMessageKind,
  hostBridgeType,
  isLegacyHostBridgeMessage,
} from './services/host-bridge/protocol';
import {
  createOrdinaryRoadEventAdapter,
  fetchOrdinaryRoadStatus,
  sendOrdinaryRoadReply,
} from './services/live-platform/ordinaryRoad';
import { createCustomSseEventAdapter } from './services/live-platform/customSse';
import {
  platformOwner,
  resolveSpeechDeliveryTargets,
  type SpeechDeliveryKind,
} from './services/live-platform/connectors';
import type {
  LiveRoomEvent,
  LiveRoomStatus,
} from './services/live-platform/types';
import type { TwitchChatMessage } from './services/twitch/twitchService';
import type { YouTubeChatMessage } from './services/youtube/youtubeService';
import './styles/app.css';
import type { AvatarMotion } from './lib/avatarMotion';
import { normalizeAvatarMotion } from './lib/avatarMotion';
import {
  type RecentLiveTurn,
  buildLiveResponseContract,
  buildLiveRoomTranscript,
  mergeRecentLiveTurns,
} from './lib/liveConversationContext';
import type { LiveLifecycleTransition } from './lib/liveResponseScheduler';
import {
  isStaleReadyReply,
  type OperatorQueueItem,
  updateOperatorQueue,
} from './lib/operatorQueue';
import { STRESS_TEST_PLAN } from './lib/stressTestPlan';
import {
  AvatarBehaviorBus,
  createAvatarBehaviorEvent,
  type AvatarAction,
} from '@aituber-onair/live-companion';

type AvatarPackageSource = 'default' | 'user';
const EMPTY_STRESS_RUN: StressRunState = {
  status: 'idle',
  completedSteps: 0,
  totalSteps: STRESS_TEST_PLAN.messageCount,
  viewers: [],
  queue: { waiting: 0, drafting: 0, ready: 0, speaking: 0 },
  failures: [],
};
type StressApiRecord = Record<string, unknown>;

function scopedViewerId(
  viewerId?: string,
  platform?: string,
): string | undefined {
  if (!viewerId) return undefined;
  return `${platform?.trim() || 'unknown'}:${viewerId}`;
}

function parseStressDiagnostics(value: unknown): StressRunState['diagnostics'] {
  if (!value || typeof value !== 'object') return undefined;
  const checks = (value as StressApiRecord).checks;
  if (!Array.isArray(checks)) return undefined;
  return checks.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const check = raw as StressApiRecord;
    const level = check.level;
    if (level !== 'pass' && level !== 'warning' && level !== 'error') return [];
    return [
      {
        id: typeof check.id === 'string' ? check.id : `diagnostic-${index}`,
        level,
        code:
          typeof check.code === 'string' ? check.code : 'unknown_diagnostic',
        summary:
          typeof check.summary === 'string'
            ? check.summary
            : 'No diagnostic summary.',
        detail: typeof check.detail === 'string' ? check.detail : undefined,
      },
    ];
  });
}

type RenderedSpeakingMedia = {
  videoUrl: string;
  audioBuffer: ArrayBuffer;
  durationSeconds: number;
};
type SpeechRenderTrace = {
  requestId: string;
  source: 'chat' | 'live' | 'vision';
  text: string;
};
type ConversationOrigin = {
  channel: string;
  label: string;
  viewerId?: string;
  viewerName?: string;
  sourcesSeen?: string[];
};
type ActiveLifecycle = ConversationOrigin & {
  eventId: string;
  replyText?: string;
  deliveredConnectorTargets?: Set<string>;
  ttsStartAt?: number;
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
};
type ReplyLatencyTrace = {
  requestId: string;
  source: 'chat' | 'live' | 'vision';
  inputAt: number;
  models: {
    llm: { provider: string; model: string };
    tts: { engine: string; model: string; speaker: string };
    lipSync: {
      engine: string;
      model: string;
      mode: 'streaming' | 'full-audio';
    };
  };
  input?: string;
  reply?: string;
  eventId?: string;
  origin?: {
    channel: string;
    requestId?: string;
    viewerId?: string;
    viewerName?: string;
    commentAt?: number;
    receivedAt?: number;
    sourcesSeen?: string[];
  };
  llmCompletedAt?: number;
  ttsFirstByteAt?: number;
  flashHeadFirstFrameAt?: number;
  firstPlaybackAt?: number;
  speechEndSignaledAt?: number;
};

const INTERACTION_STAGES = new Set<LiveLifecycleTransition['stage']>([
  'received',
  'deduplicated',
  'queued',
  'selected',
  'generated',
  'speaking',
  'done',
  'dropped',
]);

function toInteractionTransition(
  event: Record<string, unknown>,
): LiveLifecycleTransition | null {
  const eventId = typeof event.eventId === 'string' ? event.eventId : '';
  const rawStage = typeof event.stage === 'string' ? event.stage : '';
  const stage =
    rawStage === 'generating'
      ? 'selected'
      : rawStage === 'failed'
        ? 'dropped'
        : INTERACTION_STAGES.has(rawStage as LiveLifecycleTransition['stage'])
          ? (rawStage as LiveLifecycleTransition['stage'])
          : null;
  if (!eventId || !stage) return null;

  const at = typeof event.at === 'number' ? event.at : Date.now();
  return {
    eventId,
    stage,
    at,
    commentAt: typeof event.commentAt === 'number' ? event.commentAt : at,
    receivedAt: typeof event.receivedAt === 'number' ? event.receivedAt : at,
    queuedAt: typeof event.queuedAt === 'number' ? event.queuedAt : undefined,
    selectedAt:
      typeof event.selectedAt === 'number' ? event.selectedAt : undefined,
    dropReason:
      typeof event.dropReason === 'string'
        ? (event.dropReason as LiveLifecycleTransition['dropReason'])
        : undefined,
    fingerprint: eventId,
    text: typeof event.text === 'string' ? event.text : '',
    viewerId: typeof event.viewerId === 'string' ? event.viewerId : undefined,
    viewerName:
      typeof event.viewerName === 'string' ? event.viewerName : undefined,
    sourcesSeen: (() => {
      const sources = Array.isArray(event.sourcesSeen)
        ? event.sourcesSeen.filter(
            (source): source is string => typeof source === 'string',
          )
        : [];
      if (sources.length) return sources;
      if (typeof event.source === 'string' && event.source.trim()) {
        return [event.source];
      }
      return typeof event.sourceLabel === 'string' ? [event.sourceLabel] : [];
    })(),
    queueDepth: typeof event.queueDepth === 'number' ? event.queueDepth : 0,
    oldestQueueAgeMs:
      typeof event.oldestQueueAgeMs === 'number' ? event.oldestQueueAgeMs : 0,
  };
}

// FlashHead renders faster than real time after warm-up, but its very first
// slice is only 0.96 s. Starting immediately makes the queue run dry while the
// second slice is still being rendered. Buffer roughly two slices before play.
const FLASHHEAD_START_BUFFER_SECONDS = 2.5;
// A slow or never-ending upstream stream must not keep a ready first slice
// silent. This is a latency cap, not the normal buffering target.
const FLASHHEAD_MAX_START_WAIT_MS = 1_600;

// Speech always outranks an optional avatar render. If the local renderer is
// offline or cold, fall back to the idle avatar quickly and play the verified
// TTS audio instead of turning a short render delay into a silent reply.
const SPEAKING_RENDER_TIMEOUT_MS = 1_600;
// This is a *no-progress* watchdog, not a whole-reply deadline.  A real
// MiniMax reply may contain several separately synthesized sentences, so a
// fixed timer armed only at screenplay start used to kill valid playback after
// its first completed beat.
// A fact-complete Chinese weather answer can exceed 120 seconds of natural
// playback.  This is a no-progress watchdog, not a response-length limit.
const OPERATOR_SPEECH_WATCHDOG_MS = 240_000;
const OPERATOR_TTS_START_TIMEOUT_MS = 30_000;
const OPERATOR_GENERATION_RECOVERY_MS = 35_000;
const NO_REPLY_TOKEN = '[[NO_REPLY]]';
async function getAudioPlaybackTimeoutMs(arrayBuffer: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([arrayBuffer.slice(0)]));
  try {
    const duration = await new Promise<number>((resolve) => {
      const audio = new Audio();
      const timeout = window.setTimeout(() => resolve(Number.NaN), 3_000);
      const finish = (value: number) => {
        window.clearTimeout(timeout);
        audio.removeAttribute('src');
        resolve(value);
      };
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(Number.NaN);
      audio.src = url;
    });
    return Number.isFinite(duration)
      ? Math.ceil((duration + 2) * 1_000)
      : 30_000;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function App() {
  const query = new URLSearchParams(window.location.search);
  const hostCoordinatorV2Enabled = query.get('hostCoordinatorV2') !== '0';
  const speechPlanV2Enabled = query.get('speechPlanV2') !== '0';
  // Affine reactions are useful for renderer diagnostics, but they are not a
  // production motion system. Production only exposes renderer-backed output.
  const debugAffineAvatarMotion = query.get('debugAffineAvatarMotion') === '1';
  const { dispatch: dispatchLiveHostEvent, snapshot: liveHostSnapshot } =
    useLiveHostCoordinator(hostCoordinatorV2Enabled);
  const isObsOverlay = query.get('overlay') === '1';
  const [isTemporaryStressOwner, setIsTemporaryStressOwner] = useState(false);
  const isLiveRuntimeCandidate =
    isObsOverlay || query.get('listener') === '1' || isTemporaryStressOwner;
  const isLiveRuntimeOwner = useRuntimeOwnerLease(isLiveRuntimeCandidate);
  // FlashHead is the production audio-driven avatar renderer. Set
  // ?avatar=purupuru to disable rendered speaking video for troubleshooting.
  const useSpeakingAvatar = query.get('avatar') !== 'purupuru';
  const speakingAvatarEngine =
    query.get('speakEngine') === 'musetalk' ? 'musetalk' : 'flashhead';
  // FlashHead consumes the TTS byte stream incrementally. The explicit
  // `chunked=0` escape hatch keeps full-sentence rendering available for
  // troubleshooting or A/B comparison.
  const useStreamingLipSync = query.get('chunked') !== '0';
  const captureTts = query.get('captureTts') === '1';
  const {
    play,
    beginQueue,
    enqueue,
    finishQueue,
    unlock,
    stop,
    mouthLevel,
    isSpeaking,
    smoothedValue,
  } = useAudioLipsync();
  const settingsHook = useSettings(isObsOverlay ? 'consumer' : 'producer');
  const {
    items: interactionEvents,
    record: recordInteraction,
    restore: restoreInteractionFeed,
    summary: interactionSummary,
  } = useInteractionFeed();
  const [operatorQueue, setOperatorQueue] = useState<OperatorQueueItem[]>([]);
  const [stressRun, setStressRun] = useState<StressRunState>(EMPTY_STRESS_RUN);
  const recentLiveTurnsRef = useRef<RecentLiveTurn[]>([]);
  const preparingOperatorTaskRef = useRef<string | null>(null);
  const speakingOperatorTaskRef = useRef<string | null>(null);
  const runtimeOwnerIdRef = useRef(`runtime-${crypto.randomUUID()}`);
  const operatorPlaybackObservedRef = useRef(false);
  const operatorSpeechWatchdogRef = useRef<number | null>(null);
  const speechBeatBytesRef = useRef(0);
  const operatorBeatCountRef = useRef(0);
  const operatorCompletedBeatCountRef = useRef(0);
  const operatorAudioByteLengthRef = useRef(0);
  const activeDigitalHuman = useMemo(
    () =>
      settingsHook.settings.digitalHumans.profiles.find(
        (profile) =>
          profile.id === settingsHook.settings.digitalHumans.activeId,
      ) || settingsHook.settings.digitalHumans.profiles[0],
    [settingsHook.settings.digitalHumans],
  );
  const runtimeProfile = useMemo(
    () =>
      activeDigitalHuman
        ? createRuntimeCharacterProfile(activeDigitalHuman)
        : LINGLAN_PROFILE,
    [activeDigitalHuman],
  );
  const replyModelTrace = useMemo<ReplyLatencyTrace['models']>(
    () => ({
      llm: {
        provider: settingsHook.settings.llm.provider,
        model: settingsHook.settings.llm.model,
      },
      tts: {
        engine: settingsHook.settings.tts.engine,
        model:
          settingsHook.settings.tts.engine === 'minimax'
            ? runtimeProfile.voice.model
            : 'configured-by-engine',
        speaker: settingsHook.settings.tts.speaker,
      },
      lipSync: {
        engine: speakingAvatarEngine,
        model:
          speakingAvatarEngine === 'flashhead'
            ? 'SoulX-FlashHead Lite'
            : 'MuseTalk',
        mode: useStreamingLipSync ? 'streaming' : 'full-audio',
      },
    }),
    [
      settingsHook.settings.llm.model,
      settingsHook.settings.llm.provider,
      settingsHook.settings.tts.engine,
      settingsHook.settings.tts.speaker,
      runtimeProfile.voice.model,
      speakingAvatarEngine,
      useStreamingLipSync,
    ],
  );
  const streamerMemory = useStreamerMemory(
    settingsHook.settings,
    false,
    runtimeProfile,
  );
  const canUseLiveRadarVision = useMemo(() => {
    const provider = settingsHook.settings.llm.provider;
    const model = settingsHook.settings.llm.model.toLowerCase();
    if (provider !== 'openai-compatible') return true;
    return /vision|vl|gpt-4o|gemini|claude/.test(model);
  }, [settingsHook.settings.llm.model, settingsHook.settings.llm.provider]);
  const hostExtensions = useHostExtensions({
    installedSkillIds: activeDigitalHuman?.installedSkillIds,
    canUseVision: canUseLiveRadarVision,
  });
  const updateTwitchAccessToken = settingsHook.updateTwitchAccessToken;
  const updateDigitalHuman = settingsHook.updateDigitalHuman;
  const handlePreviewDigitalHumanVoice = useCallback(
    (voiceId: string) =>
      previewMinimaxVoice(
        settingsHook.settings.tts.minimaxApiKey || '',
        voiceId,
      ),
    [settingsHook.settings.tts.minimaxApiKey],
  );
  const [settingsOpen, setSettingsOpen] = useState(
    query.get('settings') === '1',
  );
  const [autoBroadcastEnabled, setAutoBroadcastEnabled] = useState(true);
  const [streamErrorMessage, setStreamErrorMessage] = useState('');
  const [ordinaryRoadStatus, setOrdinaryRoadStatus] = useState<LiveRoomStatus>({
    state: 'disabled',
  });
  const socialStreamSendRef = useRef<
    (
      platformId: string,
      reply: { message: string; idempotencyKey: string },
    ) => Promise<unknown>
  >(async () => {
    throw new Error('social_stream_control_not_connected');
  });
  const ordinaryRoadEventAdapter = useMemo(
    () =>
      createOrdinaryRoadEventAdapter(
        settingsHook.settings.liveConnectors.ordinaryRoad.gatewayUrl,
      ),
    [settingsHook.settings.liveConnectors.ordinaryRoad.gatewayUrl],
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(
    null,
  );
  const backgroundObjectUrlRef = useRef<string | null>(null);
  const [avatarPackage, setAvatarPackage] =
    useState<PuruPuruAvatarPackage | null>(null);
  const [avatarPackageSource, setAvatarPackageSource] =
    useState<AvatarPackageSource | null>(null);
  const [activeProfileAvatarId, setActiveProfileAvatarId] = useState<
    string | null
  >(null);
  const [avatarLoadError, setAvatarLoadError] = useState<string | null>(null);
  const avatarPackageRef = useRef<PuruPuruAvatarPackage | null>(null);
  const avatarLoadRequestRef = useRef(0);
  const avatarReactionIdRef = useRef(0);
  const unsupportedAvatarActionCountRef = useRef(0);
  const [unsupportedAvatarActionCount, setUnsupportedAvatarActionCount] =
    useState(0);
  const avatarBehaviorBusRef = useRef<AvatarBehaviorBus | null>(null);
  const lastAvatarBehaviorBeatRef = useRef('');
  if (!avatarBehaviorBusRef.current) {
    const bus = new AvatarBehaviorBus();
    bus.register({
      id: 'flashhead-personalive-production',
      // Lip-sync and real layer switching are driven by their existing audio
      // adapters. There is no renderer-backed motion/gesture capability yet.
      capabilities: { actionKinds: [], emotionNames: '*' },
      async dispatch() {},
    });
    avatarBehaviorBusRef.current = bus;
  }
  const handledExternalRequestIdsRef = useRef<Set<string>>(new Set());
  const speechReactionRef = useRef<PuruPuruReactionDraft | null>(null);
  const proactiveSpeechRef = useRef(false);
  const proactiveEventIdRef = useRef<string | null>(null);
  const emptyRoomAwarenessPlannerRef = useRef<EmptyRoomAwarenessPlanner | null>(
    null,
  );
  if (!emptyRoomAwarenessPlannerRef.current) {
    emptyRoomAwarenessPlannerRef.current = new EmptyRoomAwarenessPlanner();
  }
  const activeLifecycleRef = useRef<ActiveLifecycle | null>(null);
  const speechRenderTraceRef = useRef<SpeechRenderTrace | null>(null);
  const replyLatencyRef = useRef<ReplyLatencyTrace | null>(null);
  const [avatarReaction, setAvatarReaction] = useState<PuruPuruReaction | null>(
    null,
  );
  const [avatarMotion, setAvatarMotion] = useState<AvatarMotion>('idle_cold');
  const [speakingAvatarVideoUrl, setSpeakingAvatarVideoUrl] = useState<
    string | null
  >(null);
  const usePersonaLiveAvatar = activeProfileAvatarId !== runtimeProfile.id;

  const emitRuntimeEvent = useCallback(
    (event: Record<string, unknown>) => {
      const transition = toInteractionTransition(event);
      if (transition) recordInteraction(transition);

      void fetch('/api/live-runtime-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => undefined);
    },
    [recordInteraction],
  );

  // The radar page sends chat to the overlay iframe, while the full control
  // room is a separate browser instance. Mirror the authoritative runtime
  // event stream so the control room sees the same queue and outcomes.
  useEffect(() => {
    if (isObsOverlay) return;
    let cancelled = false;
    const syncInteractionFeed = async () => {
      try {
        const response = await fetch('/api/live-runtime-events?history=1', {
          cache: 'no-store',
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          events?: Record<string, unknown>[];
        };
        const transitions = Array.isArray(payload.events)
          ? payload.events
              .slice(-200)
              .map(toInteractionTransition)
              .filter(
                (event): event is LiveLifecycleTransition => event !== null,
              )
          : [];
        if (!cancelled && transitions.length) {
          restoreInteractionFeed(transitions);
        }
      } catch {
        // The feed stays usable even while the local Vite runtime restarts.
      }
    };
    void syncInteractionFeed();
    const timer = window.setInterval(() => void syncInteractionFeed(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isObsOverlay, restoreInteractionFeed]);

  const beginConversationLifecycle = useCallback(
    (origin: ConversationOrigin, eventId: string = crypto.randomUUID()) => {
      const at = Date.now();
      const lifecycle: ActiveLifecycle = { ...origin, eventId };
      activeLifecycleRef.current = lifecycle;
      const eventBase = {
        eventId,
        at,
        source: origin.channel,
        sourceLabel: origin.label,
        viewerId: origin.viewerId,
        viewerName: origin.viewerName,
        sourcesSeen: origin.sourcesSeen,
      };
      emitRuntimeEvent({ ...eventBase, stage: 'received' });
      emitRuntimeEvent({ ...eventBase, stage: 'queued', queuedAt: at });
      emitRuntimeEvent({ ...eventBase, stage: 'generating' });
      return lifecycle;
    },
    [emitRuntimeEvent],
  );

  const finalizeReplyLatency = useCallback(() => {
    const replyTrace = replyLatencyRef.current;
    if (!replyTrace) return;
    const endedAt = Date.now();
    void fetch('/api/reply-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...replyTrace,
        endedAt,
        inputToLlmMs: replyTrace.llmCompletedAt
          ? replyTrace.llmCompletedAt - replyTrace.inputAt
          : null,
        inputToTtsFirstByteMs: replyTrace.ttsFirstByteAt
          ? replyTrace.ttsFirstByteAt - replyTrace.inputAt
          : null,
        inputToFlashHeadFirstFrameMs: replyTrace.flashHeadFirstFrameAt
          ? replyTrace.flashHeadFirstFrameAt - replyTrace.inputAt
          : null,
        inputToFirstPlaybackMs: replyTrace.firstPlaybackAt
          ? replyTrace.firstPlaybackAt - replyTrace.inputAt
          : null,
        inputToEndMs: endedAt - replyTrace.inputAt,
      }),
    }).catch(() => undefined);
    replyLatencyRef.current = null;
  }, []);

  const emitAvatarReaction = useCallback((draft: PuruPuruReactionDraft) => {
    avatarReactionIdRef.current += 1;
    setAvatarReaction(withReactionId(draft, avatarReactionIdRef.current));
  }, []);

  const resetAvatarReaction = useCallback(() => {
    speechReactionRef.current = null;
    setAvatarReaction(null);
  }, []);

  const renderSpeakingVideo = useCallback(
    async (
      arrayBuffer: ArrayBuffer,
      options: { reset?: boolean; end?: boolean; sequence?: number } = {},
    ): Promise<RenderedSpeakingMedia | null> => {
      if (!useSpeakingAvatar) return null;
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        SPEAKING_RENDER_TIMEOUT_MS,
      );
      try {
        const parameters = new URLSearchParams();
        if (options.reset) parameters.set('reset', 'true');
        if (options.end) parameters.set('end', 'true');
        const trace = speechRenderTraceRef.current;
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'X-Avatar-Caller': 'react-purupuru-app',
          'X-Avatar-Sequence': String(options.sequence ?? 0),
        };
        if (trace) {
          headers['X-Avatar-Request-Id'] = trace.requestId;
          headers['X-Avatar-Source'] = trace.source;
          if (options.reset) {
            headers['X-Avatar-Text'] = encodeURIComponent(
              trace.text.slice(0, 1_000),
            );
          }
        }
        const response = await fetch(
          `/api/${speakingAvatarEngine}/render?${parameters.toString()}`,
          {
            method: 'POST',
            headers,
            body: arrayBuffer.slice(0),
            signal: controller.signal,
          },
        );
        if (response.status === 204) return null;
        if (!response.ok) {
          throw new Error(
            `${speakingAvatarEngine} returned ${response.status}`,
          );
        }
        const payload = new Uint8Array(await response.arrayBuffer());
        const { audioBuffer, videoBuffer } = parseFlashHeadBundle(payload);
        const frameCount = Number(response.headers.get('X-FlashHead-Frames'));
        const replyLatency = replyLatencyRef.current;
        if (
          replyLatency &&
          !replyLatency.flashHeadFirstFrameAt &&
          Number.isFinite(frameCount) &&
          frameCount > 0
        ) {
          replyLatency.flashHeadFirstFrameAt = Date.now();
        }
        return {
          audioBuffer,
          videoUrl: URL.createObjectURL(
            new Blob([videoBuffer], { type: 'video/webm' }),
          ),
          durationSeconds:
            Number.isFinite(frameCount) && frameCount > 0 ? frameCount / 25 : 0,
        };
      } catch (error) {
        console.warn(
          `${speakingAvatarEngine} unavailable; using the idle avatar.`,
          error,
        );
        emitRuntimeEvent({
          eventId: activeLifecycleRef.current?.eventId,
          stage: `${speakingAvatarEngine}_render_failed`,
          at: Date.now(),
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [emitRuntimeEvent, speakingAvatarEngine, useSpeakingAvatar],
  );

  const playAudioChunk = useCallback(
    async (
      arrayBuffer: ArrayBuffer,
      generatedVideoUrl: string | null,
      emitReaction: boolean,
    ) => {
      const playbackTimeoutMs = await getAudioPlaybackTimeoutMs(arrayBuffer);
      if (generatedVideoUrl) {
        setSpeakingAvatarVideoUrl(generatedVideoUrl);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }

      try {
        await Promise.race([
          play(arrayBuffer, {
            onStart: () => {
              if (!replyLatencyRef.current?.firstPlaybackAt) {
                if (replyLatencyRef.current) {
                  replyLatencyRef.current.firstPlaybackAt = Date.now();
                }
              }
              if (!emitReaction) return;
              if (speechReactionRef.current) {
                emitAvatarReaction(speechReactionRef.current);
              } else {
                setAvatarReaction(null);
              }
            },
          }),
          new Promise<void>((resolve) =>
            window.setTimeout(resolve, playbackTimeoutMs),
          ),
        ]);
      } finally {
        stop();
        if (generatedVideoUrl) {
          setSpeakingAvatarVideoUrl(null);
          // Keep the Blob alive through the visual cross-fade back to LivePortrait.
          window.setTimeout(() => URL.revokeObjectURL(generatedVideoUrl), 220);
        }
      }
    },
    [emitAvatarReaction, play, stop],
  );

  const handleAudioPlay = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      speechBeatBytesRef.current += arrayBuffer.byteLength;
      if (!replyLatencyRef.current?.ttsFirstByteAt) {
        if (replyLatencyRef.current) {
          replyLatencyRef.current.ttsFirstByteAt = Date.now();
        }
      }
      if (captureTts) {
        await fetch('/api/tts-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: arrayBuffer.slice(0),
        });
      }
      const rendered = await renderSpeakingVideo(arrayBuffer, {
        reset: true,
        end: true,
      });
      await playAudioChunk(
        rendered?.audioBuffer ?? arrayBuffer,
        rendered?.videoUrl ?? null,
        true,
      );
      finalizeReplyLatency();
    },
    [captureTts, finalizeReplyLatency, playAudioChunk, renderSpeakingVideo],
  );

  const handleAudioStream = useCallback(
    async (audioStream: AsyncGenerator<ArrayBuffer>) => {
      beginQueue();
      const iterator = audioStream[Symbol.asyncIterator]();
      let current = await iterator.next();
      if (current.done) {
        await finishQueue();
        return;
      }
      speechBeatBytesRef.current += current.value.byteLength;
      if (!replyLatencyRef.current?.ttsFirstByteAt) {
        if (replyLatencyRef.current) {
          replyLatencyRef.current.ttsFirstByteAt = Date.now();
        }
      }

      let sequence = 0;
      let renderPromise = renderSpeakingVideo(current.value, {
        reset: true,
        sequence,
      });
      const capturedChunks = captureTts ? [current.value.slice(0)] : [];
      let firstChunk = true;
      let playbackStarted = speakingAvatarEngine !== 'flashhead';
      let stagedDuration = 0;
      const stagedMedia: RenderedSpeakingMedia[] = [];
      const generatedVideoUrls: string[] = [];
      let startDeadlineTimer: number | null = null;

      const enqueueRendered = async (rendered: RenderedSpeakingMedia) => {
        const emitThisChunk = firstChunk;
        generatedVideoUrls.push(rendered.videoUrl);
        await enqueue(rendered.audioBuffer, {
          onVisualStart: () => setSpeakingAvatarVideoUrl(rendered.videoUrl),
          onStart: () => {
            if (!replyLatencyRef.current?.firstPlaybackAt) {
              if (replyLatencyRef.current) {
                replyLatencyRef.current.firstPlaybackAt = Date.now();
              }
            }
            if (!emitThisChunk) return;
            if (speechReactionRef.current) {
              emitAvatarReaction(speechReactionRef.current);
            } else {
              setAvatarReaction(null);
            }
          },
        });
        firstChunk = false;
      };

      const startStagedPlayback = async () => {
        if (playbackStarted || !stagedMedia.length) return;
        playbackStarted = true;
        if (startDeadlineTimer !== null) {
          window.clearTimeout(startDeadlineTimer);
          startDeadlineTimer = null;
        }
        for (const staged of stagedMedia.splice(0)) {
          await enqueueRendered(staged);
        }
      };

      const stageOrEnqueue = async (
        rendered: RenderedSpeakingMedia,
        forceStart = false,
      ) => {
        if (playbackStarted) {
          await enqueueRendered(rendered);
          return;
        }
        stagedMedia.push(rendered);
        stagedDuration += rendered.durationSeconds;
        if (startDeadlineTimer === null) {
          startDeadlineTimer = window.setTimeout(() => {
            void startStagedPlayback();
          }, FLASHHEAD_MAX_START_WAIT_MS);
        }
        if (!forceStart && stagedDuration < FLASHHEAD_START_BUFFER_SECONDS)
          return;
        await startStagedPlayback();
      };

      while (!current.done) {
        const nextPromise = iterator.next();
        const rendered = await renderPromise;
        if (rendered) {
          await stageOrEnqueue(rendered);
        }
        const next = await nextPromise;
        if (!next.done) speechBeatBytesRef.current += next.value.byteLength;
        if (!next.done && captureTts) {
          capturedChunks.push(next.value.slice(0));
        }
        const nextRenderPromise = next.done
          ? null
          : renderSpeakingVideo(next.value, { sequence: ++sequence });
        current = next;
        if (nextRenderPromise) renderPromise = nextRenderPromise;
      }

      if (speakingAvatarEngine === 'flashhead') {
        const finalRendered = await renderSpeakingVideo(new ArrayBuffer(0), {
          end: true,
          sequence: ++sequence,
        });
        if (finalRendered) {
          await stageOrEnqueue(finalRendered, true);
        }
      }
      if (!playbackStarted && stagedMedia.length) {
        await startStagedPlayback();
      }
      if (startDeadlineTimer !== null) window.clearTimeout(startDeadlineTimer);
      if (captureTts && capturedChunks.length) {
        await fetch('/api/tts-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob(capturedChunks),
        });
      }
      await finishQueue();
      setSpeakingAvatarVideoUrl(null);
      window.setTimeout(() => {
        for (const url of generatedVideoUrls) URL.revokeObjectURL(url);
      }, 220);
      finalizeReplyLatency();
    },
    [
      beginQueue,
      captureTts,
      emitAvatarReaction,
      enqueue,
      finishQueue,
      finalizeReplyLatency,
      renderSpeakingVideo,
      speakingAvatarEngine,
    ],
  );

  const armOperatorSpeechWatchdog = useCallback(
    (eventId: string, timeoutMs = OPERATOR_SPEECH_WATCHDOG_MS) => {
      if (speakingOperatorTaskRef.current !== eventId) return;
      if (operatorSpeechWatchdogRef.current !== null) {
        window.clearTimeout(operatorSpeechWatchdogRef.current);
      }
      operatorSpeechWatchdogRef.current = window.setTimeout(() => {
        if (speakingOperatorTaskRef.current !== eventId) return;
        // This fires only when neither a TTS beat nor playback completion has
        // made progress for the watchdog window.  Do not confuse a long,
        // multi-beat response with a stalled renderer.
        stop();
        speakingOperatorTaskRef.current = null;
        operatorPlaybackObservedRef.current = false;
        if (activeLifecycleRef.current?.eventId === eventId) {
          emitRuntimeEvent({
            eventId,
            stage: 'failed',
            at: Date.now(),
            source: activeLifecycleRef.current.channel,
            sourceLabel: activeLifecycleRef.current.label,
            viewerId: activeLifecycleRef.current.viewerId,
            viewerName: activeLifecycleRef.current.viewerName,
            sourcesSeen: activeLifecycleRef.current.sourcesSeen,
            reason: 'tts_progress_timeout',
          });
          activeLifecycleRef.current = null;
        }
        void updateOperatorQueue(eventId, 'retry', {
          reason: 'tts_progress_timeout',
        }).catch(() => undefined);
      }, timeoutMs);
    },
    [emitRuntimeEvent, stop],
  );

  const dispatchAvatarBehavior = useCallback(
    (screenplay: ScreenplayLike) => {
      const active = activeLifecycleRef.current;
      const actions: AvatarAction[] = [];
      if (screenplay.motion && screenplay.motion !== 'none') {
        actions.push({ kind: 'motion', name: screenplay.motion });
      }
      if (screenplay.gaze && screenplay.gaze !== 'none') {
        actions.push({ kind: 'pose', name: `gaze:${screenplay.gaze}` });
      }
      if (screenplay.gesture && screenplay.gesture !== 'none') {
        actions.push({ kind: 'gesture', name: screenplay.gesture });
      }
      const behaviorEvent = createAvatarBehaviorEvent(
        {
          name: screenplay.emotion || 'neutral',
          intensity: Math.max(
            0,
            Math.min(1, screenplay.emotionIntensity ?? 0.5),
          ),
        },
        {
          streamId: 'linglan-live',
          source: active?.channel.includes('quiet-room')
            ? 'proactive-talk'
            : 'assistant',
          speechText: screenplay.text,
          targetViewerId: active?.viewerId,
          correlationId: active?.eventId,
        },
        actions,
      );
      void avatarBehaviorBusRef.current
        ?.dispatch(behaviorEvent)
        .then((receipts) => {
          const skipped = receipts.some(
            (receipt) => receipt.status === 'skipped',
          )
            ? actions.length
            : 0;
          unsupportedAvatarActionCountRef.current += skipped;
          setUnsupportedAvatarActionCount(
            unsupportedAvatarActionCountRef.current,
          );
          emitRuntimeEvent({
            eventId: active?.eventId,
            stage:
              skipped > 0
                ? 'avatar_action_skipped'
                : 'avatar_behavior_dispatched',
            at: Date.now(),
            reason:
              skipped > 0
                ? 'renderer_capability_not_supported'
                : 'renderer_capability_delivered',
            intents: actions.map((action) => `${action.kind}:${action.name}`),
            skippedCount: skipped,
            receipts: receipts.map(({ adapterId, status }) => ({
              adapterId,
              status,
            })),
          });
        });
    },
    [emitRuntimeEvent],
  );

  const handleSpeechStart = useCallback(
    (screenplay: ScreenplayLike) => {
      const text = screenplay.text?.trim() || '';
      const replyTrace = replyLatencyRef.current;
      speechRenderTraceRef.current = {
        requestId: replyTrace?.requestId ?? crypto.randomUUID(),
        source:
          replyTrace?.source ??
          (activeLifecycleRef.current?.eventId ? 'live' : 'chat'),
        text,
      };
      const active = activeLifecycleRef.current;
      if (active?.eventId) {
        dispatchLiveHostEvent({
          type: 'speech',
          at: Date.now(),
          eventId: active.eventId,
          stage: 'started',
          beatIndex: 0,
          interruptibleAfter: false,
        });
        if (speakingOperatorTaskRef.current === active.eventId) {
          operatorPlaybackObservedRef.current = false;
        }
        active.ttsStartAt = Date.now();
        emitRuntimeEvent({
          eventId: active.eventId,
          stage: 'speaking',
          at: active.ttsStartAt,
          source: active.channel,
          sourceLabel: active.label,
          viewerId: active.viewerId,
          viewerName: active.viewerName,
          sourcesSeen: active.sourcesSeen,
        });
        if (!active.testRunId) {
          const message = (active.replyText || text).trim();
          const kind: SpeechDeliveryKind = active.channel.includes(
            'operator-manual',
          )
            ? 'operator-broadcast'
            : active.channel.includes('quiet-room') ||
                active.channel.includes('proactive')
              ? 'proactive-speech'
              : 'viewer-reply';
          const sourcePlatformId = active.sourcesSeen?.find(Boolean);
          const sourceConnectorId = sourcePlatformId
            ? platformOwner(
                settingsHook.settings.liveConnectors,
                sourcePlatformId,
              )
            : undefined;
          const targets = resolveSpeechDeliveryTargets(
            settingsHook.settings.liveConnectors,
            {
              eventId: active.eventId,
              kind,
              sourceConnectorId,
              sourcePlatformId,
            },
          );
          active.deliveredConnectorTargets ??= new Set<string>();
          for (const target of targets) {
            const targetKey = `${target.connectorId}:${target.platformId}`;
            if (!message || active.deliveredConnectorTargets.has(targetKey))
              continue;
            active.deliveredConnectorTargets.add(targetKey);
            const idempotencyKey = `speech:${active.eventId}:${targetKey}`;
            emitRuntimeEvent({
              eventId: active.eventId,
              stage: 'live_platform_delivery_requested',
              actor: {
                type: 'system',
                id: `${target.connectorId}-reply-adapter`,
              },
              at: Date.now(),
              source: active.channel,
              connectorId: target.connectorId,
              platformId: target.platformId,
              message,
              idempotencyKey,
            });
            const delivery =
              target.connectorId === 'ordinaryroad'
                ? sendOrdinaryRoadReply(
                    settingsHook.settings.liveConnectors.ordinaryRoad
                      .gatewayUrl,
                    target.platformId,
                    { message, idempotencyKey },
                  )
                : socialStreamSendRef.current(target.platformId, {
                    message,
                    idempotencyKey,
                  });
            void delivery
              .then((result) => {
                setStreamErrorMessage('');
                emitRuntimeEvent({
                  eventId: active.eventId,
                  stage: 'live_platform_delivery_succeeded',
                  at: Date.now(),
                  connectorId: target.connectorId,
                  platformId: target.platformId,
                  result,
                });
              })
              .catch((error) => {
                const reason =
                  error instanceof Error ? error.message : String(error);
                setStreamErrorMessage(
                  `${target.platformId} 文字回写失败：${reason}`,
                );
                emitRuntimeEvent({
                  eventId: active.eventId,
                  stage: 'live_platform_delivery_failed',
                  at: Date.now(),
                  connectorId: target.connectorId,
                  platformId: target.platformId,
                  error: reason,
                });
              });
          }
        }
      }
      speechReactionRef.current = debugAffineAvatarMotion
        ? createPuruPuruReactionFromScreenplay(screenplay)
        : null;
      lastAvatarBehaviorBeatRef.current = '';
      setAvatarMotion(
        useSpeakingAvatar
          ? 'idle_cold'
          : normalizeAvatarMotion(screenplay.motion),
      );
    },
    [
      dispatchLiveHostEvent,
      debugAffineAvatarMotion,
      emitRuntimeEvent,
      settingsHook.settings.liveConnectors,
      useSpeakingAvatar,
    ],
  );

  const handleSpeechEnd = useCallback(() => {
    if (replyLatencyRef.current) {
      replyLatencyRef.current.speechEndSignaledAt = Date.now();
    }
    const active = activeLifecycleRef.current;
    const isOperatorPlayback =
      Boolean(active?.eventId) &&
      speakingOperatorTaskRef.current === active?.eventId;
    const hasCompleteOperatorAudio =
      operatorBeatCountRef.current > 0 &&
      operatorCompletedBeatCountRef.current >= operatorBeatCountRef.current &&
      operatorAudioByteLengthRef.current > 0;
    // Streaming TTS can briefly report an idle state between beats.  That is
    // not the end of the queued response: keep its lease and lifecycle alive
    // until every planned beat has completed.
    if (isOperatorPlayback && !hasCompleteOperatorAudio) return;
    if (active?.eventId) {
      const ttsEndAt = Date.now();
      dispatchLiveHostEvent({
        type: 'speech',
        at: ttsEndAt,
        eventId: active.eventId,
        stage: 'completed',
      });
      void fetch('/api/conversation-history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: active.eventId,
          ttsStartAt: active.ttsStartAt,
          ttsEndAt,
        }),
      }).catch(() => undefined);
      if (isOperatorPlayback) {
        void updateOperatorQueue(active.eventId, 'done', {
          ownerId: runtimeOwnerIdRef.current,
          beatCount: operatorBeatCountRef.current,
          completedBeatCount: operatorCompletedBeatCountRef.current,
          audioByteLength: operatorAudioByteLengthRef.current,
        })
          .then(() => {
            emitRuntimeEvent({
              eventId: active.eventId,
              stage: 'done',
              at: ttsEndAt,
              source: active.channel,
              sourceLabel: active.label,
              viewerId: active.viewerId,
              viewerName: active.viewerName,
              sourcesSeen: active.sourcesSeen,
            });
          })
          .catch((error) => {
            emitRuntimeEvent({
              eventId: active.eventId,
              stage: 'failed',
              at: Date.now(),
              reason: 'incomplete_audio_evidence',
              error: error instanceof Error ? error.message : String(error),
            });
          });
        speakingOperatorTaskRef.current = null;
        operatorPlaybackObservedRef.current = false;
        if (operatorSpeechWatchdogRef.current !== null) {
          window.clearTimeout(operatorSpeechWatchdogRef.current);
          operatorSpeechWatchdogRef.current = null;
        }
      }
    }
    activeLifecycleRef.current = null;
    speechRenderTraceRef.current = null;
    proactiveSpeechRef.current = false;
    proactiveEventIdRef.current = null;
    resetAvatarReaction();
    setAvatarMotion('idle_cold');
  }, [dispatchLiveHostEvent, emitRuntimeEvent, resetAvatarReaction]);

  const handleSpeechInterrupted = useCallback(() => {
    const active = activeLifecycleRef.current;
    if (active?.eventId) {
      dispatchLiveHostEvent({
        type: 'speech',
        at: Date.now(),
        eventId: active.eventId,
        stage: 'interrupted',
      });
      emitRuntimeEvent({
        eventId: active.eventId,
        stage: 'dropped',
        at: Date.now(),
        source: active.channel,
        sourceLabel: active.label,
        viewerId: active.viewerId,
        viewerName: active.viewerName,
        reason: 'interrupted_at_beat_boundary',
      });
      void updateOperatorQueue(active.eventId, 'skip', {
        reason: 'interrupted_at_beat_boundary',
      }).catch(() => undefined);
    }
    speakingOperatorTaskRef.current = null;
    operatorPlaybackObservedRef.current = false;
    activeLifecycleRef.current = null;
    proactiveSpeechRef.current = false;
    proactiveEventIdRef.current = null;
    if (operatorSpeechWatchdogRef.current !== null) {
      window.clearTimeout(operatorSpeechWatchdogRef.current);
      operatorSpeechWatchdogRef.current = null;
    }
    resetAvatarReaction();
    setAvatarMotion('idle_cold');
  }, [dispatchLiveHostEvent, emitRuntimeEvent, resetAvatarReaction]);

  const {
    messages,
    isProcessing,
    partialResponse,
    processChat,
    processVisionChat,
    speakPrepared,
    isCoreReady,
    recoverChatRuntime,
    interruptSpeech,
  } = useAituberCore({
    onAudioPlay: handleAudioPlay,
    onAudioStream:
      useSpeakingAvatar && useStreamingLipSync ? handleAudioStream : undefined,
    onSpeechStart: handleSpeechStart,
    onSpeechEnd: handleSpeechEnd,
    onSpeechInterrupted: handleSpeechInterrupted,
    onSpeechChunk: (stage, data) => {
      const active = activeLifecycleRef.current;
      const bridgePlayback = data.bridge === 'minimax-audio';
      if (stage === 'start') {
        const beatIndex = Number(data.beatIndex ?? data.index ?? 0);
        const avatarBeatKey = `${active?.eventId || 'direct'}:${beatIndex}`;
        if (
          !debugAffineAvatarMotion &&
          data.screenplay &&
          typeof data.screenplay === 'object' &&
          lastAvatarBehaviorBeatRef.current !== avatarBeatKey
        ) {
          lastAvatarBehaviorBeatRef.current = avatarBeatKey;
          dispatchAvatarBehavior(data.screenplay as ScreenplayLike);
        }
        speechBeatBytesRef.current = 0;
        operatorBeatCountRef.current = bridgePlayback
          ? Number(data.count || 1)
          : Math.max(operatorBeatCountRef.current, Number(data.count || 0));
        if (active?.eventId) {
          void updateOperatorQueue(active.eventId, 'beat-progress', {
            beatCount: Number(data.count || 0),
            completedBeatCount: Number(data.index || 0),
            replaceBeatPlan: bridgePlayback,
          }).catch(() => undefined);
        }
      }
      if (
        active?.eventId &&
        (stage === 'end' || stage === 'start')
      ) {
        armOperatorSpeechWatchdog(active.eventId);
      }
      emitRuntimeEvent({
        eventId: active?.eventId || 'direct-speech',
        testRunId: active?.testRunId,
        stepId: active?.stepId,
        scenarioId: active?.scenarioId,
        stage: `tts-beat-${stage}`,
        at: Date.now(),
        ...data,
        byteLength: stage === 'start' ? 0 : speechBeatBytesRef.current,
      });
      if (active?.eventId && stage === 'end') {
        dispatchLiveHostEvent({
          type: 'speech',
          at: Date.now(),
          eventId: active.eventId,
          stage: 'beat-completed',
          beatIndex: Number(data.beatIndex ?? data.index ?? 0),
          interruptibleAfter: data.interruptibleAfter === true,
        });
        operatorCompletedBeatCountRef.current = Math.max(
          operatorCompletedBeatCountRef.current,
          Number(data.index || 0) + 1,
        );
        operatorAudioByteLengthRef.current += speechBeatBytesRef.current;
        void updateOperatorQueue(active.eventId, 'beat-progress', {
          beatCount: Number(data.count || 0),
          completedBeatCount: Number(data.index || 0) + 1,
          byteLength: speechBeatBytesRef.current,
          replaceBeatPlan: bridgePlayback,
        }).catch(() => undefined);
      }
      if (active?.eventId && stage === 'error') {
        dispatchLiveHostEvent({
          type: 'runtime-fault',
          at: Date.now(),
          eventId: active.eventId,
          reasonCode: 'tts_beat_failed',
        });
      }
    },
    settings: settingsHook.settings,
    profile: runtimeProfile,
    speechPlanV2Enabled,
    getApiKeyForProvider: settingsHook.getApiKeyForProvider,
    onAssistantResponse: (input, reply, metadata) => {
      // Update synchronously, before the disk write finishes, so an immediate
      // follow-up never loses the just-broadcast answer.
      recentLiveTurnsRef.current = mergeRecentLiveTurns(
        recentLiveTurnsRef.current,
        [
          {
            eventId: metadata?.eventId,
            at: Date.now(),
            input,
            reply,
            viewerId: metadata?.viewerId,
            viewerName: metadata?.viewerName,
            sourceLabel: metadata?.sourceLabel,
            sourcesSeen: metadata?.sourcesSeen,
          },
        ],
      );
      if (replyLatencyRef.current) {
        replyLatencyRef.current.llmCompletedAt = Date.now();
        replyLatencyRef.current.input = input;
        replyLatencyRef.current.reply = reply;
        replyLatencyRef.current.eventId = metadata?.eventId;
      }
      const active = activeLifecycleRef.current;
      if (active?.eventId && active.eventId === metadata?.eventId) {
        emitRuntimeEvent({
          eventId: active.eventId,
          stage: 'generated',
          at: Date.now(),
          source: active.channel,
          sourceLabel: active.label,
          viewerId: active.viewerId,
          viewerName: active.viewerName,
          sourcesSeen: active.sourcesSeen,
        });
      }
      void fetch('/api/conversation-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          reply,
          viewerId: metadata?.viewerId,
          viewerName: metadata?.viewerName,
          source: metadata?.source,
          sourceLabel: metadata?.sourceLabel,
          eventId: metadata?.eventId,
          commentAt: metadata?.commentAt,
          receivedAt: metadata?.receivedAt,
          queuedAt: metadata?.queuedAt,
          selectedAt: metadata?.selectedAt,
          processingAt: metadata?.processingAt,
          llmStartAt: metadata?.processingAt,
          llmEndAt: Date.now(),
          sourcesSeen: metadata?.sourcesSeen,
          testRunId:
            active?.eventId === metadata?.eventId
              ? active?.testRunId
              : undefined,
          stepId:
            active?.eventId === metadata?.eventId ? active?.stepId : undefined,
          scenarioId:
            active?.eventId === metadata?.eventId
              ? active?.scenarioId
              : undefined,
          replyAt: Date.now(),
        }),
      }).catch((error) => {
        console.warn('Conversation history persistence failed.', error);
      });
      void streamerMemory.addInteraction(
        input,
        reply,
        {
          id: scopedViewerId(
            metadata?.viewerId,
            metadata?.sourcesSeen?.[0] ?? metadata?.source,
          ),
          name: metadata?.viewerName,
        },
        metadata?.source,
      );
    },
    onChatError: (error, metadata) => {
      // Continuation failures from the chat processor can lose the original
      // metadata after speech has already started.  Keep the lifecycle event
      // as the correlation source so the stress runner reports the upstream
      // generation failure instead of a later, misleading TTS timeout.
      const active = activeLifecycleRef.current;
      const eventId = metadata?.eventId ?? active?.eventId;
      const errorMessage =
        error instanceof Error ? error.message.slice(0, 240) : 'chat_failed';
      const reason = /truncated|continuation/i.test(errorMessage)
        ? 'generation_truncated'
        : 'generation_failed';
      if (eventId) {
        void updateOperatorQueue(
          eventId,
          reason === 'generation_truncated' ? 'fail' : 'retry',
          { reason },
        ).catch(() => undefined);
        dispatchLiveHostEvent({
          type: 'generation',
          at: Date.now(),
          eventId,
          stage: 'failed',
          turn: {
            eventId,
            kind: active?.channel.includes('quiet-room')
              ? 'proactive'
              : 'viewer',
            priority: active?.channel.includes('quiet-room') ? 'low' : 'normal',
            createdAt: Date.now(),
            targetViewerId: active?.viewerId,
          },
        });
      }
      if (!active?.eventId || active.eventId !== eventId) return;
      emitRuntimeEvent({
        eventId: active.eventId,
        stage: 'failed',
        at: Date.now(),
        source: active.channel,
        sourceLabel: active.label,
        viewerId: active.viewerId,
        viewerName: active.viewerName,
        sourcesSeen: active.sourcesSeen,
        testRunId: active.testRunId,
        stepId: active.stepId,
        scenarioId: active.scenarioId,
        reason,
        error: errorMessage,
      });
      activeLifecycleRef.current = null;
    },
  });

  useEffect(() => {
    if (!isLiveRuntimeOwner) return;
    const heartbeat = () =>
      emitRuntimeEvent({
        stage: 'runtime-owner-heartbeat',
        ownerId: runtimeOwnerIdRef.current,
        availableForStress:
          !isProcessing &&
          !isSpeaking &&
          !preparingOperatorTaskRef.current &&
          !speakingOperatorTaskRef.current,
        ttsConfigured:
          settingsHook.settings.tts.engine !== 'minimax' ||
          Boolean(settingsHook.settings.tts.minimaxApiKey?.trim()),
        nextProactiveAt: liveHostSnapshot.nextProactiveAt || null,
        hostPhase: liveHostSnapshot.phase,
        activeTurnId: liveHostSnapshot.activeTurn?.eventId,
        targetViewerId: liveHostSnapshot.activeTurn?.targetViewerId,
        lastDecisionReason: liveHostSnapshot.lastDecisionReason,
        proactiveRemaining: liveHostSnapshot.proactiveRemaining,
        currentBeatIndex: liveHostSnapshot.currentBeatIndex,
        currentBeatInterruptible: liveHostSnapshot.currentBeatInterruptible,
        recoveryCount: liveHostSnapshot.recoveryCount,
        unsupportedAvatarActionCount: unsupportedAvatarActionCountRef.current,
        at: Date.now(),
      });
    heartbeat();
    const timer = window.setInterval(heartbeat, 5_000);
    return () => window.clearInterval(timer);
  }, [
    emitRuntimeEvent,
    isLiveRuntimeOwner,
    isProcessing,
    isSpeaking,
    liveHostSnapshot,
    settingsHook.settings.tts.engine,
    settingsHook.settings.tts.minimaxApiKey,
  ]);

  // A browser-side provider stream can remain internally locked after its
  // network request has already timed out.  Recover that owner automatically
  // so it cannot keep the stress runner (or a real live room) permanently
  // "busy" with no audio in flight.
  useEffect(() => {
    if (!isLiveRuntimeOwner || !isProcessing || isSpeaking) return;
    const eventId = preparingOperatorTaskRef.current;
    const timer = window.setTimeout(() => {
      if (isSpeaking) return;
      if (eventId && activeLifecycleRef.current?.eventId === eventId) {
        emitRuntimeEvent({
          eventId,
          stage: 'failed',
          at: Date.now(),
          reason: 'generation_recovery_timeout',
        });
      }
      recoverChatRuntime();
    }, OPERATOR_GENERATION_RECOVERY_MS);
    return () => window.clearTimeout(timer);
  }, [
    emitRuntimeEvent,
    isLiveRuntimeOwner,
    isProcessing,
    isSpeaking,
    recoverChatRuntime,
  ]);

  // Some avatar renderers finish their browser audio without forwarding the
  // core SPEECH_END event. Release the operator queue from the real playback
  // edge instead of waiting forever for that optional renderer signal.
  useEffect(() => {
    const eventId = speakingOperatorTaskRef.current;
    if (!eventId) return;
    if (isSpeaking) {
      operatorPlaybackObservedRef.current = true;
      return;
    }
    if (!operatorPlaybackObservedRef.current) return;

    const hasCompleteOperatorAudio =
      operatorBeatCountRef.current > 0 &&
      operatorCompletedBeatCountRef.current >= operatorBeatCountRef.current &&
      operatorAudioByteLengthRef.current > 0;
    // `isSpeaking` can fall false between streaming TTS beats.  In that gap,
    // a queue item must remain leased instead of being falsely announced as
    // done before its final beat exists.
    if (!hasCompleteOperatorAudio) return;

    void updateOperatorQueue(eventId, 'done', {
      ownerId: runtimeOwnerIdRef.current,
      beatCount: operatorBeatCountRef.current,
      completedBeatCount: operatorCompletedBeatCountRef.current,
      audioByteLength: operatorAudioByteLengthRef.current,
    })
      .then(() => {
        operatorPlaybackObservedRef.current = false;
        speakingOperatorTaskRef.current = null;
        if (operatorSpeechWatchdogRef.current !== null) {
          window.clearTimeout(operatorSpeechWatchdogRef.current);
          operatorSpeechWatchdogRef.current = null;
        }
        if (activeLifecycleRef.current?.eventId === eventId) {
          emitRuntimeEvent({
            eventId,
            stage: 'done',
            at: Date.now(),
            source: activeLifecycleRef.current.channel,
            sourceLabel: activeLifecycleRef.current.label,
            viewerId: activeLifecycleRef.current.viewerId,
            viewerName: activeLifecycleRef.current.viewerName,
            sourcesSeen: activeLifecycleRef.current.sourcesSeen,
          });
          activeLifecycleRef.current = null;
        }
      })
      .catch((error) => {
        emitRuntimeEvent({
          eventId,
          stage: 'failed',
          at: Date.now(),
          reason: 'queue_completion_rejected',
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [emitRuntimeEvent, isSpeaking]);
  const liveDirector = useLiveDirector(runtimeProfile);
  const getShortTermLiveContext = useCallback(async (before = Date.now()) => {
    try {
      const response = await fetch(
        `/api/conversation-history?shortTerm=1&before=${before}`,
        {
          cache: 'no-store',
          signal: AbortSignal.timeout(900),
        },
      );
      if (response.ok) {
        const payload = (await response.json()) as { records?: unknown };
        if (Array.isArray(payload.records)) {
          const restored = payload.records.flatMap(
            (record): RecentLiveTurn[] => {
              if (!record || typeof record !== 'object') return [];
              const value = record as Record<string, unknown>;
              if (
                typeof value.at !== 'number' ||
                typeof value.input !== 'string'
              ) {
                return [];
              }
              return [
                {
                  eventId:
                    typeof value.eventId === 'string'
                      ? value.eventId
                      : undefined,
                  at: value.at,
                  input: value.input,
                  reply:
                    typeof value.reply === 'string' ? value.reply : undefined,
                  viewerName:
                    typeof value.viewerName === 'string'
                      ? value.viewerName
                      : undefined,
                  viewerId:
                    typeof value.viewerId === 'string'
                      ? value.viewerId
                      : undefined,
                  sourceLabel:
                    typeof value.sourceLabel === 'string'
                      ? value.sourceLabel
                      : typeof value.source === 'string'
                        ? value.source
                        : undefined,
                  sourcesSeen: Array.isArray(value.sourcesSeen)
                    ? value.sourcesSeen.filter(
                        (source): source is string => typeof source === 'string',
                      )
                    : undefined,
                  skills: Array.isArray(value.skills)
                    ? value.skills.filter(
                        (skill): skill is string => typeof skill === 'string',
                      )
                    : [],
                  status:
                    typeof value.status === 'string'
                      ? (value.status as OperatorQueueItem['status'])
                      : undefined,
                },
              ];
            },
          );
          recentLiveTurnsRef.current = mergeRecentLiveTurns(
            recentLiveTurnsRef.current,
            restored,
          );
        }
      }
    } catch {
      // During a local Vite reload, the in-page ledger still preserves the
      // current conversation and avoids delaying the live reply.
    }
    return buildLiveRoomTranscript(recentLiveTurnsRef.current);
  }, []);
  // Runtime settings are synchronized from the coordinator every ten seconds.
  // Keep this object stable when its values did not change; otherwise the
  // scheduler effect below mistakes every sync for a configuration edit and
  // postpones proactive speech forever.
  const emptyRoomAwarenessSettings = useMemo(
    () => ({
      enabled: settingsHook.settings.emptyRoomAwareness.enabled,
      minIntervalMs: settingsHook.settings.emptyRoomAwareness.minIntervalMs,
      maxIntervalMs: settingsHook.settings.emptyRoomAwareness.maxIntervalMs,
      interfaceWeight: settingsHook.settings.emptyRoomAwareness.interfaceWeight,
      memoryWeight: settingsHook.settings.emptyRoomAwareness.memoryWeight,
      inspirationWeight:
        settingsHook.settings.emptyRoomAwareness.inspirationWeight,
      audienceWeight: settingsHook.settings.emptyRoomAwareness.audienceWeight,
    }),
    [
      settingsHook.settings.emptyRoomAwareness.enabled,
      settingsHook.settings.emptyRoomAwareness.minIntervalMs,
      settingsHook.settings.emptyRoomAwareness.maxIntervalMs,
      settingsHook.settings.emptyRoomAwareness.interfaceWeight,
      settingsHook.settings.emptyRoomAwareness.memoryWeight,
      settingsHook.settings.emptyRoomAwareness.inspirationWeight,
      settingsHook.settings.emptyRoomAwareness.audienceWeight,
    ],
  );
  const markLiveActivity = useCallback(
    (reason = 'viewer-interaction') => {
      liveDirector.markActivity();
      emptyRoomAwarenessPlannerRef.current?.markActivity(
        emptyRoomAwarenessSettings,
      );
      emitRuntimeEvent({
        stage: 'quiet-room-timer-reset',
        at: Date.now(),
        reason,
        nextProactiveAt: emptyRoomAwarenessPlannerRef.current?.getNextAt() ?? 0,
      });
    },
    [emitRuntimeEvent, emptyRoomAwarenessSettings, liveDirector],
  );
  useEffect(() => {
    if (emptyRoomAwarenessSettings.enabled) {
      emptyRoomAwarenessPlannerRef.current?.markActivity(
        emptyRoomAwarenessSettings,
      );
    } else {
      emptyRoomAwarenessPlannerRef.current?.reset();
    }
  }, [emptyRoomAwarenessSettings, runtimeProfile.id]);
  const screenVisionController = useScreenVisionController({
    settings: settingsHook.settings.screenVision,
    onCapture: processVisionChat,
    onEnabledChange: settingsHook.updateScreenVisionEnabled,
    onDeviceIdChange: settingsHook.updateScreenVisionDeviceId,
  });

  const processWithHostExtensions = useCallback(
    async (
      text: string,
      options?: {
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
        catchup?: boolean;
        showInput?: boolean;
        persistInteraction?: boolean;
        silent?: boolean;
        onPrepared?: (reply: string, skills: string[]) => void;
        createdAt?: number;
        testRunId?: string;
        stepId?: string;
        scenarioId?: string;
        faultKind?: OperatorQueueItem['faultKind'];
        faultConsumed?: boolean;
      },
    ) => {
      const eventId = options?.eventId ?? crypto.randomUUID();
      const displayText = options?.displayText ?? text;
      const isProactive =
        options?.sourceLabel?.includes('quiet-room') === true ||
        options?.sourcesSeen?.includes('quiet-room-awareness') === true;
      const turn = {
        eventId,
        kind: isProactive ? ('proactive' as const) : ('viewer' as const),
        priority: isProactive ? ('low' as const) : ('normal' as const),
        createdAt: options?.createdAt ?? Date.now(),
        targetViewerId: options?.viewerId,
        proactiveSource: isProactive ? options?.sourceLabel : undefined,
      };
      dispatchLiveHostEvent({
        type: 'generation',
        at: Date.now(),
        eventId,
        stage: 'started',
        turn,
      });
      const shortTermLiveContext = await getShortTermLiveContext(
        options?.createdAt,
      );
      const routing = await routeTyphoonSkillWithAgent({
        text: displayText,
        viewerId: options?.viewerId,
        viewerName: options?.viewerName,
        sourceLabel: options?.sourceLabel,
        turns: recentLiveTurnsRef.current,
      });
      const responseContract = buildLiveResponseContract(
        displayText,
        recentLiveTurnsRef.current,
        routing,
      );
      // Live comments already receive this context through liveDirector.guide.
      // Queue and radar messages need the same relationship state without
      // incrementing relationship visits again while drafts are regenerated.
      const relationshipContext =
        options?.source === 'live'
          ? ''
          : liveDirector.relationshipContext({
              id: options?.viewerId,
              name: options?.viewerName,
              platform: options?.sourcesSeen?.[0],
            });
      emitRuntimeEvent({
        eventId,
        stage: 'selected',
        at: Date.now(),
        text: displayText,
        source: options?.source ?? 'chat',
        sourceLabel: options?.sourceLabel,
        viewerId: options?.viewerId,
        viewerName: options?.viewerName,
        sourcesSeen: options?.sourcesSeen,
        createdAt: options?.commentAt,
      });
      const simulateSkillTimeout =
        Boolean(options?.testRunId) &&
        options?.faultKind === 'typhoon-skill-timeout';
      if (simulateSkillTimeout) {
        await updateOperatorQueue(eventId, 'consume-fault').catch(
          () => undefined,
        );
      }
      const enrichment = await hostExtensions.enrich({
        query: responseContract.skillQuery,
        inheritedSkillIds: responseContract.inheritedSkills,
        simulatedFaultIds: simulateSkillTimeout
          ? ['typhoon-skill-timeout']
          : undefined,
      });
      if (enrichment.forceFallback) {
        emitRuntimeEvent({
          eventId,
          stage: 'skill_timeout_or_unavailable',
          at: Date.now(),
          reason: 'skill_result_unavailable_use_safe_fallback',
          skills: enrichment.skills,
        });
      }
      const payload = enrichment.payload;
      // Operator-queue preparation must return a writable text draft. The
      // screenshot/vision route speaks directly and has no draft callback, so
      // reserve it for one-off direct broadcasts only.
      if (enrichment.vision && !options?.silent) {
        const liveRadarImage = await enrichment.vision.capture();
        if (liveRadarImage) {
          return processVisionChat(
            liveRadarImage,
            enrichment.vision.buildPrompt(
              options?.displayText ?? text,
              enrichment.context,
            ),
          );
        }
      }
      return processChat(text, {
        ...options,
        eventId,
        memoryContext: `${options?.memoryContext ?? ''}${
          options?.sourceLabel
            ? `\n\n[内部投递上下文：本条信息来自${options.sourceLabel}。仅据此调整回应方式，不要向观众复述或解释该上下文。]`
            : ''
        }${relationshipContext}${shortTermLiveContext}${responseContract.contract}${enrichment.context}`,
        factGuard: {
          // Structured facts support numeric validation. The local BOSS guide
          // fallback is policy/reference material, not a structured fact feed.
          isWeather: Boolean(enrichment.isDomainSensitive),
          viewerText: options?.displayText ?? text,
          requiredAnswer: enrichment.isDomainSensitive
            ? enrichment.fallbackReply
            : undefined,
          claims: Array.isArray(payload?.claims) ? payload.claims : undefined,
          placeResolution: payload?.placeResolution,
          rawEvidence: payload,
          catchup: options?.catchup,
          forceFallback: enrichment.forceFallback,
        },
        silent: options?.silent,
        onPrepared: (reply) => {
          dispatchLiveHostEvent({
            type: 'generation',
            at: Date.now(),
            eventId,
            stage: 'completed',
            turn,
          });
          options?.onPrepared?.(reply, enrichment.skills);
        },
      });
    },
    [
      emitRuntimeEvent,
      dispatchLiveHostEvent,
      getShortTermLiveContext,
      liveDirector,
      processChat,
      processVisionChat,
      hostExtensions,
    ],
  );

  const refreshOperatorQueue = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/operator-queue${isObsOverlay ? '' : '?observer=control-panel'}`,
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        items?: OperatorQueueItem[];
      };
      if (Array.isArray(payload.items)) setOperatorQueue(payload.items);
    } catch {
      // The control room remains usable while the local Vite host reloads.
    }
  }, [isObsOverlay]);

  const refreshStressRun = useCallback(async () => {
    try {
      const response = await fetch('/api/stress-test', { cache: 'no-store' });
      if (!response.ok) return;
      const raw = (await response.json()) as StressApiRecord;
      const testItems = operatorQueue.filter(
        (item) =>
          item.testRunId === raw.runId ||
          (raw.lifecycle === 'idle' && item.testRunId),
      );
      const status: StressRunState['status'] =
        raw.cleanupState === 'running'
          ? 'cleaning'
          : raw.lifecycle === 'completed' && raw.hardPass !== true
            ? 'failed'
            : raw.lifecycle === 'running' ||
                raw.lifecycle === 'paused' ||
                raw.lifecycle === 'completed' ||
                raw.lifecycle === 'aborted' ||
                raw.lifecycle === 'failed'
              ? raw.lifecycle
              : raw.lifecycle === 'aborting'
                ? 'paused'
                : testItems.length > 0
                  ? 'failed'
                  : 'idle';
      setStressRun({
        status,
        runId:
          typeof raw.runId === 'string' ? raw.runId : testItems[0]?.testRunId,
        completedSteps: Number(raw.terminalCount || 0),
        totalSteps: Number(raw.messageCount || STRESS_TEST_PLAN.messageCount),
        startedAt:
          typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
        updatedAt:
          typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
        etaMs:
          typeof raw.estimatedRemainingMs === 'number'
            ? raw.estimatedRemainingMs
            : undefined,
        reportPath:
          typeof raw.reportDirectory === 'string'
            ? raw.reportDirectory
            : undefined,
        phase: typeof raw.phaseLabel === 'string' ? raw.phaseLabel : undefined,
        viewers: Array.isArray(raw.viewers)
          ? raw.viewers.map((value) => {
              const viewer = value as StressApiRecord;
              return {
                id: String(viewer.viewerId || ''),
                name: String(viewer.viewerName || ''),
                role: String(viewer.viewerId || ''),
                status: viewer.currentStepId
                  ? `当前 ${viewer.currentStepId}`
                  : '等待',
                completedSteps: Number(viewer.terminal || 0),
                totalSteps: Number(viewer.quota || 0),
                currentStep:
                  typeof viewer.currentStepId === 'string'
                    ? viewer.currentStepId
                    : undefined,
              };
            })
          : [],
        queue: {
          waiting: testItems.filter((item) => item.status === 'pending').length,
          drafting: testItems.filter((item) => item.status === 'preparing')
            .length,
          ready: testItems.filter((item) => item.status === 'ready').length,
          speaking: testItems.filter((item) => item.status === 'speaking')
            .length,
        },
        currentPlayback:
          raw.currentBroadcast && typeof raw.currentBroadcast === 'object'
            ? {
                viewerName: String(
                  (raw.currentBroadcast as StressApiRecord).viewerName || '',
                ),
                stepId: String(
                  (raw.currentBroadcast as StressApiRecord).stepId || '',
                ),
                text: testItems.find(
                  (item) =>
                    item.eventId ===
                    (raw.currentBroadcast as StressApiRecord).eventId,
                )?.preparedReply,
              }
            : undefined,
        failures: Array.isArray(raw.failures)
          ? raw.failures.map((value, index: number) => {
              const failure = value as StressApiRecord;
              return {
                id: `${failure.code || 'failure'}-${failure.at || index}`,
                code:
                  typeof failure.code === 'string' ? failure.code : undefined,
                stepId:
                  typeof failure.stepId === 'string'
                    ? failure.stepId
                    : undefined,
                message: String(
                  failure.message || failure.code || 'unknown failure',
                ),
                at: Number(failure.at || Date.now()),
                diagnostic:
                  failure.diagnostic && typeof failure.diagnostic === 'object'
                    ? (failure.diagnostic as StressRunState['failures'][number]['diagnostic'])
                    : undefined,
              };
            })
          : [],
        diagnostics: parseStressDiagnostics(raw.diagnostics),
      });
    } catch {
      // Vite may be reloading while the live overlay keeps running.
    }
  }, [operatorQueue]);

  const runStressAction = useCallback(
    async (
      action: 'diagnose' | 'start' | 'pause' | 'resume' | 'abort' | 'cleanup',
    ) => {
      // Stress injection is initiated by a button, but its first TTS result
      // arrives after an LLM round trip. Resume Web Audio synchronously while
      // the click still carries browser user-activation; otherwise a perfectly
      // valid TTS response can stall until the playback watchdog fires.
      if (action === 'start') {
        void unlock().catch(() => undefined);
      }
      if (action === 'cleanup') {
        for (const viewerId of [
          'stress-viewer-a',
          'stress-viewer-b',
          'stress-viewer-c',
        ]) {
          liveDirector.removeViewer(viewerId, 'stress-test');
          await streamerMemory.removeViewer(
            scopedViewerId(viewerId, 'stress-test') || viewerId,
          );
        }
      }
      const response = await fetch('/api/stress-test', {
        method: action === 'start' || action === 'diagnose' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          mode: 'live',
          messageCount: STRESS_TEST_PLAN.messageCount,
          seed: STRESS_TEST_PLAN.defaultSeed,
          provisionalOwnerId:
            action === 'start' || action === 'diagnose'
              ? runtimeOwnerIdRef.current
              : undefined,
          ttsConfigured:
            (action === 'start' || action === 'diagnose') &&
            (settingsHook.settings.tts.engine !== 'minimax' ||
              Boolean(settingsHook.settings.tts.minimaxApiKey?.trim())),
        }),
      });
      if (!response.ok && action === 'cleanup') {
        await Promise.all(
          operatorQueue
            .filter((item) => item.testRunId)
            .map((item) => updateOperatorQueue(item.eventId, 'delete')),
        );
      } else if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          diagnostics?: unknown;
        };
        const diagnostics = parseStressDiagnostics(payload.diagnostics);
        setStressRun((previous) => ({
          ...previous,
          status: 'failed',
          diagnostics,
          failures: [
            ...previous.failures,
            ...(diagnostics || [])
              .filter((check) => check.level === 'error')
              .map((check, index) => ({
                id: `diagnostic-${check.code}-${Date.now()}-${index}`,
                message: `${check.code}: ${check.summary}${check.detail ? ` (${check.detail})` : ''}`,
                at: Date.now(),
              })),
            {
              id: `start-preflight-${Date.now()}`,
              message:
                typeof payload.error === 'string'
                  ? payload.error
                  : 'Stress test could not start.',
              at: Date.now(),
            },
          ],
        }));
        return;
      }
      if (action === 'start') {
        const result = (await response.json().catch(() => ({}))) as {
          claimedRuntimeOwner?: unknown;
        };
        if (result.claimedRuntimeOwner === true) {
          setIsTemporaryStressOwner(true);
          setStressRun((previous) => ({ ...previous, status: 'running' }));
        }
      }
      await refreshOperatorQueue();
      await refreshStressRun();
    },
    [
      liveDirector,
      operatorQueue,
      refreshOperatorQueue,
      refreshStressRun,
      settingsHook.settings.tts.engine,
      settingsHook.settings.tts.minimaxApiKey,
      streamerMemory,
      unlock,
    ],
  );

  useEffect(() => {
    if (['running', 'paused'].includes(stressRun.status)) return;
    setIsTemporaryStressOwner(false);
  }, [stressRun.status]);

  const enqueueOperatorMessage = useCallback(
    async (input: {
      eventId: string;
      text: string;
      source: string;
      sourceLabel: string;
      viewerId?: string;
      viewerName?: string;
      sourcesSeen?: string[];
      testRunId?: string;
      stepId?: string;
      scenarioId?: string;
      faultKind?: OperatorQueueItem['faultKind'];
      engagementSignals?: OperatorQueueItem['engagementSignals'];
      createdAt?: number;
    }) => {
      const now = Date.now();
      const createdAt =
        typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)
          ? input.createdAt
          : now;
      await fetch('/api/operator-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ingest', ...input, createdAt }),
      });
      emitRuntimeEvent({ ...input, stage: 'received', at: now });
      emitRuntimeEvent({ ...input, stage: 'queued', at: now, queuedAt: now });
      await refreshOperatorQueue();
    },
    [emitRuntimeEvent, refreshOperatorQueue],
  );

  const enqueueProactiveSpeech = useCallback(
    (input: {
      prompt: string;
      awarenessSource: string;
      audiencePresent: boolean;
      scheduledNextAt?: number;
      busy?: boolean;
    }) => {
      const eventId = `proactive:${crypto.randomUUID()}`;
      const decisions = dispatchLiveHostEvent({
        type: 'quiet-candidate',
        at: Date.now(),
        eventId,
        source: input.awarenessSource,
        prompt: input.prompt,
        busy: input.busy === true,
      });
      const selected = decisions.some(
        (decision) =>
          decision.kind === 'prepare-reply' && decision.eventId === eventId,
      );
      if (hostCoordinatorV2Enabled && !selected) {
        const dropped = decisions.find((decision) => decision.kind === 'drop');
        emitRuntimeEvent({
          eventId,
          stage: 'dropped',
          at: Date.now(),
          source: 'quiet-room-awareness',
          reason: dropped?.reasonCode ?? 'proactive_not_selected',
        });
        return;
      }
      emitRuntimeEvent({
        eventId,
        stage: 'proactive-selected',
        at: Date.now(),
        source: 'quiet-room-awareness',
        awarenessSource: input.awarenessSource,
        audiencePresent: input.audiencePresent,
        scheduledNextAt: input.scheduledNextAt,
      });
      proactiveSpeechRef.current = true;
      proactiveEventIdRef.current = eventId;
      void enqueueOperatorMessage({
        eventId,
        text: input.prompt,
        source: 'quiet-room-awareness',
        sourceLabel: '安静直播间主动搭话',
        sourcesSeen: ['quiet-room-awareness'],
      }).catch((error) => {
        proactiveSpeechRef.current = false;
        proactiveEventIdRef.current = null;
        emitRuntimeEvent({
          eventId,
          stage: 'failed',
          at: Date.now(),
          source: 'quiet-room-awareness',
          reason: 'proactive_enqueue_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [
      dispatchLiveHostEvent,
      emitRuntimeEvent,
      enqueueOperatorMessage,
      hostCoordinatorV2Enabled,
    ],
  );

  const cancelQueuedProactiveSpeech = useCallback(
    (reason: string) => {
      const queued = operatorQueue.filter(
        (item) =>
          item.source === 'quiet-room-awareness' &&
          ['pending', 'preparing', 'ready'].includes(item.status),
      );
      const eventIds = new Set(queued.map((item) => item.eventId));
      if (proactiveEventIdRef.current && !isSpeaking) {
        eventIds.add(proactiveEventIdRef.current);
      }
      if (!eventIds.size) return;
      proactiveSpeechRef.current = false;
      proactiveEventIdRef.current = null;
      void Promise.all(
        [...eventIds].map(async (eventId) => {
          await updateOperatorQueue(eventId, 'skip', { reason });
          emitRuntimeEvent({
            eventId,
            stage: 'dropped',
            at: Date.now(),
            source: 'quiet-room-awareness',
            reason,
          });
        }),
      )
        .then(() => refreshOperatorQueue())
        .catch(() => undefined);
    },
    [emitRuntimeEvent, isSpeaking, operatorQueue, refreshOperatorQueue],
  );

  const interruptProactiveSpeech = useCallback(
    (eventId: string, viewerId?: string) => {
      const decisions = dispatchLiveHostEvent({
        type: 'audience-message',
        at: Date.now(),
        eventId,
        viewerId,
      });
      if (proactiveSpeechRef.current && isSpeaking) {
        const interrupt = decisions.find(
          (decision) => decision.kind === 'interrupt',
        );
        if (hostCoordinatorV2Enabled && interrupt?.kind === 'interrupt') {
          interruptSpeech(interrupt.mode);
        } else if (!hostCoordinatorV2Enabled) {
          stop();
          proactiveSpeechRef.current = false;
          resetAvatarReaction();
        }
      }
      cancelQueuedProactiveSpeech('viewer_interaction');
    },
    [
      cancelQueuedProactiveSpeech,
      dispatchLiveHostEvent,
      hostCoordinatorV2Enabled,
      interruptSpeech,
      isSpeaking,
      resetAvatarReaction,
      stop,
    ],
  );

  const emergencyTakeover = useCallback(() => {
    const startedAt = performance.now();
    const activeEventId = activeLifecycleRef.current?.eventId;
    dispatchLiveHostEvent({
      type: 'operator-command',
      at: Date.now(),
      eventId: activeEventId,
      command: 'takeover',
    });
    interruptSpeech('immediate');
    stop();
    setAutoBroadcastEnabled(false);
    proactiveSpeechRef.current = false;
    proactiveEventIdRef.current = null;
    cancelQueuedProactiveSpeech('operator_takeover');
    resetAvatarReaction();
    emitRuntimeEvent({
      eventId: activeEventId,
      stage: 'operator_takeover',
      at: Date.now(),
      stopLatencyMs: Math.round(performance.now() - startedAt),
      reason: 'operator_emergency_takeover',
    });
  }, [
    cancelQueuedProactiveSpeech,
    dispatchLiveHostEvent,
    emitRuntimeEvent,
    interruptSpeech,
    resetAvatarReaction,
    stop,
  ]);

  const enqueueManualBroadcast = useCallback(
    async (text: string) => {
      const preparedReply = text.trim();
      if (!preparedReply) return;
      void unlock();
      markLiveActivity('operator-manual');
      const now = Date.now();
      await fetch('/api/operator-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manual-broadcast',
          eventId: crypto.randomUUID(),
          text: preparedReply,
          reply: preparedReply,
          source: 'operator-manual',
          sourceLabel: '总控手动播报',
          viewerName: '主播总控',
          sourcesSeen: ['operator-manual'],
          createdAt: now,
          auditActor: 'control-room',
        }),
      });
      await refreshOperatorQueue();
    },
    [markLiveActivity, refreshOperatorQueue, unlock],
  );

  useEffect(() => {
    void refreshOperatorQueue();
    const timer = window.setInterval(() => void refreshOperatorQueue(), 700);
    return () => window.clearInterval(timer);
  }, [refreshOperatorQueue]);

  useEffect(() => {
    void refreshStressRun();
    const timer = window.setInterval(() => void refreshStressRun(), 800);
    return () => window.clearInterval(timer);
  }, [refreshStressRun]);

  useEffect(() => {
    if (
      !isLiveRuntimeOwner ||
      !isCoreReady ||
      (hostCoordinatorV2Enabled &&
        liveHostSnapshot.phase === 'operator_hold') ||
      isProcessing ||
      preparingOperatorTaskRef.current
    )
      return;
    const next = operatorQueue.find(
      (item) =>
        item.status === 'pending' &&
        (!item.assignedOwnerId ||
          item.assignedOwnerId === runtimeOwnerIdRef.current),
    );
    if (!next) return;
    preparingOperatorTaskRef.current = next.eventId;
    void (async () => {
      try {
        if (next.status === 'pending') {
          await updateOperatorQueue(next.eventId, 'claim-prepare', {
            ownerId: runtimeOwnerIdRef.current,
          });
        }
        if (
          next.testRunId &&
          next.faultKind === 'prepare-lease-expiry' &&
          !next.faultConsumed
        ) {
          await updateOperatorQueue(next.eventId, 'consume-fault');
          emitRuntimeEvent({
            eventId: next.eventId,
            testRunId: next.testRunId,
            stepId: next.stepId,
            scenarioId: next.scenarioId,
            stage: 'lease-owner-lost',
            at: Date.now(),
            reason: 'injected_test_failure',
          });
          return;
        }
        const leaseTimer = window.setInterval(() => {
          void updateOperatorQueue(next.eventId, 'renew-lease', {
            ownerId: runtimeOwnerIdRef.current,
          }).catch(() => undefined);
        }, 10_000);
        let prepared = false;
        let chatAccepted = true;
        try {
          if (!next.interactionObservedAt && next.viewerId) {
            const relationshipPlatform = next.sourcesSeen?.[0] || 'unknown';
            const relationshipKey = `${relationshipPlatform}:${next.viewerId}`;
            const beforeRelationships = liveDirector.getRelationshipSnapshot();
            liveDirector.observeViewerInteraction({
              id: next.viewerId,
              name: next.viewerName,
              platform: relationshipPlatform,
            });
            const afterRelationships = liveDirector.getRelationshipSnapshot();
            const beforeVisits =
              beforeRelationships[relationshipKey]?.visits ?? 0;
            const afterVisits =
              afterRelationships[relationshipKey]?.visits ?? 0;
            const otherViewerRelationshipMutated = Object.keys({
              ...beforeRelationships,
              ...afterRelationships,
            }).some(
              (viewerId) =>
                viewerId !== relationshipKey &&
                JSON.stringify(beforeRelationships[viewerId] ?? null) !==
                  JSON.stringify(afterRelationships[viewerId] ?? null),
            );
            await updateOperatorQueue(next.eventId, 'mark-observed', {
              relationshipVisitDelta: afterVisits - beforeVisits,
              otherViewerRelationshipMutated,
            });
          }
          if (
            !next.engagementAppliedAt &&
            next.viewerId &&
            next.engagementSignals?.length
          ) {
            for (const signal of next.engagementSignals) {
              liveDirector.recordRelationshipSignal(
                {
                  id: next.viewerId,
                  name: next.viewerName,
                  platform: next.sourcesSeen?.[0],
                },
                signal,
              );
            }
            await updateOperatorQueue(next.eventId, 'mark-engagement');
          }
          if (
            next.testRunId &&
            next.faultKind === 'model-truncation' &&
            !next.faultConsumed
          ) {
            emitRuntimeEvent({
              eventId: next.eventId,
              testRunId: next.testRunId,
              stepId: next.stepId,
              scenarioId: next.scenarioId,
              stage: 'model-truncated',
              at: Date.now(),
              reason: 'injected_test_failure',
            });
            await updateOperatorQueue(next.eventId, 'consume-fault');
            await updateOperatorQueue(next.eventId, 'retry');
            return;
          }
          await refreshOperatorQueue();
          chatAccepted =
            (await processWithHostExtensions(next.text, {
              displayText: next.text,
              source: 'chat',
              eventId: next.eventId,
              sourceLabel: next.sourceLabel || next.source,
              viewerId: next.viewerId,
              viewerName: next.viewerName,
              sourcesSeen: next.sourcesSeen,
              createdAt: next.createdAt,
              testRunId: next.testRunId,
              stepId: next.stepId,
              scenarioId: next.scenarioId,
              faultKind: next.faultKind,
              faultConsumed: next.faultConsumed,
              memoryContext: streamerMemory.contextFor(next.text, {
                id: scopedViewerId(next.viewerId, next.sourcesSeen?.[0]),
                name: next.viewerName,
              }),
              silent: true,
              onPrepared: (reply, skills) => {
                prepared = true;
                if (reply === NO_REPLY_TOKEN) {
                  emitRuntimeEvent({
                    eventId: next.eventId,
                    stage: 'dropped',
                    at: Date.now(),
                    text: next.text,
                    source: next.source,
                    sourceLabel: next.sourceLabel,
                    viewerId: next.viewerId,
                    viewerName: next.viewerName,
                    sourcesSeen: next.sourcesSeen,
                    reason: 'llm_no_reply',
                  });
                  void updateOperatorQueue(next.eventId, 'skip', {
                    reason: 'llm_no_reply',
                  })
                    .then(() => refreshOperatorQueue())
                    .catch(() => undefined);
                  return;
                }
                emitRuntimeEvent({
                  eventId: next.eventId,
                  stage: 'generated',
                  at: Date.now(),
                  text: next.text,
                  source: next.source,
                  sourceLabel: next.sourceLabel,
                  viewerId: next.viewerId,
                  viewerName: next.viewerName,
                  sourcesSeen: next.sourcesSeen,
                  preparedReply: reply,
                  skills,
                });
                void updateOperatorQueue(next.eventId, 'ready', {
                  reply,
                  skills,
                })
                  .then(() => refreshOperatorQueue())
                  .catch(() => undefined);
              },
            })) !== false;
        } finally {
          window.clearInterval(leaseTimer);
        }
        if (!prepared) {
          const response = await fetch('/api/operator-queue', {
            cache: 'no-store',
          });
          const payload = (await response.json()) as {
            items?: OperatorQueueItem[];
          };
          const current = payload.items?.find(
            (item) => item.eventId === next.eventId,
          );
          if (
            current?.status === 'preparing' &&
            current.leaseOwnerId === runtimeOwnerIdRef.current
          ) {
            // `processChat` can resolve without an ASSISTANT_RESPONSE when a
            // previous provider stream left the core's private lock engaged.
            // Reset before retrying so the next queue turn gets a fresh core
            // instead of silently receiving another immediate rejection.
            recoverChatRuntime();
            // `recoverChatRuntime` clears the core synchronously but React
            // publishes `isCoreReady=false` on the next render.  Requeueing
            // in the same microtask let the old effect immediately claim the
            // item again against a null core, exhausting retries during a
            // burst without making a provider request.
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 750);
            });
            const reason = chatAccepted
              ? 'generation_completed_without_draft'
              : 'generation_core_rejected';
            emitRuntimeEvent({
              eventId: next.eventId,
              stage: 'failed',
              at: Date.now(),
              reason,
            });
            await updateOperatorQueue(next.eventId, 'retry', {
              reason,
            });
          }
        }
      } catch {
        // A deleted operator item is intentionally allowed to disappear.
      } finally {
        preparingOperatorTaskRef.current = null;
        void refreshOperatorQueue();
      }
    })();
  }, [
    emitRuntimeEvent,
    isCoreReady,
    isLiveRuntimeOwner,
    isProcessing,
    hostCoordinatorV2Enabled,
    liveHostSnapshot.phase,
    liveDirector,
    operatorQueue,
    processWithHostExtensions,
    recoverChatRuntime,
    refreshOperatorQueue,
    streamerMemory,
  ]);

  useEffect(() => {
    if (
      !isLiveRuntimeOwner ||
      (hostCoordinatorV2Enabled &&
        liveHostSnapshot.phase === 'operator_hold') ||
      isSpeaking ||
      isProcessing ||
      speakingOperatorTaskRef.current
    )
      return;
    const stale = operatorQueue.find(
      (item) =>
        isStaleReadyReply(item) &&
        (!item.assignedOwnerId ||
          item.assignedOwnerId === runtimeOwnerIdRef.current),
    );
    if (stale) {
      void updateOperatorQueue(stale.eventId, 'skip', {
        reason: 'stale_before_speech',
      })
        .then(() => {
          emitRuntimeEvent({
            eventId: stale.eventId,
            stage: 'dropped',
            at: Date.now(),
            source: stale.source,
            reason: 'stale_before_speech',
          });
          return refreshOperatorQueue();
        })
        .catch(() => undefined);
      return;
    }
    const next = operatorQueue.find(
      (item) =>
        item.status === 'ready' &&
        item.preparedReply &&
        (!item.assignedOwnerId ||
          item.assignedOwnerId === runtimeOwnerIdRef.current),
    );
    if (!next?.preparedReply) return;
    const preparedReply = next.preparedReply;
    speakingOperatorTaskRef.current = next.eventId;
    void (async () => {
      let leaseTimer: number | null = null;
      try {
        await updateOperatorQueue(next.eventId, 'claim-speak', {
          ownerId: runtimeOwnerIdRef.current,
        });
        operatorBeatCountRef.current = 0;
        operatorCompletedBeatCountRef.current = 0;
        operatorAudioByteLengthRef.current = 0;
        leaseTimer = window.setInterval(() => {
          void updateOperatorQueue(next.eventId, 'renew-lease', {
            ownerId: runtimeOwnerIdRef.current,
          }).catch(() => undefined);
        }, 10_000);
        if (
          next.testRunId &&
          next.faultKind === 'tts-first-beat-failure' &&
          !next.faultConsumed
        ) {
          emitRuntimeEvent({
            eventId: next.eventId,
            testRunId: next.testRunId,
            stepId: next.stepId,
            scenarioId: next.scenarioId,
            stage: 'tts-beat-error',
            at: Date.now(),
            index: 0,
            reason: 'injected_test_failure',
          });
          await updateOperatorQueue(next.eventId, 'consume-fault');
          await updateOperatorQueue(next.eventId, 'retry');
          speakingOperatorTaskRef.current = null;
          return;
        }
        activeLifecycleRef.current = {
          eventId: next.eventId,
          replyText: preparedReply,
          channel: next.source,
          label: next.sourceLabel || next.source,
          viewerId: next.viewerId,
          viewerName: next.viewerName,
          sourcesSeen: next.sourcesSeen,
          testRunId: next.testRunId,
          stepId: next.stepId,
          scenarioId: next.scenarioId,
        };
        // A provider can hang before emitting its first TTS callback. Start a
        // short watchdog now; once playback begins, speech-start resets it to
        // the longer progress watchdog for multi-beat replies.
        armOperatorSpeechWatchdog(next.eventId, OPERATOR_TTS_START_TIMEOUT_MS);
        await speakPrepared(preparedReply);
      } catch (error) {
        if (operatorSpeechWatchdogRef.current !== null) {
          window.clearTimeout(operatorSpeechWatchdogRef.current);
          operatorSpeechWatchdogRef.current = null;
        }
        operatorPlaybackObservedRef.current = false;
        // The core can invoke onChatError before this outer catch runs, which
        // clears activeLifecycleRef.  Report from the queued item instead so
        // a first-beat failure always remains correlated to its stress step.
        emitRuntimeEvent({
          eventId: next.eventId,
          testRunId: next.testRunId,
          stepId: next.stepId,
          scenarioId: next.scenarioId,
          stage: 'failed',
          at: Date.now(),
          source: next.source,
          sourceLabel: next.sourceLabel,
          viewerId: next.viewerId,
          viewerName: next.viewerName,
          sourcesSeen: next.sourcesSeen,
          reason: 'tts_playback_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        if (activeLifecycleRef.current?.eventId === next.eventId) {
          activeLifecycleRef.current = null;
        }
        // The core already retries the first beat exactly once. Never requeue
        // a heard response, and do not add a second outer retry loop.
        await updateOperatorQueue(next.eventId, 'fail', {
          reason:
            operatorCompletedBeatCountRef.current > 0
              ? 'later_beat_failed_partial_playback_preserved'
              : 'tts_first_beat_failed_after_retry',
        }).catch(() => undefined);
        speakingOperatorTaskRef.current = null;
      } finally {
        if (leaseTimer !== null) window.clearInterval(leaseTimer);
        void refreshOperatorQueue();
      }
    })();
  }, [
    emitRuntimeEvent,
    isLiveRuntimeOwner,
    isProcessing,
    isSpeaking,
    hostCoordinatorV2Enabled,
    liveHostSnapshot.phase,
    operatorQueue,
    refreshOperatorQueue,
    armOperatorSpeechWatchdog,
    speakPrepared,
  ]);

  useEffect(() => {
    const handleNarrationRequest = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || window.parent === window) return;
      let origin: URL;
      try {
        origin = new URL(event.origin);
      } catch {
        return;
      }
      if (!['127.0.0.1', 'localhost', '::1'].includes(origin.hostname)) return;
      const data = event.data as {
        type?: unknown;
        scene?: unknown;
        requestedAt?: unknown;
        requestId?: unknown;
        text?: unknown;
        engagement?: unknown;
        viewerId?: unknown;
        viewerName?: unknown;
      };
      const requestedAt = Number(data.requestedAt);
      const now = Date.now();
      if (!Number.isFinite(requestedAt) || Math.abs(now - requestedAt) > 30_000)
        return;
      const messageKind = getHostBridgeMessageKind(data.type);
      const isLegacyMessage = isLegacyHostBridgeMessage(data.type);

      if (messageKind === 'engagement') {
        const signal =
          typeof data.engagement === 'string' ? data.engagement : '';
        if (
          signal !== 'follow' &&
          signal !== 'like' &&
          signal !== 'gift' &&
          signal !== 'superchat' &&
          signal !== 'guard'
        ) {
          return;
        }
        // Radar events share the same named viewer channel as its chat.
        const viewerId =
          typeof data.viewerId === 'string' && data.viewerId.trim()
            ? data.viewerId.trim()
            : '001号人类';
        const viewerName =
          typeof data.viewerName === 'string' && data.viewerName.trim()
            ? data.viewerName.trim()
            : viewerId;
        liveDirector.recordRelationshipSignal(
          {
            id: viewerId,
            name: viewerName,
          },
          signal,
        );
        return;
      }

      if (messageKind === 'chat') {
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        const requestId = String(data.requestId ?? '');
        if (!text || text.length > 500 || !requestId) return;
        // Acknowledge before starting model work. The parent retries until this
        // arrives, while request-id de-duplication keeps retries harmless.
        window.parent.postMessage(
          { type: hostBridgeType('chat-ack', isLegacyMessage), requestId },
          event.origin,
        );
        if (requestId) {
          if (handledExternalRequestIdsRef.current.has(requestId)) return;
          handledExternalRequestIdsRef.current.add(requestId);
          if (handledExternalRequestIdsRef.current.size > 100) {
            const oldest = handledExternalRequestIdsRef.current
              .values()
              .next().value;
            if (oldest) handledExternalRequestIdsRef.current.delete(oldest);
          }
        }
        const viewerId =
          typeof data.viewerId === 'string' && data.viewerId.trim()
            ? data.viewerId.trim()
            : '001号人类';
        const viewerName =
          typeof data.viewerName === 'string' && data.viewerName.trim()
            ? data.viewerName.trim()
            : viewerId;
        markLiveActivity('parent-message');
        interruptProactiveSpeech(requestId, viewerId);
        void enqueueOperatorMessage({
          eventId: requestId,
          text,
          source: 'parent-message',
          // The Typhoon Boss Radar iframe is one continuous viewer channel.
          // Give it a stable identity so memory, queue cards and prompts all
          // agree about who is speaking.
          sourceLabel: '台风雷达对话',
          sourcesSeen: ['typhoon-radar'],
          viewerId,
          viewerName,
        });
        return;
      }

      // Parent-page narration is intentionally disabled. The avatar reports
      // typhoon facts only after a real viewer asks, which avoids synthetic
      // rolling bulletins that make the live room feel staged.
      return;
    };
    window.addEventListener('message', handleNarrationRequest);
    // The parent must wait for this handshake instead of guessing when HMR or
    // iframe reloads have installed the message listener.
    window.parent.postMessage({ type: hostBridgeType('ready') }, '*');
    // Existing Typhoon Boss Radar embeds wait for the old ready event.
    window.parent.postMessage({ type: hostBridgeType('ready', true) }, '*');
    return () => window.removeEventListener('message', handleNarrationRequest);
  }, [
    liveDirector,
    markLiveActivity,
    enqueueOperatorMessage,
    interruptProactiveSpeech,
  ]);

  useEffect(() => {
    let cancelled = false;
    const receiveExternalChat = async () => {
      try {
        const response = await fetch('/api/external-chat', {
          cache: 'no-store',
        });
        if (response.status === 204 || !response.ok || cancelled) return;
        const data = (await response.json()) as {
          requestId?: unknown;
          text?: unknown;
          viewerId?: unknown;
          viewerName?: unknown;
        };
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (!text || text.length > 500) return;
        const eventId = String(data.requestId || crypto.randomUUID());
        const viewerId =
          typeof data.viewerId === 'string' ? data.viewerId : 'external-viewer';
        markLiveActivity('external-chat-bridge');
        interruptProactiveSpeech(eventId, viewerId);
        void enqueueOperatorMessage({
          eventId,
          text,
          source: 'external-chat-bridge',
          sourceLabel: '外部聊天桥接',
          viewerId:
            typeof data.viewerId === 'string' ? data.viewerId : '001号人类',
          viewerName:
            typeof data.viewerName === 'string' ? data.viewerName : '001号人类',
        });
      } catch {
        // The local bridge is optional while the runtime is starting up.
      }
    };
    void receiveExternalChat();
    const timer = window.setInterval(() => void receiveExternalChat(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enqueueOperatorMessage, interruptProactiveSpeech, markLiveActivity]);

  const handleSend = useCallback(
    (text: string) => {
      // Unlock audio while this Enter/click handler still has user-gesture
      // permission; TTS arrives asynchronously after the LLM response.
      void unlock();
      const lifecycle = beginConversationLifecycle({
        channel: 'web-chat',
        label: '总控手动输入',
      });
      replyLatencyRef.current = {
        requestId: crypto.randomUUID(),
        source: 'chat',
        inputAt: Date.now(),
        models: replyModelTrace,
        input: text,
        eventId: lifecycle.eventId,
        origin: { channel: 'web-chat' },
      };
      markLiveActivity('web-chat');
      interruptProactiveSpeech(lifecycle.eventId, 'operator');
      // Stop previous audio if speech is currently playing
      stop();
      resetAvatarReaction();
      void processWithHostExtensions(text, {
        memoryContext: streamerMemory.contextFor(text),
        eventId: lifecycle.eventId,
        sourceLabel: lifecycle.label,
      });
    },
    [
      unlock,
      stop,
      resetAvatarReaction,
      processWithHostExtensions,
      streamerMemory,
      markLiveActivity,
      replyModelTrace,
      beginConversationLifecycle,
      interruptProactiveSpeech,
    ],
  );

  const processLiveChat = useCallback(
    (
      text: string,
      options: {
        displayText?: string;
        viewerId?: string;
        viewerName?: string;
        eventId?: string;
        commentAt?: number;
        receivedAt?: number;
        queuedAt?: number;
        selectedAt?: number;
        processingAt?: number;
        sourcesSeen?: string[];
        catchup?: boolean;
      } = {},
    ) => {
      options.sourcesSeen = options.sourcesSeen ?? [];
      const displayText = options?.displayText ?? text;
      void enqueueOperatorMessage({
        eventId: options?.eventId ?? crypto.randomUUID(),
        text: displayText,
        source: options?.sourcesSeen?.join('+') || 'live-comment',
        sourceLabel: options?.sourcesSeen?.length
          ? `直播弹幕 · ${options?.sourcesSeen?.join(' / ') || ''}`
          : '直播弹幕',
        viewerId: options?.viewerId,
        viewerName: options?.viewerName,
        sourcesSeen: options?.sourcesSeen,
      });
      return Promise.resolve();
    },
    [enqueueOperatorMessage],
  );

  const {
    enqueueLiveComments,
    enqueueYouTubeComments,
    enqueueTwitchComments,
    enqueueLiveRoomEvents,
    queueDepth,
    oldestQueueAgeMs,
  } = useLiveCommentIntelligence({
    profile: runtimeProfile,
    messages,
    isProcessing,
    processChat: processLiveChat,
    streamPlatform: settingsHook.settings.stream.platform,
    llmSettings: settingsHook.settings.llm,
    getApiKeyForProvider: settingsHook.getApiKeyForProvider,
    enabled:
      settingsHook.settings.commentIntelligence.enabled && autoBroadcastEnabled,
    mode: settingsHook.settings.commentIntelligence.mode,
    analysisIntervalMs:
      settingsHook.settings.commentIntelligence.analysisIntervalMs,
    maxCommentsPerBatch:
      settingsHook.settings.commentIntelligence.maxCommentsPerBatch,
    minCommentsForLLMAnalysis:
      settingsHook.settings.commentIntelligence.minCommentsForLLMAnalysis,
    blockHighRiskViewers:
      settingsHook.settings.commentIntelligence.blockHighRiskViewers,
    viewerBlockDurationMs:
      settingsHook.settings.commentIntelligence.viewerBlockDurationMs,
    streamTopic: settingsHook.settings.commentIntelligence.streamTopic,
    streamTitle: settingsHook.settings.commentIntelligence.streamTitle,
    topicFilter: settingsHook.settings.commentIntelligence.topicFilter,
    onTransition: recordInteraction,
  });

  const socialStreamBus = useSocialStreamBus(
    settingsHook.settings.liveConnectors.socialStreamNinja,
    enqueueLiveComments,
  );
  useEffect(() => {
    socialStreamSendRef.current = socialStreamBus.send;
  }, [socialStreamBus.send]);

  useInterval(() => {
    if (
      !isLiveRuntimeOwner ||
      !autoBroadcastEnabled ||
      (settingsHook.settings.stream.platform === 'none' &&
        !settingsHook.settings.liveConnectors.ordinaryRoad.enabled &&
        !settingsHook.settings.liveConnectors.socialStreamNinja.enabled) ||
      isProcessing ||
      isSpeaking ||
      queueDepth > 0 ||
      oldestQueueAgeMs > 0
    )
      return;
    const room = liveDirector.getRoomSnapshot();
    const interfaceContext = [
      `当前时间：${new Date().toLocaleString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
      })}`,
      settingsHook.settings.commentIntelligence.streamTitle
        ? `节目标题：${settingsHook.settings.commentIntelligence.streamTitle}`
        : '',
      settingsHook.settings.commentIntelligence.streamTopic
        ? `节目主题：${settingsHook.settings.commentIntelligence.streamTopic}`
        : '',
      `当前头像状态：${avatarMotion}`,
      ...messages
        .filter((message) => message.role === 'assistant')
        .slice(-2)
        .map((message) => `界面最近出现过：${message.content.slice(0, 90)}`),
    ]
      .filter(Boolean)
      .join('；');
    const memoryCues = streamerMemory.records
      .filter(
        (record) =>
          record.digitalHumanId === runtimeProfile.id &&
          (record.subjectType === 'self' || record.subjectType === 'topic') &&
          record.visibility !== 'private' &&
          Boolean(record.lastSleptAt || record.sourceType === 'reflection') &&
          record.phase !== 'dormant' &&
          record.phase !== 'forgotten',
      )
      .sort(
        (left, right) =>
          (right.lastSleptAt || right.updatedAt) -
          (left.lastSleptAt || left.updatedAt),
      )
      .slice(0, 18)
      .map((record) => ({
        id: record.id,
        title: record.title,
        content: record.content.slice(0, 180),
      }));
    const awareness = emptyRoomAwarenessPlannerRef.current?.poll(
      emptyRoomAwarenessSettings,
      {
        digitalHumanName: runtimeProfile.displayName,
        digitalHumanTitle: runtimeProfile.title,
        isLive: room.isLive,
        audiencePresent: room.estimatedAudience > 0,
        busy:
          isProcessing || isSpeaking || queueDepth > 0 || oldestQueueAgeMs > 0,
        interfaceContext,
        memoryCues,
      },
    );
    if (awareness) {
      enqueueProactiveSpeech({
        prompt: awareness.prompt,
        awarenessSource: awareness.source,
        audiencePresent: room.estimatedAudience > 0,
        scheduledNextAt: awareness.scheduledNextAt,
      });
    }
  }, 10_000);

  const handleYoutubeComment = useCallback(
    (comment: YouTubeChatMessage) => {
      markLiveActivity('youtube-comment');
      interruptProactiveSpeech(comment.id, comment.userName);
      enqueueYouTubeComments([comment]);
    },
    [enqueueYouTubeComments, interruptProactiveSpeech, markLiveActivity],
  );

  const handleTwitchComment = useCallback(
    (comment: TwitchChatMessage) => {
      const eventId = `twitch:${crypto.randomUUID()}`;
      markLiveActivity('twitch-comment');
      interruptProactiveSpeech(eventId, comment.userName);
      enqueueTwitchComments([comment]);
    },
    [enqueueTwitchComments, interruptProactiveSpeech, markLiveActivity],
  );

  const handleLiveRoomEvent = useCallback(
    (comment: LiveRoomEvent) => {
      if (!liveDirector.isRoomLive()) return;
      const supportSignal =
        comment.type === 'gift'
          ? 'gift'
          : comment.type === 'superchat'
            ? 'superchat'
            : comment.type === 'guard'
              ? 'guard'
              : comment.type === 'follow'
                ? 'follow'
                : comment.type === 'like'
                  ? 'like'
                  : undefined;
      if (supportSignal) {
        const decisions = dispatchLiveHostEvent({
          type: 'engagement',
          at: comment.timestamp || Date.now(),
          eventId: comment.id,
          viewerId: comment.author.id,
          engagementKind: supportSignal,
          priority:
            supportSignal === 'superchat' || supportSignal === 'guard'
              ? 'high'
              : 'normal',
        });
        const interrupt = decisions.find(
          (decision) => decision.kind === 'interrupt',
        );
        if (interrupt?.kind === 'interrupt') {
          interruptSpeech(interrupt.mode);
        }
        liveDirector.recordRelationshipSignal(
          {
            id: comment.author.id,
            name: comment.author.name,
            platform: String(comment.metadata?.platformId || 'unknown'),
          },
          supportSignal,
        );
      }
      if (!isQuietRoomInteraction(comment.type)) {
        const platform = String(comment.metadata?.platformId || 'unknown');
        dispatchLiveHostEvent({
          type: 'viewer-presence',
          kind: 'join',
          at: comment.timestamp || Date.now(),
          eventId: comment.id,
          viewer: {
            id: comment.author.id,
            displayName: comment.author.name,
            platform:
              platform === 'bilibili' ||
              platform === 'douyin' ||
              platform === 'youtube' ||
              platform === 'twitch'
                ? platform
                : 'unknown',
            addressable: true,
            mayMentionName: false,
          },
        });
        liveDirector.observeViewerEntry(
          {
            id: comment.author.id,
            name: comment.author.name,
            platform: String(comment.metadata?.platformId || 'unknown'),
          },
          Number(comment.metadata?.firstSeenAt) || undefined,
        );
        emitRuntimeEvent({
          eventId: comment.id,
          stage: 'skipped',
          at: Date.now(),
          source: platform,
          viewerId: comment.author.id,
          viewerName: comment.author.name,
          reason: 'viewer_presence_only',
        });
        return;
      }
      // The radar is an optional parent display, never a second comment
      // consumer. Forward only normalized real comments over the existing
      // iframe bridge; the parent performs its own city parsing and cooldown.
      if (
        comment.type === 'comment' &&
        comment.text.trim() &&
        window.parent !== window
      ) {
        window.parent.postMessage(
          {
            type: 'aituber:live-comment',
            version: 1,
            id: comment.id,
            text: comment.text.trim(),
            viewerId: comment.author.id,
            viewerName: comment.author.name,
            platform:
              typeof comment.metadata?.platformId === 'string'
                ? comment.metadata.platformId
                : 'live',
            receivedAt: comment.timestamp,
          },
          '*',
        );
      }
      markLiveActivity(
        `${String(comment.metadata?.platformId || 'live')}-${comment.type}`,
      );
      if (!supportSignal) {
        interruptProactiveSpeech(comment.id, comment.author.id);
      } else {
        cancelQueuedProactiveSpeech('engagement_waits_for_next_beat');
      }
      enqueueLiveRoomEvents([comment]);
    },
    [
      cancelQueuedProactiveSpeech,
      dispatchLiveHostEvent,
      emitRuntimeEvent,
      enqueueLiveRoomEvents,
      interruptProactiveSpeech,
      interruptSpeech,
      liveDirector,
      markLiveActivity,
    ],
  );

  const handleSimulatedLiveRoomEvent = useCallback(
    (event: LiveRoomEvent) => {
      // This is called directly from a control-room button. Resume Web Audio
      // before the LLM/TTS round-trip so browser autoplay policy cannot leave
      // a successfully generated reply silent.
      void unlock().catch(() => undefined);
      // Keep the simulator on the same live-room path while making the test
      // room self-contained; it must not require a real platform connection.
      liveDirector.updateRoomState({
        isLive: true,
      });
      dispatchLiveHostEvent({ type: 'stream-state', at: Date.now(), isLive: true });
      handleLiveRoomEvent(event);
    },
    [dispatchLiveHostEvent, handleLiveRoomEvent, liveDirector, unlock],
  );

  const handleOrdinaryRoadStatus = useCallback(
    (status: LiveRoomStatus) => {
      liveDirector.updateRoomState(status);
      dispatchLiveHostEvent({
        type: 'stream-state',
        at: Date.now(),
        isLive: status.isLive === true,
      });
      setOrdinaryRoadStatus(status);
      if (status.state === 'online') {
        setStreamErrorMessage('');
      } else if (status.state === 'error') {
        setStreamErrorMessage(status.error || 'OrdinaryRoad 连接器正在重连。');
      }
    },
    [dispatchLiveHostEvent, liveDirector],
  );

  useEffect(() => {
    if (!settingsHook.settings.liveConnectors.ordinaryRoad.enabled) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await fetchOrdinaryRoadStatus(
          settingsHook.settings.liveConnectors.ordinaryRoad.gatewayUrl,
        );
        if (!cancelled) handleOrdinaryRoadStatus(status);
      } catch (error) {
        if (cancelled) return;
        handleOrdinaryRoadStatus({
          state: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'ordinaryroad_health_failed',
        });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    handleOrdinaryRoadStatus,
    settingsHook.settings.liveConnectors.ordinaryRoad.enabled,
    settingsHook.settings.liveConnectors.ordinaryRoad.gatewayUrl,
  ]);

  const handleLiveRoomStatus = useCallback(
    (status: LiveRoomStatus) => {
      liveDirector.updateRoomState(status);
      dispatchLiveHostEvent({
        type: 'stream-state',
        at: Date.now(),
        isLive: status.isLive === true,
      });
      if (status.state === 'error') {
        setStreamErrorMessage(status.error || '自定义直播平台连接正在重试。');
      }
    },
    [dispatchLiveHostEvent, liveDirector],
  );

  const handleBackgroundImageChange = useCallback((file: File | null) => {
    if (backgroundObjectUrlRef.current) {
      URL.revokeObjectURL(backgroundObjectUrlRef.current);
      backgroundObjectUrlRef.current = null;
    }

    if (!file) {
      setBackgroundImageUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    backgroundObjectUrlRef.current = nextUrl;
    setBackgroundImageUrl(nextUrl);
  }, []);

  const installAvatarPackage = useCallback(
    (loaded: PuruPuruAvatarPackage, source: AvatarPackageSource) => {
      setAvatarPackage((current) => {
        current?.dispose();
        avatarPackageRef.current = loaded;
        return loaded;
      });
      setAvatarPackageSource(source);
    },
    [],
  );

  const clearAvatarPackage = useCallback(() => {
    setAvatarPackage((current) => {
      current?.dispose();
      avatarPackageRef.current = null;
      return null;
    });
    setAvatarPackageSource(null);
  }, []);

  const handleAvatarPackageChange = useCallback(
    async (file: File | null) => {
      if (!file) {
        await digitalHumanAvatarStore.remove(runtimeProfile.id);
        updateDigitalHuman(runtimeProfile.id, { avatarAssetName: undefined });
        setActiveProfileAvatarId(null);
        clearAvatarPackage();
        return;
      }

      const requestId = avatarLoadRequestRef.current + 1;
      avatarLoadRequestRef.current = requestId;

      try {
        setAvatarLoadError(null);
        const loaded = await loadPuruPuruPackage(file);

        if (requestId !== avatarLoadRequestRef.current) {
          loaded.dispose();
          return;
        }

        installAvatarPackage(loaded, 'user');
        await digitalHumanAvatarStore.put(runtimeProfile.id, file);
        updateDigitalHuman(runtimeProfile.id, { avatarAssetName: file.name });
        setActiveProfileAvatarId(runtimeProfile.id);
      } catch (error) {
        if (requestId !== avatarLoadRequestRef.current) return;
        setAvatarLoadError(
          error instanceof Error
            ? error.message
            : '无法加载 .purupuru 形象包。',
        );
      }
    },
    [
      clearAvatarPackage,
      installAvatarPackage,
      runtimeProfile.id,
      updateDigitalHuman,
    ],
  );

  const handleDigitalHumanAvatarUpload = useCallback(
    (profileId: string, file: File | null) => {
      if (profileId !== runtimeProfile.id) {
        if (!file) {
          void digitalHumanAvatarStore.remove(profileId);
          updateDigitalHuman(profileId, { avatarAssetName: undefined });
          return;
        }
        void digitalHumanAvatarStore.put(profileId, file).then(() => {
          updateDigitalHuman(profileId, { avatarAssetName: file.name });
        });
        return;
      }
      void handleAvatarPackageChange(file);
    },
    [handleAvatarPackageChange, runtimeProfile.id, updateDigitalHuman],
  );

  useEffect(() => {
    const profileId = runtimeProfile.id;
    const requestId = avatarLoadRequestRef.current + 1;
    avatarLoadRequestRef.current = requestId;
    void (async () => {
      const blob = await digitalHumanAvatarStore.get(profileId);
      if (requestId !== avatarLoadRequestRef.current) return;
      if (!blob) {
        setActiveProfileAvatarId(null);
        clearAvatarPackage();
        return;
      }
      try {
        const file = new File([blob], `${profileId}.purupuru`, {
          type: blob.type || 'application/zip',
        });
        const loaded = await loadPuruPuruPackage(file);
        if (requestId !== avatarLoadRequestRef.current) {
          loaded.dispose();
          return;
        }
        installAvatarPackage(loaded, 'user');
        setActiveProfileAvatarId(profileId);
      } catch (error) {
        if (requestId !== avatarLoadRequestRef.current) return;
        clearAvatarPackage();
        setActiveProfileAvatarId(null);
        setAvatarLoadError(
          error instanceof Error ? error.message : '无法加载该数字人的头像包。',
        );
      }
    })();
  }, [clearAvatarPackage, installAvatarPackage, runtimeProfile.id]);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('access_token')) return;

    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    const state = params.get('state');
    const savedState = sessionStorage.getItem('twitchOauthState');

    if (token && state && state === savedState) {
      updateTwitchAccessToken(token);
      queueMicrotask(() => setStreamErrorMessage(''));
      sessionStorage.removeItem('twitchOauthState');
    }

    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
  }, [updateTwitchAccessToken]);

  useYoutubeComments({
    youtubeLiveId: settingsHook.settings.stream.youtubeLiveId,
    youtubeApiKey: settingsHook.settings.stream.youtubeApiKey,
    isEnabled:
      isLiveRuntimeOwner &&
      settingsHook.settings.stream.platform === 'youtube' &&
      !platformOwner(settingsHook.settings.liveConnectors, 'youtube') &&
      settingsHook.settings.stream.youtubeEnabled,
    intervalMs: settingsHook.settings.stream.youtubeCommentIntervalMs,
    onComment: handleYoutubeComment,
  });

  useTwitchComments({
    twitchChannel: settingsHook.settings.stream.twitchChannel,
    twitchClientId: settingsHook.settings.stream.twitchClientId,
    twitchAccessToken: settingsHook.settings.stream.twitchAccessToken,
    isEnabled:
      isLiveRuntimeOwner &&
      settingsHook.settings.stream.platform === 'twitch' &&
      !platformOwner(settingsHook.settings.liveConnectors, 'twitch') &&
      settingsHook.settings.stream.twitchEnabled,
    intervalMs: settingsHook.settings.stream.twitchCommentIntervalMs,
    onComment: handleTwitchComment,
    onTokenExpired: () => {
      settingsHook.updateTwitchAccessToken('');
      settingsHook.updateTwitchEnabled(false);
      setStreamErrorMessage('Twitch 访问令牌已过期，请重新连接。');
    },
    onError: (message) => {
      setStreamErrorMessage(message);
      if (message) {
        console.warn(message);
      }
    },
  });

  useLivePlatformEvents({
    adapter: ordinaryRoadEventAdapter,
    clientKey: isObsOverlay ? 'obs-runtime' : 'control-runtime',
    isEnabled:
      isLiveRuntimeOwner &&
      settingsHook.settings.liveConnectors.ordinaryRoad.enabled,
    onEvent: handleLiveRoomEvent,
    onStatus: handleOrdinaryRoadStatus,
  });

  useEffect(() => {
    if (!settingsHook.settings.liveConnectors.ordinaryRoad.enabled) {
      setOrdinaryRoadStatus({ state: 'disabled' });
    }
  }, [settingsHook.settings.liveConnectors.ordinaryRoad.enabled]);

  const customSseAdapter = useMemo(
    () =>
      createCustomSseEventAdapter(
        settingsHook.settings.stream.customSseEndpoint,
      ),
    [settingsHook.settings.stream.customSseEndpoint],
  );
  useLivePlatformEvents({
    adapter: customSseAdapter,
    clientKey: isObsOverlay ? 'obs-runtime' : 'control-runtime',
    isEnabled:
      isLiveRuntimeOwner &&
      settingsHook.settings.stream.platform === 'custom-sse' &&
      settingsHook.settings.stream.customSseEnabled &&
      !!settingsHook.settings.stream.customSseEndpoint.trim(),
    onEvent: handleLiveRoomEvent,
    onStatus: handleLiveRoomStatus,
  });

  // Close the dialog with the Escape key
  useEffect(() => {
    if (!settingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    const backgroundObjectUrl = backgroundObjectUrlRef;

    return () => {
      if (backgroundObjectUrl.current) {
        URL.revokeObjectURL(backgroundObjectUrl.current);
      }
    };
  }, []);

  useEffect(() => {
    avatarPackageRef.current = avatarPackage;
  }, [avatarPackage]);

  useEffect(() => {
    return () => {
      avatarLoadRequestRef.current += 1;
      avatarPackageRef.current?.dispose();
      avatarPackageRef.current = null;
    };
  }, []);

  const avatarViewTransform = useMemo(
    () => ({
      x: settingsHook.settings.visual.avatarViewX,
      y: settingsHook.settings.visual.avatarViewY,
      scale: settingsHook.settings.visual.avatarViewScale,
    }),
    [
      settingsHook.settings.visual.avatarViewX,
      settingsHook.settings.visual.avatarViewY,
      settingsHook.settings.visual.avatarViewScale,
    ],
  );

  return (
    <div className={`app${isObsOverlay ? ' app-obs-overlay' : ''}`}>
      {isObsOverlay ? (
        <ChatPanel
          messages={messages}
          partialResponse={partialResponse}
          isProcessing={isProcessing}
          onSend={handleSend}
          mouthLevel={mouthLevel}
          voiceLevel={smoothedValue}
          isSpeaking={isSpeaking}
          avatarPackage={avatarPackage}
          avatarReaction={avatarReaction}
          backgroundImageUrl={backgroundImageUrl}
          visual={settingsHook.settings.visual}
          avatarViewTransform={avatarViewTransform}
          onAvatarViewTransformChange={settingsHook.updateVisualAvatarView}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          overlay={isObsOverlay}
          avatarMotion={avatarMotion}
          usePersonaLiveAvatar={usePersonaLiveAvatar}
          speakingAvatarVideoUrl={speakingAvatarVideoUrl}
        />
      ) : (
        <ControlRoom
          messages={messages}
          partialResponse={partialResponse}
          isProcessing={isProcessing}
          isSpeaking={isSpeaking}
          mouthLevel={mouthLevel}
          voiceLevel={smoothedValue}
          queueDepth={queueDepth}
          oldestQueueAgeMs={oldestQueueAgeMs}
          interactionEvents={interactionEvents}
          interactionSummary={interactionSummary}
          operatorQueue={operatorQueue}
          stressRun={stressRun}
          onDiagnoseStressTest={() => runStressAction('diagnose')}
          onStartStressTest={() => runStressAction('start')}
          onPauseStressTest={() => runStressAction('pause')}
          onResumeStressTest={() => runStressAction('resume')}
          onAbortStressTest={() => runStressAction('abort')}
          onCleanupStressTest={() => runStressAction('cleanup')}
          onDeleteQueueItem={(eventId) => {
            void updateOperatorQueue(eventId, 'delete', {
              auditActor: 'control-room',
            }).then(() => refreshOperatorQueue());
          }}
          onMoveQueueItem={(eventId, order) => {
            void updateOperatorQueue(eventId, 'move', {
              order,
              auditActor: 'control-room',
            }).then(() => refreshOperatorQueue());
          }}
          onEditQueueReply={(eventId, reply) => {
            void updateOperatorQueue(eventId, 'edit-reply', {
              reply,
              auditActor: 'control-room',
            }).then(() => refreshOperatorQueue());
          }}
          settings={settingsHook.settings}
          avatarPackage={avatarPackage}
          avatarReaction={avatarReaction}
          avatarMotion={avatarMotion}
          speakingAvatarVideoUrl={speakingAvatarVideoUrl}
          avatarViewTransform={avatarViewTransform}
          onAvatarViewTransformChange={settingsHook.updateVisualAvatarView}
          onSend={handleSend}
          onBroadcast={(text) => {
            void enqueueManualBroadcast(text);
          }}
          onStop={() => {
            stop();
            resetAvatarReaction();
          }}
          onEmergencyTakeover={emergencyTakeover}
          liveHostSnapshot={liveHostSnapshot}
          unsupportedAvatarActionCount={unsupportedAvatarActionCount}
          autoBroadcastEnabled={autoBroadcastEnabled}
          onToggleAutoBroadcast={() => {
            setAutoBroadcastEnabled((value) => {
              const enabled = !value;
              if (enabled) {
                dispatchLiveHostEvent({
                  type: 'operator-command',
                  at: Date.now(),
                  command: 'resume',
                  isLive: liveDirector.isRoomLive(),
                });
              }
              return enabled;
            });
          }}
          onUpdateEmptyRoomAwareness={settingsHook.updateEmptyRoomAwareness}
          onOpenLegacySettings={() => setSettingsOpen(true)}
          socialBusHealth={socialStreamBus.health}
          socialBusError={socialStreamBus.error}
          socialDiscoveredPlatforms={socialStreamBus.discoveredPlatforms}
          ordinaryRoadStatus={ordinaryRoadStatus}
          onUpdateLiveConnectors={settingsHook.updateLiveConnectors}
          onSimulateLiveRoomEvent={handleSimulatedLiveRoomEvent}
          onSelectDigitalHuman={settingsHook.selectDigitalHuman}
          onAddDigitalHuman={settingsHook.addDigitalHuman}
          onUpdateDigitalHuman={settingsHook.updateDigitalHuman}
          onSetDigitalHumanEnabled={settingsHook.setDigitalHumanEnabled}
          onRemoveDigitalHuman={(id) => {
            void streamerMemory.removeDigitalHuman(id);
            settingsHook.removeDigitalHuman(id);
          }}
          onAvatarPackageUpload={handleDigitalHumanAvatarUpload}
          onPreviewVoice={handlePreviewDigitalHumanVoice}
          memory={streamerMemory}
          onAuditAction={(event) =>
            emitRuntimeEvent({
              stage: 'operator_ui_action',
              actor: { type: 'operator', id: 'control-room' },
              at: Date.now(),
              ...event,
            })
          }
        />
      )}

      {!isObsOverlay && settingsOpen && (
        <div
          className="settings-dialog-overlay"
          onClick={() => setSettingsOpen(false)}
        >
          <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="settings-dialog-header">
              <h2>设置</h2>
              <button
                className="settings-dialog-close"
                onClick={() => setSettingsOpen(false)}
              >
                &times;
              </button>
            </div>
            <SettingsPanel
              {...settingsHook}
              isProcessing={isProcessing}
              backgroundImageUrl={backgroundImageUrl}
              streamErrorMessage={streamErrorMessage}
              avatarPackage={avatarPackage}
              avatarPackageSource={avatarPackageSource}
              avatarLoadError={avatarLoadError}
              screenVisionController={screenVisionController}
              onBackgroundImageChange={handleBackgroundImageChange}
              onAvatarPackageChange={handleAvatarPackageChange}
              memory={streamerMemory}
            />
          </div>
        </div>
      )}
    </div>
  );
}
