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
  isCityReportEngagementPayload,
  normalizeCityReportEngagementPayload,
} from './lib/cityReportEngagementPolicy';
import {
  hasSoulPrimaryEvidence,
  type AcceptanceFingerprint,
  type AcceptanceLedger,
} from './lib/acceptanceLedger';
import {
  createSoulQuietEventData,
  EmptyRoomAwarenessPlanner,
  isQuietRoomInteraction,
  minimumQuietIntervalMs,
} from './lib/emptyRoomAwareness';
import { parseFlashHeadBundle } from './lib/flashheadBundle';
import { resolveEffectiveLiveRoomStatus } from './lib/liveRoomRuntimeState';
import { routeSimulatorEventForQueue } from './lib/simulatorRoom';
import {
  isSimulatorBridgeEvent,
  publishSimulatorEvent,
  SIMULATOR_EVENT_CHANNEL,
} from './lib/simulatorEventBridge';
import {
  createLiveCommentEvent,
  createViewerRelationEvent,
  normalizeViewerPlatform,
  viewerFollowRegistry,
} from './lib/viewerFollowRegistry';
import {
  createRadarCityCommandRouter,
  isRadarCityCommand,
  isRadarCityCommentEvent,
  readRelayedRadarCityComments,
  RADAR_CITY_EVENT_CHANNEL,
  relayRadarCityComment,
} from './lib/radarCityBridge';
import {
  getWeatherLocationClarification,
  routeSoulSkillDeterministically,
  routeTyphoonSkillWithAgent,
} from './lib/skillRoutingAgent';
import {
  formatPersonaInteractionPlan,
  planPersonaInteraction,
  type PersonaPlannerInput,
} from './lib/personaInteractionPlanner';
import { refinePersonaPlanWithAgent } from './lib/personaPlanningAgent';
import { LINGLAN_PERSONA_POLICY } from './lib/linglanPersonaPolicy';
import {
  PersonaRuntimeState,
  type PersonaRuntimeTransition,
  type ProactiveIntentPlanV1,
} from './lib/personaRuntimeState';
import { isRecentSemanticTopicRepeat } from './lib/personaTopicLedger';
import {
  buildViewerEntryWelcomePrompt,
  shouldWelcomeViewerEntry,
} from './lib/viewerEntryWelcome';
import { previewMinimaxVoice } from './lib/minimaxVoicePreview';
import { guardViewerResponse } from './lib/responseGuard';
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
  projectObservedLiveTurn,
  projectRoomInteractionSamples,
  recentParticipantEvidence,
} from './lib/liveConversationContext';
import {
  ROOM_ACTOR_ID,
  appendConversationHistoryScopeQuery,
  classifyLegacyMemoryMigration,
  classifyLegacyRelationshipMigration,
  type ConversationDeliveryStatus,
  type ConversationHistoryScope,
} from './lib/conversationHistory';
import type { LiveLifecycleTransition } from './lib/liveResponseScheduler';
import type { RoomInteractionSnapshot } from './lib/roomInteractionTracker';
import {
  isStaleReadyReply,
  type OperatorQueueItem,
  type PreparedSpeechPlan,
  updateOperatorQueue,
} from './lib/operatorQueue';
import { STRESS_TEST_PLAN } from './lib/stressTestPlan';
import {
  AvatarBehaviorBus,
  createAvatarBehaviorEvent,
  type AvatarAction,
} from '@aituber-onair/live-companion';
import {
  buildSpeechPlanV2,
  type SpeechPlanV2BuilderHints,
} from '@aituber-onair/core';
import type {
  CanonRevisionV1,
  SoulEventKind,
  SoulOutcomeStatus,
  SoulScopeV1,
  SubjectiveFactV1,
  SubjectiveMemoryRefV1,
} from '@aituber-onair/soul';
import {
  LINGLAN_SOUL_CONSTITUTION,
  LINGLAN_SOUL_PROFILE,
  createLinglanSoulEvent,
  speechPlanHintsForSoulDecision,
} from './lib/linglanSoul';
import { BrowserSoulRuntimeSession } from './lib/soulRuntimeClient';
import {
  projectSoulEvaluation,
  projectSoulState,
  type SoulInspectorTraceV1,
} from './lib/soulInspectorProjection';
import {
  requestSoulReflection,
  type SoulReflectionLedgerSummaryV1,
} from './lib/soulReflectionClient';
import {
  SoulCanonRepository,
  type SoulCanonProjectionV1,
} from './lib/soulCanonRepository';
import { evaluateSoulReflectionPolicy } from './lib/soulReflectionPolicy';
import {
  hasCompleteDeliveryEvidence,
  isLiveHostCoordinatorRequired,
  resolveAuthoritativeSpeechHints,
  resolveIncompleteDelivery,
} from './lib/liveHostDelivery';

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

type SoulCanaryActiveSummary = {
  runId: string;
  scope: SoulScopeV1;
  startedAt: number;
  runtimeOwnerClaimedAt?: number;
};

type SoulCanaryOperatorCredential = SoulCanaryActiveSummary & {
  version: 1;
  operatorToken: string;
};

type SoulCanaryRuntimeCredential = SoulCanaryActiveSummary & {
  eventToken: string;
  ownerId: string;
};

const SOUL_CANARY_OPERATOR_SESSION_KEY = 'aituber:soul-canary-operator:v1';
const SOUL_CANARY_MIN_DURATION_MS = 2 * 60 * 60_000;

function sameSoulScope(left: SoulScopeV1, right: SoulScopeV1): boolean {
  return (
    left.personaId === right.personaId &&
    left.platform === right.platform &&
    left.roomId === right.roomId &&
    left.sessionId === right.sessionId
  );
}

function readSoulCanaryOperatorCredential(): SoulCanaryOperatorCredential | null {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(SOUL_CANARY_OPERATOR_SESSION_KEY) || 'null',
    ) as Partial<SoulCanaryOperatorCredential> | null;
    if (
      parsed?.version !== 1 ||
      typeof parsed.runId !== 'string' ||
      typeof parsed.operatorToken !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(parsed.operatorToken) ||
      typeof parsed.startedAt !== 'number' ||
      !parsed.scope ||
      typeof parsed.scope.personaId !== 'string' ||
      typeof parsed.scope.platform !== 'string' ||
      typeof parsed.scope.roomId !== 'string' ||
      typeof parsed.scope.sessionId !== 'string'
    ) {
      return null;
    }
    return parsed as SoulCanaryOperatorCredential;
  } catch {
    return null;
  }
}

function persistSoulCanaryOperatorCredential(
  credential: SoulCanaryOperatorCredential | null,
): void {
  try {
    if (credential) {
      sessionStorage.setItem(
        SOUL_CANARY_OPERATOR_SESSION_KEY,
        JSON.stringify(credential),
      );
    } else {
      sessionStorage.removeItem(SOUL_CANARY_OPERATOR_SESSION_KEY);
    }
  } catch {
    // A private browsing/storage failure must not weaken server validation.
  }
}

function scopedViewerId(
  viewerId?: string,
  platform?: string,
): string | undefined {
  if (!viewerId) return undefined;
  return `${platform?.trim() || 'unknown'}:${viewerId}`;
}

function getOrCreateSoulSessionId(
  personaId: string,
  platform: string,
  roomId: string,
): string {
  const storageKey = `aituber:soul-session:${personaId}:${platform}:${roomId}`;
  try {
    const existing = localStorage.getItem(storageKey)?.trim();
    if (existing) return existing;
    const created = `soul-session:${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `soul-session:${crypto.randomUUID()}`;
  }
}

const soulRecoveryInFlight = new Map<
  string,
  Promise<BrowserSoulRuntimeSession>
>();

function recoverSoulRuntimeOnce(
  scopeKey: string,
  scope: SoulScopeV1,
): { promise: Promise<BrowserSoulRuntimeSession>; started: boolean } {
  const existing = soulRecoveryInFlight.get(scopeKey);
  if (existing) return { promise: existing, started: false };
  const promise = BrowserSoulRuntimeSession.recover({
    constitution: LINGLAN_SOUL_CONSTITUTION,
    profile: LINGLAN_SOUL_PROFILE,
    scope,
  });
  soulRecoveryInFlight.set(scopeKey, promise);
  const clear = () => {
    if (soulRecoveryInFlight.get(scopeKey) === promise) {
      soulRecoveryInFlight.delete(scopeKey);
    }
  };
  void promise.then(clear, clear);
  return { promise, started: true };
}

function soulEvidenceLevel(options: {
  testRunId?: string;
  sourceLabel?: string;
  sourcesSeen?: string[];
}) {
  const sources = [options.sourceLabel, ...(options.sourcesSeen ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (options.testRunId || /simulator|stress|synthetic/u.test(sources)) {
    return 'synthetic' as const;
  }
  if (/bilibili|douyin|youtube|twitch|ordinaryroad/u.test(sources)) {
    return 'production' as const;
  }
  return 'production-equivalent' as const;
}

function soulEventKindForTurn(
  isProactive: boolean,
  engagementSignals?: OperatorQueueItem['engagementSignals'],
): SoulEventKind {
  if (isProactive) return 'silence-tick';
  if (engagementSignals?.includes('follow')) return 'follow';
  if (engagementSignals?.includes('like')) return 'like-batch';
  if (
    engagementSignals?.some((signal) =>
      ['gift', 'superchat', 'guard'].includes(signal),
    )
  ) {
    return 'gift';
  }
  return 'audience-message';
}

function canaryOwnsSoulTurn(
  isProactive: boolean,
  engagementSignals: OperatorQueueItem['engagementSignals'] | undefined,
  moderation: string,
): boolean {
  return (
    isProactive ||
    Boolean(engagementSignals?.length) ||
    moderation === 'boundary' ||
    moderation === 'local_mute'
  );
}

function boundedSoulFactContent(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 1_200);
  try {
    return JSON.stringify(value).slice(0, 1_200);
  } catch {
    return String(value).slice(0, 1_200);
  }
}

function soulCanonMemoryRefs(
  revisions: readonly CanonRevisionV1[],
  actorId?: string,
): SubjectiveMemoryRefV1[] {
  return [...revisions]
    .filter(
      (revision) =>
        revision.status === 'active' &&
        (revision.involvesViewerIds.length === 0 ||
          (actorId !== undefined &&
            revision.involvesViewerIds.includes(actorId))),
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    )
    .slice(0, 6)
    .map((revision) => ({
      id: revision.id,
      content: `[character-canon; realityClass=${revision.realityClass}; disclose this class literally if asked whether it happened in the physical world] ${revision.content}`,
      provenance: `character-canon:${revision.realityClass}:${revision.contentHash}`,
      confidence: 1,
    }));
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
  ttsRequestAt?: number;
  ttsStartAt?: number;
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
};
type PendingPersonaRuntimeCommit = {
  interaction?: PersonaRuntimeTransition;
  proactive?: ProactiveIntentPlanV1;
};
type PendingDeliveredInteraction = {
  input: string;
  reply: string;
  eventId: string;
  viewerId?: string;
  viewerName?: string;
  source?: 'chat' | 'live' | 'vision';
  sourceLabel?: string;
  sourcesSeen?: string[];
};
type PendingGenerationFailure = {
  reason:
    | 'generation_auth_failed'
    | 'generation_truncated'
    | 'generation_failed';
  error: string;
  retryable: boolean;
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
  ttsRequestedAt?: number;
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

// FlashHead returns generated media behind the TTS stream. Keep enough ready
// media to bridge one normal render instead of starting after a single slice
// and then repeatedly running dry.
const FLASHHEAD_START_BUFFER_SECONDS = 2.5;
// This remains a latency cap for an unusually slow stream, but must not force
// playback before the normal continuity buffer has had a chance to fill.
const FLASHHEAD_PLAYBACK_START_WAIT_MS = 2_800;

// Speech always outranks an optional avatar render. If the local renderer is
// offline or cold, fall back to the idle avatar quickly and play the verified
// TTS audio instead of turning a short render delay into a silent reply.
const SPEAKING_RENDER_TIMEOUT_MS = 6_000;
// This is a *no-progress* watchdog, not a whole-reply deadline.  A real
// MiniMax reply may contain several separately synthesized sentences, so a
// fixed timer armed only at screenplay start used to kill valid playback after
// its first completed beat.
// A fact-complete Chinese weather answer can exceed 120 seconds of natural
// playback.  This is a no-progress watchdog, not a response-length limit.
const OPERATOR_SPEECH_WATCHDOG_MS = 45_000;
const OPERATOR_TTS_START_TIMEOUT_MS = 15_000;
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
  // The coordinator owns every public speech turn. This is intentionally not
  // derived from URL/settings state; `?hostCoordinatorV2=0` is no longer an
  // execution bypass.
  const hostCoordinatorV2Enabled = isLiveHostCoordinatorRequired();
  const speechPlanV2Enabled = query.get('speechPlanV2') !== '0';
  const personaPlannerEnabled = query.get('personaPlanner') !== '0';
  // Affine reactions are useful for renderer diagnostics, but they are not a
  // production motion system. Production only exposes renderer-backed output.
  const debugAffineAvatarMotion = query.get('debugAffineAvatarMotion') === '1';
  const isObsOverlay = query.get('overlay') === '1';
  const settingsHook = useSettings(isObsOverlay ? 'consumer' : 'producer');
  const requestedSoulMode = query.get('soulMode');
  const configuredSoulRuntimeMode =
    requestedSoulMode === 'legacy' ||
    requestedSoulMode === 'shadow' ||
    requestedSoulMode === 'canary' ||
    requestedSoulMode === 'primary'
      ? requestedSoulMode
      : settingsHook.settings.soul.runtimeMode;
  const [soulPrimaryGatePassed, setSoulPrimaryGatePassed] = useState(false);
  const refreshSoulPrimaryGate = useCallback(async () => {
    const response = await fetch('/api/acceptance-ledger', {
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const ledger = (await response.json()) as AcceptanceLedger & {
      currentFingerprint?: AcceptanceFingerprint;
      primaryEligible?: boolean;
    };
    const passed =
      ledger.primaryEligible === true &&
      hasSoulPrimaryEvidence(ledger, ledger.currentFingerprint);
    setSoulPrimaryGatePassed(passed);
    return passed;
  }, []);
  useEffect(() => {
    let cancelled = false;
    void refreshSoulPrimaryGate()
      .then((passed) => {
        if (!cancelled) setSoulPrimaryGatePassed(passed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshSoulPrimaryGate]);
  const soulRuntimeMode =
    configuredSoulRuntimeMode === 'primary' && !soulPrimaryGatePassed
      ? 'canary'
      : configuredSoulRuntimeMode;
  const soulPublicBehaviorEnabled =
    (soulRuntimeMode === 'canary' || soulRuntimeMode === 'primary') &&
    settingsHook.settings.digitalHumans.activeId ===
      LINGLAN_SOUL_CONSTITUTION.personaId;
  const activeBroadcastPolicy = useMemo(
    () => ({
      quietThresholdMs: settingsHook.settings.emptyRoomAwareness.minIntervalMs,
      proactiveCooldownMs:
        settingsHook.settings.emptyRoomAwareness.proactiveCooldownMs,
      maxProactiveTurns:
        settingsHook.settings.emptyRoomAwareness.maxProactiveTurns,
    }),
    [
      settingsHook.settings.emptyRoomAwareness.maxProactiveTurns,
      settingsHook.settings.emptyRoomAwareness.minIntervalMs,
      settingsHook.settings.emptyRoomAwareness.proactiveCooldownMs,
    ],
  );
  const [isTemporaryStressOwner, setIsTemporaryStressOwner] = useState(false);
  const isLiveRuntimeCandidate =
    isObsOverlay || query.get('listener') === '1' || isTemporaryStressOwner;
  const { ownsRuntime: isLiveRuntimeOwner, ownerId: runtimeOwnerId } =
    useRuntimeOwnerLease(isLiveRuntimeCandidate);
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
    audioUnlockRequired,
  } = useAudioLipsync();

  useEffect(() => {
    const unlockFromUserGesture = () => {
      void unlock().catch(() => undefined);
    };
    // Some control-room inputs (for example the embedded radar console) hand
    // their event to the runtime through a local bridge. By the time the
    // runtime receives it, the original click is no longer on the call stack
    // and Web Audio cannot be resumed. Capture any genuine operator gesture at
    // the window boundary so later live comments can use the already-running
    // shared AudioContext.
    window.addEventListener('pointerdown', unlockFromUserGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', unlockFromUserGesture, true);
    return () => {
      window.removeEventListener('pointerdown', unlockFromUserGesture, true);
      window.removeEventListener('keydown', unlockFromUserGesture, true);
    };
  }, [unlock]);
  const {
    items: interactionEvents,
    record: recordInteraction,
    restore: restoreInteractionFeed,
    summary: interactionSummary,
  } = useInteractionFeed();
  const [operatorQueue, setOperatorQueue] = useState<OperatorQueueItem[]>([]);
  const operatorQueueRef = useRef<OperatorQueueItem[]>([]);
  operatorQueueRef.current = operatorQueue;
  const [stressRun, setStressRun] = useState<StressRunState>(EMPTY_STRESS_RUN);
  const recentLiveTurnsRef = useRef<RecentLiveTurn[]>([]);
  const processingLiveEventIdsRef = useRef(new Set<string>());
  const radarCityCommandRouterRef = useRef(createRadarCityCommandRouter());
  const preparingOperatorTaskRef = useRef<string | null>(null);
  const generationFailureByEventIdRef = useRef(
    new Map<string, PendingGenerationFailure>(),
  );
  const generationFailureQueueMutationRef = useRef(new Set<string>());
  const speakingOperatorTaskRef = useRef<string | null>(null);
  const runtimeOwnerIdRef = useRef(`runtime-${crypto.randomUUID()}`);
  const operatorPlaybackObservedRef = useRef(false);
  const operatorSpeechWatchdogRef = useRef<number | null>(null);
  const operatorSpeechWatchdogArmRef = useRef<
    (eventId: string, timeoutMs?: number, reason?: string) => void
  >(() => undefined);
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
  const soulScope = useMemo<SoulScopeV1>(() => {
    const platform =
      settingsHook.settings.stream.platform === 'none'
        ? 'local'
        : settingsHook.settings.stream.platform;
    const roomId =
      settingsHook.settings.stream.youtubeLiveId.trim() ||
      settingsHook.settings.stream.twitchChannel.trim() ||
      settingsHook.settings.socialStream.sessionId.trim() ||
      'default-room';
    return {
      personaId: runtimeProfile.id,
      platform,
      roomId,
      sessionId: getOrCreateSoulSessionId(runtimeProfile.id, platform, roomId),
    };
  }, [
    runtimeProfile.id,
    settingsHook.settings.socialStream.sessionId,
    settingsHook.settings.stream.platform,
    settingsHook.settings.stream.twitchChannel,
    settingsHook.settings.stream.youtubeLiveId,
  ]);
  const conversationHistoryScopeFor = useCallback(
    (viewerId?: string, eventPlatform?: string): ConversationHistoryScope => {
      const scopedViewerId = viewerId?.trim() || ROOM_ACTOR_ID;
      const platform = eventPlatform?.trim() || soulScope.platform;
      const roomId =
        platform === 'youtube'
          ? settingsHook.settings.stream.youtubeLiveId.trim() ||
            soulScope.roomId
          : platform === 'twitch'
            ? settingsHook.settings.stream.twitchChannel.trim() ||
              soulScope.roomId
            : platform === soulScope.platform
              ? soulScope.roomId
              : settingsHook.settings.socialStream.sessionId.trim() ||
                'default-room';
      const sessionId =
        platform === soulScope.platform && roomId === soulScope.roomId
          ? soulScope.sessionId
          : getOrCreateSoulSessionId(soulScope.personaId, platform, roomId);
      return {
        personaId: soulScope.personaId,
        platform,
        roomId,
        sessionId,
        actorId: scopedViewerId,
        viewerId: scopedViewerId,
      };
    },
    [
      settingsHook.settings.socialStream.sessionId,
      settingsHook.settings.stream.twitchChannel,
      settingsHook.settings.stream.youtubeLiveId,
      soulScope,
    ],
  );
  const liveHostScope = useMemo(
    () => ({
      profileId: soulScope.personaId,
      sessionId: soulScope.sessionId,
      streamId: `${soulScope.platform}:${soulScope.roomId}`,
    }),
    [soulScope],
  );
  const soulScopeKey = `${soulScope.personaId}\u0000${soulScope.platform}\u0000${soulScope.roomId}\u0000${soulScope.sessionId}`;
  const [soulCanaryOperatorCredential, setSoulCanaryOperatorCredential] =
    useState<SoulCanaryOperatorCredential | null>(() =>
      readSoulCanaryOperatorCredential(),
    );
  const [activeSoulCanary, setActiveSoulCanary] =
    useState<SoulCanaryActiveSummary | null>(null);
  const [soulCanaryBusy, setSoulCanaryBusy] = useState<
    'starting' | 'finishing' | 'aborting' | undefined
  >();
  const [soulCanaryError, setSoulCanaryError] = useState('');
  const [soulCanaryClock, setSoulCanaryClock] = useState(Date.now());
  const soulCanaryRuntimeCredentialRef =
    useRef<SoulCanaryRuntimeCredential | null>(null);
  const {
    dispatch: dispatchLiveHostEvent,
    snapshot: liveHostSnapshot,
    claimSpeechPermission,
    pendingActions: pendingLiveHostActions,
    acknowledgeActions: acknowledgeLiveHostActions,
  } = useLiveHostCoordinator(activeBroadcastPolicy, liveHostScope);
  const baseSoulSession = useMemo(
    () =>
      runtimeProfile.id === LINGLAN_SOUL_CONSTITUTION.personaId
        ? new BrowserSoulRuntimeSession({
            constitution: LINGLAN_SOUL_CONSTITUTION,
            profile: LINGLAN_SOUL_PROFILE,
            scope: soulScope,
          })
        : null,
    [runtimeProfile.id, soulScope],
  );
  const [soulRecoveryState, setSoulRecoveryState] = useState<{
    scopeKey: string;
    status: 'loading' | 'ready' | 'failed';
    session?: BrowserSoulRuntimeSession;
    error?: string;
  }>(() => ({ scopeKey: soulScopeKey, status: 'loading' }));
  const soulSession =
    soulRuntimeMode === 'legacy'
      ? baseSoulSession
      : soulRecoveryState.scopeKey === soulScopeKey &&
          soulRecoveryState.status === 'ready'
        ? (soulRecoveryState.session ?? null)
        : null;
  const soulCanonRepository = useMemo(
    () =>
      runtimeProfile.id === LINGLAN_SOUL_CONSTITUTION.personaId
        ? new SoulCanonRepository({
            scope: soulScope,
            constitution: LINGLAN_SOUL_CONSTITUTION,
          })
        : null,
    [runtimeProfile.id, soulScope],
  );
  const [soulCanonProjection, setSoulCanonProjection] = useState<{
    scopeKey: string;
    projection: SoulCanonProjectionV1;
  } | null>(null);
  const activeSoulCanon = useMemo(
    () =>
      soulCanonProjection?.scopeKey === soulScopeKey
        ? soulCanonProjection.projection.active
        : [],
    [soulCanonProjection, soulScopeKey],
  );
  const soulSessionByEventIdRef = useRef(
    new Map<string, BrowserSoulRuntimeSession>(),
  );
  const soulOutcomePromiseByEventIdRef = useRef(
    new Map<string, Promise<void>>(),
  );
  const soulOutcomeFinalizerRef = useRef<
    (
      eventId: string,
      status: SoulOutcomeStatus,
      options?: { deliveredFraction?: number; reasonCode?: string },
    ) => Promise<void>
  >(async () => undefined);
  const activeSoulScopeContextRef = useRef({
    scopeKey: soulScopeKey,
    session: soulSession,
  });
  const scopeTransitionChainRef = useRef(Promise.resolve());
  const scopeTransitionEventIdsRef = useRef(new Set<string>());
  const runtimeScopeEpochRef = useRef(0);
  const runtimeScopeActivatedAtRef = useRef(Date.now());
  const [runtimeScopeReadyKey, setRuntimeScopeReadyKey] =
    useState(soulScopeKey);
  const soulReflectionEvidenceRef = useRef<SoulReflectionLedgerSummaryV1[]>([]);
  const soulReflectionInFlightRef = useRef(false);
  const soulLastReflectionAtRef = useRef(0);
  const soulPreviousHostPhaseRef = useRef(liveHostSnapshot.phase);
  const [soulInspectorTrace, setSoulInspectorTrace] =
    useState<SoulInspectorTraceV1 | null>(null);
  const [soulControlState, setSoulControlState] = useState({
    cognitionFrozen: false,
    cognitionFreezeOrigin: undefined as
      | 'operator'
      | 'state-persistence-failure'
      | 'snapshot-recovery'
      | undefined,
    memoryIsolated: false,
    neutralFallbackActive: false,
    operatorHasControl: false,
    snapshotRecoveryAvailable: true,
    busyControl: undefined as
      | 'cognition'
      | 'memory'
      | 'fallback'
      | 'snapshot'
      | 'operator'
      | undefined,
  });
  useEffect(() => {
    if (
      soulControlState.cognitionFrozen &&
      !soulControlState.cognitionFreezeOrigin
    ) {
      // Fast Refresh can preserve the pre-origin state shape in the OBS
      // runtime. That legacy state was produced by the rejected-reflection
      // bug above; migrate it once instead of requiring an OBS restart.
      setSoulControlState((state) => ({
        ...state,
        cognitionFrozen: false,
        neutralFallbackActive: false,
      }));
    }
  }, [
    soulControlState.cognitionFreezeOrigin,
    soulControlState.cognitionFrozen,
  ]);
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
  const personaRuntimeStateRef = useRef<PersonaRuntimeState | null>(null);
  if (!personaRuntimeStateRef.current) {
    personaRuntimeStateRef.current = new PersonaRuntimeState();
  }
  const pendingPersonaRuntimeCommitsRef = useRef<
    Map<string, PendingPersonaRuntimeCommit>
  >(new Map());
  const pendingDeliveredInteractionsRef = useRef<
    Map<string, PendingDeliveredInteraction>
  >(new Map());
  const conversationHistoryScopeByEventIdRef = useRef<
    Map<string, ConversationHistoryScope>
  >(new Map());
  const completedSpeechBeatTextByEventIdRef = useRef<
    Map<string, Map<number, string>>
  >(new Map());
  const commitConversationHistoryOutcome = useCallback(
    (
      eventId: string,
      deliveryStatus: Exclude<ConversationDeliveryStatus, 'generated'>,
      options: {
        viewerId?: string;
        deliveredFraction?: number;
        reasonCode?: string;
        ttsStartAt?: number;
        ttsEndAt?: number;
      } = {},
    ) => {
      const scope =
        conversationHistoryScopeByEventIdRef.current.get(eventId) ??
        conversationHistoryScopeFor(options.viewerId);
      const deliveredReply =
        deliveryStatus === 'partial'
          ? [
              ...(completedSpeechBeatTextByEventIdRef.current.get(eventId) ??
                new Map<number, string>()),
            ]
              .sort(([left], [right]) => left - right)
              .map(([, text]) => text)
              .join('')
              .trim() || undefined
          : undefined;
      void fetch('/api/conversation-history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          scope,
          deliveryStatus,
          deliveredFraction: options.deliveredFraction,
          deliveredReply,
          reasonCode: options.reasonCode,
          ttsStartAt: options.ttsStartAt,
          ttsEndAt: options.ttsEndAt,
        }),
      })
        .then((response) => {
          if (response.ok) {
            conversationHistoryScopeByEventIdRef.current.delete(eventId);
            completedSpeechBeatTextByEventIdRef.current.delete(eventId);
          }
        })
        .catch(() => undefined);
    },
    [conversationHistoryScopeFor],
  );
  const emptyRoomAwarenessPlannerRef = useRef<EmptyRoomAwarenessPlanner | null>(
    null,
  );
  if (!emptyRoomAwarenessPlannerRef.current) {
    emptyRoomAwarenessPlannerRef.current = new EmptyRoomAwarenessPlanner(
      Math.random,
      personaRuntimeStateRef.current,
    );
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

      const runtimeEvent = {
        ...event,
        scope: event.scope ?? soulScope,
        runtimeMode: event.runtimeMode ?? soulRuntimeMode,
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const canaryCredential = soulCanaryRuntimeCredentialRef.current;
      if (
        isLiveRuntimeOwner &&
        soulRuntimeMode === 'canary' &&
        canaryCredential?.ownerId === runtimeOwnerId &&
        sameSoulScope(canaryCredential.scope, soulScope)
      ) {
        headers['X-Soul-Canary-Run'] = canaryCredential.runId;
        headers['X-Soul-Canary-Token'] = canaryCredential.eventToken;
        headers['X-Runtime-Owner-Id'] = runtimeOwnerId;
      }
      void fetch('/api/live-runtime-events', {
        method: 'POST',
        headers,
        body: JSON.stringify(runtimeEvent),
      }).catch(() => undefined);
    },
    [
      isLiveRuntimeOwner,
      recordInteraction,
      runtimeOwnerId,
      soulRuntimeMode,
      soulScope,
    ],
  );
  const emitSoulRecoveryEventRef = useRef(emitRuntimeEvent);
  emitSoulRecoveryEventRef.current = emitRuntimeEvent;
  useEffect(() => {
    if (
      runtimeProfile.id !== LINGLAN_SOUL_CONSTITUTION.personaId ||
      soulRuntimeMode === 'legacy'
    ) {
      return;
    }
    let cancelled = false;
    setSoulRecoveryState({ scopeKey: soulScopeKey, status: 'loading' });
    const recovery = recoverSoulRuntimeOnce(soulScopeKey, soulScope);
    if (recovery.started) {
      emitSoulRecoveryEventRef.current({
        stage: 'soul_snapshot_recovery_started',
        at: Date.now(),
        scope: soulScope,
        reason: 'automatic-runtime-open',
      });
    }
    void recovery.promise
      .then((session) => {
        if (cancelled) return;
        setSoulRecoveryState({
          scopeKey: soulScopeKey,
          status: 'ready',
          session,
        });
        emitSoulRecoveryEventRef.current({
          stage: 'soul_snapshot_recovered',
          at: Date.now(),
          scope: soulScope,
          reason: 'automatic-runtime-open',
          stateVersion: session.getState().version,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setSoulRecoveryState({
          scopeKey: soulScopeKey,
          status: 'failed',
          error: message,
        });
        setSoulControlState((state) => ({
          ...state,
          cognitionFrozen: true,
          cognitionFreezeOrigin: 'snapshot-recovery',
          neutralFallbackActive: true,
        }));
        emitSoulRecoveryEventRef.current({
          stage: 'soul_snapshot_recovery_failed',
          at: Date.now(),
          scope: soulScope,
          reason: 'automatic-runtime-open',
          error: message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeProfile.id, soulRuntimeMode, soulScope, soulScopeKey]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const response = await fetch('/api/acceptance-ledger?activeCanary=1', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        activeCanaries?: SoulCanaryActiveSummary[];
      };
      if (cancelled) return;
      const active = Array.isArray(payload.activeCanaries)
        ? (payload.activeCanaries[0] ?? null)
        : null;
      setActiveSoulCanary(active);
      setSoulCanaryOperatorCredential((current) => {
        if (!current || active?.runId === current.runId) return current;
        persistSoulCanaryOperatorCredential(null);
        return null;
      });
    };
    void refresh().catch(() => undefined);
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      5_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!activeSoulCanary) return;
    setSoulCanaryClock(Date.now());
    const timer = window.setInterval(
      () => setSoulCanaryClock(Date.now()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, [activeSoulCanary]);
  useEffect(() => {
    if (!isLiveRuntimeOwner || soulRuntimeMode !== 'canary') {
      soulCanaryRuntimeCredentialRef.current = null;
      return;
    }
    let cancelled = false;
    const claimActiveCanary = async () => {
      const activeResponse = await fetch(
        '/api/acceptance-ledger?activeCanary=1',
        { cache: 'no-store' },
      );
      if (!activeResponse.ok) return;
      const activePayload = (await activeResponse.json()) as {
        activeCanaries?: SoulCanaryActiveSummary[];
      };
      const active = activePayload.activeCanaries?.find((candidate) =>
        sameSoulScope(candidate.scope, soulScope),
      );
      if (!active) {
        soulCanaryRuntimeCredentialRef.current = null;
        return;
      }
      const current = soulCanaryRuntimeCredentialRef.current;
      if (
        current?.runId === active.runId &&
        current.ownerId === runtimeOwnerId
      ) {
        return;
      }
      const response = await fetch('/api/acceptance-ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Owner-Id': runtimeOwnerId,
        },
        body: JSON.stringify({
          action: 'claim-soul-canary-runtime',
          scope: soulScope,
        }),
      });
      if (!response.ok) return;
      const claimed = (await response.json()) as {
        runId?: unknown;
        eventToken?: unknown;
        scope?: SoulScopeV1;
        startedAt?: unknown;
      };
      if (
        cancelled ||
        typeof claimed.runId !== 'string' ||
        typeof claimed.eventToken !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(claimed.eventToken) ||
        typeof claimed.startedAt !== 'number' ||
        !claimed.scope
      ) {
        return;
      }
      soulCanaryRuntimeCredentialRef.current = {
        runId: claimed.runId,
        eventToken: claimed.eventToken,
        scope: claimed.scope,
        startedAt: claimed.startedAt,
        ownerId: runtimeOwnerId,
      };
      emitRuntimeEvent({
        stage: 'soul_canary_runtime_claimed',
        at: Date.now(),
        runId: claimed.runId,
      });
    };
    void claimActiveCanary().catch(() => undefined);
    const timer = window.setInterval(
      () => void claimActiveCanary().catch(() => undefined),
      5_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    emitRuntimeEvent,
    isLiveRuntimeOwner,
    runtimeOwnerId,
    soulRuntimeMode,
    soulScope,
  ]);
  const startSoulCanary = useCallback(async () => {
    if (soulRuntimeMode !== 'canary') {
      setSoulCanaryError('请先将 Soul Runtime 切换为 Canary。');
      return;
    }
    setSoulCanaryBusy('starting');
    setSoulCanaryError('');
    try {
      const response = await fetch('/api/acceptance-ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Settings-Role': 'producer',
        },
        body: JSON.stringify({
          action: 'start-soul-canary',
          scope: soulScope,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        runId?: unknown;
        operatorToken?: unknown;
        scope?: SoulScopeV1;
        startedAt?: unknown;
        error?: unknown;
      };
      if (
        !response.ok ||
        typeof payload.runId !== 'string' ||
        typeof payload.operatorToken !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(payload.operatorToken) ||
        typeof payload.startedAt !== 'number' ||
        !payload.scope
      ) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : 'soul_canary_start_failed',
        );
      }
      const credential: SoulCanaryOperatorCredential = {
        version: 1,
        runId: payload.runId,
        operatorToken: payload.operatorToken,
        scope: payload.scope,
        startedAt: payload.startedAt,
      };
      persistSoulCanaryOperatorCredential(credential);
      setSoulCanaryOperatorCredential(credential);
      setActiveSoulCanary(credential);
      setSoulCanaryClock(Date.now());
      emitRuntimeEvent({
        stage: 'soul_canary_started',
        at: Date.now(),
        runId: credential.runId,
      });
    } catch (error) {
      setSoulCanaryError(
        error instanceof Error ? error.message : 'soul_canary_start_failed',
      );
    } finally {
      setSoulCanaryBusy(undefined);
    }
  }, [emitRuntimeEvent, soulRuntimeMode, soulScope]);
  const finishSoulCanary = useCallback(async () => {
    const credential = soulCanaryOperatorCredential;
    if (!credential) return;
    setSoulCanaryBusy('finishing');
    setSoulCanaryError('');
    try {
      const response = await fetch('/api/acceptance-ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Settings-Role': 'producer',
          'X-Soul-Canary-Operator-Token': credential.operatorToken,
        },
        body: JSON.stringify({
          action: 'finish-soul-canary',
          runId: credential.runId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : 'soul_canary_finish_failed',
        );
      }
      persistSoulCanaryOperatorCredential(null);
      setSoulCanaryOperatorCredential(null);
      setActiveSoulCanary(null);
      soulCanaryRuntimeCredentialRef.current = null;
      await refreshSoulPrimaryGate();
    } catch (error) {
      setSoulCanaryError(
        error instanceof Error ? error.message : 'soul_canary_finish_failed',
      );
    } finally {
      setSoulCanaryBusy(undefined);
    }
  }, [refreshSoulPrimaryGate, soulCanaryOperatorCredential]);
  const abortSoulCanary = useCallback(async () => {
    const credential = soulCanaryOperatorCredential;
    if (!credential) return;
    setSoulCanaryBusy('aborting');
    setSoulCanaryError('');
    try {
      const response = await fetch('/api/acceptance-ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Settings-Role': 'producer',
          'X-Soul-Canary-Operator-Token': credential.operatorToken,
        },
        body: JSON.stringify({
          action: 'abort-soul-canary',
          runId: credential.runId,
          reasonCode: 'operator-aborted-from-soul-inspector',
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : 'soul_canary_abort_failed',
        );
      }
      persistSoulCanaryOperatorCredential(null);
      setSoulCanaryOperatorCredential(null);
      setActiveSoulCanary(null);
      soulCanaryRuntimeCredentialRef.current = null;
    } catch (error) {
      setSoulCanaryError(
        error instanceof Error ? error.message : 'soul_canary_abort_failed',
      );
    } finally {
      setSoulCanaryBusy(undefined);
    }
  }, [soulCanaryOperatorCredential]);
  const recordSoulReflectionEvidence = useCallback(
    (entry: SoulReflectionLedgerSummaryV1) => {
      soulReflectionEvidenceRef.current = [
        ...soulReflectionEvidenceRef.current.filter(
          (candidate) => candidate.eventId !== entry.eventId,
        ),
        entry,
      ].slice(-24);
    },
    [],
  );
  useEffect(() => {
    if (!soulCanonRepository || soulRuntimeMode === 'legacy') return;
    let cancelled = false;
    void soulCanonRepository
      .load()
      .then((projection) => {
        if (cancelled) return;
        setSoulCanonProjection({ scopeKey: soulScopeKey, projection });
        emitRuntimeEvent({
          stage: 'soul_canon_projection_loaded',
          at: Date.now(),
          scope: soulScope,
          activeCount: projection.active.length,
          candidateCount: projection.candidates.length,
          supersededCount: projection.superseded.length,
          retractedCount: projection.retracted.length,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        emitRuntimeEvent({
          stage: 'soul_canon_projection_failed_closed',
          at: Date.now(),
          scope: soulScope,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    emitRuntimeEvent,
    soulCanonRepository,
    soulRuntimeMode,
    soulScope,
    soulScopeKey,
  ]);

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
        llmToTtsRequestMs:
          replyTrace.llmCompletedAt && replyTrace.ttsRequestedAt
            ? replyTrace.ttsRequestedAt - replyTrace.llmCompletedAt
            : null,
        ttsRequestToFirstByteMs:
          replyTrace.ttsRequestedAt && replyTrace.ttsFirstByteAt
            ? replyTrace.ttsFirstByteAt - replyTrace.ttsRequestedAt
            : null,
        firstByteToPlaybackMs:
          replyTrace.ttsFirstByteAt && replyTrace.firstPlaybackAt
            ? replyTrace.firstPlaybackAt - replyTrace.ttsFirstByteAt
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
      const requestedAt = Date.now();
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
        emitRuntimeEvent({
          eventId: activeLifecycleRef.current?.eventId,
          stage: `${speakingAvatarEngine}_render_request`,
          at: requestedAt,
          sequence: options.sequence ?? 0,
          byteLength: arrayBuffer.byteLength,
          reset: options.reset === true,
          end: options.end === true,
        });
        const response = await fetch(
          `/api/${speakingAvatarEngine}/render?${parameters.toString()}`,
          {
            method: 'POST',
            headers,
            body: arrayBuffer.slice(0),
            signal: controller.signal,
          },
        );
        const headersAt = Date.now();
        emitRuntimeEvent({
          eventId: activeLifecycleRef.current?.eventId,
          stage: `${speakingAvatarEngine}_render_headers`,
          at: headersAt,
          sequence: options.sequence ?? 0,
          requestToHeadersMs: headersAt - requestedAt,
          status: response.status,
        });
        if (response.status === 204) return null;
        if (!response.ok) {
          throw new Error(
            `${speakingAvatarEngine} returned ${response.status}`,
          );
        }
        const payload = new Uint8Array(await response.arrayBuffer());
        emitRuntimeEvent({
          eventId: activeLifecycleRef.current?.eventId,
          stage: `${speakingAvatarEngine}_render_completed`,
          at: Date.now(),
          sequence: options.sequence ?? 0,
          requestToMediaMs: Date.now() - requestedAt,
          payloadByteLength: payload.byteLength,
        });
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

  const markSpeechAudioReady = useCallback(
    (byteLength: number) => {
      const active = activeLifecycleRef.current;
      if (!active?.eventId || active.ttsStartAt) return;
      const at = Date.now();
      active.ttsStartAt = at;
      operatorSpeechWatchdogArmRef.current(active.eventId);
      dispatchLiveHostEvent({
        type: 'speech',
        at,
        eventId: active.eventId,
        stage: 'started',
        beatIndex: 0,
        interruptibleAfter: false,
      });
      emitRuntimeEvent({
        eventId: active.eventId,
        stage: 'speaking',
        at,
        source: active.channel,
        sourceLabel: active.label,
        viewerId: active.viewerId,
        viewerName: active.viewerName,
        sourcesSeen: active.sourcesSeen,
      });
      emitRuntimeEvent({
        eventId: active.eventId,
        stage: 'tts_first_audio',
        at,
        requestedAt: active.ttsRequestAt,
        requestToFirstAudioMs: active.ttsRequestAt
          ? at - active.ttsRequestAt
          : undefined,
        byteLength,
        source: active.channel,
        sourceLabel: active.label,
      });
    },
    [dispatchLiveHostEvent, emitRuntimeEvent],
  );

  const handleAudioPlay = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      speechBeatBytesRef.current += arrayBuffer.byteLength;
      if (arrayBuffer.byteLength > 0)
        markSpeechAudioReady(arrayBuffer.byteLength);
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
    [
      captureTts,
      finalizeReplyLatency,
      markSpeechAudioReady,
      playAudioChunk,
      renderSpeakingVideo,
    ],
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
      if (current.value.byteLength > 0)
        markSpeechAudioReady(current.value.byteLength);
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
      const sourceChunks = [current.value.slice(0)];
      let firstChunk = true;
      let playbackStarted = speakingAvatarEngine !== 'flashhead';
      let stagedDuration = 0;
      const stagedMedia: RenderedSpeakingMedia[] = [];
      const generatedVideoUrls: string[] = [];
      let startDeadlineTimer: number | null = null;
      let rendererProducedMedia = false;

      // Do not race a FlashHead render against a shorter UI deadline. The
      // renderer holds streaming MP3 state across requests, so treating a
      // merely slow response as absent discards its generated audio/video and
      // produces audible gaps. `renderSpeakingVideo` still has the hard
      // no-progress timeout above, so an unavailable renderer cannot hang the
      // speech pipeline forever.
      const awaitStreamRender = async (
        pendingRender: Promise<RenderedSpeakingMedia | null>,
      ): Promise<RenderedSpeakingMedia | null> => pendingRender;

      const enqueuePlayable = async (
        audioBuffer: ArrayBuffer,
        videoUrl?: string,
      ) => {
        const emitThisChunk = firstChunk;
        if (videoUrl) generatedVideoUrls.push(videoUrl);
        await enqueue(audioBuffer, {
          onVisualStart: videoUrl
            ? () => setSpeakingAvatarVideoUrl(videoUrl)
            : undefined,
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

      const enqueueRendered = async (rendered: RenderedSpeakingMedia) => {
        await enqueuePlayable(rendered.audioBuffer, rendered.videoUrl);
      };

      const enqueueRendererFallback = async (audioBuffer: ArrayBuffer) => {
        if (!playbackStarted) {
          playbackStarted = true;
          if (startDeadlineTimer !== null) {
            window.clearTimeout(startDeadlineTimer);
            startDeadlineTimer = null;
          }
        }
        emitRuntimeEvent({
          eventId: activeLifecycleRef.current?.eventId,
          stage: 'flashhead_audio_fallback',
          at: Date.now(),
          byteLength: audioBuffer.byteLength,
          reason: 'renderer_returned_no_playable_media',
        });
        await enqueuePlayable(audioBuffer);
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
          }, FLASHHEAD_PLAYBACK_START_WAIT_MS);
        }
        if (!forceStart && stagedDuration < FLASHHEAD_START_BUFFER_SECONDS)
          return;
        await startStagedPlayback();
      };

      while (!current.done) {
        const sourceAudio = current.value;
        const nextPromise = iterator.next();
        const rendered = await awaitStreamRender(renderPromise);
        if (rendered) {
          rendererProducedMedia = true;
          await stageOrEnqueue(rendered);
        } else if (sourceAudio.byteLength > 0) {
          if (speakingAvatarEngine === 'flashhead') {
            // Streaming MP3 fragments are not independently decodable.
            // FlashHead has accepted the fragment into its current session;
            // the explicit end request below gets the first chance to flush it.
            emitRuntimeEvent({
              eventId: activeLifecycleRef.current?.eventId,
              stage: 'flashhead_fragment_deferred',
              at: Date.now(),
              byteLength: sourceAudio.byteLength,
              reason: 'renderer_session_will_flush_tail',
            });
          } else {
            await enqueueRendererFallback(sourceAudio);
          }
        }
        const next = await nextPromise;
        if (!next.done) speechBeatBytesRef.current += next.value.byteLength;
        if (!next.done) sourceChunks.push(next.value.slice(0));
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
        const finalRendered = await awaitStreamRender(
          renderSpeakingVideo(new ArrayBuffer(0), {
            end: true,
            sequence: ++sequence,
          }),
        );
        if (finalRendered) {
          rendererProducedMedia = true;
          await stageOrEnqueue(finalRendered, true);
        }
        if (!rendererProducedMedia && sourceChunks.length) {
          const byteLength = sourceChunks.reduce(
            (total, chunk) => total + chunk.byteLength,
            0,
          );
          const completeAudio = new Uint8Array(byteLength);
          let offset = 0;
          for (const chunk of sourceChunks) {
            completeAudio.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          await enqueueRendererFallback(completeAudio.buffer);
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
      emitRuntimeEvent,
      enqueue,
      finishQueue,
      finalizeReplyLatency,
      markSpeechAudioReady,
      renderSpeakingVideo,
      speakingAvatarEngine,
    ],
  );

  const armOperatorSpeechWatchdog = useCallback(
    (
      eventId: string,
      timeoutMs = OPERATOR_SPEECH_WATCHDOG_MS,
      reason = 'tts_progress_timeout',
    ) => {
      if (speakingOperatorTaskRef.current !== eventId) return;
      if (operatorSpeechWatchdogRef.current !== null) {
        window.clearTimeout(operatorSpeechWatchdogRef.current);
      }
      operatorSpeechWatchdogRef.current = window.setTimeout(() => {
        if (speakingOperatorTaskRef.current !== eventId) return;
        // This fires only when neither a TTS beat nor playback completion has
        // made progress for the watchdog window.  Do not confuse a long,
        // multi-beat response with a stalled renderer.
        const active = activeLifecycleRef.current;
        const outcome = resolveIncompleteDelivery({
          beatCount: operatorBeatCountRef.current,
          completedBeatCount: operatorCompletedBeatCountRef.current,
          audioByteLength: operatorAudioByteLengthRef.current,
          playbackObserved:
            operatorPlaybackObservedRef.current || Boolean(active?.ttsStartAt),
        });
        stop();
        speakingOperatorTaskRef.current = null;
        operatorPlaybackObservedRef.current = false;
        operatorSpeechWatchdogRef.current = null;
        if (active?.eventId === eventId) {
          emitRuntimeEvent({
            eventId,
            stage: 'failed',
            at: Date.now(),
            source: active.channel,
            sourceLabel: active.label,
            viewerId: active.viewerId,
            viewerName: active.viewerName,
            sourcesSeen: active.sourcesSeen,
            reason,
            soulOutcomeStatus: outcome.status,
            deliveredFraction: outcome.deliveredFraction,
          });
        }
        dispatchLiveHostEvent({
          type: 'runtime-fault',
          at: Date.now(),
          eventId,
          reasonCode: reason,
        });
        commitConversationHistoryOutcome(eventId, outcome.status, {
          viewerId: active?.viewerId,
          deliveredFraction: outcome.deliveredFraction,
          reasonCode: reason,
          ttsStartAt: active?.ttsStartAt,
          ttsEndAt: Date.now(),
        });
        void (async () => {
          await soulOutcomeFinalizerRef.current(eventId, outcome.status, {
            deliveredFraction: outcome.deliveredFraction,
            reasonCode: reason,
          });
          pendingPersonaRuntimeCommitsRef.current.delete(eventId);
          pendingDeliveredInteractionsRef.current.delete(eventId);
          if (activeLifecycleRef.current?.eventId === eventId) {
            activeLifecycleRef.current = null;
          }
          await updateOperatorQueue(eventId, 'fail', { reason }).catch(
            () => undefined,
          );
        })();
      }, timeoutMs);
    },
    [
      commitConversationHistoryOutcome,
      dispatchLiveHostEvent,
      emitRuntimeEvent,
      stop,
    ],
  );
  operatorSpeechWatchdogArmRef.current = armOperatorSpeechWatchdog;

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
        if (speakingOperatorTaskRef.current === active.eventId) {
          operatorPlaybackObservedRef.current = false;
        }
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
      debugAffineAvatarMotion,
      emitRuntimeEvent,
      settingsHook.settings.liveConnectors,
      useSpeakingAvatar,
    ],
  );

  const finalizeSoulOutcome = useCallback(
    (
      eventId: string,
      status: SoulOutcomeStatus,
      options: {
        deliveredFraction?: number;
        reasonCode?: string;
      } = {},
    ): Promise<void> => {
      const existing = soulOutcomePromiseByEventIdRef.current.get(eventId);
      if (existing) return existing;
      const session = soulSessionByEventIdRef.current.get(eventId);
      if (!session) return Promise.resolve();
      const finalizing = session
        .applyOutcome(eventId, status, options)
        .then(({ state, persistenceOk, persistenceError }) => {
          setSoulInspectorTrace((previous) =>
            previous?.event.id === eventId
              ? {
                  ...previous,
                  state: projectSoulState(state),
                  outcome: {
                    status,
                    occurredAt: Date.now(),
                    deliveredFraction: options.deliveredFraction,
                    reasonCode: options.reasonCode,
                  },
                }
              : previous,
          );
          emitRuntimeEvent({
            eventId,
            stage: 'soul_outcome_committed',
            at: Date.now(),
            scope: session.scope,
            runtimeMode: soulRuntimeMode,
            status,
            deliveredFraction: options.deliveredFraction,
            reasonCode: options.reasonCode,
            persistenceOk,
            persistenceError,
            stateVersion: state.version,
          });
        })
        .catch((error) => {
          emitRuntimeEvent({
            eventId,
            stage: 'soul_outcome_failed',
            at: Date.now(),
            status,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          soulOutcomePromiseByEventIdRef.current.delete(eventId);
          soulSessionByEventIdRef.current.delete(eventId);
        });
      soulOutcomePromiseByEventIdRef.current.set(eventId, finalizing);
      return finalizing;
    },
    [emitRuntimeEvent, soulRuntimeMode],
  );
  soulOutcomeFinalizerRef.current = finalizeSoulOutcome;

  const handleSpeechEnd = useCallback(() => {
    if (replyLatencyRef.current) {
      replyLatencyRef.current.speechEndSignaledAt = Date.now();
    }
    const active = activeLifecycleRef.current;
    const isOperatorPlayback =
      Boolean(active?.eventId) &&
      speakingOperatorTaskRef.current === active?.eventId;
    const hasCompleteOperatorAudio = hasCompleteDeliveryEvidence({
      beatCount: operatorBeatCountRef.current,
      completedBeatCount: operatorCompletedBeatCountRef.current,
      audioByteLength: operatorAudioByteLengthRef.current,
    });
    // Streaming TTS can briefly report an idle state between beats.  That is
    // not the end of the queued response: keep its lease and lifecycle alive
    // until every planned beat has completed.
    if (isOperatorPlayback && !hasCompleteOperatorAudio) return;
    if (active?.eventId) {
      const ttsEndAt = Date.now();
      const isSoulDelivery = soulSessionByEventIdRef.current.has(
        active.eventId,
      );
      dispatchLiveHostEvent({
        type: 'speech',
        at: ttsEndAt,
        eventId: active.eventId,
        stage: 'completed',
      });
      finalizeSoulOutcome(active.eventId, 'spoken', {
        deliveredFraction: 1,
        reasonCode: 'tts-playback-completed',
      });
      commitConversationHistoryOutcome(active.eventId, 'spoken', {
        viewerId: active.viewerId,
        deliveredFraction: 1,
        reasonCode: 'tts-playback-completed',
        ttsStartAt: active.ttsStartAt,
        ttsEndAt,
      });
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
      const personaCommit = pendingPersonaRuntimeCommitsRef.current.get(
        active.eventId,
      );
      if (personaCommit?.interaction) {
        personaRuntimeStateRef.current!.commitInteraction(
          personaCommit.interaction,
        );
      }
      if (personaCommit?.proactive) {
        personaRuntimeStateRef.current!.commitProactive(
          personaCommit.proactive,
          ttsEndAt,
        );
      }
      if (personaCommit) {
        const snapshot = personaRuntimeStateRef.current!.snapshot(ttsEndAt);
        emitRuntimeEvent({
          eventId: active.eventId,
          stage: 'persona_state_committed',
          at: ttsEndAt,
          activeDrive: personaCommit.proactive?.drive,
          topicFamily: personaCommit.proactive?.topicFamily,
          topicSource: personaCommit.proactive?.source,
          emotion: snapshot.emotion.activeAffect?.label,
          emotionIntensity: snapshot.emotion.activeAffect?.intensity,
          mood: snapshot.emotion.mood,
          topicLedgerSize: snapshot.topics.length,
        });
        pendingPersonaRuntimeCommitsRef.current.delete(active.eventId);
      }
      const deliveredInteraction = pendingDeliveredInteractionsRef.current.get(
        active.eventId,
      );
      if (deliveredInteraction && !soulControlState.memoryIsolated) {
        recentLiveTurnsRef.current = mergeRecentLiveTurns(
          recentLiveTurnsRef.current,
          [
            {
              eventId: deliveredInteraction.eventId,
              at: ttsEndAt,
              input: deliveredInteraction.input,
              reply: deliveredInteraction.reply,
              viewerId: deliveredInteraction.viewerId,
              viewerName: deliveredInteraction.viewerName,
              sourceLabel: deliveredInteraction.sourceLabel,
              sourcesSeen: deliveredInteraction.sourcesSeen,
            },
          ],
        );
        if (!isSoulDelivery) {
          void streamerMemory.addInteraction(
            deliveredInteraction.input,
            deliveredInteraction.reply,
            {
              id: scopedViewerId(
                deliveredInteraction.viewerId,
                deliveredInteraction.sourcesSeen?.[0] ??
                  deliveredInteraction.source,
              ),
              name: deliveredInteraction.viewerName,
            },
            deliveredInteraction.source,
          );
        }
        pendingDeliveredInteractionsRef.current.delete(active.eventId);
        emitRuntimeEvent({
          eventId: active.eventId,
          stage: isSoulDelivery
            ? 'soul_delivered_projection_committed'
            : 'delivered_interaction_committed',
          at: ttsEndAt,
          source: deliveredInteraction.source,
          viewerId: deliveredInteraction.viewerId,
          authoritativeStore: isSoulDelivery
            ? 'soul-ledger'
            : 'legacy-streamer-memory',
        });
      } else if (deliveredInteraction) {
        pendingDeliveredInteractionsRef.current.delete(active.eventId);
        emitRuntimeEvent({
          eventId: active.eventId,
          stage: 'delivered_interaction_memory_isolated',
          at: ttsEndAt,
          reason: 'operator-memory-write-isolation',
        });
      }
    }
    activeLifecycleRef.current = null;
    speechRenderTraceRef.current = null;
    proactiveSpeechRef.current = false;
    proactiveEventIdRef.current = null;
    resetAvatarReaction();
    setAvatarMotion('idle_cold');
  }, [
    dispatchLiveHostEvent,
    emitRuntimeEvent,
    finalizeSoulOutcome,
    commitConversationHistoryOutcome,
    resetAvatarReaction,
    soulControlState.memoryIsolated,
    streamerMemory,
  ]);

  const handleSpeechInterrupted = useCallback(() => {
    const active = activeLifecycleRef.current;
    const defersScopeCleanup = Boolean(
      active?.eventId && scopeTransitionEventIdsRef.current.has(active.eventId),
    );
    if (active?.eventId) {
      if (!defersScopeCleanup) {
        pendingPersonaRuntimeCommitsRef.current.delete(active.eventId);
        pendingDeliveredInteractionsRef.current.delete(active.eventId);
      }
      dispatchLiveHostEvent({
        type: 'speech',
        at: Date.now(),
        eventId: active.eventId,
        stage: 'interrupted',
      });
      const incompleteDelivery = resolveIncompleteDelivery({
        beatCount: operatorBeatCountRef.current,
        completedBeatCount: operatorCompletedBeatCountRef.current,
        audioByteLength: operatorAudioByteLengthRef.current,
        playbackObserved:
          operatorPlaybackObservedRef.current || Boolean(active.ttsStartAt),
      });
      const deliveredFraction = incompleteDelivery.deliveredFraction;
      finalizeSoulOutcome(
        active.eventId,
        defersScopeCleanup
          ? incompleteDelivery.status
          : deliveredFraction > 0
            ? 'partial'
            : 'interrupted',
        {
          deliveredFraction,
          reasonCode: defersScopeCleanup
            ? 'scope-switch-interrupted-delivery'
            : 'interrupted-at-beat-boundary',
        },
      );
      commitConversationHistoryOutcome(
        active.eventId,
        incompleteDelivery.status,
        {
          viewerId: active.viewerId,
          deliveredFraction,
          reasonCode: defersScopeCleanup
            ? 'scope-switch-interrupted-delivery'
            : 'interrupted-at-beat-boundary',
          ttsStartAt: active.ttsStartAt,
          ttsEndAt: Date.now(),
        },
      );
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
    if (!defersScopeCleanup) {
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
    }
  }, [
    dispatchLiveHostEvent,
    emitRuntimeEvent,
    finalizeSoulOutcome,
    commitConversationHistoryOutcome,
    resetAvatarReaction,
  ]);

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
      const bridgePlayback =
        data.bridge === 'minimax-audio' || data.bridge === 'minimax-stream';
      if (stage === 'start') {
        const requestedAt = Date.now();
        if (active) active.ttsRequestAt = requestedAt;
        if (replyLatencyRef.current) {
          replyLatencyRef.current.ttsRequestedAt = requestedAt;
        }
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
      if (active?.eventId && (stage === 'end' || stage === 'start')) {
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
        const completedBeatIndex = Number(data.beatIndex ?? data.index ?? 0);
        const completedBeatText =
          data.screenplay && typeof data.screenplay === 'object'
            ? String((data.screenplay as ScreenplayLike).text ?? '').trim()
            : '';
        if (completedBeatText && speechBeatBytesRef.current > 0) {
          const completedBeats =
            completedSpeechBeatTextByEventIdRef.current.get(active.eventId) ??
            new Map<number, string>();
          completedBeats.set(completedBeatIndex, completedBeatText);
          completedSpeechBeatTextByEventIdRef.current.set(
            active.eventId,
            completedBeats,
          );
        }
        dispatchLiveHostEvent({
          type: 'speech',
          at: Date.now(),
          eventId: active.eventId,
          stage: 'beat-completed',
          beatIndex: completedBeatIndex,
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
        pendingPersonaRuntimeCommitsRef.current.delete(active.eventId);
        pendingDeliveredInteractionsRef.current.delete(active.eventId);
        const deliveredFraction =
          operatorBeatCountRef.current > 0
            ? Math.min(
                1,
                operatorCompletedBeatCountRef.current /
                  operatorBeatCountRef.current,
              )
            : 0;
        finalizeSoulOutcome(
          active.eventId,
          deliveredFraction > 0 ? 'partial' : 'failed',
          {
            deliveredFraction,
            reasonCode: 'tts-beat-failed',
          },
        );
        commitConversationHistoryOutcome(
          active.eventId,
          deliveredFraction > 0 ? 'partial' : 'failed',
          {
            viewerId: active.viewerId,
            deliveredFraction,
            reasonCode: 'tts-beat-failed',
            ttsStartAt: active.ttsStartAt,
            ttsEndAt: Date.now(),
          },
        );
      }
    },
    personaPlannerEnabled,
    settings: settingsHook.settings,
    profile: runtimeProfile,
    speechPlanV2Enabled,
    getApiKeyForProvider: settingsHook.getApiKeyForProvider,
    onAssistantResponse: (input, reply, metadata) => {
      // Generated text is not an autobiographical event yet. Reserve it here
      // and commit only after the correlated speech lifecycle proves delivery.
      if (metadata?.eventId) {
        pendingDeliveredInteractionsRef.current.set(metadata.eventId, {
          input,
          reply,
          eventId: metadata.eventId,
          viewerId: metadata.viewerId,
          viewerName: metadata.viewerName,
          source: metadata.source,
          sourceLabel: metadata.sourceLabel,
          sourcesSeen: metadata.sourcesSeen,
        });
      }
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
      if (metadata?.eventId) {
        const historyScope = conversationHistoryScopeFor(
          metadata.viewerId,
          metadata.sourcesSeen?.[0],
        );
        conversationHistoryScopeByEventIdRef.current.set(
          metadata.eventId,
          historyScope,
        );
        void fetch('/api/conversation-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input,
            reply,
            viewerId: metadata.viewerId,
            viewerName: metadata.viewerName,
            source: metadata.source,
            sourceLabel: metadata.sourceLabel,
            eventId: metadata.eventId,
            scope: historyScope,
            deliveryStatus: 'generated',
            commentAt: metadata.commentAt,
            receivedAt: metadata.receivedAt,
            queuedAt: metadata.queuedAt,
            selectedAt: metadata.selectedAt,
            processingAt: metadata.processingAt,
            llmStartAt: metadata.processingAt,
            llmEndAt: Date.now(),
            sourcesSeen: metadata.sourcesSeen,
            testRunId:
              active?.eventId === metadata.eventId
                ? active?.testRunId
                : undefined,
            stepId:
              active?.eventId === metadata.eventId ? active?.stepId : undefined,
            scenarioId:
              active?.eventId === metadata.eventId
                ? active?.scenarioId
                : undefined,
            replyAt: Date.now(),
          }),
        }).catch((error) => {
          console.warn('Conversation history reservation failed.', error);
        });
      }
    },
    onChatError: (error, metadata) => {
      // Continuation failures from the chat processor can lose the original
      // metadata after speech has already started.  Keep the lifecycle event
      // as the correlation source so the stress runner reports the upstream
      // generation failure instead of a later, misleading TTS timeout.
      const active = activeLifecycleRef.current;
      const eventId = metadata?.eventId ?? active?.eventId;
      if (eventId) {
        pendingDeliveredInteractionsRef.current.delete(eventId);
      }
      const errorMessage =
        error instanceof Error ? error.message.slice(0, 240) : 'chat_failed';
      const reason: PendingGenerationFailure['reason'] =
        /\b401\b|unauthori[sz]ed|api.?key|credential|authorization/i.test(
          errorMessage,
        )
          ? 'generation_auth_failed'
          : /truncated|continuation/i.test(errorMessage)
            ? 'generation_truncated'
            : 'generation_failed';
      const queueOwnsFailure =
        Boolean(eventId) && preparingOperatorTaskRef.current === eventId;
      if (eventId) {
        if (queueOwnsFailure) {
          generationFailureByEventIdRef.current.set(eventId, {
            reason,
            error: errorMessage,
            retryable:
              reason !== 'generation_auth_failed' &&
              reason !== 'generation_truncated',
          });
          // The streaming core may report an error without resolving the
          // outer preparation promise (for example after a transport-level
          // network failure). Do not leave the durable queue item leased in
          // `preparing` until the two-minute server lease expires. Mutate it
          // once per attempt here; the preparation effect will observe that
          // it is no longer `preparing` and therefore cannot double-retry it.
          if (!generationFailureQueueMutationRef.current.has(eventId)) {
            generationFailureQueueMutationRef.current.add(eventId);
            processingLiveEventIdsRef.current.delete(eventId);
            preparingOperatorTaskRef.current = null;
            void updateOperatorQueue(
              eventId,
              reason === 'generation_failed' ? 'retry' : 'fail',
              { reason },
            ).catch(() => undefined);
          }
        }
        const incompleteDelivery = resolveIncompleteDelivery({
          beatCount: operatorBeatCountRef.current,
          completedBeatCount: operatorCompletedBeatCountRef.current,
          audioByteLength: operatorAudioByteLengthRef.current,
          playbackObserved:
            operatorPlaybackObservedRef.current || Boolean(active?.ttsStartAt),
        });
        commitConversationHistoryOutcome(eventId, incompleteDelivery.status, {
          viewerId: active?.viewerId,
          deliveredFraction: incompleteDelivery.deliveredFraction,
          reasonCode: reason,
          ttsStartAt: active?.ttsStartAt,
          ttsEndAt: Date.now(),
        });
        // The queue preparation effect is the sole retry authority for its
        // active event. Letting this callback also mutate the queue races the
        // still-running generation attempt and previously caused four rapid
        // duplicate retries with a misleading no-draft reason.
        if (!queueOwnsFailure) {
          void updateOperatorQueue(
            eventId,
            reason === 'generation_failed' ? 'retry' : 'fail',
            { reason },
          ).catch(() => undefined);
        }
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
      emitRuntimeEvent({
        eventId,
        stage: queueOwnsFailure ? 'generation_error' : 'failed',
        at: Date.now(),
        source: active?.channel,
        sourceLabel: active?.label,
        viewerId: active?.viewerId,
        viewerName: active?.viewerName,
        sourcesSeen: active?.sourcesSeen,
        testRunId: active?.testRunId,
        stepId: active?.stepId,
        scenarioId: active?.scenarioId,
        reason,
        error: errorMessage,
      });
      if (active?.eventId && active.eventId === eventId) {
        activeLifecycleRef.current = null;
      }
    },
  });

  useEffect(() => {
    const previous = activeSoulScopeContextRef.current;
    if (previous.scopeKey === soulScopeKey) {
      // Snapshot recovery can replace the session without changing identity.
      previous.session = soulSession;
      return;
    }

    const targetScopeKey = soulScopeKey;
    const targetEpoch = runtimeScopeEpochRef.current + 1;
    const targetActivatedAt = Date.now();
    runtimeScopeEpochRef.current = targetEpoch;
    runtimeScopeActivatedAtRef.current = targetActivatedAt;
    activeSoulScopeContextRef.current = {
      scopeKey: targetScopeKey,
      session: soulSession,
    };

    const active = activeLifecycleRef.current;
    const capturedEventIds = new Set<string>([
      ...pendingDeliveredInteractionsRef.current.keys(),
      ...pendingPersonaRuntimeCommitsRef.current.keys(),
      ...soulSessionByEventIdRef.current.keys(),
    ]);
    if (active?.eventId) capturedEventIds.add(active.eventId);
    if (preparingOperatorTaskRef.current) {
      capturedEventIds.add(preparingOperatorTaskRef.current);
    }
    if (speakingOperatorTaskRef.current) {
      capturedEventIds.add(speakingOperatorTaskRef.current);
    }
    if (active?.eventId) {
      scopeTransitionEventIdsRef.current.add(active.eventId);
    }

    const incompleteDelivery = resolveIncompleteDelivery({
      beatCount: operatorBeatCountRef.current,
      completedBeatCount: operatorCompletedBeatCountRef.current,
      audioByteLength: operatorAudioByteLengthRef.current,
      playbackObserved:
        operatorPlaybackObservedRef.current || Boolean(active?.ttsStartAt),
    });
    const oldSoulEventIds = [...soulSessionByEventIdRef.current.keys()];
    const oldQueueItems = operatorQueueRef.current.filter(
      (item) =>
        item.createdAt < targetActivatedAt &&
        ['pending', 'preparing', 'ready', 'speaking'].includes(item.status),
    );

    // Stop the old performer immediately, but defer clearing its evidence until
    // every old Soul reservation has a durable terminal outcome.
    if (operatorSpeechWatchdogRef.current !== null) {
      window.clearTimeout(operatorSpeechWatchdogRef.current);
    }
    interruptSpeech('immediate');
    stop();
    recoverChatRuntime();

    let disposed = false;
    const transition = scopeTransitionChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await Promise.all(
          oldSoulEventIds.map((eventId) => {
            const isActive = eventId === active?.eventId;
            return finalizeSoulOutcome(
              eventId,
              isActive ? incompleteDelivery.status : 'failed',
              {
                deliveredFraction: isActive
                  ? incompleteDelivery.deliveredFraction
                  : 0,
                reasonCode: isActive
                  ? 'scope-switch-interrupted-delivery'
                  : 'scope-switch-before-delivery',
              },
            );
          }),
        );

        await Promise.allSettled(
          oldQueueItems.map((item) =>
            updateOperatorQueue(
              item.eventId,
              item.status === 'speaking' ? 'fail' : 'skip',
              { reason: 'scope_changed_before_delivery' },
            ),
          ),
        );

        for (const eventId of capturedEventIds) {
          const queueItem = oldQueueItems.find(
            (item) => item.eventId === eventId,
          );
          const isActive = eventId === active?.eventId;
          const deliveryStatus = isActive
            ? incompleteDelivery.status
            : queueItem && queueItem.status !== 'speaking'
              ? 'skipped'
              : 'failed';
          commitConversationHistoryOutcome(eventId, deliveryStatus, {
            viewerId: isActive ? active?.viewerId : queueItem?.viewerId,
            deliveredFraction: isActive
              ? incompleteDelivery.deliveredFraction
              : 0,
            reasonCode: isActive
              ? 'scope-switch-interrupted-delivery'
              : 'scope-switch-before-delivery',
            ttsStartAt: isActive ? active?.ttsStartAt : undefined,
            ttsEndAt: Date.now(),
          });
          pendingDeliveredInteractionsRef.current.delete(eventId);
          pendingPersonaRuntimeCommitsRef.current.delete(eventId);
          processingLiveEventIdsRef.current.delete(eventId);
          scopeTransitionEventIdsRef.current.delete(eventId);
        }
        if (
          activeLifecycleRef.current?.eventId &&
          capturedEventIds.has(activeLifecycleRef.current.eventId)
        ) {
          activeLifecycleRef.current = null;
        }
        if (
          preparingOperatorTaskRef.current &&
          capturedEventIds.has(preparingOperatorTaskRef.current)
        ) {
          preparingOperatorTaskRef.current = null;
        }
        if (
          speakingOperatorTaskRef.current &&
          capturedEventIds.has(speakingOperatorTaskRef.current)
        ) {
          speakingOperatorTaskRef.current = null;
        }
        if (operatorSpeechWatchdogRef.current !== null) {
          window.clearTimeout(operatorSpeechWatchdogRef.current);
          operatorSpeechWatchdogRef.current = null;
        }
        operatorPlaybackObservedRef.current = false;
        operatorBeatCountRef.current = 0;
        operatorCompletedBeatCountRef.current = 0;
        operatorAudioByteLengthRef.current = 0;
        speechBeatBytesRef.current = 0;
        activeLifecycleRef.current = null;
        speechRenderTraceRef.current = null;
        replyLatencyRef.current = null;
        speechReactionRef.current = null;
        proactiveSpeechRef.current = false;
        proactiveEventIdRef.current = null;
        recentLiveTurnsRef.current = [];
        soulReflectionEvidenceRef.current = [];
        soulLastReflectionAtRef.current = 0;

        const nextPersonaRuntimeState = new PersonaRuntimeState();
        personaRuntimeStateRef.current = nextPersonaRuntimeState;
        emptyRoomAwarenessPlannerRef.current = new EmptyRoomAwarenessPlanner(
          Math.random,
          nextPersonaRuntimeState,
        );
        resetAvatarReaction();
        setAvatarMotion('idle_cold');

        const stillCurrent =
          activeSoulScopeContextRef.current.scopeKey === targetScopeKey &&
          runtimeScopeEpochRef.current === targetEpoch;
        if (!disposed && stillCurrent) {
          setSoulInspectorTrace(null);
          setRuntimeScopeReadyKey(targetScopeKey);
          emitRuntimeEvent({
            stage: 'runtime_scope_transition_committed',
            at: Date.now(),
            fromScopeKey: previous.scopeKey,
            toScopeKey: targetScopeKey,
            settledSoulReservations: oldSoulEventIds.length,
            discardedQueueItems: oldQueueItems.length,
          });
        }
      });
    scopeTransitionChainRef.current = transition;

    return () => {
      disposed = true;
    };
  }, [
    commitConversationHistoryOutcome,
    emitRuntimeEvent,
    finalizeSoulOutcome,
    interruptSpeech,
    recoverChatRuntime,
    resetAvatarReaction,
    soulScopeKey,
    soulSession,
    stop,
  ]);

  useEffect(() => {
    if (pendingLiveHostActions.length === 0) return;
    const consumed: string[] = [];
    for (const action of pendingLiveHostActions) {
      consumed.push(action.actionId);
      emitRuntimeEvent({
        eventId: action.eventId,
        stage: 'live_host_action_consumed',
        at: Date.now(),
        actionId: action.actionId,
        actionKind: action.kind,
        reasonCode: action.reasonCode,
        scope: action.scope,
      });
      if (action.kind === 'emit-avatar-intent') {
        dispatchAvatarBehavior({
          motion: `host-${action.intent}`,
          emotion: action.intent === 'recovering' ? 'serious' : 'neutral',
          emotionIntensity: 0.35,
        });
        continue;
      }
      if (action.kind === 'enter-recovery') {
        stop();
        recoverChatRuntime();
        if (action.eventId) {
          const pending = pendingDeliveredInteractionsRef.current.get(
            action.eventId,
          );
          commitConversationHistoryOutcome(action.eventId, 'failed', {
            viewerId: pending?.viewerId,
            deliveredFraction: 0,
            reasonCode: action.reasonCode,
            ttsEndAt: Date.now(),
          });
          pendingPersonaRuntimeCommitsRef.current.delete(action.eventId);
          pendingDeliveredInteractionsRef.current.delete(action.eventId);
          finalizeSoulOutcome(action.eventId, 'failed', {
            deliveredFraction: 0,
            reasonCode: action.reasonCode,
          });
        }
        continue;
      }
      if (action.kind === 'request-operator-attention') {
        setStreamErrorMessage(
          `Soul runtime requires operator attention: ${action.reasonCode}`,
        );
        // Host execution recovery and Soul cognition are separate failure
        // domains. A model/TTS/coordinator fault may require operator
        // attention, but it must never rewrite the Soul control mode. Soul
        // fallback is enabled only by explicit operator action or a verified
        // Soul persistence/integrity failure at its own call site.
      }
    }
    acknowledgeLiveHostActions(consumed);
  }, [
    acknowledgeLiveHostActions,
    commitConversationHistoryOutcome,
    dispatchAvatarBehavior,
    emitRuntimeEvent,
    finalizeSoulOutcome,
    pendingLiveHostActions,
    recoverChatRuntime,
    stop,
  ]);

  useEffect(() => {
    if (!isLiveRuntimeOwner) return;
    const heartbeat = () =>
      emitRuntimeEvent({
        stage: 'runtime-owner-heartbeat',
        scope: soulScope,
        runtimeMode: soulRuntimeMode,
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
    soulRuntimeMode,
    soulScope,
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

    const hasCompleteOperatorAudio = hasCompleteDeliveryEvidence({
      beatCount: operatorBeatCountRef.current,
      completedBeatCount: operatorCompletedBeatCountRef.current,
      audioByteLength: operatorAudioByteLengthRef.current,
    });
    // `isSpeaking` can fall false between streaming TTS beats.  In that gap,
    // a queue item must remain leased instead of being falsely announced as
    // done before its final beat exists.
    if (!hasCompleteOperatorAudio) return;

    // Use the same idempotent completion path as the core SPEECH_END event.
    // The first caller clears activeLifecycleRef; a late duplicate becomes a
    // no-op and cannot commit the Soul reservation twice.
    handleSpeechEnd();
  }, [handleSpeechEnd, isSpeaking]);
  const liveDirector = useLiveDirector(runtimeProfile, {
    soulManaged: soulPublicBehaviorEnabled,
  });
  useEffect(() => {
    if (!soulSession || soulRuntimeMode === 'legacy') return;
    let cancelled = false;
    const migrationKey = `aituber:soul-migration:v2:${soulScopeKey}`;
    try {
      if (localStorage.getItem(migrationKey)) return;
    } catch {
      // The ledger remains the authority when storage access is unavailable.
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const exportedRecords = await streamerMemory.export();
          // A record that explicitly belongs to another persona is not
          // ambiguous legacy data; it is out of scope and must not even enter
          // this persona's quarantine ledger.
          const records = exportedRecords.filter(
            (record) => record.digitalHumanId === soulScope.personaId,
          );
          const foreignPersonaSkippedCount =
            exportedRecords.length - records.length;
          const relationships = liveDirector.getRelationshipSnapshot();
          const memoryEntries = records.map((record) => {
            const classification = classifyLegacyMemoryMigration(record, {
              personaId: soulScope.personaId,
              platform: soulScope.platform,
            });
            const eligible = classification.disposition === 'projection-seed';
            return {
              id: `${eligible ? 'migration:v2:memory' : 'quarantine:v2:memory'}:${soulScope.sessionId}:${encodeURIComponent(record.id).slice(0, 100)}`,
              occurredAt: record.updatedAt || record.createdAt || Date.now(),
              payload: eligible
                ? {
                    protocolVersion: '1.0',
                    recordType: 'legacy-memory-migration',
                    disposition: 'projection-seed',
                    provenance: 'indexeddb-streamer-memory-v1',
                    evidenceLevel: 'production-equivalent',
                    legacyRecordId: record.id,
                    platform: soulScope.platform,
                    viewerId: classification.viewerId,
                    memoryKind: record.kind,
                    subjectType: record.subjectType,
                    subjectId: record.subjectId,
                    title: record.title.slice(0, 240),
                    untrustedLegacyContent: record.content.slice(0, 1_200),
                    confidence: record.confidence,
                    status: record.status,
                  }
                : {
                    protocolVersion: '1.0',
                    recordType: 'legacy-memory-quarantine',
                    disposition: 'quarantine-audit',
                    provenance: 'indexeddb-streamer-memory-v1',
                    evidenceLevel: 'synthetic',
                    legacyRecordId: record.id,
                    quarantineReason: classification.reason,
                    claimedPersonaId: record.digitalHumanId,
                    claimedSubjectType: record.subjectType,
                    claimedSubjectId: record.subjectId,
                    claimedSourceType: record.sourceType,
                  },
            };
          });
          const relationshipEntries = Object.entries(relationships).map(
            ([viewerScopeKey, relationship]) => {
              const classification = classifyLegacyRelationshipMigration(
                viewerScopeKey,
                soulScope.platform,
              );
              const eligible = classification.disposition === 'projection-seed';
              return {
                id: `${eligible ? 'migration:v2:relationship' : 'quarantine:v2:relationship'}:${soulScope.sessionId}:${encodeURIComponent(viewerScopeKey).slice(0, 90)}`,
                occurredAt: relationship.lastSeenAt || Date.now(),
                payload: eligible
                  ? {
                      protocolVersion: '1.0',
                      recordType: 'legacy-relationship-migration',
                      disposition: 'projection-seed',
                      provenance: 'localstorage-live-relationships-v1',
                      evidenceLevel: 'production-equivalent',
                      platform: soulScope.platform,
                      viewerId: classification.viewerId,
                      viewerScopeKey,
                      relationship,
                    }
                  : {
                      protocolVersion: '1.0',
                      recordType: 'legacy-relationship-quarantine',
                      disposition: 'quarantine-audit',
                      provenance: 'localstorage-live-relationships-v1',
                      evidenceLevel: 'synthetic',
                      viewerScopeKey,
                      quarantineReason: classification.reason,
                    },
              };
            },
          );
          const entries = [...memoryEntries, ...relationshipEntries];
          const migratedMemoryCount = memoryEntries.filter(
            (entry) => entry.payload.disposition === 'projection-seed',
          ).length;
          const migratedRelationshipCount = relationshipEntries.filter(
            (entry) => entry.payload.disposition === 'projection-seed',
          ).length;
          const quarantineCount = entries.filter(
            (entry) => entry.payload.disposition === 'quarantine-audit',
          ).length;
          for (const entry of entries) {
            if (cancelled) return;
            const response = await fetch('/api/soul/ledger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...entry,
                kind: 'reflection',
                scope: soulScope,
              }),
            });
            if (!response.ok) {
              throw new Error(`legacy_migration_http_${response.status}`);
            }
          }
          if (cancelled) return;
          try {
            localStorage.setItem(
              migrationKey,
              JSON.stringify({
                completedAt: Date.now(),
                memoryCount: migratedMemoryCount,
                relationshipCount: migratedRelationshipCount,
                quarantineCount,
                foreignPersonaSkippedCount,
              }),
            );
          } catch {
            // The append-only ledger is already idempotent by migration IDs.
          }
          emitRuntimeEvent({
            stage: 'soul_legacy_projection_migrated',
            at: Date.now(),
            scope: soulScope,
            runtimeMode: soulRuntimeMode,
            memoryCount: migratedMemoryCount,
            relationshipCount: migratedRelationshipCount,
            quarantineCount,
            foreignPersonaSkippedCount,
            evidenceLevel: 'production-equivalent',
          });
        } catch (error) {
          if (cancelled) return;
          emitRuntimeEvent({
            stage: 'soul_legacy_projection_migration_failed',
            at: Date.now(),
            scope: soulScope,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    emitRuntimeEvent,
    liveDirector,
    runtimeProfile.id,
    soulRuntimeMode,
    soulScope,
    soulScopeKey,
    soulSession,
    streamerMemory,
  ]);
  const runSoulReflection = useCallback(
    async (reason: 'long-idle' | 'session-end' | 'important-conflict') => {
      if (
        !soulSession ||
        soulRuntimeMode === 'legacy' ||
        soulReflectionInFlightRef.current ||
        soulControlState.cognitionFrozen ||
        soulControlState.memoryIsolated ||
        soulControlState.operatorHasControl
      ) {
        return;
      }
      const ledgerSummary = soulReflectionEvidenceRef.current.slice(-24);
      if (ledgerSummary.length === 0) return;
      soulReflectionInFlightRef.current = true;
      const startedAt = Date.now();
      emitRuntimeEvent({
        stage: 'soul_reflection_started',
        at: startedAt,
        reason,
        evidenceCount: ledgerSummary.length,
        stateVersion: soulSession.getState().version,
      });
      try {
        const canonProjection =
          soulCanonProjection?.scopeKey === soulScopeKey
            ? soulCanonProjection.projection
            : undefined;
        const existingCanon = canonProjection
          ? [
              ...canonProjection.active,
              ...canonProjection.candidates,
              ...canonProjection.superseded,
              ...canonProjection.retracted,
            ]
          : [];
        const result = await requestSoulReflection({
          session: soulSession,
          constitution: LINGLAN_SOUL_CONSTITUTION,
          profile: LINGLAN_SOUL_PROFILE,
          scope: soulScope,
          ledgerSummary,
          existingCanon,
          memories: soulCanonMemoryRefs(canonProjection?.active ?? []),
          reflectionKey: reason,
          signal: AbortSignal.timeout(45_000),
        });
        const allowedEvidenceEventIds = ledgerSummary.map(
          (entry) => entry.eventId,
        );
        const policyEvaluation = evaluateSoulReflectionPolicy({
          profile: LINGLAN_SOUL_PROFILE,
          proposal: result.proposal,
          allowedEvidenceEventIds,
        });
        const committed = await soulSession.commitReflection({
          proposal: result.proposal,
          allowedEvidenceEventIds,
          approval: policyEvaluation.approval,
          occurredAt: Date.now(),
        });
        if (!committed.persistenceOk && committed.applied) {
          setSoulControlState((state) => ({
            ...state,
            cognitionFrozen: true,
            cognitionFreezeOrigin: 'state-persistence-failure',
            neutralFallbackActive: true,
          }));
        } else if (!committed.persistenceOk) {
          emitRuntimeEvent({
            eventId: result.proposal.id,
            stage: 'soul_reflection_audit_persistence_degraded',
            at: Date.now(),
            reason,
            disposition: committed.record.disposition,
          });
        }
        const reviewableCanonIds = new Set(
          result.canonCandidates.flatMap(
            ({ validation, unknownEvidenceEventIds }, index) =>
              unknownEvidenceEventIds.length === 0 &&
              (validation.valid ||
                validation.reasonCodes.every(
                  (code) => code === 'canon-review-passes-insufficient',
                ))
                ? [result.proposal.canonProposals[index]?.id ?? '']
                : [],
          ),
        );
        const reviewableCanonProposal = {
          ...result.proposal,
          canonProposals: result.proposal.canonProposals.filter((proposal) =>
            reviewableCanonIds.has(proposal.id),
          ),
        };
        const canonResults =
          committed.persistenceOk &&
          soulCanonRepository &&
          reviewableCanonProposal.canonProposals.length > 0
            ? await soulCanonRepository.acceptReflectionCandidates(
                reviewableCanonProposal,
                ledgerSummary.flatMap((entry) =>
                  entry.actorId
                    ? [{ eventId: entry.eventId, actorId: entry.actorId }]
                    : [],
                ),
              )
            : [];
        if (soulCanonRepository && canonResults.length > 0) {
          setSoulCanonProjection({
            scopeKey: soulScopeKey,
            projection: soulCanonRepository.getProjection(),
          });
        }
        soulLastReflectionAtRef.current = Date.now();
        emitRuntimeEvent({
          eventId: result.reflectionId,
          stage: 'soul_reflection_proposal_persisted',
          at: Date.now(),
          reason,
          durationMs: Date.now() - startedAt,
          modelProfileId: result.meta.modelProfileId,
          fallback: result.meta.fallback,
          fallbackReason: result.meta.fallbackReason,
          goalProposalCount: result.proposal.goalWeightDeltas.length,
          beliefProposalCount: result.proposal.beliefProposals.length,
          canonCandidateCount: result.canonCandidates.length,
          validCanonCandidateCount: result.canonCandidates.filter(
            (candidate) => candidate.validation.valid,
          ).length,
          approvedGoalCount: policyEvaluation.goalReviews.filter(
            (review) => review.approved,
          ).length,
          approvedBeliefCount: policyEvaluation.beliefReviews.filter(
            (review) => review.approved,
          ).length,
          reflectionDisposition: committed.record.disposition,
          reflectionPersistenceOk: committed.persistenceOk,
          canonDispositionCounts: canonResults.reduce<Record<string, number>>(
            (counts, item) => {
              counts[item.status] = (counts[item.status] ?? 0) + 1;
              return counts;
            },
            {},
          ),
          reasonCodes: result.proposal.reasonCodes,
          disposition: 'proposal-reviewed-under-local-policy',
        });
      } catch (error) {
        emitRuntimeEvent({
          stage: 'soul_reflection_failed',
          at: Date.now(),
          reason,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        soulReflectionInFlightRef.current = false;
      }
    },
    [
      emitRuntimeEvent,
      soulCanonProjection,
      soulCanonRepository,
      soulControlState.cognitionFrozen,
      soulControlState.memoryIsolated,
      soulControlState.operatorHasControl,
      soulRuntimeMode,
      soulScope,
      soulScopeKey,
      soulSession,
    ],
  );
  useEffect(() => {
    if (!soulSession || soulRuntimeMode === 'legacy') return;
    const maybeReflectDuringIdle = () => {
      const now = Date.now();
      const quietFor = Math.max(
        0,
        now - liveHostSnapshot.lastAudienceActivityAt,
      );
      if (
        quietFor >= 5 * 60_000 &&
        now - soulLastReflectionAtRef.current >= 15 * 60_000 &&
        soulReflectionEvidenceRef.current.length >= 3 &&
        !isProcessing &&
        !isSpeaking
      ) {
        void runSoulReflection('long-idle');
      }
    };
    maybeReflectDuringIdle();
    const timer = window.setInterval(maybeReflectDuringIdle, 60_000);
    return () => window.clearInterval(timer);
  }, [
    isProcessing,
    isSpeaking,
    liveHostSnapshot.lastAudienceActivityAt,
    runSoulReflection,
    soulRuntimeMode,
    soulSession,
  ]);
  useEffect(() => {
    const previous = soulPreviousHostPhaseRef.current;
    soulPreviousHostPhaseRef.current = liveHostSnapshot.phase;
    if (
      previous !== 'offline' &&
      liveHostSnapshot.phase === 'offline' &&
      soulReflectionEvidenceRef.current.length > 0
    ) {
      void runSoulReflection('session-end');
    }
  }, [liveHostSnapshot.phase, runSoulReflection]);
  const getShortTermLiveContext = useCallback(
    async (before = Date.now(), viewerId?: string, eventPlatform?: string) => {
      try {
        const params = appendConversationHistoryScopeQuery(
          new URLSearchParams({
            shortTerm: '1',
            before: String(before),
          }),
          conversationHistoryScopeFor(viewerId, eventPlatform),
        );
        const response = await fetch(
          `/api/conversation-history?${params.toString()}`,
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
                  typeof value.input !== 'string' ||
                  !['spoken', 'partial'].includes(
                    String(value.deliveryStatus || ''),
                  )
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
                          (source): source is string =>
                            typeof source === 'string',
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
      return buildLiveRoomTranscript(
        recentLiveTurnsRef.current,
        viewerId,
        Date.now(),
        eventPlatform,
      );
    },
    [conversationHistoryScopeFor],
  );
  // Keep this object stable when its values did not change; otherwise the
  // scheduler effect below mistakes every sync for a configuration edit and
  // postpones proactive speech forever.
  const emptyRoomAwarenessSettings = useMemo(
    () => ({
      enabled: settingsHook.settings.emptyRoomAwareness.enabled,
      audiencePolicy: settingsHook.settings.emptyRoomAwareness.audiencePolicy,
      scheduleEnabled: settingsHook.settings.emptyRoomAwareness.scheduleEnabled,
      scheduleStartHour:
        settingsHook.settings.emptyRoomAwareness.scheduleStartHour,
      scheduleEndHour: settingsHook.settings.emptyRoomAwareness.scheduleEndHour,
      minIntervalMs: settingsHook.settings.emptyRoomAwareness.minIntervalMs,
      maxIntervalMs: settingsHook.settings.emptyRoomAwareness.maxIntervalMs,
      proactiveCooldownMs:
        settingsHook.settings.emptyRoomAwareness.proactiveCooldownMs,
      maxProactiveTurns:
        settingsHook.settings.emptyRoomAwareness.maxProactiveTurns,
      maxSentences: settingsHook.settings.emptyRoomAwareness.maxSentences,
      behaviorStrategies:
        settingsHook.settings.emptyRoomAwareness.behaviorStrategies,
      interfaceWeight: settingsHook.settings.emptyRoomAwareness.interfaceWeight,
      memoryWeight: settingsHook.settings.emptyRoomAwareness.memoryWeight,
      inspirationWeight:
        settingsHook.settings.emptyRoomAwareness.inspirationWeight,
      audienceWeight: settingsHook.settings.emptyRoomAwareness.audienceWeight,
    }),
    [
      settingsHook.settings.emptyRoomAwareness.enabled,
      settingsHook.settings.emptyRoomAwareness.audiencePolicy,
      settingsHook.settings.emptyRoomAwareness.scheduleEnabled,
      settingsHook.settings.emptyRoomAwareness.scheduleStartHour,
      settingsHook.settings.emptyRoomAwareness.scheduleEndHour,
      settingsHook.settings.emptyRoomAwareness.minIntervalMs,
      settingsHook.settings.emptyRoomAwareness.maxIntervalMs,
      settingsHook.settings.emptyRoomAwareness.proactiveCooldownMs,
      settingsHook.settings.emptyRoomAwareness.maxProactiveTurns,
      settingsHook.settings.emptyRoomAwareness.maxSentences,
      settingsHook.settings.emptyRoomAwareness.behaviorStrategies,
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
  const processCoordinatedScreenVisionChat = useCallback(
    async (imageDataUrl: string, prompt?: string) => {
      if (runtimeScopeReadyKey !== soulScopeKey) return;
      const eventId = `screen-vision:${crypto.randomUUID()}`;
      const turn = {
        eventId,
        kind: 'viewer' as const,
        priority: 'low' as const,
        createdAt: Date.now(),
      };
      dispatchLiveHostEvent({
        type: 'generation',
        at: Date.now(),
        eventId,
        stage: 'started',
        turn,
      });
      dispatchLiveHostEvent({
        type: 'generation',
        at: Date.now(),
        eventId,
        stage: 'completed',
        turn,
      });
      if (!claimSpeechPermission(eventId)) {
        emitRuntimeEvent({
          eventId,
          stage: 'dropped',
          at: Date.now(),
          source: 'screen-vision',
          reason: 'coordinator_denied_screen_vision_speech',
        });
        return;
      }
      beginConversationLifecycle(
        { channel: 'screen-vision', label: 'screen-vision' },
        eventId,
      );
      await processVisionChat(imageDataUrl, prompt);
      if (activeLifecycleRef.current?.eventId === eventId) {
        emitRuntimeEvent({
          eventId,
          stage: 'failed',
          at: Date.now(),
          source: 'screen-vision',
          reason: 'vision_completed_without_public_speech',
        });
        activeLifecycleRef.current = null;
      }
    },
    [
      beginConversationLifecycle,
      claimSpeechPermission,
      dispatchLiveHostEvent,
      emitRuntimeEvent,
      processVisionChat,
      runtimeScopeReadyKey,
      soulScopeKey,
    ],
  );
  const screenVisionController = useScreenVisionController({
    settings: settingsHook.settings.screenVision,
    onCapture: processCoordinatedScreenVisionChat,
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
        roomContext?: RoomInteractionSnapshot;
        sourceLabel?: string;
        catchup?: boolean;
        showInput?: boolean;
        persistInteraction?: boolean;
        silent?: boolean;
        onPrepared?: (
          reply: string,
          skills: string[],
          speechPlan?: PreparedSpeechPlan,
        ) => void;
        createdAt?: number;
        testRunId?: string;
        stepId?: string;
        scenarioId?: string;
        faultKind?: OperatorQueueItem['faultKind'];
        faultConsumed?: boolean;
        engagementSignals?: OperatorQueueItem['engagementSignals'];
      },
    ) => {
      const eventId = options?.eventId ?? crypto.randomUUID();
      if (processingLiveEventIdsRef.current.has(eventId)) {
        emitRuntimeEvent({
          eventId,
          stage: 'generation_duplicate_ignored',
          at: Date.now(),
          reason: 'event_already_generating',
        });
        return;
      }
      processingLiveEventIdsRef.current.add(eventId);
      window.setTimeout(
        () => processingLiveEventIdsRef.current.delete(eventId),
        45_000,
      );
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
      // The simulator/control panel and the authoritative OBS runtime may be
      // different browser pages. Rehydrate actor-tagged rolling evidence from
      // the queue payload before routing; page-local refs alone cannot carry
      // pending viewers across that boundary.
      if (options?.roomContext?.samples.length) {
        recentLiveTurnsRef.current = projectRoomInteractionSamples(
          recentLiveTurnsRef.current,
          options.roomContext.samples,
          options.sourcesSeen?.[0] || options.sourceLabel,
        );
      }
      const shortTermLiveContext = await getShortTermLiveContext(
        options?.createdAt,
        options?.viewerId,
        options?.sourcesSeen?.[0],
      );
      const routerTurns = isProactive
        ? []
        : recentLiveTurnsRef.current
            .filter((turn) => Date.now() - turn.at <= 90_000)
            .slice(-8);
      const observedParticipants = recentParticipantEvidence(
        recentLiveTurnsRef.current,
      );
      const liveRoomSnapshot = liveDirector.getRoomSnapshot();
      const effectiveRoomContext = options?.roomContext
        ? {
            ...options.roomContext,
            participantCount: Math.max(
              options.roomContext.participantCount,
              observedParticipants.length,
            ),
            platformAudienceEstimate: liveRoomSnapshot.estimatedAudience,
            participantCountIsExact: false,
          }
        : undefined;
      const weatherLocationClarification =
        getWeatherLocationClarification(displayText);
      const routingInput = {
        text: displayText,
        viewerId: options?.viewerId,
        viewerName: options?.viewerName,
        sourceLabel: options?.sourceLabel,
        turns: routerTurns,
      };
      const soulRouting = soulPublicBehaviorEnabled
        ? routeSoulSkillDeterministically(routingInput)
        : null;
      const soulOwnsTurn = Boolean(
        soulRouting &&
          (soulRuntimeMode === 'primary' ||
            (soulRuntimeMode === 'canary' &&
              canaryOwnsSoulTurn(
                isProactive,
                options?.engagementSignals,
                soulRouting.moderation,
              ))),
      );
      const routing = soulOwnsTurn
        ? soulRouting!
        : await routeTyphoonSkillWithAgent(routingInput);
      emitRuntimeEvent({
        eventId,
        stage: 'program_decision',
        at: Date.now(),
        viewerId: options?.viewerId,
        viewerName: options?.viewerName,
        sourceLabel: options?.sourceLabel,
        mode: routing.mode,
        intent: routing.intent,
        direction: routing.direction,
        shouldSpeak: routing.shouldSpeak,
        inheritTyphoon: routing.inheritTyphoon,
        context: {
          turns: routerTurns.length,
          transcriptChars: shortTermLiveContext.length,
          memoryChars: options?.memoryContext?.length ?? 0,
        },
      });
      let personaContext = '';
      let legacySpeechPlanHints: SpeechPlanV2BuilderHints | undefined;
      let personaRuntimeTransition: PersonaRuntimeTransition | undefined;
      if (personaPlannerEnabled && !soulOwnsTurn) {
        const personaStartedAt = performance.now();
        emitRuntimeEvent({
          eventId,
          stage: 'persona_plan_started',
          at: Date.now(),
          source: options?.source ?? 'chat',
        });
        const personaInput: PersonaPlannerInput = {
          eventId,
          text: displayText,
          viewerId: options?.viewerId,
          viewerName: options?.viewerName,
          sourceLabel: options?.sourceLabel,
          routing,
          relationship: liveDirector.relationshipBrief({
            id: options?.viewerId,
            name: options?.viewerName,
            platform: options?.sourcesSeen?.[0],
          }),
          recentTurns: routerTurns,
          memorySignals: streamerMemory.signalsFor(displayText, {
            id: scopedViewerId(options?.viewerId, options?.sourcesSeen?.[0]),
            name: options?.viewerName,
          }),
          room: effectiveRoomContext,
        };
        const localPlan = planPersonaInteraction(
          personaInput,
          LINGLAN_PERSONA_POLICY,
        );
        const refinedPersonaPlan = await refinePersonaPlanWithAgent(
          personaInput,
          localPlan,
          LINGLAN_PERSONA_POLICY,
        );
        const proactiveIntent =
          pendingPersonaRuntimeCommitsRef.current.get(eventId)?.proactive;
        const intentAlignedPlan = proactiveIntent
          ? {
              ...refinedPersonaPlan,
              mustDo: [
                proactiveIntent.mustAdvance,
                `只推进人格动力：${proactiveIntent.drive}（${proactiveIntent.driveGoal}）`,
                ...refinedPersonaPlan.mustDo,
              ],
              mustAvoid: [
                `不得重复近期冷却主题：${proactiveIntent.mustAvoidTopics.join('、') || '无'}`,
                '不得把杯子、饮料或其他道具当作人格内容引擎',
                ...refinedPersonaPlan.mustAvoid,
              ],
              deliveryTarget: {
                ...refinedPersonaPlan.deliveryTarget,
                emotion: proactiveIntent.emotion.label,
                delivery: proactiveIntent.emotion.delivery,
                intensity: proactiveIntent.emotion.intensity,
              },
              reasonCode:
                `${refinedPersonaPlan.reasonCode}:${proactiveIntent.reasonCode}`.slice(
                  0,
                  120,
                ),
            }
          : refinedPersonaPlan;
        const runtimePrepared =
          personaRuntimeStateRef.current!.prepareInteraction(
            intentAlignedPlan,
            Date.now(),
            options?.viewerId,
          );
        const personaPlan = runtimePrepared.plan;
        legacySpeechPlanHints = {
          emotion: personaPlan.deliveryTarget.emotion,
          delivery: personaPlan.deliveryTarget.delivery,
          emotionIntensity:
            (personaPlan.deliveryTarget.intensity[0] +
              personaPlan.deliveryTarget.intensity[1]) /
            2,
          prosody: personaPlan.deliveryTarget.prosody,
          motion:
            routing.mode === 'urgent' || routing.mode === 'weather'
              ? 'serious_report'
              : undefined,
        };
        personaRuntimeTransition = runtimePrepared.transition;
        const personaDurationMs = Math.round(
          performance.now() - personaStartedAt,
        );
        const personaAudit = {
          eventId,
          at: Date.now(),
          scene: personaPlan.scene,
          stance: personaPlan.stance,
          primaryMove: personaPlan.primaryMove,
          roomAction: personaPlan.roomAction,
          confidence: personaPlan.confidence,
          source: personaPlan.source,
          reasonCode: personaPlan.reasonCode,
          durationMs: personaDurationMs,
          activeDrive: proactiveIntent?.drive,
          topicFamily: proactiveIntent?.topicFamily,
          topicSource: proactiveIntent?.source,
          expressedEmotion: personaPlan.deliveryTarget.emotion,
        };
        emitRuntimeEvent({
          ...personaAudit,
          stage:
            personaPlan.source === 'agent'
              ? 'persona_plan_agent'
              : personaPlan.source === 'fallback'
                ? 'persona_plan_fallback'
                : 'persona_plan_completed',
        });

        if (personaPlan.localMuteViewerIds.length) {
          await Promise.all(
            personaPlan.localMuteViewerIds.map((viewerId) =>
              fetch('/api/live-safety', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  eventId,
                  viewerId,
                  sourceLabel: options?.sourceLabel,
                  moderation: 'local_mute',
                  reason: personaPlan.reasonCode,
                }),
              }).catch(() => null),
            ),
          );
        }
        if (
          personaPlan.roomAction === 'skip' ||
          personaPlan.roomAction === 'local_mute'
        ) {
          emitRuntimeEvent({
            ...personaAudit,
            stage: 'persona_plan_skipped',
          });
          processingLiveEventIdsRef.current.delete(eventId);
          dispatchLiveHostEvent({
            type: 'generation',
            at: Date.now(),
            eventId,
            stage: 'completed',
            turn,
          });
          options?.onPrepared?.(NO_REPLY_TOKEN, []);
          return true;
        }
        personaContext = formatPersonaInteractionPlan(
          personaPlan,
          effectiveRoomContext,
        );
        if (personaPlan.source !== 'rules') {
          emitRuntimeEvent({
            ...personaAudit,
            stage: 'persona_plan_completed',
          });
        }
      }
      const safety = options?.viewerId
        ? await fetch('/api/live-safety', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId,
              viewerId: options.viewerId,
              viewerName: options.viewerName,
              sourceLabel: options.sourceLabel,
              moderation: routing.moderation,
              reason: routing.reason,
            }),
          })
            .then((response) =>
              response.ok
                ? (response.json() as Promise<{
                    event?: {
                      action?: string;
                      mutedUntil?: number;
                      score?: number;
                    };
                  }>)
                : null,
            )
            .catch(() => null)
        : null;
      const safetyAction = safety?.event?.action;
      if (
        (safetyAction === 'local_mute' ||
          routing.moderation === 'local_mute') &&
        options?.viewerId
      ) {
        if (
          soulSession &&
          (soulOwnsTurn ||
            soulRuntimeMode === 'shadow' ||
            soulRuntimeMode === 'canary')
        ) {
          const safetyEvent = createLinglanSoulEvent({
            id: eventId,
            scope: soulScope,
            kind: 'safety-signal',
            occurredAt: options?.commentAt ?? Date.now(),
            receivedAt: options?.receivedAt ?? Date.now(),
            evidenceLevel: soulEvidenceLevel({
              testRunId: options?.testRunId,
              sourceLabel: options?.sourceLabel,
              sourcesSeen: options?.sourcesSeen,
            }),
            provenance: 'local-live-safety-gateway',
            confidence: 1,
            urgency: 'high',
            actor: {
              kind: 'viewer',
              id:
                scopedViewerId(options.viewerId, options?.sourcesSeen?.[0]) ??
                options.viewerId,
              displayName: options?.viewerName,
            },
            data: {
              text: displayText,
              untrustedViewerText: displayText,
              moderation: 'local_mute',
              safetyScore: safety?.event?.score,
            },
          });
          recordSoulReflectionEvidence({
            eventId,
            summary: `Safety-gated viewer event: ${displayText.slice(0, 420)}`,
            evidenceLevel: safetyEvent.evidenceLevel,
            provenance: safetyEvent.provenance,
            actorId: safetyEvent.actor?.id,
          });
          const safetyEvaluation = await soulSession.evaluate(safetyEvent, {
            forceFallbackReason: 'local-safety-mute',
          });
          const safetyTrace = projectSoulEvaluation(
            safetyEvaluation,
            safetyEvent,
          );
          setSoulInspectorTrace({
            ...safetyTrace,
            outcome: {
              status: 'skipped',
              occurredAt: Date.now(),
              reasonCode: 'local-safety-mute',
            },
          });
          if (soulOwnsTurn) {
            await soulSession.reserveDecision(eventId);
            soulSessionByEventIdRef.current.set(eventId, soulSession);
            finalizeSoulOutcome(eventId, 'skipped', {
              deliveredFraction: 0,
              reasonCode: 'local-safety-mute',
            });
          }
          void runSoulReflection('important-conflict');
        }
        emitRuntimeEvent({
          eventId,
          stage: 'director_local_mute',
          at: Date.now(),
          reason:
            safetyAction === 'local_mute'
              ? 'safety_gateway_decision'
              : 'director_decision',
          viewerId: options.viewerId,
          viewerName: options.viewerName,
          safetyScore: safety?.event?.score,
        });
        processingLiveEventIdsRef.current.delete(eventId);
        dispatchLiveHostEvent({
          type: 'generation',
          at: Date.now(),
          eventId,
          stage: 'completed',
          turn,
        });
        options?.onPrepared?.(NO_REPLY_TOKEN, []);
        return true;
      }
      if (personaRuntimeTransition) {
        const pending = pendingPersonaRuntimeCommitsRef.current.get(eventId);
        pendingPersonaRuntimeCommitsRef.current.set(eventId, {
          ...pending,
          interaction: personaRuntimeTransition,
        });
      }
      const responseContract = isProactive
        ? {
            contract: '',
            inheritedSkills: [],
            skillQuery: '',
            preferMultipleBeats: false,
            hasPrimaryQuestion: false,
          }
        : buildLiveResponseContract(displayText, routerTurns, routing);
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
      if (
        weatherLocationClarification &&
        options?.onPrepared &&
        !soulOwnsTurn
      ) {
        emitRuntimeEvent({
          eventId,
          stage: 'weather_clarification_fast_path',
          at: Date.now(),
          text: displayText,
          preparedReply: weatherLocationClarification,
          reason: routing.reason,
        });
        processingLiveEventIdsRef.current.delete(eventId);
        dispatchLiveHostEvent({
          type: 'generation',
          at: Date.now(),
          eventId,
          stage: 'completed',
          turn,
        });
        options.onPrepared(weatherLocationClarification, []);
        return true;
      }
      const simulateSkillTimeout =
        Boolean(options?.testRunId) &&
        options?.faultKind === 'typhoon-skill-timeout';
      if (simulateSkillTimeout) {
        await updateOperatorQueue(eventId, 'consume-fault').catch(
          () => undefined,
        );
      }
      const enrichment = isProactive
        ? {
            context: '',
            skills: [],
            isDomainSensitive: false,
            forceFallback: false,
          }
        : await hostExtensions.enrich({
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
      const shouldShadowSoulTurn = Boolean(
        soulSession &&
          !soulOwnsTurn &&
          (soulRuntimeMode === 'shadow' || soulRuntimeMode === 'canary'),
      );
      let runShadowSoulEvaluation: (() => void) | undefined;
      if (soulSession && (soulOwnsTurn || shouldShadowSoulTurn)) {
        const actorId =
          scopedViewerId(options?.viewerId, options?.sourcesSeen?.[0]) ??
          (isProactive ? runtimeProfile.id : 'control-room-operator');
        const eventKind = soulEventKindForTurn(
          isProactive,
          options?.engagementSignals,
        );
        const soulEvent = createLinglanSoulEvent({
          id: eventId,
          scope: soulScope,
          kind: eventKind,
          occurredAt: options?.commentAt ?? options?.createdAt ?? Date.now(),
          receivedAt: options?.receivedAt ?? Date.now(),
          evidenceLevel: soulEvidenceLevel({
            testRunId: options?.testRunId,
            sourceLabel: options?.sourceLabel,
            sourcesSeen: options?.sourcesSeen,
          }),
          provenance:
            [options?.sourceLabel, ...(options?.sourcesSeen ?? [])]
              .filter(Boolean)
              .join(':') || 'local-control-room',
          confidence: 1,
          urgency:
            routing.mode === 'urgent'
              ? 'urgent'
              : routing.moderation !== 'none'
                ? 'high'
                : isProactive
                  ? 'low'
                  : 'normal',
          actor: {
            kind: isProactive
              ? 'self'
              : options?.viewerId
                ? 'viewer'
                : 'operator',
            id: actorId,
            displayName: options?.viewerName,
          },
          data: isProactive
            ? createSoulQuietEventData({
                durationMs:
                  Date.now() - liveHostSnapshot.lastAudienceActivityAt,
                roomContext: effectiveRoomContext,
                sourceLabel: options?.sourceLabel,
                // Soul focus has no authoritative activity lease yet. Keep
                // this false instead of inferring engagement from legacy drives.
                selfDirectedEngagement: false,
              })
            : {
                text: displayText,
                untrustedViewerText: displayText,
                sourceLabel: options?.sourceLabel,
                supportRequestEligible: !isCityReportEngagementPayload({
                  eventId,
                  text: displayText,
                }),
                engagementSignals: options?.engagementSignals,
                roomConflict: effectiveRoomContext?.conflictLevel,
                routeMode: routing.mode,
                routeIntent: routing.intent,
                truthDomain: enrichment.isDomainSensitive
                  ? 'weather'
                  : routing.mode === 'urgent'
                    ? 'safety'
                    : undefined,
              },
        });
        recordSoulReflectionEvidence({
          eventId,
          summary: isProactive
            ? `Quiet-room interval: ${String(soulEvent.data.durationMs ?? 0)}ms`
            : displayText.slice(0, 600),
          evidenceLevel: soulEvent.evidenceLevel,
          provenance: soulEvent.provenance,
          actorId: soulEvent.actor?.id,
        });
        const verifiedFacts: SubjectiveFactV1[] = [];
        if (weatherLocationClarification) {
          verifiedFacts.push({
            id: `fact:${eventId}:weather-location-required`,
            statement: weatherLocationClarification,
            provenance: 'local-weather-location-validator',
            confidence: 1,
          });
        }
        if (Array.isArray(payload?.claims)) {
          payload.claims.slice(0, 8).forEach((claim, index) => {
            const statement = boundedSoulFactContent(claim);
            if (!statement) return;
            verifiedFacts.push({
              id: `fact:${eventId}:tool-claim:${index}`,
              statement,
              provenance: `tool:${enrichment.skills.join(',') || 'host-extension'}`,
              confidence: 1,
            });
          });
        }
        if (enrichment.isDomainSensitive && enrichment.fallbackReply) {
          verifiedFacts.push({
            id: `fact:${eventId}:required-answer`,
            statement: enrichment.fallbackReply,
            provenance: `tool-postcondition:${enrichment.skills.join(',') || 'host-extension'}`,
            confidence: 1,
          });
        }
        const memories: SubjectiveMemoryRefV1[] =
          soulControlState.memoryIsolated
            ? []
            : [
                ...soulCanonMemoryRefs(activeSoulCanon, soulEvent.actor?.id),
                ...streamerMemory
                  .signalsFor(displayText, {
                    id: scopedViewerId(
                      options?.viewerId,
                      options?.sourcesSeen?.[0],
                    ),
                    name: options?.viewerName,
                  })
                  .map((signal, index) => ({
                    id: `legacy-memory:${eventId}:${index}`,
                    content: signal.topic,
                    provenance: `legacy-memory-migration:${signal.sourceKind}`,
                    confidence: signal.confidence,
                  })),
              ].slice(0, 6);
        const forceFallbackReason = soulControlState.operatorHasControl
          ? 'operator-has-execution-control'
          : soulControlState.cognitionFrozen
            ? 'cognition-frozen'
            : soulControlState.neutralFallbackActive
              ? 'operator-neutral-fallback'
              : undefined;
        const evaluateSoulTurn = () =>
          soulSession.evaluate(soulEvent, {
            verifiedFacts,
            memories,
            forceFallbackReason,
          });

        if (!soulOwnsTurn) {
          runShadowSoulEvaluation = () => {
            void evaluateSoulTurn()
              .then(async (evaluation) => {
                const reserved = await soulSession.reserveDecision(eventId);
                const outcome = await soulSession.applyOutcome(
                  eventId,
                  'skipped',
                  {
                    deliveredFraction: 0,
                    reasonCode: 'shadow-non-authoritative',
                  },
                );
                const persistenceOk =
                  evaluation.persistenceOk &&
                  reserved.persistenceOk &&
                  outcome.persistenceOk;
                const trace = projectSoulEvaluation(evaluation, soulEvent);
                setSoulInspectorTrace({
                  ...trace,
                  state: projectSoulState(outcome.state),
                  outcome: {
                    status: 'skipped',
                    occurredAt: Date.now(),
                    reasonCode: 'shadow-non-authoritative',
                  },
                });
                emitRuntimeEvent({
                  eventId,
                  stage: 'soul_shadow_decision',
                  at: Date.now(),
                  evidenceLevel: soulEvent.evidenceLevel,
                  stateVersion: evaluation.state.version,
                  action: evaluation.decision.action,
                  utility: evaluation.decision.utility,
                  reasonCodes: evaluation.decision.reasonCodes,
                  candidateScores: evaluation.decision.candidateScores,
                  modelProfileId: evaluation.meta.modelProfileId,
                  modelLatencyMs: evaluation.meta.latencyMs,
                  fallback: evaluation.meta.fallback,
                  fallbackReason: evaluation.meta.fallbackReason,
                  fallbackDetail: evaluation.meta.fallbackDetail,
                  persistenceOk,
                  persistenceError:
                    evaluation.persistenceError ??
                    reserved.persistenceError ??
                    outcome.persistenceError,
                });
                emitRuntimeEvent({
                  eventId,
                  stage: 'soul_shadow_outcome_committed',
                  at: Date.now(),
                  status: 'skipped',
                  reasonCode: 'shadow-non-authoritative',
                  persistenceOk,
                  persistenceError:
                    evaluation.persistenceError ??
                    reserved.persistenceError ??
                    outcome.persistenceError,
                  stateVersion: outcome.state.version,
                });
              })
              .catch((error) => {
                emitRuntimeEvent({
                  eventId,
                  stage: 'soul_shadow_failed',
                  at: Date.now(),
                  error: error instanceof Error ? error.message : String(error),
                });
              });
          };
        } else {
          const evaluation = await evaluateSoulTurn();
          setSoulInspectorTrace(projectSoulEvaluation(evaluation, soulEvent));
          emitRuntimeEvent({
            eventId,
            stage: 'soul_decision_selected',
            at: Date.now(),
            scope: soulScope,
            runtimeMode: soulRuntimeMode,
            evidenceLevel: soulEvent.evidenceLevel,
            stateVersion: evaluation.state.version,
            action: evaluation.decision.action,
            truthMode: evaluation.decision.truthMode,
            goalsServed: evaluation.decision.goalsServed,
            utility: evaluation.decision.utility,
            reasonCodes: evaluation.decision.reasonCodes,
            candidateScores: evaluation.decision.candidateScores,
            internalAffect: evaluation.decision.internalAffect,
            expressedAffect: evaluation.decision.expressedAffect,
            modelProfileId: evaluation.meta.modelProfileId,
            modelLatencyMs: evaluation.meta.latencyMs,
            modelFirstContentLatencyMs: evaluation.meta.firstContentLatencyMs,
            fallback: evaluation.meta.fallback,
            fallbackReason: evaluation.meta.fallbackReason,
            fallbackDetail: evaluation.meta.fallbackDetail,
            persistenceOk: evaluation.persistenceOk,
            persistenceError: evaluation.persistenceError,
          });

          const reserved = await soulSession.reserveDecision(eventId);
          setSoulInspectorTrace((previous) =>
            previous?.event.id === eventId
              ? { ...previous, state: projectSoulState(reserved.state) }
              : previous,
          );
          const publicExecutionBlocked =
            !evaluation.persistenceOk ||
            !reserved.persistenceOk ||
            soulControlState.operatorHasControl;
          const authoritativeUtterance =
            weatherLocationClarification ||
            (enrichment.forceFallback && enrichment.fallbackReply
              ? enrichment.fallbackReply
              : undefined);
          const selectedUtterance =
            authoritativeUtterance ?? evaluation.decision.utterance;
          const deliberateSilence =
            (!authoritativeUtterance &&
              (evaluation.decision.action === 'remain-silent' ||
                evaluation.decision.action === 'delay')) ||
            !selectedUtterance?.trim() ||
            (!authoritativeUtterance &&
              evaluation.decision.expiresAt <= Date.now());
          if (publicExecutionBlocked || deliberateSilence) {
            const reasonCode = publicExecutionBlocked
              ? soulControlState.operatorHasControl
                ? 'operator-has-execution-control'
                : 'soul-persistence-fail-closed'
              : evaluation.decision.expiresAt <= Date.now()
                ? 'soul-decision-expired'
                : `deliberate-${evaluation.decision.action}`;
            soulSessionByEventIdRef.current.set(eventId, soulSession);
            finalizeSoulOutcome(eventId, 'skipped', {
              deliveredFraction: 0,
              reasonCode,
            });
            processingLiveEventIdsRef.current.delete(eventId);
            dispatchLiveHostEvent({
              type: 'generation',
              at: Date.now(),
              eventId,
              stage: 'completed',
              turn,
            });
            emitRuntimeEvent({
              eventId,
              stage: 'soul_formal_silence',
              at: Date.now(),
              action: evaluation.decision.action,
              reasonCode,
              expiresAt: evaluation.decision.expiresAt,
            });
            options?.onPrepared?.(NO_REPLY_TOKEN, []);
            return true;
          }

          const guardedResponse = guardViewerResponse(selectedUtterance ?? '', {
            isWeather: Boolean(enrichment.isDomainSensitive),
            viewerText: displayText,
            requiredAnswer: enrichment.isDomainSensitive
              ? enrichment.fallbackReply
              : undefined,
            claims: Array.isArray(payload?.claims) ? payload.claims : undefined,
            placeResolution: payload?.placeResolution,
            rawEvidence: payload,
            catchup: options?.catchup,
            forceFallback: enrichment.forceFallback,
          });
          const spokenText = guardedResponse.text.trim();
          const speechHints = speechPlanHintsForSoulDecision(
            evaluation.decision,
          );
          const builtSpeechPlan = buildSpeechPlanV2(
            spokenText,
            authoritativeUtterance
              ? resolveAuthoritativeSpeechHints(
                  speechHints,
                  routing.mode === 'urgent',
                )
              : speechHints,
          );
          const speechPlan: PreparedSpeechPlan = {
            version: 2,
            beats: builtSpeechPlan.beats.map((beat) => ({
              ...beat,
              prosody: beat.prosody
                ? Object.fromEntries(Object.entries(beat.prosody))
                : undefined,
            })),
          };
          if (options?.persistInteraction !== false) {
            pendingDeliveredInteractionsRef.current.set(eventId, {
              input: displayText,
              reply: spokenText,
              eventId,
              viewerId: options?.viewerId,
              viewerName: options?.viewerName,
              source: options?.source,
              sourceLabel: options?.sourceLabel,
              sourcesSeen: options?.sourcesSeen,
            });
          }
          soulSessionByEventIdRef.current.set(eventId, soulSession);
          if (replyLatencyRef.current) {
            replyLatencyRef.current.llmCompletedAt = Date.now();
            replyLatencyRef.current.input = displayText;
            replyLatencyRef.current.reply = spokenText;
            replyLatencyRef.current.eventId = eventId;
          }
          const historyScope = conversationHistoryScopeFor(
            options?.viewerId,
            options?.sourcesSeen?.[0],
          );
          conversationHistoryScopeByEventIdRef.current.set(
            eventId,
            historyScope,
          );
          void fetch('/api/conversation-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: displayText,
              reply: spokenText,
              viewerId: options?.viewerId,
              viewerName: options?.viewerName,
              source: options?.source,
              sourceLabel: options?.sourceLabel,
              eventId,
              scope: historyScope,
              deliveryStatus: 'generated',
              commentAt: options?.commentAt,
              receivedAt: options?.receivedAt,
              queuedAt: options?.queuedAt,
              selectedAt: options?.selectedAt,
              processingAt: options?.processingAt,
              llmStartAt: options?.processingAt,
              llmEndAt: Date.now(),
              sourcesSeen: options?.sourcesSeen,
              replyAt: Date.now(),
            }),
          }).catch(() => undefined);
          processingLiveEventIdsRef.current.delete(eventId);
          dispatchLiveHostEvent({
            type: 'generation',
            at: Date.now(),
            eventId,
            stage: 'completed',
            turn,
          });
          emitRuntimeEvent({
            eventId,
            stage: 'soul_speech_plan_built',
            at: Date.now(),
            beatCount: speechPlan.beats.length,
            action: evaluation.decision.action,
            factPostconditionApplied:
              spokenText !== evaluation.decision.utterance,
            responseGuardRewritten: guardedResponse.rewritten,
            responseGuardReasons: guardedResponse.reasons,
          });
          if (options?.onPrepared) {
            options.onPrepared(spokenText, enrichment.skills, speechPlan);
            return true;
          }
          if (!claimSpeechPermission(eventId)) {
            commitConversationHistoryOutcome(eventId, 'skipped', {
              viewerId: options?.viewerId,
              deliveredFraction: 0,
              reasonCode: 'coordinator-denied-direct-speech',
            });
            pendingDeliveredInteractionsRef.current.delete(eventId);
            finalizeSoulOutcome(eventId, 'skipped', {
              deliveredFraction: 0,
              reasonCode: 'coordinator-denied-direct-speech',
            });
            return true;
          }
          await speakPrepared(spokenText, speechPlan);
          return true;
        }
      }
      // Operator-queue preparation must return a writable text draft. The
      // screenshot/vision route speaks directly and has no draft callback, so
      // reserve it for one-off direct broadcasts only.
      if (enrichment.vision && !options?.silent) {
        const liveRadarImage = await enrichment.vision.capture();
        if (liveRadarImage) {
          processingLiveEventIdsRef.current.delete(eventId);
          dispatchLiveHostEvent({
            type: 'generation',
            at: Date.now(),
            eventId,
            stage: 'completed',
            turn,
          });
          if (!claimSpeechPermission(eventId)) {
            emitRuntimeEvent({
              eventId,
              stage: 'dropped',
              at: Date.now(),
              reason: 'coordinator_denied_direct_vision_speech',
            });
            return false;
          }
          if (activeLifecycleRef.current?.eventId !== eventId) {
            activeLifecycleRef.current = {
              eventId,
              channel: options?.source ?? 'vision',
              label: options?.sourceLabel ?? 'vision',
              viewerId: options?.viewerId,
              viewerName: options?.viewerName,
              sourcesSeen: options?.sourcesSeen,
            };
          }
          await processVisionChat(
            liveRadarImage,
            enrichment.vision.buildPrompt(
              options?.displayText ?? text,
              enrichment.context,
            ),
          );
          if (activeLifecycleRef.current?.eventId === eventId) {
            emitRuntimeEvent({
              eventId,
              stage: 'failed',
              at: Date.now(),
              reason: 'vision_completed_without_public_speech',
            });
            activeLifecycleRef.current = null;
          }
          return true;
        }
      }
      const directPlaybackRequested =
        options?.silent !== true && !options?.onPrepared;
      return processChat(text, {
        ...options,
        eventId,
        memoryContext: `${options?.memoryContext ?? ''}${
          options?.sourceLabel
            ? `\n\n[内部投递上下文：本条信息来自${options.sourceLabel}。仅据此调整回应方式，不要向观众复述或解释该上下文。]`
            : ''
        }${relationshipContext}${personaContext}${shortTermLiveContext}${responseContract.contract}${enrichment.context}`,
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
          engagementSignals: options?.engagementSignals,
        },
        speechPlanHints: legacySpeechPlanHints,
        // Generate silently, then let the one-shot coordinator permission
        // authorize the only public playback path.
        silent: true,
        onPrepared: (reply, speechPlan) => {
          // Shadow mode deliberately runs the second diagnostic model call
          // only after the authoritative legacy draft has completed. Running
          // both MiniMax requests concurrently starved the Soul stream before
          // its first content and made every trace look like a provider fault.
          runShadowSoulEvaluation?.();
          const repeatsRecentTopic =
            isProactive &&
            isRecentSemanticTopicRepeat(
              reply,
              recentLiveTurnsRef.current
                .filter((recent) => Date.now() - recent.at <= 5 * 60_000)
                .flatMap((recent) => [recent.input, recent.reply ?? ''])
                .filter(Boolean),
            );
          processingLiveEventIdsRef.current.delete(eventId);
          dispatchLiveHostEvent({
            type: 'generation',
            at: Date.now(),
            eventId,
            stage: 'completed',
            turn,
          });
          if (options?.onPrepared) {
            if (repeatsRecentTopic) {
              emitRuntimeEvent({
                eventId,
                stage: 'proactive_semantic_repeat_suppressed',
                at: Date.now(),
                source: options.source,
                sourceLabel: options.sourceLabel,
                reason: 'recent-topic-semantic-overlap',
              });
              options.onPrepared(NO_REPLY_TOKEN, enrichment.skills, speechPlan);
              return;
            }
            options.onPrepared(reply, enrichment.skills, speechPlan);
            return;
          }
          if (!directPlaybackRequested) return;
          if (
            runtimeScopeReadyKey !== soulScopeKey ||
            !claimSpeechPermission(eventId)
          ) {
            emitRuntimeEvent({
              eventId,
              stage: 'dropped',
              at: Date.now(),
              reason: 'coordinator_denied_direct_chat_speech',
            });
            commitConversationHistoryOutcome(eventId, 'skipped', {
              viewerId: options?.viewerId,
              deliveredFraction: 0,
              reasonCode: 'coordinator-denied-direct-chat-speech',
            });
            return;
          }
          const active = activeLifecycleRef.current;
          if (active?.eventId === eventId) {
            active.replyText = reply;
          } else {
            activeLifecycleRef.current = {
              eventId,
              replyText: reply,
              channel: options?.source ?? 'chat',
              label: options?.sourceLabel ?? 'chat',
              viewerId: options?.viewerId,
              viewerName: options?.viewerName,
              sourcesSeen: options?.sourcesSeen,
            };
          }
          void speakPrepared(reply, speechPlan).catch((error) => {
            emitRuntimeEvent({
              eventId,
              stage: 'failed',
              at: Date.now(),
              reason: 'direct_chat_tts_failed',
              error: error instanceof Error ? error.message : String(error),
            });
            commitConversationHistoryOutcome(eventId, 'failed', {
              viewerId: options?.viewerId,
              deliveredFraction: 0,
              reasonCode: 'direct-chat-tts-failed',
              ttsEndAt: Date.now(),
            });
            void finalizeSoulOutcome(eventId, 'failed', {
              deliveredFraction: 0,
              reasonCode: 'direct-chat-tts-failed',
            });
            if (activeLifecycleRef.current?.eventId === eventId) {
              activeLifecycleRef.current = null;
            }
          });
        },
      });
    },
    [
      activeSoulCanon,
      commitConversationHistoryOutcome,
      conversationHistoryScopeFor,
      emitRuntimeEvent,
      dispatchLiveHostEvent,
      claimSpeechPermission,
      finalizeSoulOutcome,
      getShortTermLiveContext,
      hostExtensions,
      liveDirector,
      liveHostSnapshot.lastAudienceActivityAt,
      personaPlannerEnabled,
      processChat,
      processVisionChat,
      recordSoulReflectionEvidence,
      runSoulReflection,
      runtimeProfile.id,
      runtimeScopeReadyKey,
      soulControlState.cognitionFrozen,
      soulControlState.memoryIsolated,
      soulControlState.neutralFallbackActive,
      soulControlState.operatorHasControl,
      soulPublicBehaviorEnabled,
      soulRuntimeMode,
      soulScope,
      soulScopeKey,
      soulSession,
      speakPrepared,
      streamerMemory,
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
      prompt?: string;
      directReply?: string;
      source: string;
      sourceLabel: string;
      viewerId?: string;
      viewerName?: string;
      sourcesSeen?: string[];
      roomContext?: RoomInteractionSnapshot;
      testRunId?: string;
      stepId?: string;
      scenarioId?: string;
      faultKind?: OperatorQueueItem['faultKind'];
      engagementSignals?: OperatorQueueItem['engagementSignals'];
      presenceOnly?: boolean;
      createdAt?: number;
    }) => {
      const now = Date.now();
      const createdAt =
        typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)
          ? input.createdAt
          : now;
      const normalizedCityReport = normalizeCityReportEngagementPayload(
        {
          eventId: input.eventId,
          text: input.text,
          directReply: input.directReply,
          viewerName: input.viewerName,
        },
        soulRuntimeMode,
      );
      const queueInput = {
        ...input,
        text: normalizedCityReport.text,
        directReply: normalizedCityReport.directReply,
        viewerName: normalizedCityReport.viewerName,
      };
      const response = await fetch('/api/operator-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ingest', ...queueInput, createdAt }),
      });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(
          `operator queue ingest failed (${response.status})${
            detail ? `: ${detail.slice(0, 300)}` : ''
          }`,
        );
      }
      emitRuntimeEvent({
        ...queueInput,
        stage: 'received',
        at: now,
        cityReportResult: normalizedCityReport.isCityReportResult,
        legacySupportRequestRemoved:
          normalizedCityReport.legacySupportRequestRemoved,
      });
      emitRuntimeEvent({
        ...queueInput,
        stage: 'queued',
        at: now,
        queuedAt: now,
        cityReportResult: normalizedCityReport.isCityReportResult,
        legacySupportRequestRemoved:
          normalizedCityReport.legacySupportRequestRemoved,
      });
      // The item has already been accepted. A transient list refresh must not
      // make the caller treat that accepted task as an enqueue failure.
      await refreshOperatorQueue().catch(() => undefined);
    },
    [emitRuntimeEvent, refreshOperatorQueue, soulRuntimeMode],
  );

  const enqueueProactiveSpeech = useCallback(
    (input: {
      prompt: string;
      awarenessSource: string;
      audiencePresent: boolean;
      personaIntent?: ProactiveIntentPlanV1;
      roomContext?: RoomInteractionSnapshot;
      scheduledNextAt?: number;
      busy?: boolean;
    }) => {
      const eventId = `proactive:${crypto.randomUUID()}`;
      const lastAudienceActivityAt = liveHostSnapshot.lastAudienceActivityAt;
      const quietForMs = lastAudienceActivityAt
        ? Math.max(0, Date.now() - lastAudienceActivityAt)
        : Number.POSITIVE_INFINITY;
      const requiredQuietMs = minimumQuietIntervalMs(
        emptyRoomAwarenessSettings,
      );
      if (quietForMs < requiredQuietMs) {
        emitRuntimeEvent({
          eventId,
          stage: 'dropped',
          at: Date.now(),
          source: 'quiet-room-awareness',
          reason: 'recent_audience_activity',
          quietForMs,
          requiredQuietMs,
        });
        return;
      }
      const decisions = dispatchLiveHostEvent({
        type: 'quiet-candidate',
        at: Date.now(),
        eventId,
        source: input.awarenessSource,
        opportunityId: eventId,
        expiresAt: Date.now() + 30_000,
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
      const personaIntent = input.personaIntent;
      if (!soulPublicBehaviorEnabled && !personaIntent) {
        emitRuntimeEvent({
          eventId,
          stage: 'dropped',
          at: Date.now(),
          source: 'quiet-room-awareness',
          reason: 'legacy-persona-intent-missing',
        });
        return;
      }
      if (!soulPublicBehaviorEnabled && personaIntent) {
        pendingPersonaRuntimeCommitsRef.current.set(eventId, {
          proactive: personaIntent,
        });
      }
      emitRuntimeEvent(
        soulPublicBehaviorEnabled
          ? {
              eventId,
              stage: 'proactive-opportunity-selected',
              at: Date.now(),
              source: 'quiet-room-awareness',
              awarenessSource: input.awarenessSource,
              audiencePresent: input.audiencePresent,
              scheduledNextAt: input.scheduledNextAt,
            }
          : {
              eventId,
              stage: 'proactive-selected',
              at: Date.now(),
              source: 'quiet-room-awareness',
              awarenessSource: input.awarenessSource,
              audiencePresent: input.audiencePresent,
              activeDrive: personaIntent?.drive,
              topicFamily: personaIntent?.topicFamily,
              topicSource: personaIntent?.source,
              continuity: personaIntent?.continuity,
              expressedEmotion: personaIntent?.emotion.label,
              scheduledNextAt: input.scheduledNextAt,
            },
      );
      proactiveSpeechRef.current = true;
      proactiveEventIdRef.current = eventId;
      const isSoulOpportunity = input.awarenessSource === 'soul-opportunity';
      void enqueueOperatorMessage({
        eventId,
        text: isSoulOpportunity
          ? input.audiencePresent
            ? '安静时段自主评估（有在场观众）'
            : '安静时段自主评估（当前无人）'
          : input.audiencePresent
            ? '空场主动搭话（有在场观众）'
            : `空场自语（${input.awarenessSource}）`,
        prompt: input.prompt,
        source: 'quiet-room-awareness',
        sourceLabel: isSoulOpportunity
          ? 'Soul 安静时段自主机会'
          : '安静直播间主动搭话',
        sourcesSeen: ['quiet-room-awareness', input.awarenessSource],
        roomContext: input.roomContext,
      }).catch((error) => {
        proactiveSpeechRef.current = false;
        proactiveEventIdRef.current = null;
        pendingPersonaRuntimeCommitsRef.current.delete(eventId);
        dispatchLiveHostEvent({
          type: 'runtime-fault',
          at: Date.now(),
          eventId,
          reasonCode: 'proactive_enqueue_failed',
        });
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
      emptyRoomAwarenessSettings,
      hostCoordinatorV2Enabled,
      liveHostSnapshot.lastAudienceActivityAt,
      soulPublicBehaviorEnabled,
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
          const pending = pendingDeliveredInteractionsRef.current.get(eventId);
          emitRuntimeEvent({
            eventId,
            stage: 'dropped',
            at: Date.now(),
            source: 'quiet-room-awareness',
            reason,
          });
          pendingPersonaRuntimeCommitsRef.current.delete(eventId);
          commitConversationHistoryOutcome(eventId, 'skipped', {
            viewerId: pending?.viewerId,
            deliveredFraction: 0,
            reasonCode: reason,
          });
          pendingDeliveredInteractionsRef.current.delete(eventId);
          finalizeSoulOutcome(eventId, 'skipped', {
            deliveredFraction: 0,
            reasonCode: reason,
          });
        }),
      )
        .then(() => refreshOperatorQueue())
        .catch(() => undefined);
    },
    [
      commitConversationHistoryOutcome,
      emitRuntimeEvent,
      finalizeSoulOutcome,
      isSpeaking,
      operatorQueue,
      refreshOperatorQueue,
    ],
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
      return (
        !hostCoordinatorV2Enabled ||
        decisions.some(
          (decision) =>
            decision.kind === 'queue-audience-turn' &&
            decision.eventId === eventId,
        )
      );
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
      void unlock().catch(() => undefined);
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
      runtimeScopeReadyKey !== soulScopeKey ||
      (hostCoordinatorV2Enabled &&
        liveHostSnapshot.phase === 'operator_hold') ||
      isProcessing ||
      preparingOperatorTaskRef.current
    )
      return;
    const next = operatorQueue.find(
      (item) =>
        item.status === 'pending' &&
        (item.createdAt >= runtimeScopeActivatedAtRef.current ||
          item.finishReason === 'lease_expired_requeued') &&
        (!item.assignedOwnerId ||
          item.assignedOwnerId === runtimeOwnerIdRef.current),
    );
    if (!next) return;
    const claimedScopeEpoch = runtimeScopeEpochRef.current;
    generationFailureQueueMutationRef.current.delete(next.eventId);
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
          if (
            !next.interactionObservedAt &&
            next.viewerId &&
            !next.presenceOnly
          ) {
            const relationshipPlatform = next.sourcesSeen?.[0] || 'unknown';
            const relationshipKey = `${relationshipPlatform}:${next.viewerId}`;
            const beforeRelationships = liveDirector.getRelationshipSnapshot();
            if (!soulPublicBehaviorEnabled) {
              liveDirector.observeViewerInteraction({
                id: next.viewerId,
                name: next.viewerName,
                platform: relationshipPlatform,
              });
            }
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
            if (!soulPublicBehaviorEnabled) {
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
          if (
            claimedScopeEpoch !== runtimeScopeEpochRef.current ||
            activeSoulScopeContextRef.current.scopeKey !== soulScopeKey
          ) {
            prepared = true;
            await updateOperatorQueue(next.eventId, 'fail', {
              reason: 'scope_changed_during_generation',
            }).catch(() => undefined);
            return;
          }
          const generationPrompt = next.prompt || next.text;
          // Queue-originated turns (live comments, radar bridge messages and
          // proactive turns) used to bypass the trace initialised by
          // handleSend. They could finish and emit `done`, but had no latency
          // record to persist, leaving the topology stuck on an older result.
          // Start one trace for the claimed queue turn before generation so a
          // safe skill fallback is measured exactly like a normal reply.
          replyLatencyRef.current = {
            requestId: crypto.randomUUID(),
            source:
              next.source.includes('live') ||
              next.source === 'parent-message' ||
              next.source === 'external-chat-bridge'
                ? 'live'
                : 'chat',
            inputAt: next.createdAt,
            models: replyModelTrace,
            input: next.text,
            eventId: next.eventId,
            origin: {
              channel: next.source,
              viewerId: next.viewerId,
              viewerName: next.viewerName,
              sourcesSeen: next.sourcesSeen,
            },
          };
          chatAccepted =
            (await processWithHostExtensions(generationPrompt, {
              displayText: next.text,
              source: 'chat',
              eventId: next.eventId,
              sourceLabel: next.sourceLabel || next.source,
              viewerId: next.viewerId,
              viewerName: next.viewerName,
              sourcesSeen: next.sourcesSeen,
              roomContext: next.roomContext,
              createdAt: next.createdAt,
              testRunId: next.testRunId,
              stepId: next.stepId,
              scenarioId: next.scenarioId,
              faultKind: next.faultKind,
              faultConsumed: next.faultConsumed,
              engagementSignals: next.engagementSignals,
              memoryContext: streamerMemory.contextFor(next.text, {
                id: scopedViewerId(next.viewerId, next.sourcesSeen?.[0]),
                name: next.viewerName,
              }),
              silent: true,
              onPrepared: (reply, skills, speechPlan) => {
                prepared = true;
                if (
                  claimedScopeEpoch !== runtimeScopeEpochRef.current ||
                  activeSoulScopeContextRef.current.scopeKey !== soulScopeKey
                ) {
                  void updateOperatorQueue(next.eventId, 'fail', {
                    reason: 'scope_changed_before_draft_commit',
                  }).catch(() => undefined);
                  return;
                }
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
                  speechPlan,
                  skills,
                });
                void updateOperatorQueue(next.eventId, 'ready', {
                  reply,
                  speechPlan,
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
          // The current attempt has returned, so its generation de-duplication
          // guard must not outlive the attempt and reject the controlled retry.
          processingLiveEventIdsRef.current.delete(next.eventId);
          const capturedFailure = generationFailureByEventIdRef.current.get(
            next.eventId,
          );
          generationFailureByEventIdRef.current.delete(next.eventId);
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
            const reason =
              capturedFailure?.reason ??
              (chatAccepted
                ? 'generation_completed_without_draft'
                : 'generation_core_rejected');
            emitRuntimeEvent({
              eventId: next.eventId,
              stage: 'failed',
              at: Date.now(),
              reason,
              error: capturedFailure?.error,
            });
            if (capturedFailure && !capturedFailure.retryable) {
              await updateOperatorQueue(next.eventId, 'fail', { reason });
              return;
            }
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
    dispatchLiveHostEvent,
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
    replyModelTrace,
    refreshOperatorQueue,
    runtimeScopeReadyKey,
    soulScopeKey,
    soulPublicBehaviorEnabled,
    streamerMemory,
  ]);

  useEffect(() => {
    if (
      !isLiveRuntimeOwner ||
      runtimeScopeReadyKey !== soulScopeKey ||
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
        (item.createdAt >= runtimeScopeActivatedAtRef.current ||
          item.finishReason === 'lease_expired_requeued') &&
        (!item.assignedOwnerId ||
          item.assignedOwnerId === runtimeOwnerIdRef.current),
    );
    if (stale) {
      void updateOperatorQueue(stale.eventId, 'skip', {
        reason: 'stale_before_speech',
      })
        .then(() => {
          commitConversationHistoryOutcome(stale.eventId, 'skipped', {
            viewerId: stale.viewerId,
            deliveredFraction: 0,
            reasonCode: 'stale-before-speech',
          });
          pendingDeliveredInteractionsRef.current.delete(stale.eventId);
          finalizeSoulOutcome(stale.eventId, 'skipped', {
            deliveredFraction: 0,
            reasonCode: 'stale-before-speech',
          });
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
        item.createdAt >= runtimeScopeActivatedAtRef.current &&
        (!item.assignedOwnerId ||
          item.assignedOwnerId === runtimeOwnerIdRef.current),
    );
    if (!next?.preparedReply) return;
    const preparedReply = next.preparedReply;
    if (liveHostSnapshot.activeTurn?.eventId !== next.eventId) {
      const turn = {
        eventId: next.eventId,
        kind: next.source.includes('quiet-room')
          ? ('proactive' as const)
          : next.engagementSignals?.length
            ? ('engagement' as const)
            : ('viewer' as const),
        priority: next.engagementSignals?.some(
          (signal) => signal === 'superchat' || signal === 'guard',
        )
          ? ('high' as const)
          : ('normal' as const),
        createdAt: next.createdAt,
        targetViewerId: next.viewerId,
      };
      dispatchLiveHostEvent({
        type: 'generation',
        at: Date.now(),
        eventId: next.eventId,
        stage: 'started',
        turn,
      });
      dispatchLiveHostEvent({
        type: 'generation',
        at: Date.now(),
        eventId: next.eventId,
        stage: 'completed',
        turn,
      });
    }
    const claimedScopeEpoch = runtimeScopeEpochRef.current;
    speakingOperatorTaskRef.current = next.eventId;
    void (async () => {
      let leaseTimer: number | null = null;
      let claimedSpeech = false;
      try {
        await updateOperatorQueue(next.eventId, 'claim-speak', {
          ownerId: runtimeOwnerIdRef.current,
        });
        claimedSpeech = true;
        if (!claimSpeechPermission(next.eventId)) {
          await updateOperatorQueue(next.eventId, 'fail', {
            reason: 'coordinator_speak_turn_missing',
          }).catch(() => undefined);
          speakingOperatorTaskRef.current = null;
          return;
        }
        if (
          claimedScopeEpoch !== runtimeScopeEpochRef.current ||
          activeSoulScopeContextRef.current.scopeKey !== soulScopeKey
        ) {
          await updateOperatorQueue(next.eventId, 'fail', {
            reason: 'scope_changed_before_speech',
          }).catch(() => undefined);
          speakingOperatorTaskRef.current = null;
          return;
        }
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
        armOperatorSpeechWatchdog(
          next.eventId,
          OPERATOR_TTS_START_TIMEOUT_MS,
          'tts_first_audio_timeout',
        );
        await speakPrepared(preparedReply, next.preparedSpeechPlan);
      } catch (error) {
        if (operatorSpeechWatchdogRef.current !== null) {
          window.clearTimeout(operatorSpeechWatchdogRef.current);
          operatorSpeechWatchdogRef.current = null;
        }
        operatorPlaybackObservedRef.current = false;
        // A second control/overlay page may have rendered from a stale queue
        // snapshot. It lost the atomic server claim; that is not a playback
        // failure and must never overwrite the real owner's done state.
        if (!claimedSpeech) {
          speakingOperatorTaskRef.current = null;
          return;
        }
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
        const incompleteDelivery = resolveIncompleteDelivery({
          beatCount: operatorBeatCountRef.current,
          completedBeatCount: operatorCompletedBeatCountRef.current,
          audioByteLength: operatorAudioByteLengthRef.current,
          playbackObserved:
            operatorPlaybackObservedRef.current ||
            Boolean(activeLifecycleRef.current?.ttsStartAt),
        });
        await finalizeSoulOutcome(next.eventId, incompleteDelivery.status, {
          deliveredFraction: incompleteDelivery.deliveredFraction,
          reasonCode:
            incompleteDelivery.status === 'partial'
              ? 'tts-playback-failed-after-partial-delivery'
              : 'tts-playback-failed',
        });
        if (activeLifecycleRef.current?.eventId === next.eventId) {
          activeLifecycleRef.current = null;
        }
        commitConversationHistoryOutcome(
          next.eventId,
          incompleteDelivery.status,
          {
            viewerId: next.viewerId,
            deliveredFraction: incompleteDelivery.deliveredFraction,
            reasonCode: 'tts_playback_failed',
            ttsEndAt: Date.now(),
          },
        );
        pendingDeliveredInteractionsRef.current.delete(next.eventId);
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
    commitConversationHistoryOutcome,
    emitRuntimeEvent,
    finalizeSoulOutcome,
    dispatchLiveHostEvent,
    isLiveRuntimeOwner,
    isProcessing,
    isSpeaking,
    hostCoordinatorV2Enabled,
    liveHostSnapshot.activeTurn?.eventId,
    liveHostSnapshot.phase,
    operatorQueue,
    refreshOperatorQueue,
    runtimeScopeReadyKey,
    soulScopeKey,
    armOperatorSpeechWatchdog,
    claimSpeechPermission,
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
        directReply?: unknown;
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
        if (soulPublicBehaviorEnabled) {
          const eventId = String(
            data.requestId || `parent-engagement:${crypto.randomUUID()}`,
          );
          const decisions = dispatchLiveHostEvent({
            type: 'engagement',
            at: requestedAt,
            eventId,
            viewerId,
            engagementKind: signal,
            priority:
              signal === 'superchat' || signal === 'guard' ? 'high' : 'normal',
          });
          const interrupt = decisions.find(
            (decision) => decision.kind === 'interrupt',
          );
          if (interrupt?.kind === 'interrupt') {
            interruptSpeech(interrupt.mode);
          }
          const accepted =
            !hostCoordinatorV2Enabled ||
            decisions.some(
              (decision) =>
                decision.kind === 'queue-audience-turn' &&
                decision.eventId === eventId,
            );
          if (accepted) {
            void enqueueOperatorMessage({
              eventId,
              text: `Verified platform ${signal} event`,
              source: 'parent-engagement',
              sourceLabel: 'typhoon-radar-engagement',
              viewerId,
              viewerName,
              sourcesSeen: ['typhoon-radar'],
              engagementSignals: [signal],
              createdAt: requestedAt,
            });
          }
          return;
        }
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
        if (!interruptProactiveSpeech(requestId, viewerId)) {
          emitRuntimeEvent({
            eventId: requestId,
            stage: 'dropped',
            at: Date.now(),
            reason: 'coordinator-rejected-audience-turn',
          });
          return;
        }
        const directReply =
          typeof data.directReply === 'string' ? data.directReply.trim() : '';
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
          directReply,
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
    dispatchLiveHostEvent,
    emitRuntimeEvent,
    hostCoordinatorV2Enabled,
    interruptSpeech,
    liveDirector,
    markLiveActivity,
    enqueueOperatorMessage,
    interruptProactiveSpeech,
    soulPublicBehaviorEnabled,
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
          directReply?: unknown;
          viewerId?: unknown;
          viewerName?: unknown;
        };
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        const directReply =
          typeof data.directReply === 'string' ? data.directReply.trim() : '';
        if (!text || text.length > 500) return;
        const eventId = String(data.requestId || crypto.randomUUID());
        const viewerId =
          typeof data.viewerId === 'string' ? data.viewerId : 'external-viewer';
        markLiveActivity('external-chat-bridge');
        if (!interruptProactiveSpeech(eventId, viewerId)) return;
        void enqueueOperatorMessage({
          eventId,
          text,
          source: 'external-chat-bridge',
          sourceLabel: '外部聊天桥接',
          viewerId:
            typeof data.viewerId === 'string' ? data.viewerId : '001号人类',
          viewerName:
            typeof data.viewerName === 'string' ? data.viewerName : '001号人类',
          directReply,
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
      void unlock().catch(() => undefined);
      // Manual chat uses the same authoritative queue in legacy, shadow,
      // canary and primary modes. No direct processChat/TTS bypass remains.
      if (isLiveHostCoordinatorRequired()) {
        const eventId = crypto.randomUUID();
        markLiveActivity('web-chat');
        if (!interruptProactiveSpeech(eventId, 'operator')) return;
        void enqueueOperatorMessage({
          eventId,
          text,
          source: 'web-chat',
          sourceLabel: 'control-room-input',
          sourcesSeen: ['local-control-room'],
        });
        return;
      }
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
      if (!interruptProactiveSpeech(lifecycle.eventId, 'operator')) {
        activeLifecycleRef.current = null;
        return;
      }
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
      enqueueOperatorMessage,
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
        roomContext?: RoomInteractionSnapshot;
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
        roomContext: options?.roomContext,
        createdAt: options?.commentAt,
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
    const audienceMembers = liveDirector.getAudienceSnapshot();
    const awarenessContext = {
      digitalHumanName: runtimeProfile.displayName,
      digitalHumanTitle: runtimeProfile.title,
      isLive: room.isLive,
      audiencePresent: room.estimatedAudience > 0,
      participantCount: room.estimatedAudience,
      busy:
        isProcessing || isSpeaking || queueDepth > 0 || oldestQueueAgeMs > 0,
      interfaceContext,
      memoryCues,
      audienceMembers,
    };
    const awareness = soulPublicBehaviorEnabled
      ? emptyRoomAwarenessPlannerRef.current?.pollSoulOpportunity(
          emptyRoomAwarenessSettings,
          awarenessContext,
        )
      : emptyRoomAwarenessPlannerRef.current?.poll(
          emptyRoomAwarenessSettings,
          awarenessContext,
        );
    if (awareness) {
      enqueueProactiveSpeech({
        prompt: awareness.prompt,
        awarenessSource: awareness.source,
        audiencePresent: room.estimatedAudience > 0,
        personaIntent:
          awareness.source === 'strategy' ? awareness.personaIntent : undefined,
        roomContext:
          awareness.source === 'soul-opportunity'
            ? awareness.roomContext
            : undefined,
        scheduledNextAt: awareness.scheduledNextAt,
      });
    }
  }, 10_000);

  const handleYoutubeComment = useCallback(
    (comment: YouTubeChatMessage) => {
      markLiveActivity('youtube-comment');
      if (interruptProactiveSpeech(comment.id, comment.userName)) {
        enqueueYouTubeComments([comment]);
      }
    },
    [enqueueYouTubeComments, interruptProactiveSpeech, markLiveActivity],
  );

  const handleTwitchComment = useCallback(
    (comment: TwitchChatMessage) => {
      const eventId = `twitch:${crypto.randomUUID()}`;
      markLiveActivity('twitch-comment');
      if (interruptProactiveSpeech(eventId, comment.userName)) {
        enqueueTwitchComments([comment]);
      }
    },
    [enqueueTwitchComments, interruptProactiveSpeech, markLiveActivity],
  );

  const handleLiveRoomEvent = useCallback(
    (comment: LiveRoomEvent) => {
      // Bilibili's room-status endpoint occasionally fails while the WebSocket
      // is still delivering real-time events. A fresh comment *or entry* is
      // stronger evidence that the room is live than that stale status poll;
      // otherwise every entry is discarded before the welcome branch below.
      // History polling remains deliberately excluded so reconnects never
      // replay old comments.
      const receivedAt =
        Number(comment.metadata?.receivedAt) || comment.timestamp || 0;
      const isFreshInboundEvent =
        (comment.type === 'comment' || comment.type === 'entry') &&
        comment.metadata?.source !== 'history-poll' &&
        receivedAt > 0 &&
        Date.now() - receivedAt < 60_000;
      if (!liveDirector.isRoomLive()) {
        if (!isFreshInboundEvent) return;
        liveDirector.updateRoomState({ isLive: true });
      }
      const platform =
        normalizeViewerPlatform(
          typeof comment.metadata?.platformId === 'string'
            ? comment.metadata.platformId
            : 'live',
        ) || 'live';
      radarCityCommandRouterRef.current.observeViewer(
        comment.author,
        comment.timestamp || Date.now(),
      );
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
      let coordinatorAccepted = true;
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
        coordinatorAccepted =
          !hostCoordinatorV2Enabled ||
          decisions.some(
            (decision) =>
              decision.kind === 'queue-audience-turn' &&
              decision.eventId === comment.id,
          );
        const interrupt = decisions.find(
          (decision) => decision.kind === 'interrupt',
        );
        if (interrupt?.kind === 'interrupt') {
          interruptSpeech(interrupt.mode);
        }
        if (!soulPublicBehaviorEnabled) {
          liveDirector.recordRelationshipSignal(
            {
              id: comment.author.id,
              name: comment.author.name,
              platform,
            },
            supportSignal,
          );
        }
      }
      if (comment.type === 'follow') {
        const observedAt = comment.timestamp || Date.now();
        const persistedAt = viewerFollowRegistry.record(
          { platform, viewerId: comment.author.id },
          observedAt,
        );
        if (persistedAt !== undefined && window.parent !== window) {
          window.parent.postMessage(
            createViewerRelationEvent({
              id: comment.id,
              viewerId: comment.author.id,
              viewerName: comment.author.name,
              platform,
              observedAt,
            }),
            '*',
          );
        }
      }
      if (!isQuietRoomInteraction(comment.type)) {
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
            mayMentionName: true,
          },
        });
        const viewer = {
          id: comment.author.id,
          name: comment.author.name,
          platform,
        };
        const entryObservation = liveDirector.observeViewerEntry(
          viewer,
          Number(comment.metadata?.firstSeenAt) || undefined,
        );
        const welcomePrompt =
          entryObservation && shouldWelcomeViewerEntry(entryObservation)
            ? buildViewerEntryWelcomePrompt({
                viewerName: comment.author.name,
                platform,
                estimatedAudience: entryObservation.estimatedAudience,
                viewerLocation:
                  typeof comment.metadata?.ipLocation === 'string'
                    ? comment.metadata.ipLocation
                    : typeof comment.metadata?.location === 'string'
                      ? comment.metadata.location
                      : typeof comment.metadata?.province === 'string'
                        ? comment.metadata.province
                        : undefined,
              })
            : null;
        if (welcomePrompt) {
          const welcomeEventId = `entry-welcome:${comment.id}`;
          interruptProactiveSpeech(welcomeEventId, comment.author.id);
          void enqueueOperatorMessage({
            eventId: welcomeEventId,
            text: welcomePrompt,
            source: 'viewer-entry-welcome',
            sourceLabel: '直播间进场欢迎',
            viewerId: comment.author.id,
            viewerName: comment.author.name,
            sourcesSeen: [platform],
            presenceOnly: true,
            createdAt: comment.timestamp || Date.now(),
          }).catch((error) => {
            emitRuntimeEvent({
              eventId: welcomeEventId,
              stage: 'failed',
              at: Date.now(),
              source: 'viewer-entry-welcome',
              viewerId: comment.author.id,
              viewerName: comment.author.name,
              reason: 'viewer_entry_welcome_enqueue_failed',
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
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
      // consumer. Only a whole-message city command (for example "@上海")
      // may enter its bridge. Viewer mentions such as "@北辰 你闭嘴" remain
      // ordinary room conversation for the persona/conflict pipeline.
      if (comment.type === 'comment' && comment.text.trim()) {
        const isCityCommand =
          isRadarCityCommand(comment.text) &&
          radarCityCommandRouterRef.current.shouldRoute(comment.text);
        if (isCityCommand) {
          const followObservedAt = viewerFollowRegistry.observedAt({
            platform,
            viewerId: comment.author.id,
          });
          const radarCityComment = createLiveCommentEvent({
            id: comment.id,
            text: comment.text.trim(),
            viewerId: comment.author.id,
            viewerName: comment.author.name,
            platform,
            // Some live-platform adapters omit a timestamp on otherwise valid
            // comments. The radar bridge requires a finite receive time, so
            // use the arrival time just as the rest of this handler does.
            receivedAt: comment.timestamp || Date.now(),
            followObservedAt,
          });
          if (window.parent !== window) {
            window.parent.postMessage(radarCityComment, '*');
          }
          void relayRadarCityComment(radarCityComment).catch(() => undefined);
          markLiveActivity(
            `${String(comment.metadata?.platformId || 'live')}-city-command`,
          );
          // City commands are consumed by the radar bridge and do not create
          // a host reply. Only notify the host coordinator when there really
          // is proactive speech to cancel; otherwise an audience-message with
          // no matching generation leaves the host stuck in deliberating.
          if (proactiveSpeechRef.current || proactiveEventIdRef.current) {
            interruptProactiveSpeech(comment.id, comment.author.id);
          }
          return;
        }
      }
      markLiveActivity(
        `${String(comment.metadata?.platformId || 'live')}-${comment.type}`,
      );
      if (!supportSignal) {
        coordinatorAccepted = interruptProactiveSpeech(
          comment.id,
          comment.author.id,
        );
      } else {
        cancelQueuedProactiveSpeech('engagement_waits_for_next_beat');
      }
      if (coordinatorAccepted) {
        const queuedComment = routeSimulatorEventForQueue(comment);
        recentLiveTurnsRef.current = projectObservedLiveTurn(
          recentLiveTurnsRef.current,
          {
            eventId: queuedComment.id,
            at: queuedComment.timestamp || Date.now(),
            input: queuedComment.text,
            viewerId: queuedComment.author.id,
            viewerName: queuedComment.author.name,
            sourceLabel: platform,
            sourcesSeen: [platform],
          },
        );
        enqueueLiveRoomEvents([queuedComment]);
      } else {
        emitRuntimeEvent({
          eventId: comment.id,
          stage: 'dropped',
          at: Date.now(),
          reason: 'coordinator-rejected-audience-turn',
        });
      }
    },
    [
      cancelQueuedProactiveSpeech,
      dispatchLiveHostEvent,
      emitRuntimeEvent,
      enqueueOperatorMessage,
      enqueueLiveRoomEvents,
      interruptProactiveSpeech,
      interruptSpeech,
      hostCoordinatorV2Enabled,
      liveDirector,
      markLiveActivity,
      soulPublicBehaviorEnabled,
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
      dispatchLiveHostEvent({
        type: 'stream-state',
        at: Date.now(),
        isLive: true,
      });
      publishSimulatorEvent(event);
      handleLiveRoomEvent(event);
    },
    [dispatchLiveHostEvent, handleLiveRoomEvent, liveDirector, unlock],
  );

  useEffect(() => {
    if (!isObsOverlay || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SIMULATOR_EVENT_CHANNEL);
    channel.addEventListener('message', (message: MessageEvent<unknown>) => {
      if (!isSimulatorBridgeEvent(message.data)) return;
      // The independent simulator is a real live-event source for the embedded
      // runtime. Mirror its live state before routing the event so the normal
      // room-live guard cannot discard the cross-window comment/follow chain.
      liveDirector.updateRoomState({ isLive: true });
      handleLiveRoomEvent(message.data);
    });
    return () => channel.close();
  }, [handleLiveRoomEvent, isObsOverlay, liveDirector]);

  useEffect(() => {
    if (!isObsOverlay || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(RADAR_CITY_EVENT_CHANNEL);
    const forwardToRadar = (message: MessageEvent<unknown>) => {
      if (!isRadarCityCommentEvent(message.data) || window.parent === window)
        return;
      window.parent.postMessage(message.data, '*');
    };
    channel.addEventListener('message', forwardToRadar);
    return () => channel.close();
  }, [isObsOverlay]);

  useEffect(() => {
    if (!isObsOverlay) return;
    let cancelled = false;
    let after: number | null = null;
    const forwardRelayedEvents = async () => {
      try {
        const result = await readRelayedRadarCityComments(
          after === null ? 'latest' : after,
        );
        if (after === null) {
          after = result.latestSequence;
          return;
        }
        if (result.latestSequence < after) {
          // Vite may restart independently of the long-lived OBS browser
          // source. Align to the new relay generation without replaying it.
          after = result.latestSequence;
          return;
        }
        const events = result.events;
        for (const { sequence, event } of events) {
          after = Math.max(after, sequence);
          if (window.parent !== window) window.parent.postMessage(event, '*');
        }
      } catch {
        // The overlay retries while the local Vite host restarts.
      }
    };
    void forwardRelayedEvents();
    const timer = window.setInterval(() => {
      if (!cancelled) void forwardRelayedEvents();
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isObsOverlay]);

  const handleOrdinaryRoadStatus = useCallback(
    (status: LiveRoomStatus) => {
      const effectiveStatus = resolveEffectiveLiveRoomStatus(status, {
        obsOverlayActive: isObsOverlay,
        autoBroadcastEnabled,
      });
      liveDirector.updateRoomState(effectiveStatus);
      dispatchLiveHostEvent({
        type: 'stream-state',
        at: Date.now(),
        isLive: effectiveStatus.isLive === true,
      });
      setOrdinaryRoadStatus(effectiveStatus);
      if (status.state === 'online') {
        setStreamErrorMessage('');
      } else if (status.state === 'error') {
        setStreamErrorMessage(status.error || 'OrdinaryRoad 连接器正在重连。');
      }
    },
    [autoBroadcastEnabled, dispatchLiveHostEvent, isObsOverlay, liveDirector],
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
          audioUnlockRequired={audioUnlockRequired}
          onUnlockAudio={() => void unlock().catch(() => undefined)}
        />
      ) : (
        <ControlRoom
          soulInspector={{
            runtimeMode: soulRuntimeMode,
            onRuntimeModeChange: (mode) => {
              if (mode === 'primary' && !soulPrimaryGatePassed) {
                settingsHook.updateSoulRuntimeMode('canary');
                emitRuntimeEvent({
                  stage: 'soul_primary_gate_blocked',
                  at: Date.now(),
                  reason: 'requires-two-distinct-two-hour-production-canaries',
                });
                return;
              }
              settingsHook.updateSoulRuntimeMode(mode);
            },
            state:
              soulInspectorTrace?.state ??
              (soulSession ? projectSoulState(soulSession.getState()) : null),
            event: soulInspectorTrace?.event,
            decision: soulInspectorTrace?.decision,
            outcome: soulInspectorTrace?.outcome,
            telemetry: soulInspectorTrace?.telemetry,
            memoryRefs: soulInspectorTrace?.memoryRefs,
            canary: {
              status:
                soulCanaryBusy ??
                (activeSoulCanary
                  ? soulCanaryOperatorCredential?.runId ===
                    activeSoulCanary.runId
                    ? 'active'
                    : 'active-elsewhere'
                  : soulCanaryError
                    ? 'error'
                    : 'idle'),
              runId: activeSoulCanary?.runId,
              startedAt: activeSoulCanary?.startedAt,
              elapsedMs: activeSoulCanary
                ? Math.max(0, soulCanaryClock - activeSoulCanary.startedAt)
                : undefined,
              scopeLabel: activeSoulCanary
                ? `${activeSoulCanary.scope.platform}/${activeSoulCanary.scope.roomId}`
                : `${soulScope.platform}/${soulScope.roomId}`,
              runtimeOwnerClaimedAt: activeSoulCanary?.runtimeOwnerClaimedAt,
              primaryEligible: soulPrimaryGatePassed,
              canStart:
                soulRuntimeMode === 'canary' &&
                soulScope.personaId === LINGLAN_SOUL_CONSTITUTION.personaId &&
                !activeSoulCanary &&
                !soulCanaryBusy,
              canFinish: Boolean(
                activeSoulCanary &&
                  soulCanaryOperatorCredential?.runId ===
                    activeSoulCanary.runId &&
                  soulCanaryClock - activeSoulCanary.startedAt >=
                    SOUL_CANARY_MIN_DURATION_MS &&
                  !soulCanaryBusy,
              ),
              canAbort: Boolean(
                activeSoulCanary &&
                  soulCanaryOperatorCredential?.runId ===
                    activeSoulCanary.runId &&
                  !soulCanaryBusy,
              ),
              error: soulCanaryError || undefined,
            },
            onStartCanary: startSoulCanary,
            onFinishCanary: finishSoulCanary,
            onAbortCanary: abortSoulCanary,
            controls: soulControlState,
            onFreezeCognition: (cognitionFrozen) => {
              setSoulControlState((state) => ({
                ...state,
                cognitionFrozen,
                cognitionFreezeOrigin: cognitionFrozen ? 'operator' : undefined,
              }));
              emitRuntimeEvent({
                stage: 'soul_operator_control',
                control: 'cognition',
                enabled: cognitionFrozen,
                at: Date.now(),
              });
            },
            onIsolateMemory: (memoryIsolated) => {
              setSoulControlState((state) => ({
                ...state,
                memoryIsolated,
              }));
              emitRuntimeEvent({
                stage: 'soul_operator_control',
                control: 'memory-write-isolation',
                enabled: memoryIsolated,
                at: Date.now(),
              });
            },
            onEnableNeutralFallback: (neutralFallbackActive) => {
              setSoulControlState((state) => ({
                ...state,
                neutralFallbackActive,
              }));
              emitRuntimeEvent({
                stage: 'soul_operator_control',
                control: 'neutral-fallback',
                enabled: neutralFallbackActive,
                at: Date.now(),
              });
            },
            onRecoverSnapshot: async () => {
              if (!baseSoulSession) return;
              setSoulControlState((state) => ({
                ...state,
                cognitionFrozen: true,
                cognitionFreezeOrigin: 'snapshot-recovery',
                busyControl: 'snapshot',
              }));
              emitRuntimeEvent({
                stage: 'soul_snapshot_recovery_requested',
                at: Date.now(),
                scope: soulScope,
              });
              try {
                const restored = await BrowserSoulRuntimeSession.recover({
                  constitution: LINGLAN_SOUL_CONSTITUTION,
                  profile: LINGLAN_SOUL_PROFILE,
                  scope: soulScope,
                });
                soulSessionByEventIdRef.current.clear();
                setSoulRecoveryState({
                  scopeKey: soulScopeKey,
                  status: 'ready',
                  session: restored,
                });
                setSoulInspectorTrace((previous) =>
                  previous
                    ? {
                        ...previous,
                        state: projectSoulState(restored.getState()),
                        outcome: {
                          status: 'skipped',
                          occurredAt: Date.now(),
                          reasonCode: 'snapshot-restored-cognition-frozen',
                        },
                      }
                    : previous,
                );
                setSoulControlState((state) => ({
                  ...state,
                  cognitionFrozen: true,
                  cognitionFreezeOrigin: 'snapshot-recovery',
                  snapshotRecoveryAvailable: true,
                  busyControl: undefined,
                }));
                emitRuntimeEvent({
                  stage: 'soul_snapshot_recovered',
                  at: Date.now(),
                  scope: soulScope,
                  stateVersion: restored.getState().version,
                });
              } catch (error) {
                setSoulControlState((state) => ({
                  ...state,
                  cognitionFrozen: true,
                  cognitionFreezeOrigin: 'snapshot-recovery',
                  snapshotRecoveryAvailable: false,
                  busyControl: undefined,
                }));
                emitRuntimeEvent({
                  stage: 'soul_snapshot_recovery_failed',
                  at: Date.now(),
                  scope: soulScope,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            },
            onOperatorTakeover: (operatorHasControl) => {
              setSoulControlState((state) => ({
                ...state,
                operatorHasControl,
              }));
              if (operatorHasControl) {
                emergencyTakeover();
              } else {
                dispatchLiveHostEvent({
                  type: 'operator-command',
                  at: Date.now(),
                  command: 'resume',
                  isLive: liveDirector.isRoomLive(),
                });
              }
              emitRuntimeEvent({
                stage: 'soul_operator_control',
                control: 'execution-authority',
                enabled: operatorHasControl,
                at: Date.now(),
              });
            },
          }}
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
