import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PuruPuruAvatarPackage } from '../lib/purupuruPackage';
import type { PuruPuruReaction } from '../lib/purupuruReactions';
import type { AvatarMotion } from '../lib/avatarMotion';
import type { ChatMessage } from '../types/chat';
import type {
  AppSettings,
  AvatarViewTransform,
  DigitalHumanProfile,
} from '../types/settings';
import type { StreamBusHealth } from '../hooks/useSocialStreamBus';
import type {
  RuntimeOwnerLeaseSnapshot,
  RuntimeOwnerLeaseState,
} from '../hooks/useRuntimeOwnerLease';
import type { LiveRoomStatus } from '../services/live-platform/types';
import type { LiveRoomEvent } from '../services/live-platform/types';
import type {
  InteractionFeedItem,
  InteractionFeedSummary,
} from '../hooks/useInteractionFeed';
import type { StreamerMemoryApi } from '../hooks/useStreamerMemory';
import { AvatarBackground } from './AvatarPanel';
import { ChatInput } from './ChatInput';
import { MemoryLifePanel } from './MemoryLifePanel';
import { DIGITAL_HUMAN_SKILLS } from '../lib/digitalHumanSkills';
import {
  appendOperatorQueueQuery,
  type OperatorQueueItem,
  type OperatorQueueScope,
  type OperatorQueueSummary,
} from '../lib/operatorQueue';
import { createSingleFlightRunner } from '../lib/singleFlight';
import type { LiveSessionState } from '../lib/liveSessionLifecycle';
import {
  fetchMinimaxVoiceOptions,
  type MinimaxVoiceOption,
} from '../lib/minimaxVoicePreview';
import type { StressRunState } from './StressTestPanel';
import type { BroadcastRuntimeHealth } from './BroadcastTopologyPanel';
import type { SoulInspectorPanelProps } from './SoulInspectorPanel';
import { LiveConnectorConsole } from './LiveConnectorConsole';
import type { LiveHostSnapshot } from '@aituber-onair/live-companion';
import {
  assessLiveReadiness,
  shouldPauseAutomationForReadiness,
  type LiveReadinessAction,
} from '../lib/liveReadiness';
import {
  planLiveStartup,
  type LiveStartupAction,
} from '../lib/liveStartupGuide';
import { projectLiveOperation } from '../lib/liveOperation';
import {
  executeRuntimeRecovery,
  projectRuntimeRecovery,
  type RuntimeRecoveryAction,
  type RuntimeRecoveryPorts,
} from '../lib/runtimeRecovery';
import {
  operatorPreflightRequiresPause,
  type OperatorPreflightReport,
  type OperatorPreflightSession,
} from '../lib/operatorPreflight';
import {
  buildCommitmentCompletionUpdate,
  commitmentDraftFromRecord,
  planCommitmentBroadcast,
  planCommitmentMutation,
  planCommitmentReminder,
  projectCommitmentRadar,
  type CommitmentDraft,
  type CommitmentDraftErrors,
  type CommitmentUrgency,
} from '../lib/commitmentRadar';
import {
  projectOperatorAttention,
  type OperatorAttentionAction,
  type OperatorAttentionItem,
} from '../lib/operatorAttention';
import {
  createOperatorAttentionActionEvent,
  mergeOperatorAttentionRuntimeEvents,
  projectOperatorAttentionLedger,
  type OperatorAttentionRuntimeEvent,
} from '../lib/operatorAttentionLedger';
import { projectLiveSessionRetrospective } from '../lib/liveSessionRetrospective';
import {
  createLiveSessionRetrospectiveEvent,
  mergeLiveSessionRetrospectiveEvents,
  projectLiveSessionTrend,
  retrospectiveRevision,
  type LiveSessionRetrospectiveRuntimeEvent,
} from '../lib/liveSessionTrend';
import {
  planNextSessionImprovement,
  type NextSessionImprovementItem,
} from '../lib/nextSessionImprovementPlan';
import {
  createNextSessionImprovementActionEvent,
  mergeNextSessionImprovementActionEvents,
  projectNextSessionImprovementEffectiveness,
  type NextSessionImprovementActionRuntimeEvent,
} from '../lib/nextSessionImprovementOutcome';
import { adaptNextSessionImprovementPlan } from '../lib/adaptiveImprovementPlan';
import {
  listImprovementStrategies,
  prepareImprovementStrategyExperiment,
  projectImprovementStrategyExperiments,
  selectNextImprovementStrategy,
  type ImprovementStrategy,
  type ImprovementStrategyDraft,
  type NextImprovementStrategySelection,
} from '../lib/improvementStrategyExperiment';
import {
  createImprovementStrategyAssetEvent,
  projectImprovementStrategyAssets,
  type ImprovementStrategyAsset,
} from '../lib/improvementStrategyAssets';
import {
  reviewImprovementStrategyDraft,
} from '../lib/improvementStrategyQuality';
import { calibrateImprovementStrategyQuality } from '../lib/improvementStrategyQualityCalibration';
import {
  createImprovementStrategyQualityPolicyRollbackProposal,
  createImprovementStrategyQualityPolicyEvent,
  projectImprovementStrategyQualityPolicyHistory,
  type ImprovementStrategyQualityPolicy,
  type ImprovementStrategyQualityPolicyField,
} from '../lib/improvementStrategyQualityPolicy';
import { evaluateImprovementStrategyQualityPolicyImpact } from '../lib/improvementStrategyQualityPolicyShadow';
import {
  createImprovementStrategyQualityRejectionEvent,
  observeImprovementStrategyQualityPolicyRelease,
} from '../lib/improvementStrategyQualityPolicyObservation';
import { governImprovementStrategyQualityPolicyChange } from '../lib/improvementStrategyQualityPolicyGovernance';
import { attributeImprovementStrategyQualityPolicyRelease } from '../lib/improvementStrategyQualityPolicyAttribution';
import {
  IMPROVEMENT_STRATEGY_QUALITY_POLICY_EFFECT_FRESHNESS_MS,
  projectImprovementStrategyQualityPolicyEffectLedger,
} from '../lib/improvementStrategyQualityPolicyEffectLedger';
import {
  createImprovementStrategyQualityPolicyRevalidationControlEvent,
  createImprovementStrategyQualityPolicyRevalidationTerminalEvent,
  projectImprovementStrategyQualityPolicyRevalidationHistory,
  projectImprovementStrategyQualityPolicyRevalidationLifecycle,
  type ImprovementStrategyQualityPolicyRevalidationLifecycle,
  type ImprovementStrategyQualityPolicyRevalidationTerminalReason,
  type ImprovementStrategyQualityPolicyRevalidationTerminalStatus,
} from '../lib/improvementStrategyQualityPolicyRevalidation';
import { projectImprovementStrategyQualityPolicyRevalidationAnalytics } from '../lib/improvementStrategyQualityPolicyRevalidationAnalytics';
import { governImprovementStrategyQualityPolicyTrend } from '../lib/improvementStrategyQualityPolicyTrendGovernance';
import { createImprovementExperimentContext } from '../lib/improvementExperimentContext';

const SimulatorRoomConsole = lazy(async () => {
  const module = await import('./SimulatorRoomConsole');
  return { default: module.SimulatorRoomConsole };
});

function isImprovementStrategyQualityPolicyRevalidationTerminalStatus(
  status: ImprovementStrategyQualityPolicyRevalidationLifecycle['status'],
): status is ImprovementStrategyQualityPolicyRevalidationTerminalStatus {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'expired' ||
    status === 'context-changed' ||
    status === 'interrupted'
  );
}
const BroadcastTopologyPanel = lazy(async () => {
  const module = await import('./BroadcastTopologyPanel');
  return { default: module.BroadcastTopologyPanel };
});
const SoulInspectorPanel = lazy(async () => {
  const module = await import('./SoulInspectorPanel');
  return { default: module.SoulInspectorPanel };
});

const workspacePanelFallback = (
  <output className="workspace-card">Loading workspace…</output>
);

const commitmentUrgencyLabels: Record<CommitmentUrgency, string> = {
  overdue: '已逾期',
  'due-soon': '即将到期',
  active: '推进中',
  unscheduled: '待排期',
  completed: '已完成',
};

const improvementExperimentStageLabels: Record<
  NextImprovementStrategySelection['stage'],
  string
> = {
  coverage: '首轮覆盖',
  comparison: '补齐对照',
  confirmation: '确认领先',
  'awaiting-outcome': '等待结果',
  decided: '结论有效',
  revalidation: '漂移复验',
  redesign: '重新设计',
};

const improvementStrategyQualityPolicyFieldLabels: Record<
  ImprovementStrategyQualityPolicyField,
  string
> = {
  warningPenalty: '警告扣分',
  maxInstructionClauses: '指令步骤上限',
  confoundedExecution: '混杂实验处理',
};

const improvementStrategyQualityPolicyRevalidationReasonLabels: Record<
  ImprovementStrategyQualityPolicyRevalidationTerminalReason,
  string
> = {
  'fresh-evidence-threshold-met': '样本门槛达成',
  'fresh-negative-evidence': '新鲜负向证据',
  'freshness-window-elapsed': '复验窗口超时',
  'experiment-context-changed': '实验上下文切换',
  'policy-release-interrupted': '其他门禁发布',
};

const improvementStrategyQualityPolicyEffectFreshnessDays =
  IMPROVEMENT_STRATEGY_QUALITY_POLICY_EFFECT_FRESHNESS_MS /
  (24 * 60 * 60 * 1_000);

function createEmptyImprovementStrategyDraft(): ImprovementStrategyDraft {
  return {
    label: '',
    variable: 'method',
    instruction: '',
    successSignal: '',
  };
}

function createEmptyCommitmentDraft(digitalHumanId: string): CommitmentDraft {
  return {
    digitalHumanId,
    title: '',
    beneficiary: '',
    progress: '待开始',
    deadline: '',
    nextAction: '',
    completionEvidence: '',
    content: '',
    visibility: 'internal',
    importance: 7,
  };
}

type Workspace =
  | 'avatars'
  | 'overview'
  | 'simulator'
  | 'memory'
  | 'insights'
  | 'pipeline'
  | 'config';

type CommitmentFilter = 'open' | 'attention' | 'snoozed' | 'completed' | 'all';

interface ControlRoomProps {
  messages: ChatMessage[];
  partialResponse: string;
  isProcessing: boolean;
  isSpeaking: boolean;
  mouthLevel: number;
  voiceLevel: number;
  queueDepth: number;
  oldestQueueAgeMs: number;
  interactionEvents: InteractionFeedItem[];
  interactionSummary: InteractionFeedSummary;
  operatorQueue: OperatorQueueItem[];
  operatorQueueHistory: OperatorQueueItem[];
  operatorQueueHistorySummary: OperatorQueueSummary;
  operatorQueueScope: OperatorQueueScope;
  liveSessionState: LiveSessionState;
  currentSessionQueueSummary: OperatorQueueSummary;
  previousSessionQueueSummary: OperatorQueueSummary;
  onStartNewLiveSession: () => Promise<void>;
  onDeleteQueueItem: (eventId: string) => void;
  onMoveQueueItem: (eventId: string, order: number) => void;
  onEditQueueReply: (eventId: string, reply: string) => void;
  settings: AppSettings;
  avatarPackage?: PuruPuruAvatarPackage | null;
  avatarReaction?: PuruPuruReaction | null;
  avatarMotion: AvatarMotion;
  speakingAvatarVideoUrl?: string | null;
  avatarViewTransform: AvatarViewTransform;
  onAvatarViewTransformChange: (transform: AvatarViewTransform) => void;
  onBroadcast: (text: string) => void;
  onStop: () => void;
  onEmergencyTakeover: () => void;
  liveHostSnapshot: LiveHostSnapshot;
  unsupportedAvatarActionCount: number;
  reliabilityMetrics: {
    bindingErrors: number;
    staleCallbacks: number;
    proactiveRepeatSuppressions: number;
    coordinatorRecoveries: number;
    paidInvitationsLastHour: number;
    freeInvitationsLastHour: number;
    associatedSupportCount: number;
    associatedSupportAmount: number;
  };
  autoBroadcastEnabled: boolean;
  onEnableAutoBroadcast: () => void;
  onDisableAutoBroadcast: () => void;
  onClaimRuntime: () => void;
  onRecoverRuntime: () => void | Promise<void>;
  operatorPreflightSession: OperatorPreflightSession;
  onRunOperatorPreflight: () => Promise<OperatorPreflightReport>;
  runtimeOwnerLease: RuntimeOwnerLeaseState;
  onUpdateEmptyRoomAwareness: (
    update: Partial<AppSettings['emptyRoomAwareness']>,
  ) => void;
  onOpenLegacySettings: () => void;
  socialBusHealth: StreamBusHealth;
  socialBusError: string;
  socialDiscoveredPlatforms: string[];
  ordinaryRoadStatus: LiveRoomStatus;
  onUpdateLiveConnectors: (
    update: (
      current: AppSettings['liveConnectors'],
    ) => AppSettings['liveConnectors'],
  ) => void;
  onSimulateLiveRoomEvent: (event: LiveRoomEvent) => void;
  onSelectDigitalHuman: (id: string) => void;
  onAddDigitalHuman: () => void;
  onUpdateDigitalHuman: (
    id: string,
    update: Partial<DigitalHumanProfile>,
  ) => void;
  onSetDigitalHumanEnabled: (id: string, enabled: boolean) => void;
  onRemoveDigitalHuman: (id: string) => void;
  onAvatarPackageUpload: (profileId: string, file: File | null) => void;
  onPreviewVoice: (voiceId: string) => Promise<void>;
  memory: StreamerMemoryApi;
  stressRun: StressRunState;
  onDiagnoseStressTest: () => void | Promise<void>;
  onStartStressTest: () => void | Promise<void>;
  onPauseStressTest: () => void | Promise<void>;
  onResumeStressTest: () => void | Promise<void>;
  onAbortStressTest: () => void | Promise<void>;
  onCleanupStressTest: () => void | Promise<void>;
  onAuditAction: (event: Record<string, unknown>) => void;
  soulInspector: SoulInspectorPanelProps;
}

type RuntimeHealth = BroadcastRuntimeHealth & {
  runtimeOwner?: {
    active: boolean;
    available: boolean;
    ttsConfigured: boolean;
  };
  runtimeLease?: RuntimeOwnerLeaseSnapshot;
  repeatedReplyCount?: number;
  queueDepth?: number;
  oldestQueueAgeMs?: number;
  alerts?: string[];
  ttsRateLimitCount?: number;
};

type LiveProgramState = {
  mode: 'companion' | 'weather' | 'urgent' | 'variety';
  locked: boolean;
  updatedAt?: number;
};

type LiveSafetyState = {
  viewers: Array<{
    viewerId: string;
    viewerName?: string;
    sourceLabel?: string;
    score: number;
    mutedUntil?: number;
  }>;
  events: Array<{
    id: string;
    at: number;
    viewerId?: string;
    viewerName?: string;
    sourceLabel?: string;
    action: 'allow' | 'boundary' | 'local_mute';
    reason: string;
  }>;
};

type PipelineLatencyRecord = {
  requestId: string;
  eventId?: string;
  input?: string;
  inputAt?: number;
  llmCompletedAt?: number;
  endedAt?: number;
  ttsRequestedAt?: number;
  ttsFirstByteAt?: number;
  flashHeadFirstFrameAt?: number;
  firstPlaybackAt?: number;
  inputToEndMs?: number;
  source?: string;
  origin?: { channel?: string; commentAt?: number; receivedAt?: number };
};
type PipelineRuntimeEvent = {
  eventId?: string;
  stage?: string;
  source?: string;
  at?: number;
};

const workspaceLabels: Record<Workspace, string> = {
  avatars: '数字人管理',
  overview: '总控',
  simulator: '模拟直播间',
  memory: '记忆',
  insights: '播送策略',
  pipeline: '链路监控',
  config: '配置',
};

function formatAge(milliseconds: number) {
  if (!milliseconds) return '—';
  return `${Math.max(1, Math.round(milliseconds / 1000))} 秒`;
}

function createEmptyRoomStrategyId() {
  return `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const interactionStageLabels = {
  received: '已接收',
  deduplicated: '已合并',
  queued: '等待回复',
  selected: '准备回应',
  generated: '已交给主播',
  speaking: '播出中',
  done: '已完成',
  dropped: '未采用',
} as const;

const dropReasonLabels: Record<string, string> = {
  duplicate_id: '重复消息',
  duplicate_text: '内容重复',
  low_information: '信息不足',
  merged: '并入同题',
  overflow_merged: '高峰合并',
  expired: '已过时',
  analysis_filtered: '未通过筛选',
  processing_error: '处理失败',
};

function formatEventTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatResolutionDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  if (milliseconds < 60_000)
    return `${Math.max(1, Math.round(milliseconds / 1000))} 秒`;
  return `${Math.max(1, Math.round(milliseconds / 60_000))} 分钟`;
}

function formatRevalidationDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  if (milliseconds >= 24 * 60 * 60_000) {
    return `${Math.round((milliseconds / (24 * 60 * 60_000)) * 10) / 10} 天`;
  }
  if (milliseconds >= 60 * 60_000) {
    return `${Math.round((milliseconds / (60 * 60_000)) * 10) / 10} 小时`;
  }
  return formatResolutionDuration(milliseconds);
}

function formatPercentage(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function sourceRoomLabel(source: string): string {
  if (source === 'simulator') return '模拟直播间 · sim-room-001';
  if (source.startsWith('simulator:')) {
    return `模拟直播间 · ${sourceRoomLabel(source.slice('simulator:'.length))}`;
  }
  if (source === 'typhoon-radar' || source === 'parent-message') {
    return '台风 Boss 雷达 · 输入';
  }
  if (source === 'external-chat-bridge') return '外部聊天桥接';
  if (source === 'bilibili') return 'Bilibili 直播间';
  if (source === 'douyin') return '抖音直播间';
  if (source === 'douyu') return '斗鱼直播间';
  if (source === 'huya') return '虎牙直播间';
  if (source === 'kuaishou') return '快手直播间';
  return source || '未知直播间';
}

function queueTone(status: OperatorQueueItem['status']) {
  if (status === 'done') return 'replied';
  if (status === 'skipped') return 'skipped';
  if (status === 'failed') return 'failed';
  if (status === 'archived') return 'archived';
  if (status === 'pending') return 'waiting';
  return 'replying';
}

function queueStatusLabel(status: OperatorQueueItem['status']) {
  if (status === 'done') return '已回复';
  if (status === 'skipped') return '未采用（重复强调）';
  if (status === 'pending') return '待回复';
  if (status === 'preparing') return '正在撰写';
  if (status === 'ready') return '等待播出';
  if (status === 'speaking') return '正在播出';
  if (status === 'archived') return '已归档';
  return '执行失败';
}

function formatViewerWait(item: OperatorQueueItem) {
  const completedAt = item.preparedAt ?? item.doneAt ?? item.updatedAt;
  const seconds = Math.max(
    0,
    Math.round((completedAt - item.createdAt) / 1000),
  );
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatLeaseRemaining(milliseconds = 0) {
  return `${Math.max(0, Math.ceil(milliseconds / 1000))} 秒`;
}

function skipReasonLabel(reason?: string) {
  if (reason === 'duplicate_text') return '与同一观众近期消息重复';
  if (reason === 'llm_no_reply') return '模型判断无需占用直播时间';
  return '该消息未被采用';
}

function describeOperatorControl(
  target: EventTarget | null,
  interaction: 'click' | 'blur',
): Record<string, unknown> | null {
  if (!(target instanceof HTMLElement)) return null;
  const control =
    interaction === 'click'
      ? target.closest<HTMLElement>(
          'button, a, input, textarea, select, [role="button"]',
        )
      : target;
  if (!control) return null;

  const field =
    control.getAttribute('name') ||
    control.getAttribute('id') ||
    control.getAttribute('data-audit-action') ||
    undefined;
  const label =
    control.getAttribute('data-audit-action') ||
    control.getAttribute('aria-label') ||
    control.getAttribute('title') ||
    control.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ||
    field ||
    control.tagName.toLowerCase();
  const isSensitive = /key|token|secret|password|cookie|credential/i.test(
    `${field ?? ''} ${label}`,
  );
  let value: unknown;
  if (control instanceof HTMLInputElement) {
    value =
      control.type === 'checkbox' || control.type === 'radio'
        ? control.checked
        : isSensitive || control.type === 'password'
          ? '[REDACTED]'
          : control.value;
  } else if (
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    value = isSensitive ? '[REDACTED]' : control.value;
  }

  return {
    interaction,
    control: control.tagName.toLowerCase(),
    field,
    label,
    value,
  };
}

export function ControlRoom(props: ControlRoomProps) {
  const {
    onClaimRuntime,
    onDisableAutoBroadcast,
    onEnableAutoBroadcast,
    onOpenLegacySettings,
    onBroadcast,
    onRunOperatorPreflight,
    onAuditAction,
    liveSessionState,
    operatorQueueScope,
    previousSessionQueueSummary,
  } = props;
  const currentSessionId = liveSessionState.current.sessionId;
  const previousSession = liveSessionState.previous;
  const [workspace, setWorkspace] = useState<Workspace>('overview');
  const [confirmNewSession, setConfirmNewSession] = useState(false);
  const [isRotatingSession, setIsRotatingSession] = useState(false);
  const [sessionRotationError, setSessionRotationError] = useState('');
  const [retrospectiveCopyState, setRetrospectiveCopyState] = useState<
    'idle' | 'copied' | 'failed'
  >('idle');
  const [nextSessionActionInFlight, setNextSessionActionInFlight] = useState<
    string | null
  >(null);
  const [nextSessionActionFeedback, setNextSessionActionFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [selectedImprovementStrategies, setSelectedImprovementStrategies] =
    useState<Record<string, ImprovementStrategy['id']>>({});
  const [customImprovementStrategyDrafts, setCustomImprovementStrategyDrafts] =
    useState<Record<string, ImprovementStrategyDraft>>({});
  const [
    editingImprovementStrategyAssetIds,
    setEditingImprovementStrategyAssetIds,
  ] = useState<Record<string, string | undefined>>({});
  const [
    copiedFromImprovementStrategyAssetIds,
    setCopiedFromImprovementStrategyAssetIds,
  ] = useState<Record<string, string | undefined>>({});
  const [openImprovementStrategyComposers, setOpenImprovementStrategyComposers] =
    useState<Record<string, boolean>>({});
  const [startupRequested, setStartupRequested] = useState(false);
  const [startupActionInFlight, setStartupActionInFlight] =
    useState<LiveStartupAction | null>(null);
  const [startupActionError, setStartupActionError] = useState('');
  const operatorPreflightReport = props.operatorPreflightSession.report;
  const isOperatorPreflightRunning =
    props.operatorPreflightSession.state === 'running';
  const [runtimeHeartbeatStable, setRuntimeHeartbeatStable] = useState(false);
  const [recoveryActionInFlight, setRecoveryActionInFlight] =
    useState<RuntimeRecoveryAction | null>(null);
  const [recoveryFeedback, setRecoveryFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [commitmentCompletingId, setCommitmentCompletingId] = useState<
    string | null
  >(null);
  const [commitmentFeedback, setCommitmentFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [commitmentDraft, setCommitmentDraft] = useState<{
    recordId?: string;
    value: CommitmentDraft;
  } | null>(null);
  const [commitmentDraftErrors, setCommitmentDraftErrors] =
    useState<CommitmentDraftErrors>({});
  const [commitmentSaving, setCommitmentSaving] = useState(false);
  const commitmentRadar = useMemo(
    () => projectCommitmentRadar(props.memory.records),
    [props.memory.records],
  );
  const [commitmentFilter, setCommitmentFilter] =
    useState<CommitmentFilter>('open');
  const [commitmentOwnerFilter, setCommitmentOwnerFilter] = useState('all');
  const visibleCommitments = useMemo(
    () =>
      commitmentRadar.items.filter((item) => {
        if (
          commitmentOwnerFilter !== 'all' &&
          item.digitalHumanId !== commitmentOwnerFilter
        ) {
          return false;
        }
        if (commitmentFilter === 'all') return true;
        if (commitmentFilter === 'open') {
          return item.urgency !== 'completed';
        }
        if (commitmentFilter === 'attention') {
          return (
            !item.isSnoozed &&
            (item.urgency === 'overdue' || item.urgency === 'due-soon')
          );
        }
        if (commitmentFilter === 'snoozed') return item.isSnoozed;
        return item.urgency === 'completed';
      }),
    [commitmentFilter, commitmentOwnerFilter, commitmentRadar.items],
  );
  const [commitmentReminderInFlight, setCommitmentReminderInFlight] = useState<
    string | null
  >(null);
  const completeCommitment = useCallback(
    async (commitmentId: string) => {
      const record = props.memory.records.find(({ id }) => id === commitmentId);
      if (!record || commitmentCompletingId) return;

      setCommitmentCompletingId(commitmentId);
      setCommitmentFeedback(null);
      try {
        await props.memory.revise(
          record.id,
          buildCommitmentCompletionUpdate(record),
          '运营者通过承诺雷达确认完成',
        );
        setCommitmentFeedback({
          tone: 'success',
          message: `“${record.title}”已标记完成，原始修订痕迹已保留。`,
        });
      } catch (error) {
        setCommitmentFeedback({
          tone: 'error',
          message:
            error instanceof Error
              ? error.message
              : '承诺状态更新失败，请稍后重试。',
        });
      } finally {
        setCommitmentCompletingId(null);
      }
    },
    [commitmentCompletingId, props.memory],
  );
  const updateCommitmentReminder = useCallback(
    async (commitmentId: string, action: 'tomorrow' | 'resume') => {
      const record = props.memory.records.find(({ id }) => id === commitmentId);
      if (!record || commitmentReminderInFlight) return;
      const plan = planCommitmentReminder(record, action);
      if (!plan.ok) {
        setCommitmentFeedback({ tone: 'error', message: plan.reason });
        return;
      }

      setCommitmentReminderInFlight(commitmentId);
      setCommitmentFeedback(null);
      try {
        await props.memory.revise(
          record.id,
          plan.update,
          action === 'tomorrow'
            ? '运营者将承诺提醒暂缓到明天'
            : '运营者恢复承诺提醒',
        );
        setCommitmentFeedback({
          tone: 'success',
          message:
            action === 'tomorrow'
              ? `“${record.title}”将在明天 09:00 恢复提醒。`
              : `“${record.title}”已恢复为需要关注。`,
        });
      } catch (error) {
        setCommitmentFeedback({
          tone: 'error',
          message:
            error instanceof Error
              ? error.message
              : '提醒状态更新失败，请稍后重试。',
        });
      } finally {
        setCommitmentReminderInFlight(null);
      }
    },
    [commitmentReminderInFlight, props.memory],
  );
  const saveCommitmentDraft = useCallback(async () => {
    if (!commitmentDraft || commitmentSaving) return;
    const current = commitmentDraft.recordId
      ? props.memory.records.find(({ id }) => id === commitmentDraft.recordId)
      : undefined;
    const plan = planCommitmentMutation(commitmentDraft.value, current);
    if (!plan.ok) {
      setCommitmentDraftErrors(plan.errors);
      return;
    }

    setCommitmentSaving(true);
    setCommitmentFeedback(null);
    try {
      if (plan.mutation.kind === 'create') {
        await props.memory.add(plan.mutation.input);
      } else {
        await props.memory.revise(
          plan.mutation.id,
          plan.mutation.update,
          '运营者通过承诺雷达保存结构化承诺',
        );
      }
      setCommitmentDraft(null);
      setCommitmentDraftErrors({});
      setCommitmentFeedback({
        tone: 'success',
        message:
          plan.mutation.kind === 'create'
            ? '新承诺已写入记忆，并自动进入雷达。'
            : '承诺修改已保存，修订历史仍然保留。',
      });
    } catch (error) {
      setCommitmentFeedback({
        tone: 'error',
        message:
          error instanceof Error ? error.message : '承诺保存失败，请稍后重试。',
      });
    } finally {
      setCommitmentSaving(false);
    }
  }, [commitmentDraft, commitmentSaving, props.memory]);
  const enqueueCommitmentBroadcast = useCallback(
    (commitmentId: string) => {
      const record = props.memory.records.find(({ id }) => id === commitmentId);
      if (!record) return;
      const plan = planCommitmentBroadcast(record);
      if (!plan.ok) {
        setCommitmentFeedback({ tone: 'error', message: plan.reason });
        return;
      }

      onBroadcast(plan.text);
      setCommitmentFeedback({
        tone: 'success',
        message: `“${record.title}”已提交到当前直播的播报队列。`,
      });
    },
    [onBroadcast, props.memory.records],
  );
  const updateCommitmentDraft = useCallback(
    (update: Partial<CommitmentDraft>) => {
      setCommitmentDraft((current) =>
        current
          ? { ...current, value: { ...current.value, ...update } }
          : current,
      );
      setCommitmentDraftErrors((current) => {
        const next = { ...current };
        for (const key of Object.keys(update)) {
          delete next[key as keyof CommitmentDraftErrors];
        }
        return next;
      });
    },
    [],
  );
  const soulOwnsQuietRoomBehavior =
    props.soulInspector.runtimeMode === 'canary' ||
    props.soulInspector.runtimeMode === 'primary';
  const [radarInput, setRadarInput] = useState('');
  const [minimaxVoices, setMinimaxVoices] = useState<MinimaxVoiceOption[]>([]);
  const [voiceLoadError, setVoiceLoadError] = useState('');
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(
    null,
  );
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth>({});
  const [runtimeHealthState, setRuntimeHealthState] = useState<
    'checking' | 'available' | 'unavailable'
  >('checking');
  const [pipelineLatencyRecords, setPipelineLatencyRecords] = useState<
    PipelineLatencyRecord[]
  >([]);
  const [pipelineRuntimeEvents, setPipelineRuntimeEvents] = useState<
    PipelineRuntimeEvent[]
  >([]);
  const [operatorAttentionRuntimeEvents, setOperatorAttentionRuntimeEvents] =
    useState<OperatorAttentionRuntimeEvent[]>([]);
  const [operatorAttentionHistoryLoaded, setOperatorAttentionHistoryLoaded] =
    useState(false);
  const attentionTransitionGuardRef = useRef(new Map<string, string>());
  const [liveSessionRetrospectiveEvents, setLiveSessionRetrospectiveEvents] =
    useState<LiveSessionRetrospectiveRuntimeEvent[]>([]);
  const [
    liveSessionRetrospectiveHistoryLoaded,
    setLiveSessionRetrospectiveHistoryLoaded,
  ] = useState(false);
  const retrospectiveEventGuardRef = useRef(new Set<string>());
  const [
    nextSessionImprovementActionEvents,
    setNextSessionImprovementActionEvents,
  ] = useState<NextSessionImprovementActionRuntimeEvent[]>([]);
  const improvementStrategyQualityPolicyRevalidationTerminalGuardRef =
    useRef(new Set<string>());
  const [
    nextSessionImprovementHistoryState,
    setNextSessionImprovementHistoryState,
  ] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [liveProgram, setLiveProgram] = useState<LiveProgramState>({
    mode: 'companion',
    locked: false,
  });
  const [liveSafety, setLiveSafety] = useState<LiveSafetyState>({
    viewers: [],
    events: [],
  });
  const sourceRooms = useMemo(() => {
    const connectors = props.settings.liveConnectors;
    const ordinaryRoad = Object.entries(connectors.ordinaryRoad.platforms)
      .filter(([, item]) => item.enabled && item.roomId.trim())
      .map(([platformId, item]) => ({
        id: `ordinaryroad:${platformId}:${item.roomId}`,
        label: `${sourceRoomLabel(platformId)} · ${item.roomId}`,
        tone: 'connected',
      }));
    const social = Object.entries(connectors.socialStreamNinja.platforms)
      .filter(([, item]) => item.enabled)
      .map(([platformId, item]) => ({
        id: `social:${platformId}:${item.roomId}`,
        label: `${sourceRoomLabel(platformId)}${item.roomId.trim() ? ` · ${item.roomId}` : ''}`,
        tone: 'external',
      }));
    return [
      ...ordinaryRoad,
      ...social,
      {
        id: 'simulator',
        label: sourceRoomLabel('simulator'),
        tone: 'simulator',
      },
      {
        id: 'typhoon-radar',
        label: sourceRoomLabel('typhoon-radar'),
        tone: 'radar',
      },
    ];
  }, [props.settings.liveConnectors]);
  const formatSourceRoom = (source: string) =>
    sourceRooms.find(
      (room) =>
        room.id.startsWith(`ordinaryroad:${source}:`) ||
        room.id.startsWith(`social:${source}:`),
    )?.label ?? sourceRoomLabel(source);

  const submitRadarInput = () => {
    const text = radarInput.trim();
    if (!text) return;
    props.onSimulateLiveRoomEvent({
      id: `typhoon-radar:${crypto.randomUUID()}`,
      type: 'comment',
      text,
      timestamp: Date.now(),
      author: { id: 'radar-viewer-001', name: '001号人类' },
      metadata: {
        connectorId: 'typhoon-boss-radar',
        platformId: 'typhoon-radar',
        sourcePlatform: 'typhoon-radar',
        roomId: 'typhoon-boss-radar',
        sourceLabel: '台风 Boss 雷达 · 输入',
      },
    });
    setRadarInput('');
  };
  const refreshRuntimeHealth = useCallback(async () => {
    try {
      const path = appendOperatorQueueQuery('/api/live-runtime-health', {
        scope: props.operatorQueueScope,
      });
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok)
        throw new Error(`health check failed: ${response.status}`);
      setRuntimeHealth((await response.json()) as RuntimeHealth);
      setRuntimeHealthState('available');
    } catch {
      setRuntimeHealthState('unavailable');
    }
  }, [props.operatorQueueScope]);
  useEffect(() => {
    void refreshRuntimeHealth();
    const timer = window.setInterval(() => {
      void refreshRuntimeHealth();
    }, 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshRuntimeHealth]);
  useEffect(() => {
    let cancelled = false;
    const refresh = createSingleFlightRunner(async () => {
      const response = await fetch('/api/live-runtime-events?history=1&limit=80', {
        cache: 'no-store',
      });
      const payload = response.ok
        ? ((await response.json()) as {
            events?: PipelineRuntimeEvent[];
          })
        : null;
      if (!cancelled && Array.isArray(payload?.events)) {
        setPipelineRuntimeEvents(payload.events);
      }
    });
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void fetch(
        '/api/live-runtime-events?history=1&limit=100&stagePrefix=operator_session_retrospective',
        { cache: 'no-store' },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            payload: {
              events?: LiveSessionRetrospectiveRuntimeEvent[];
            } | null,
          ) => {
            if (cancelled || !Array.isArray(payload?.events)) return;
            setLiveSessionRetrospectiveEvents((current) =>
              mergeLiveSessionRetrospectiveEvents({
                remote:
                  payload.events as LiveSessionRetrospectiveRuntimeEvent[],
                local: current,
              }),
            );
            setLiveSessionRetrospectiveHistoryLoaded(true);
          },
        )
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void fetch(
        '/api/live-runtime-events?history=1&limit=200&stagePrefix=operator_next_session_improvement_',
        { cache: 'no-store' },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            payload: {
              events?: NextSessionImprovementActionRuntimeEvent[];
            } | null,
          ) => {
            if (cancelled) return;
            if (!Array.isArray(payload?.events)) {
              setNextSessionImprovementHistoryState('unavailable');
              return;
            }
            setNextSessionImprovementActionEvents((current) =>
              mergeNextSessionImprovementActionEvents({
                remote:
                  payload.events as NextSessionImprovementActionRuntimeEvent[],
                local: current,
              }),
            );
            setNextSessionImprovementHistoryState('ready');
          },
        )
        .catch(() => {
          if (!cancelled)
            setNextSessionImprovementHistoryState('unavailable');
        });
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void fetch(
        '/api/live-runtime-events?history=1&limit=400&stagePrefix=operator_attention_',
        { cache: 'no-store' },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (payload: { events?: OperatorAttentionRuntimeEvent[] } | null) => {
            if (cancelled || !Array.isArray(payload?.events)) return;
            setOperatorAttentionRuntimeEvents((current) =>
              mergeOperatorAttentionRuntimeEvents({
                remote: payload.events as OperatorAttentionRuntimeEvent[],
                local: current,
              }),
            );
            setOperatorAttentionHistoryLoaded(true);
          },
        )
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void fetch('/api/reply-latency?limit=24', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { records?: PipelineLatencyRecord[] } | null) => {
          if (!cancelled && Array.isArray(payload?.records)) {
            setPipelineLatencyRecords(payload.records);
          }
        })
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void fetch('/api/live-program', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((state: LiveProgramState | null) => {
          if (!cancelled && state) setLiveProgram(state);
        })
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const updateLiveProgram = (update: Partial<LiveProgramState>) => {
    void fetch('/api/live-program', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((state: LiveProgramState | null) => {
        if (state) setLiveProgram(state);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void fetch('/api/live-safety', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((state: LiveSafetyState | null) => {
          if (!cancelled && state) setLiveSafety(state);
        })
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const releaseViewerSafety = (viewerId: string) => {
    void fetch('/api/live-safety', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release', viewerId }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((state: LiveSafetyState | null) => {
        if (state) setLiveSafety(state);
      })
      .catch(() => undefined);
  };
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [draggingQueueId, setDraggingQueueId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<
    'active' | 'replied' | 'skipped' | 'failed' | 'archived'
  >('active');
  const visibleQueue = useMemo(() => {
    const source =
      queueFilter === 'active'
        ? props.operatorQueue
        : props.operatorQueueHistory;
    const matching = source.filter((item) => {
      if (queueFilter === 'replied') return item.status === 'done';
      if (queueFilter === 'skipped') return item.status === 'skipped';
      if (queueFilter === 'failed') return item.status === 'failed';
      if (queueFilter === 'archived') return item.status === 'archived';
      return ['pending', 'preparing', 'ready', 'speaking'].includes(
        item.status,
      );
    });

    // Completed history is a timeline: the latest actual response belongs on top.
    if (queueFilter === 'replied') {
      return matching.sort(
        (left, right) =>
          (right.doneAt ?? right.updatedAt) - (left.doneAt ?? left.updatedAt),
      );
    }
    return matching;
  }, [props.operatorQueue, props.operatorQueueHistory, queueFilter]);
  const selectedQueueItem =
    visibleQueue.find((item) => item.eventId === selectedQueueId) ??
    visibleQueue[0];
  const selectedReplyIsHistory = queueFilter !== 'active';
  const selectedQueueIsSkipped = selectedQueueItem?.status === 'skipped';

  useEffect(() => {
    if (!visibleQueue.some((item) => item.eventId === selectedQueueId)) {
      setSelectedQueueId(visibleQueue[0]?.eventId ?? null);
    }
  }, [selectedQueueId, visibleQueue]);

  useEffect(() => {
    if (!selectedQueueItem) {
      setReplyDraft('');
      return;
    }
    setReplyDraft(selectedQueueItem.preparedReply ?? '');
  }, [selectedQueueItem]);
  const recentMessages = useMemo(
    () => props.messages.slice(-8).reverse(),
    [props.messages],
  );
  const stage = props.isSpeaking
    ? '播出中'
    : props.isProcessing
      ? '生成中'
      : props.queueDepth
        ? '等待处理'
        : '待命';
  const activeDigitalHuman =
    props.settings.digitalHumans.profiles.find(
      (profile) => profile.id === props.settings.digitalHumans.activeId,
    ) || props.settings.digitalHumans.profiles[0];
  const outputTargetConfigured = useMemo(() => {
    if (props.settings.stream.platform !== 'none') return true;
    const connectors = props.settings.liveConnectors;
    const hasEnabledRoom = (
      platforms: AppSettings['liveConnectors']['ordinaryRoad']['platforms'],
    ) =>
      Object.values(platforms).some(
        (platform) => platform.enabled && Boolean(platform.roomId.trim()),
      );
    return (
      (connectors.ordinaryRoad.enabled &&
        hasEnabledRoom(connectors.ordinaryRoad.platforms)) ||
      (connectors.socialStreamNinja.enabled &&
        hasEnabledRoom(connectors.socialStreamNinja.platforms))
    );
  }, [props.settings.liveConnectors, props.settings.stream.platform]);
  const liveReadiness = useMemo(
    () =>
      assessLiveReadiness({
        healthState: runtimeHealthState,
        health: runtimeHealth,
        outputTargetConfigured,
        queueDepth: props.queueDepth,
        oldestQueueAgeMs: props.oldestQueueAgeMs,
      }),
    [
      outputTargetConfigured,
      props.oldestQueueAgeMs,
      props.queueDepth,
      runtimeHealth,
      runtimeHealthState,
    ],
  );
  const runtimeRecovery = useMemo(
    () =>
      projectRuntimeRecovery({
        healthState: runtimeHealthState,
        health: runtimeHealth,
        connector: {
          ordinaryRoadState: props.ordinaryRoadStatus.state,
          ordinaryRoadError: props.ordinaryRoadStatus.error,
          socialError: props.socialBusError,
        },
        localRuntimeOwner: props.runtimeOwnerLease.status === 'owned',
      }),
    [
      props.ordinaryRoadStatus.error,
      props.ordinaryRoadStatus.state,
      props.runtimeOwnerLease.status,
      props.socialBusError,
      runtimeHealth,
      runtimeHealthState,
    ],
  );
  const operatorAttention = useMemo(
    () =>
      projectOperatorAttention({
        readiness: liveReadiness,
        recovery: runtimeRecovery,
        preflight: props.operatorPreflightSession,
        commitments: commitmentRadar.summary,
      }),
    [
      commitmentRadar.summary,
      liveReadiness,
      props.operatorPreflightSession,
      runtimeRecovery,
    ],
  );
  const currentAttentionLedger = useMemo(
    () =>
      projectOperatorAttentionLedger({
        events: operatorAttentionRuntimeEvents,
        sessionId: currentSessionId,
        currentItems:
          operatorAttention.status === 'checking'
            ? undefined
            : operatorAttention.items,
      }),
    [
      operatorAttention.items,
      operatorAttention.status,
      operatorAttentionRuntimeEvents,
      currentSessionId,
    ],
  );
  const previousAttentionLedger = useMemo(
    () =>
      previousSession
        ? projectOperatorAttentionLedger({
            events: operatorAttentionRuntimeEvents,
            sessionId: previousSession.sessionId,
          })
        : null,
    [operatorAttentionRuntimeEvents, previousSession],
  );
  const previousSessionRetrospective = useMemo(
    () =>
      previousSession && previousAttentionLedger
        ? projectLiveSessionRetrospective({
            session: previousSession,
            queue: previousSessionQueueSummary,
            attention: previousAttentionLedger,
            scope: {
              platform: operatorQueueScope.platform,
              roomId: operatorQueueScope.roomId,
            },
          })
        : null,
    [
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
      previousAttentionLedger,
      previousSession,
      previousSessionQueueSummary,
    ],
  );
  const liveSessionTrend = useMemo(
    () =>
      projectLiveSessionTrend(liveSessionRetrospectiveEvents, {
        personaId: operatorQueueScope.personaId,
        platform: operatorQueueScope.platform,
        roomId: operatorQueueScope.roomId,
        recordLimit: 40,
      }),
    [
      liveSessionRetrospectiveEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementExperimentContext = useMemo(
    () =>
      createImprovementExperimentContext({
        settings: props.settings,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        autoBroadcastEnabled: props.autoBroadcastEnabled,
      }),
    [
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
      props.autoBroadcastEnabled,
      props.settings,
    ],
  );
  useEffect(() => {
    setSelectedImprovementStrategies({});
  }, [improvementExperimentContext.id]);
  const nextSessionImprovementPlan = useMemo(
    () =>
      planNextSessionImprovement({
        retrospective: previousSessionRetrospective,
        trend: liveSessionTrend,
      }),
    [liveSessionTrend, previousSessionRetrospective],
  );
  const nextSessionImprovementEffectiveness = useMemo(
    () =>
      projectNextSessionImprovementEffectiveness({
        actions: nextSessionImprovementActionEvents,
        sessions: liveSessionTrend.records,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        context: improvementExperimentContext,
      }),
    [
      improvementExperimentContext,
      liveSessionTrend.records,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const adaptiveNextSessionImprovementPlan = useMemo(
    () =>
      adaptNextSessionImprovementPlan({
        plan: nextSessionImprovementPlan,
        effectiveness: nextSessionImprovementEffectiveness,
      }),
    [nextSessionImprovementEffectiveness, nextSessionImprovementPlan],
  );
  const improvementStrategyAssets = useMemo(
    () =>
      projectImprovementStrategyAssets({
        events: nextSessionImprovementActionEvents,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
      }),
    [
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyCatalog = useMemo(
    () =>
      listImprovementStrategies({
        actions: nextSessionImprovementActionEvents,
        additions: improvementStrategyAssets.activeStrategies,
        excludedStrategyIds: improvementStrategyAssets.unavailableStrategyIds,
      }),
    [improvementStrategyAssets, nextSessionImprovementActionEvents],
  );
  const improvementStrategyProjection = useMemo(
    () =>
      projectImprovementStrategyExperiments({
        actions: nextSessionImprovementActionEvents,
        sessions: liveSessionTrend.records,
        strategyCatalog: improvementStrategyCatalog,
        excludedStrategyIds: improvementStrategyAssets.unavailableStrategyIds,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        context: improvementExperimentContext,
      }),
    [
      improvementExperimentContext,
      improvementStrategyAssets.unavailableStrategyIds,
      improvementStrategyCatalog,
      liveSessionTrend.records,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyQualityPolicyHistory = useMemo(
    () =>
      projectImprovementStrategyQualityPolicyHistory({
        events: nextSessionImprovementActionEvents,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
      }),
    [
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyQualityPolicy =
    improvementStrategyQualityPolicyHistory[0];
  const improvementStrategyQualityCalibration = useMemo(
    () =>
      calibrateImprovementStrategyQuality({
        events: nextSessionImprovementActionEvents,
        records: improvementStrategyProjection.records,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        gateVersion: improvementStrategyQualityPolicy.version,
      }),
    [
      improvementStrategyProjection.records,
      improvementStrategyQualityPolicy.version,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyQualityRollbackTarget =
    improvementStrategyQualityPolicyHistory[1];
  const improvementStrategyQualityPolicyObservation = useMemo(
    () =>
      improvementStrategyQualityRollbackTarget
        ? observeImprovementStrategyQualityPolicyRelease({
            events: nextSessionImprovementActionEvents,
            records: improvementStrategyProjection.records,
            scope: {
              personaId: operatorQueueScope.personaId,
              platform: operatorQueueScope.platform,
              roomId: operatorQueueScope.roomId,
            },
            currentVersion: improvementStrategyQualityPolicy.version,
            baselineVersion:
              improvementStrategyQualityRollbackTarget.version,
          })
        : null,
    [
      improvementStrategyProjection.records,
      improvementStrategyQualityPolicy.version,
      improvementStrategyQualityRollbackTarget,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyQualityPolicyAttribution = useMemo(
    () =>
      improvementStrategyQualityPolicyObservation &&
      improvementStrategyQualityRollbackTarget
        ? attributeImprovementStrategyQualityPolicyRelease({
            baseline: improvementStrategyQualityRollbackTarget,
            current: improvementStrategyQualityPolicy,
            observation: improvementStrategyQualityPolicyObservation,
          })
        : null,
    [
      improvementStrategyQualityPolicy,
      improvementStrategyQualityPolicyObservation,
      improvementStrategyQualityRollbackTarget,
    ],
  );
  const improvementStrategyQualityPolicyEffectLedger = useMemo(
    () =>
      projectImprovementStrategyQualityPolicyEffectLedger({
        policies: improvementStrategyQualityPolicyHistory,
        events: nextSessionImprovementActionEvents,
        records: improvementStrategyProjection.records,
        context: improvementExperimentContext,
        now: Date.now(),
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
      }),
    [
      improvementExperimentContext,
      improvementStrategyProjection.records,
      improvementStrategyQualityPolicyHistory,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyQualityPolicyRevalidation = useMemo(
    () =>
      projectImprovementStrategyQualityPolicyRevalidationLifecycle({
        events: nextSessionImprovementActionEvents,
        ledger: improvementStrategyQualityPolicyEffectLedger,
        context: improvementExperimentContext,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        now: Date.now(),
      }),
    [
      improvementExperimentContext,
      improvementStrategyQualityPolicyEffectLedger,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  useEffect(() => {
    const lifecycle = improvementStrategyQualityPolicyRevalidation;
    if (
      nextSessionImprovementHistoryState !== 'ready' ||
      !isImprovementStrategyQualityPolicyRevalidationTerminalStatus(
        lifecycle.status,
      ) ||
      !lifecycle.target ||
      !lifecycle.runId
    ) {
      return;
    }
    const event =
      createImprovementStrategyQualityPolicyRevalidationTerminalEvent({
        lifecycle: {
          ...lifecycle,
          status: lifecycle.status,
          target: lifecycle.target,
          runId: lifecycle.runId,
        },
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        context: improvementExperimentContext,
      });
    const eventId = event.eventId ?? '';
    if (
      nextSessionImprovementActionEvents.some(
        (candidate) => candidate.eventId === eventId,
      ) ||
      improvementStrategyQualityPolicyRevalidationTerminalGuardRef.current.has(
        eventId,
      )
    ) {
      return;
    }
    improvementStrategyQualityPolicyRevalidationTerminalGuardRef.current.add(
      eventId,
    );
    setNextSessionImprovementActionEvents((events) =>
      events.some((candidate) => candidate.eventId === eventId)
        ? events
        : [...events, event],
    );
    onAuditAction(event);
  }, [
    improvementExperimentContext,
    improvementStrategyQualityPolicyRevalidation,
    nextSessionImprovementActionEvents,
    nextSessionImprovementHistoryState,
    onAuditAction,
    operatorQueueScope.personaId,
    operatorQueueScope.platform,
    operatorQueueScope.roomId,
  ]);
  const improvementStrategyQualityPolicyRevalidationHistory = useMemo(
    () =>
      projectImprovementStrategyQualityPolicyRevalidationHistory({
        events: nextSessionImprovementActionEvents,
        current: improvementStrategyQualityPolicyRevalidation,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
      }),
    [
      improvementStrategyQualityPolicyRevalidation,
      nextSessionImprovementActionEvents,
      operatorQueueScope.personaId,
      operatorQueueScope.platform,
      operatorQueueScope.roomId,
    ],
  );
  const improvementStrategyQualityPolicyRevalidationAnalytics = useMemo(
    () =>
      projectImprovementStrategyQualityPolicyRevalidationAnalytics({
        runs: improvementStrategyQualityPolicyRevalidationHistory.runs,
      }),
    [improvementStrategyQualityPolicyRevalidationHistory.runs],
  );
  const improvementStrategyQualityPolicyTrendGovernance = useMemo(
    () =>
      governImprovementStrategyQualityPolicyTrend({
        trend:
          improvementStrategyQualityPolicyRevalidationAnalytics.trend,
      }),
    [improvementStrategyQualityPolicyRevalidationAnalytics.trend],
  );
  const improvementStrategyQualityPolicyGovernance = useMemo(
    () =>
      governImprovementStrategyQualityPolicyChange({
        current: improvementStrategyQualityPolicy,
        history: improvementStrategyQualityPolicyHistory,
        calibration: improvementStrategyQualityCalibration,
        observation: improvementStrategyQualityPolicyObservation,
        changeEffects:
          improvementStrategyQualityPolicyEffectLedger.directionEffects,
        revalidationTarget:
          improvementStrategyQualityPolicyRevalidation.status === 'active'
            ? improvementStrategyQualityPolicyRevalidation.target ??
              undefined
            : undefined,
        revalidationRunId:
          improvementStrategyQualityPolicyRevalidation.status === 'active'
            ? improvementStrategyQualityPolicyRevalidation.runId ??
              undefined
            : undefined,
        trendGovernance:
          improvementStrategyQualityPolicyTrendGovernance,
      }),
    [
      improvementStrategyQualityCalibration,
      improvementStrategyQualityPolicy,
      improvementStrategyQualityPolicyHistory,
      improvementStrategyQualityPolicyObservation,
      improvementStrategyQualityPolicyEffectLedger.directionEffects,
      improvementStrategyQualityPolicyRevalidation,
      improvementStrategyQualityPolicyTrendGovernance,
    ],
  );
  const improvementStrategyQualityPolicyProposal =
    improvementStrategyQualityPolicyGovernance.proposal;
  const improvementStrategyQualityGovernanceRestoreTarget =
    improvementStrategyQualityPolicyGovernance.restoreTarget;
  const improvementStrategyQualityPolicyImpact = useMemo(() => {
    if (!improvementStrategyQualityPolicyProposal) return null;
    const selectionByImprovement = Object.fromEntries(
      [
        ...new Set(
          improvementStrategyAssets.activeStrategies
            .map(({ improvementId }) => improvementId)
            .filter((id): id is string => Boolean(id)),
        ),
      ].map((improvementId) => [
        improvementId,
        selectNextImprovementStrategy(
          improvementStrategyProjection,
          improvementId,
        ),
      ]),
    );
    return evaluateImprovementStrategyQualityPolicyImpact({
      currentPolicy: improvementStrategyQualityPolicy,
      candidatePolicy: improvementStrategyQualityPolicyProposal.policy,
      assets: improvementStrategyAssets.assets,
      strategies: improvementStrategyCatalog,
      actions: nextSessionImprovementActionEvents,
      baseSessionId: previousSession?.sessionId,
      historyReady:
        nextSessionImprovementHistoryState === 'ready' &&
        liveSessionRetrospectiveHistoryLoaded,
      selectionByImprovement,
    });
  }, [
    improvementStrategyAssets,
    improvementStrategyCatalog,
    improvementStrategyProjection,
    improvementStrategyQualityPolicy,
    improvementStrategyQualityPolicyProposal,
    liveSessionRetrospectiveHistoryLoaded,
    nextSessionImprovementActionEvents,
    nextSessionImprovementHistoryState,
    previousSession?.sessionId,
  ]);
  const improvementExperimentHistoryReady =
    nextSessionImprovementHistoryState === 'ready' &&
    liveSessionRetrospectiveHistoryLoaded;
  useEffect(() => {
    if (
      !previousSession ||
      !previousSessionRetrospective ||
      !operatorAttentionHistoryLoaded ||
      !liveSessionRetrospectiveHistoryLoaded
    ) {
      return;
    }
    const revision = retrospectiveRevision(previousSessionRetrospective);
    const guardKey = `${previousSession.sessionId}:${revision}`;
    const alreadyPersisted = liveSessionRetrospectiveEvents.some(
      (event) =>
        event.sessionId === previousSession.sessionId &&
        event.retrospectiveRevision === revision,
    );
    if (alreadyPersisted || retrospectiveEventGuardRef.current.has(guardKey)) {
      return;
    }
    retrospectiveEventGuardRef.current.add(guardKey);
    const event = createLiveSessionRetrospectiveEvent({
      report: previousSessionRetrospective,
      session: previousSession,
      scope: {
        personaId: operatorQueueScope.personaId,
        platform: operatorQueueScope.platform,
        roomId: operatorQueueScope.roomId,
      },
      experimentContext: improvementExperimentContext,
    });
    setLiveSessionRetrospectiveEvents((events) => [...events, event]);
    onAuditAction(event);
  }, [
    liveSessionRetrospectiveEvents,
    liveSessionRetrospectiveHistoryLoaded,
    improvementExperimentContext,
    onAuditAction,
    operatorAttentionHistoryLoaded,
    operatorQueueScope.personaId,
    operatorQueueScope.platform,
    operatorQueueScope.roomId,
    previousSession,
    previousSessionRetrospective,
  ]);
  const copyPreviousSessionRetrospective = useCallback(async () => {
    if (!previousSessionRetrospective) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(
        previousSessionRetrospective.markdown,
      );
      setRetrospectiveCopyState('copied');
      window.setTimeout(() => setRetrospectiveCopyState('idle'), 2_000);
    } catch {
      setRetrospectiveCopyState('failed');
    }
  }, [previousSessionRetrospective]);
  useEffect(() => {
    if (!operatorAttentionHistoryLoaded) return;
    for (const transition of currentAttentionLedger.transitions) {
      const guardKey = `${transition.sessionId}:${transition.attentionId}`;
      if (
        attentionTransitionGuardRef.current.get(guardKey) === transition.stage
      ) {
        continue;
      }
      attentionTransitionGuardRef.current.set(guardKey, transition.stage ?? '');
      setOperatorAttentionRuntimeEvents((events) => [...events, transition]);
      onAuditAction(transition);
    }
  }, [
    currentAttentionLedger.transitions,
    operatorAttentionHistoryLoaded,
    onAuditAction,
  ]);
  const runtimeOwnerReady =
    runtimeHealthState === 'available' &&
    runtimeHealth.runtimeOwner?.active === true &&
    runtimeHealth.runtimeOwner.available === true;
  useEffect(() => {
    if (!runtimeOwnerReady) {
      setRuntimeHeartbeatStable(false);
      return;
    }
    const timer = window.setTimeout(
      () => setRuntimeHeartbeatStable(true),
      4_000,
    );
    return () => window.clearTimeout(timer);
  }, [runtimeOwnerReady]);
  useEffect(() => {
    if (
      props.autoBroadcastEnabled &&
      ((runtimeHealthState !== 'checking' &&
        shouldPauseAutomationForReadiness(liveReadiness)) ||
        operatorPreflightRequiresPause(props.operatorPreflightSession))
    ) {
      onDisableAutoBroadcast();
    }
  }, [
    liveReadiness,
    onDisableAutoBroadcast,
    props.autoBroadcastEnabled,
    props.operatorPreflightSession,
    runtimeHealthState,
  ]);
  const platformLive =
    runtimeHealth.supervisor?.isLive === true ||
    props.ordinaryRoadStatus.isLive === true;
  const liveStartupPlan = useMemo(
    () =>
      planLiveStartup({
        readiness: liveReadiness,
        autoBroadcastEnabled: props.autoBroadcastEnabled,
        runtimeStable: runtimeHeartbeatStable,
        platformLive,
        configurationPreflightStatus: operatorPreflightReport?.status,
        configurationPreflightRunning: isOperatorPreflightRunning,
      }),
    [
      liveReadiness,
      platformLive,
      props.autoBroadcastEnabled,
      isOperatorPreflightRunning,
      operatorPreflightReport?.status,
      runtimeHeartbeatStable,
    ],
  );
  const liveOperation = projectLiveOperation({
    autoBroadcastEnabled: props.autoBroadcastEnabled,
    platformLive,
  });
  const authoritativeLease = runtimeHealth.runtimeLease;
  const leaseOwner = authoritativeLease?.active
    ? authoritativeLease.owner
    : undefined;
  const runtimeLeaseDiagnostic =
    props.runtimeOwnerLease.status === 'owned'
      ? {
          tone: 'owned',
          title: '当前页面持有播出执行权',
          detail: leaseOwner
            ? `续租正常 · 剩余 ${formatLeaseRemaining(leaseOwner.remainingMs)} · 标识 ${leaseOwner.fingerprint}`
            : '租约已获得，正在等待健康状态同步。',
        }
      : props.runtimeOwnerLease.status === 'contended' && leaseOwner
        ? {
            tone: 'contended',
            title: `${leaseOwner.label} 正在执行`,
            detail: `标识 ${leaseOwner.fingerprint} · 剩余 ${formatLeaseRemaining(leaseOwner.remainingMs)} · 到期后当前页面会自动重试`,
          }
        : props.runtimeOwnerLease.status === 'claiming'
          ? {
              tone: 'claiming',
              title: '正在申请播出执行权',
              detail: '服务器正在确认当前唯一执行端。',
            }
          : props.runtimeOwnerLease.status === 'unavailable'
            ? {
                tone: 'unavailable',
                title: '租约服务暂不可用',
                detail: '当前页面不会消费队列；恢复连接后会自动重试。',
              }
            : leaseOwner
              ? {
                  tone: 'observing',
                  title: `${leaseOwner.label} 正在执行`,
                  detail: `标识 ${leaseOwner.fingerprint} · 剩余 ${formatLeaseRemaining(leaseOwner.remainingMs)}`,
                }
              : {
                  tone: 'idle',
                  title: '当前页面尚未接管',
                  detail: '点击一键开播后，当前页面会申请唯一播出执行权。',
                };
  const runReadinessAction = useCallback(
    (action: LiveStartupAction) => {
      if (action === 'enable-automation') {
        onEnableAutoBroadcast();
        return;
      }
      if (action === 'run-preflight') {
        setStartupActionError('');
        void onRunOperatorPreflight().catch((error) => {
          setStartupActionError(
            error instanceof Error ? error.message : '开播前诊断失败，请重试。',
          );
          setStartupRequested(false);
          setStartupActionInFlight(null);
        });
        return;
      }
      if (action === 'claim-runtime') {
        onClaimRuntime();
        return;
      }
      if (action === 'open-settings') {
        onOpenLegacySettings();
        return;
      }
      if (action === 'open-connectors') {
        setWorkspace('config');
        return;
      }
      if (action === 'review-queue') {
        setWorkspace('overview');
        window.requestAnimationFrame(() =>
          document
            .getElementById('operator-queue')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        );
        return;
      }
      if (action === 'open-pipeline') {
        setWorkspace('pipeline');
        return;
      }
      void refreshRuntimeHealth();
    },
    [
      onClaimRuntime,
      onEnableAutoBroadcast,
      onOpenLegacySettings,
      onRunOperatorPreflight,
      refreshRuntimeHealth,
    ],
  );
  const runRecoveryAction = useCallback(
    async (action: RuntimeRecoveryAction) => {
      setRecoveryActionInFlight(action);
      setRecoveryFeedback(null);
      const unavailableSoulRecovery = () => {
        throw new Error('当前 Soul 快照恢复入口不可用');
      };
      const ports: RuntimeRecoveryPorts = {
        'restart-runtime': props.onRecoverRuntime,
        'recover-soul':
          props.soulInspector.onRecoverSnapshot ?? unavailableSoulRecovery,
        'open-settings': onOpenLegacySettings,
        'open-connectors': () => setWorkspace('config'),
        'review-queue': () => {
          setWorkspace('overview');
          window.requestAnimationFrame(() =>
            document
              .getElementById('operator-queue')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          );
        },
        'open-pipeline': () => setWorkspace('pipeline'),
        'retry-health': refreshRuntimeHealth,
      };
      try {
        await executeRuntimeRecovery(action, ports);
        if (action === 'restart-runtime' || action === 'recover-soul') {
          window.setTimeout(() => void refreshRuntimeHealth(), 800);
        }
        setRecoveryFeedback({
          tone: 'success',
          message:
            action === 'restart-runtime'
              ? '恢复指令已执行，正在重新建立生成与语音运行时。'
              : '恢复动作已执行。',
        });
      } catch (error) {
        setRecoveryFeedback({
          tone: 'error',
          message:
            error instanceof Error ? error.message : '恢复失败，请稍后重试。',
        });
        throw error;
      } finally {
        setRecoveryActionInFlight(null);
      }
    },
    [
      onOpenLegacySettings,
      props.onRecoverRuntime,
      props.soulInspector.onRecoverSnapshot,
      refreshRuntimeHealth,
    ],
  );
  useEffect(() => {
    if (!startupActionInFlight) return;
    if (
      liveStartupPlan.nextAction !== startupActionInFlight ||
      liveStartupPlan.phase === 'started'
    ) {
      setStartupActionInFlight(null);
      if (liveStartupPlan.phase === 'started') setStartupRequested(false);
    }
  }, [liveStartupPlan, startupActionInFlight]);
  useEffect(() => {
    if (!startupActionInFlight) return;
    const timer = window.setTimeout(
      () => {
        setStartupActionInFlight(null);
        setStartupRequested(false);
      },
      startupActionInFlight === 'claim-runtime' ? 12_000 : 4_000,
    );
    return () => window.clearTimeout(timer);
  }, [startupActionInFlight]);
  useEffect(() => {
    if (
      !startupRequested ||
      startupActionInFlight ||
      !liveStartupPlan.nextAction
    ) {
      return;
    }
    setStartupActionInFlight(liveStartupPlan.nextAction);
    runReadinessAction(liveStartupPlan.nextAction);
    if (!liveStartupPlan.automatic) {
      setStartupRequested(false);
      setStartupActionInFlight(null);
    }
  }, [
    liveStartupPlan,
    runReadinessAction,
    startupActionInFlight,
    startupRequested,
  ]);
  const runIssueAction = (action: LiveReadinessAction) => {
    setStartupRequested(false);
    runReadinessAction(action);
  };
  const recordAttentionAction = useCallback(
    (
      stage:
        | 'operator_attention_action_started'
        | 'operator_attention_action_completed'
        | 'operator_attention_action_failed',
      item: OperatorAttentionItem,
      action: OperatorAttentionAction,
      error?: string,
    ) => {
      const event = createOperatorAttentionActionEvent({
        stage,
        sessionId: currentSessionId,
        item,
        action,
        error,
      });
      setOperatorAttentionRuntimeEvents((events) => [...events, event]);
      onAuditAction(event);
    },
    [currentSessionId, onAuditAction],
  );
  const runAttentionAction = async (item: OperatorAttentionItem) => {
    const action = item.action;
    if (!action) return;
    recordAttentionAction('operator_attention_action_started', item, action);
    try {
      if (action === 'run-preflight') {
        setRecoveryFeedback(null);
        await onRunOperatorPreflight();
      } else if (action === 'open-commitments') {
        setCommitmentFilter('attention');
        setWorkspace('memory');
      } else if (action === 'claim-runtime') {
        runIssueAction(action);
      } else {
        await runRecoveryAction(action);
      }
      recordAttentionAction(
        'operator_attention_action_completed',
        item,
        action,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '处理动作执行失败，请稍后重试。';
      if (action === 'run-preflight') {
        setRecoveryFeedback({ tone: 'error', message });
      }
      recordAttentionAction(
        'operator_attention_action_failed',
        item,
        action,
        message,
      );
    }
  };
  const addCustomImprovementStrategy = (improvementId: string) => {
    const draft =
      customImprovementStrategyDrafts[improvementId] ??
      createEmptyImprovementStrategyDraft();
    const previous = improvementStrategyAssets.assets.find(
      ({ assetId }) =>
        assetId === editingImprovementStrategyAssetIds[improvementId],
    );
    const qualityReview = reviewImprovementStrategyDraft({
      improvementId,
      draft,
      strategies: improvementStrategyCatalog,
      actions: nextSessionImprovementActionEvents,
      baseSessionId: previousSession?.sessionId,
      historyReady: improvementExperimentHistoryReady,
      selection: selectNextImprovementStrategy(
        improvementStrategyProjection,
        improvementId,
      ),
      editingStrategyId: previous?.strategy.id,
      policy: improvementStrategyQualityPolicy,
    });
    if (!qualityReview.canSave || !qualityReview.strategy) {
      const event = createImprovementStrategyQualityRejectionEvent({
        improvementId,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        gateVersion: improvementStrategyQualityPolicy.version,
        review: {
          status: 'blocked',
          score: qualityReview.score,
          blockIds: qualityReview.checks
            .filter(({ status }) => status === 'block')
            .map(({ id }) => id),
        },
      });
      setNextSessionImprovementActionEvents((events) => [
        ...events,
        event,
      ]);
      onAuditAction(event);
      setNextSessionActionFeedback({
        tone: 'error',
        message:
          qualityReview.checks.find(({ status }) => status === 'block')
            ?.detail ?? '策略质量检查未通过。',
      });
      return;
    }
    const strategy = qualityReview.strategy;
    const event = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy,
      scope: {
        personaId: operatorQueueScope.personaId,
        platform: operatorQueueScope.platform,
        roomId: operatorQueueScope.roomId,
      },
      previous,
      copiedFromAssetId:
        copiedFromImprovementStrategyAssetIds[improvementId],
      quality: {
        score: qualityReview.score,
        status: qualityReview.status === 'ready' ? 'ready' : 'review',
        warningIds: qualityReview.checks
          .filter(({ status }) => status === 'warning')
          .map(({ id }) => id),
        gateVersion: improvementStrategyQualityPolicy.version,
      },
    });
    setNextSessionImprovementActionEvents((events) => [...events, event]);
    onAuditAction(event);
    setSelectedImprovementStrategies((current) => ({
      ...current,
      [improvementId]: strategy.id,
    }));
    setCustomImprovementStrategyDrafts((current) => ({
      ...current,
      [improvementId]: createEmptyImprovementStrategyDraft(),
    }));
    setEditingImprovementStrategyAssetIds((current) => ({
      ...current,
      [improvementId]: undefined,
    }));
    setCopiedFromImprovementStrategyAssetIds((current) => ({
      ...current,
      [improvementId]: undefined,
    }));
    setOpenImprovementStrategyComposers((current) => ({
      ...current,
      [improvementId]: false,
    }));
    setNextSessionActionFeedback({
      tone: 'success',
      message: previous
        ? `自研策略“${strategy.label}”已保存为 V${previous.version + 1}。`
        : `自研策略“${strategy.label}”已保存并加入本轮实验。`,
    });
  };

  const changeImprovementStrategyAssetStatus = (
    asset: ImprovementStrategyAsset,
    operation: 'archive' | 'restore',
  ) => {
    const event = createImprovementStrategyAssetEvent({
      operation,
      asset,
      scope: {
        personaId: operatorQueueScope.personaId,
        platform: operatorQueueScope.platform,
        roomId: operatorQueueScope.roomId,
      },
    });
    setNextSessionImprovementActionEvents((events) => [...events, event]);
    onAuditAction(event);
    if (
      operation === 'archive' &&
      selectedImprovementStrategies[asset.strategy.improvementId ?? ''] ===
        asset.strategy.id
    ) {
      setSelectedImprovementStrategies((current) => ({
        ...current,
        [asset.strategy.improvementId ?? '']: 'standard',
      }));
    }
    setNextSessionActionFeedback({
      tone: 'success',
      message:
        operation === 'archive'
          ? `策略“${asset.strategy.label}”已归档。`
          : `策略“${asset.strategy.label}”已恢复。`,
    });
  };

  const publishImprovementStrategyQualityPolicy = () => {
    if (!improvementStrategyQualityPolicyProposal) return;
    const event = createImprovementStrategyQualityPolicyEvent({
      proposal: improvementStrategyQualityPolicyProposal,
      context: improvementExperimentContext,
      scope: {
        personaId: operatorQueueScope.personaId,
        platform: operatorQueueScope.platform,
        roomId: operatorQueueScope.roomId,
      },
    });
    setNextSessionImprovementActionEvents((events) => [...events, event]);
    onAuditAction(event);
    setNextSessionActionFeedback({
      tone: 'success',
      message:
        improvementStrategyQualityPolicyProposal.trigger ===
        'revalidation'
          ? improvementStrategyQualityPolicyProposal.revalidation?.phase ===
            'reset-baseline'
            ? `复验基线 V${improvementStrategyQualityPolicyProposal.toVersion} 已发布；完成观察后将继续测量目标方向。`
            : `质量门禁复验 V${improvementStrategyQualityPolicyProposal.toVersion} 已发布，新版本将补充当前上下文的精确样本。`
          : `质量门禁单变量实验 V${improvementStrategyQualityPolicyProposal.toVersion} 已发布，新版本将重新积累校准证据。`,
    });
  };

  const controlImprovementStrategyQualityPolicyRevalidation = (
    operation: 'cancel' | 'restart',
  ) => {
    const target = improvementStrategyQualityPolicyRevalidation.target;
    if (!target) return;
    const event =
      createImprovementStrategyQualityPolicyRevalidationControlEvent({
        operation,
        target,
        scope: {
          personaId: operatorQueueScope.personaId,
          platform: operatorQueueScope.platform,
          roomId: operatorQueueScope.roomId,
        },
        context: improvementExperimentContext,
        progress:
          improvementStrategyQualityPolicyRevalidation.progress,
        runId:
          improvementStrategyQualityPolicyRevalidation.runId ??
          undefined,
      });
    setNextSessionImprovementActionEvents((events) => [...events, event]);
    onAuditAction(event);
    setNextSessionActionFeedback({
      tone: 'success',
      message:
        operation === 'cancel'
          ? '复验已取消，目标锁已解除；门禁配置保持不变。'
          : '复验已重新开始，系统将继续锁定原目标并生成下一阶段提案。',
    });
  };

  const restoreImprovementStrategyQualityPolicy = (
    target: ImprovementStrategyQualityPolicy,
  ) => {
    const proposal =
      createImprovementStrategyQualityPolicyRollbackProposal({
        current: improvementStrategyQualityPolicy,
        target,
      });
    const event = createImprovementStrategyQualityPolicyEvent({
      proposal,
      context: improvementExperimentContext,
      scope: {
        personaId: operatorQueueScope.personaId,
        platform: operatorQueueScope.platform,
        roomId: operatorQueueScope.roomId,
      },
    });
    setNextSessionImprovementActionEvents((events) => [...events, event]);
    onAuditAction(event);
    setNextSessionActionFeedback({
      tone: 'success',
      message: `已将 V${target.version} 的配置发布为 V${proposal.toVersion}，校准证据将重新积累。`,
    });
  };

  const runNextSessionImprovement = async (
    item: NextSessionImprovementItem,
    strategyId: ImprovementStrategy['id'] = 'standard',
  ) => {
    if (!improvementExperimentHistoryReady) {
      setNextSessionActionFeedback({
        tone: 'error',
        message:
          nextSessionImprovementHistoryState === 'unavailable'
            ? '实验历史暂时不可用，为避免重复实验，本次动作未执行。'
            : '实验历史仍在加载，请稍后再执行。',
      });
      return;
    }
    const selection = selectNextImprovementStrategy(
      improvementStrategyProjection,
      item.id,
    );
    if (selection.mode === 'wait' || selection.mode === 'review') {
      setNextSessionActionFeedback({
        tone: 'error',
        message:
          selection.mode === 'wait'
            ? '该实验正在等待下一场复盘，结果产生前不会重复执行。'
            : '当前样本预算已经结束，请先设计新的策略变量。',
      });
      return;
    }
    const experiment = previousSession
      ? prepareImprovementStrategyExperiment({
          actions: nextSessionImprovementActionEvents,
          baseSessionId: previousSession.sessionId,
          improvementId: item.id,
          strategyId,
          strategyCatalog: improvementStrategyCatalog,
          excludedStrategyIds: improvementStrategyAssets.unavailableStrategyIds,
        })
      : null;
    setNextSessionActionInFlight(item.id);
    setNextSessionActionFeedback(null);
    try {
      if (item.action === 'run-preflight') {
        await onRunOperatorPreflight();
      } else {
        runReadinessAction(item.action);
      }
      setNextSessionActionFeedback({
        tone: 'success',
        message:
          item.action === 'run-preflight'
            ? '诊断已完成，建议已留下执行证据。'
            : '已打开对应工作区，可继续核对复盘证据。',
      });
      if (previousSession) {
        const event = createNextSessionImprovementActionEvent({
          item,
          baseSession: previousSession,
          scope: {
            personaId: operatorQueueScope.personaId,
            platform: operatorQueueScope.platform,
            roomId: operatorQueueScope.roomId,
          },
          outcome: 'completed',
          experimentContext: improvementExperimentContext,
          strategyQualityGateVersion:
            improvementStrategyQualityPolicy.version,
          strategy: experiment
            ? {
                id: experiment.strategy.id,
                label: experiment.strategy.label,
                controlled: experiment.controlled,
                variable: experiment.strategy.variable,
                instruction: experiment.strategy.instruction,
                successSignal: experiment.strategy.successSignal,
                origin: experiment.strategy.origin,
              }
            : undefined,
        });
        setNextSessionImprovementActionEvents((events) => [...events, event]);
        onAuditAction(event);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '改进动作执行失败，请重试。';
      setNextSessionActionFeedback({ tone: 'error', message });
      if (previousSession) {
        const event = createNextSessionImprovementActionEvent({
          item,
          baseSession: previousSession,
          scope: {
            personaId: operatorQueueScope.personaId,
            platform: operatorQueueScope.platform,
            roomId: operatorQueueScope.roomId,
          },
          outcome: 'failed',
          experimentContext: improvementExperimentContext,
          strategyQualityGateVersion:
            improvementStrategyQualityPolicy.version,
          strategy: experiment
            ? {
                id: experiment.strategy.id,
                label: experiment.strategy.label,
                controlled: experiment.controlled,
                variable: experiment.strategy.variable,
                instruction: experiment.strategy.instruction,
                successSignal: experiment.strategy.successSignal,
                origin: experiment.strategy.origin,
              }
            : undefined,
          error: message,
        });
        setNextSessionImprovementActionEvents((events) => [...events, event]);
        onAuditAction(event);
      }
    } finally {
      setNextSessionActionInFlight(null);
    }
  };
  const requestStartup = () => {
    setStartupActionError('');
    setStartupRequested(true);
  };
  const requestAutomationToggle = () => {
    if (props.autoBroadcastEnabled) {
      setStartupRequested(false);
      setStartupActionInFlight(null);
      onDisableAutoBroadcast();
      return;
    }
    requestStartup();
  };
  useEffect(() => {
    if (
      props.settings.tts.engine !== 'minimax' ||
      !props.settings.tts.minimaxApiKey?.trim()
    ) {
      setMinimaxVoices([]);
      setVoiceLoadError('');
      return;
    }
    let cancelled = false;
    void fetchMinimaxVoiceOptions(props.settings.tts.minimaxApiKey)
      .then((voices) => {
        if (!cancelled) {
          setMinimaxVoices(voices);
          setVoiceLoadError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMinimaxVoices([]);
          setVoiceLoadError(
            error instanceof Error
              ? error.message
              : '无法加载 MiniMax 音色列表。',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.settings.tts.engine, props.settings.tts.minimaxApiKey]);

  const previewVoice = async (voiceId: string) => {
    setPreviewingVoiceId(voiceId);
    try {
      await props.onPreviewVoice(voiceId);
      setVoiceLoadError('');
    } catch (error) {
      setVoiceLoadError(
        error instanceof Error ? error.message : '音色试听失败。',
      );
    } finally {
      setPreviewingVoiceId(null);
    }
  };

  return (
    <main
      className="control-room"
      onClickCapture={(event) => {
        const auditEvent = describeOperatorControl(event.target, 'click');
        if (auditEvent) props.onAuditAction(auditEvent);
      }}
      onBlurCapture={(event) => {
        const auditEvent = describeOperatorControl(event.target, 'blur');
        if (auditEvent) props.onAuditAction(auditEvent);
      }}
    >
      <header className="control-room-header">
        <div className="control-room-brand">
          <span className="control-room-eyebrow">
            LIVE CONTROL ROOM / DIGITAL HUMAN STUDIO
          </span>
          <strong>直播总控</strong>
        </div>
        <div
          className={`live-operation-status is-${liveOperation.tone}`}
          aria-label={`播出阶段：${liveOperation.title}`}
        >
          <span
            className={`pulse-dot ${liveOperation.phase !== 'standby' ? 'is-live' : ''}`}
          />
          <div>
            <strong>{liveOperation.title}</strong>
            <small>
              {liveOperation.detail} · 引擎{stage}
            </small>
          </div>
        </div>
        <div className="control-room-actions">
          <div className="live-session-control">
            <span>
              第 {props.liveSessionState.current.sequence} 场 ·{' '}
              {new Date(
                props.liveSessionState.current.startedAt,
              ).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {confirmNewSession ? (
              <div
                className="live-session-confirm"
                role="group"
                aria-label="确认开始新场次"
              >
                <small>
                  将暂停数字人自动播出并归档未完成互动；OBS
                  或平台推流需单独停止。
                </small>
                <button
                  type="button"
                  className="is-confirm"
                  disabled={isRotatingSession}
                  onClick={() => {
                    setIsRotatingSession(true);
                    setSessionRotationError('');
                    void props
                      .onStartNewLiveSession()
                      .then(() => {
                        setConfirmNewSession(false);
                      })
                      .catch((error) => {
                        setSessionRotationError(
                          error instanceof Error
                            ? error.message
                            : '切场失败，请重试',
                        );
                      })
                      .finally(() => {
                        setIsRotatingSession(false);
                      });
                  }}
                >
                  确认切场
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmNewSession(false)}
                  disabled={isRotatingSession}
                >
                  取消
                </button>
                {sessionRotationError ? (
                  <small role="alert">{sessionRotationError}</small>
                ) : null}
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmNewSession(true)}>
                {liveOperation.phase === 'live' ||
                liveOperation.phase === 'live-paused'
                  ? '结束并切换场次'
                  : liveOperation.phase === 'preview'
                    ? '结束预演并切场'
                    : '开始新场次'}
              </button>
            )}
          </div>
          <div className="auto-broadcast-stack">
            <button
              className={props.autoBroadcastEnabled ? 'is-armed' : ''}
              disabled={
                !props.autoBroadcastEnabled &&
                (liveStartupPlan.phase === 'checking' ||
                  Boolean(startupActionInFlight))
              }
              title={
                props.autoBroadcastEnabled
                  ? '立即停止自动播出'
                  : liveStartupPlan.detail
              }
              onClick={requestAutomationToggle}
            >
              {props.autoBroadcastEnabled &&
              shouldPauseAutomationForReadiness(liveReadiness)
                ? '自动播出：等待就绪'
                : liveOperation.automationLabel}
            </button>
            {liveOperation.showPipelineAction ? (
              <button
                type="button"
                className="quiet-action"
                onClick={() => setWorkspace('pipeline')}
              >
                {liveOperation.phase === 'preview'
                  ? '进入正式推流检查'
                  : '查看正式推流状态'}
              </button>
            ) : null}
          </div>
          <button className="danger-action" onClick={props.onEmergencyTakeover}>
            紧急接管
          </button>
        </div>
      </header>

      <aside className="control-room-nav" aria-label="控制台工作区">
        {(Object.keys(workspaceLabels) as Workspace[]).map((item) => (
          <button
            key={item}
            className={workspace === item ? 'is-active' : ''}
            onClick={() => setWorkspace(item)}
          >
            {workspaceLabels[item]}
            {item === 'overview' && operatorAttention.counts.total > 0 && (
              <span className="workspace-attention-badge">
                {operatorAttention.counts.total}
              </span>
            )}
            {item === 'memory' && commitmentRadar.summary.attention > 0 && (
              <span className="workspace-attention-badge">
                {commitmentRadar.summary.attention}
              </span>
            )}
          </button>
        ))}
      </aside>

      <section className="control-room-main">
        {workspace === 'avatars' && (
          <section className="workspace-card digital-human-workspace">
            <div className="workspace-heading">
              <div>
                <span className="stage-label">DIGITAL HUMAN STUDIO</span>
                <h1>数字人管理</h1>
              </div>
              <small>
                {props.settings.digitalHumans.profiles.length} 个已接入数字人
              </small>
            </div>
            <div className="digital-human-list">
              {props.settings.digitalHumans.profiles.map((profile) => (
                <article
                  key={profile.id}
                  className={`digital-human-card ${profile.id === activeDigitalHuman?.id ? 'is-active' : ''} ${profile.enabled ? '' : 'is-disabled'}`}
                >
                  <div className="digital-human-portrait" aria-hidden="true">
                    {profile.avatarLabel || profile.displayName.slice(0, 1)}
                  </div>
                  <div className="digital-human-details">
                    {profile.id === activeDigitalHuman?.id && (
                      <span className="active-label">当前直播中</span>
                    )}
                    <input
                      aria-label={`${profile.displayName}名称`}
                      value={profile.displayName}
                      onChange={(event) =>
                        props.onUpdateDigitalHuman(profile.id, {
                          displayName: event.target.value,
                          avatarLabel: event.target.value.slice(0, 1),
                        })
                      }
                    />
                    <input
                      aria-label={`${profile.displayName}定位`}
                      value={profile.title}
                      onChange={(event) =>
                        props.onUpdateDigitalHuman(profile.id, {
                          title: event.target.value,
                        })
                      }
                    />
                    <input
                      aria-label={`${profile.displayName}说明`}
                      value={profile.description}
                      onChange={(event) =>
                        props.onUpdateDigitalHuman(profile.id, {
                          description: event.target.value,
                        })
                      }
                    />
                  </div>
                  <dl>
                    <div>
                      <dt>
                        官方音色库
                        {minimaxVoices.length
                          ? ` · ${minimaxVoices.length}`
                          : ''}
                      </dt>
                      <dd className="voice-select-row">
                        <select
                          aria-label={`${profile.displayName}音色`}
                          value={profile.voiceSpeaker}
                          onChange={(event) =>
                            props.onUpdateDigitalHuman(profile.id, {
                              voiceSpeaker: event.target.value,
                            })
                          }
                        >
                          <option value={profile.voiceSpeaker}>
                            {minimaxVoices.find(
                              (voice) =>
                                voice.voice_id === profile.voiceSpeaker,
                            )?.voice_name || profile.voiceSpeaker}
                          </option>
                          {minimaxVoices
                            .filter(
                              (voice) =>
                                voice.voice_id !== profile.voiceSpeaker,
                            )
                            .map((voice) => (
                              <option
                                key={voice.voice_id}
                                value={voice.voice_id}
                              >
                                {voice.voice_name}
                              </option>
                            ))}
                        </select>
                        <button
                          className="quiet-action"
                          onClick={() =>
                            void previewVoice(profile.voiceSpeaker)
                          }
                          disabled={previewingVoiceId === profile.voiceSpeaker}
                        >
                          {previewingVoiceId === profile.voiceSpeaker
                            ? '生成试听…'
                            : '试听'}
                        </button>
                      </dd>
                    </div>
                    <div>
                      <dt>头像</dt>
                      <dd>
                        {profile.avatarAssetName ||
                          (profile.id === 'linglan-queen'
                            ? '默认 PersonaLive'
                            : '未绑定')}
                      </dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>
                        {!profile.enabled
                          ? '已停用'
                          : profile.id === activeDigitalHuman?.id &&
                              props.isSpeaking
                            ? '播出中'
                            : profile.id === activeDigitalHuman?.id
                              ? '待命'
                              : '待播'}
                      </dd>
                    </div>
                  </dl>
                  <label className="avatar-package-picker">
                    绑定 .purupuru
                    <input
                      type="file"
                      accept=".purupuru,application/zip"
                      onChange={(event) =>
                        props.onAvatarPackageUpload(
                          profile.id,
                          event.target.files?.[0] || null,
                        )
                      }
                    />
                  </label>
                  <details className="persona-editor digital-human-skills" open>
                    <summary>Agent Skills</summary>
                    <p>安装后仅在匹配问题时向该数字人提供技能上下文。</p>
                    {DIGITAL_HUMAN_SKILLS.map((skill) => {
                      const installed = profile.installedSkillIds.includes(
                        skill.id,
                      );
                      return (
                        <article key={skill.id} className="digital-human-skill">
                          <div>
                            <strong>{skill.name}</strong>
                            <p>{skill.summary}</p>
                            <small>由当前部署的内容服务提供。</small>
                          </div>
                          <button
                            className={installed ? 'quiet-action' : ''}
                            onClick={() =>
                              props.onUpdateDigitalHuman(profile.id, {
                                installedSkillIds: installed
                                  ? profile.installedSkillIds.filter(
                                      (id) => id !== skill.id,
                                    )
                                  : [...profile.installedSkillIds, skill.id],
                              })
                            }
                          >
                            {installed ? '已安装 · 卸载' : '安装技能'}
                          </button>
                        </article>
                      );
                    })}
                  </details>
                  <details className="persona-editor">
                    <summary>人设与播出契约</summary>
                    <p>
                      这些选项会动态进入该数字人的每次回复提示词，不会向观众展示
                      JSON 或内部指令。
                    </p>
                    <label>
                      核心身份
                      <textarea
                        value={profile.persona.identity}
                        onChange={(event) =>
                          props.onUpdateDigitalHuman(profile.id, {
                            persona: {
                              ...profile.persona,
                              identity: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      直播内容焦点
                      <textarea
                        value={profile.persona.liveFocus}
                        onChange={(event) =>
                          props.onUpdateDigitalHuman(profile.id, {
                            persona: {
                              ...profile.persona,
                              liveFocus: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      与观众的关系
                      <textarea
                        value={profile.persona.audienceRelationship}
                        onChange={(event) =>
                          props.onUpdateDigitalHuman(profile.id, {
                            persona: {
                              ...profile.persona,
                              audienceRelationship: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      说话气质
                      <textarea
                        value={profile.persona.speakingStyle}
                        onChange={(event) =>
                          props.onUpdateDigitalHuman(profile.id, {
                            persona: {
                              ...profile.persona,
                              speakingStyle: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      口头习惯
                      <textarea
                        value={profile.persona.signatureHabit}
                        onChange={(event) =>
                          props.onUpdateDigitalHuman(profile.id, {
                            persona: {
                              ...profile.persona,
                              signatureHabit: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      不可逾越的边界
                      <textarea
                        value={profile.persona.hardBoundaries}
                        onChange={(event) =>
                          props.onUpdateDigitalHuman(profile.id, {
                            persona: {
                              ...profile.persona,
                              hardBoundaries: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </details>
                  <details className="memory-editor">
                    <summary>记忆与关系</summary>
                    <MemoryLifePanel profile={profile} memory={props.memory} />
                  </details>
                  <div className="digital-human-controls">
                    <button
                      disabled={
                        profile.id === activeDigitalHuman?.id ||
                        !profile.enabled
                      }
                      onClick={() => props.onSelectDigitalHuman(profile.id)}
                    >
                      {profile.id === activeDigitalHuman?.id
                        ? '当前主播'
                        : '切换为当前主播'}
                    </button>
                    <button
                      className="quiet-action"
                      onClick={() =>
                        props.onSetDigitalHumanEnabled(
                          profile.id,
                          !profile.enabled,
                        )
                      }
                    >
                      {profile.enabled ? '停用档案' : '重新启用'}
                    </button>
                    {profile.id !== 'linglan-queen' && (
                      <button
                        className="danger-action"
                        onClick={() => props.onRemoveDigitalHuman(profile.id)}
                      >
                        移除
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="digital-human-actions">
              <button onClick={props.onAddDigitalHuman}>新增数字人档案</button>
              <button onClick={props.onOpenLegacySettings}>
                打开当前主播运行配置
              </button>
            </div>
            {voiceLoadError && (
              <p className="voice-status" role="status">
                {voiceLoadError}
              </p>
            )}
          </section>
        )}
        {workspace === 'overview' && (
          <>
            <section
              className={`live-readiness is-${liveReadiness.status}`}
              aria-label="开播就绪检查"
              aria-live="polite"
            >
              <div className="live-readiness-summary">
                <span className="live-readiness-kicker">LIVE READINESS</span>
                <strong>{liveReadiness.title}</strong>
                <p>{liveReadiness.summary}</p>
              </div>
              {liveReadiness.issues.length > 0 &&
              operatorAttention.items.length === 0 ? (
                <div className="live-readiness-issues">
                  {liveReadiness.issues.map((issue) => (
                    <article
                      key={issue.code}
                      className={`is-${issue.severity}`}
                    >
                      <div>
                        <b>{issue.title}</b>
                        <small>{issue.detail}</small>
                      </div>
                      {issue.action && issue.actionLabel ? (
                        <button
                          type="button"
                          onClick={() => runIssueAction(issue.action!)}
                        >
                          {issue.actionLabel}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
              <div
                className={`live-preflight-summary is-${operatorPreflightReport?.status || props.operatorPreflightSession.state}`}
              >
                <div>
                  <span>CONFIG PREFLIGHT</span>
                  <b>
                    {operatorPreflightReport
                      ? operatorPreflightReport.status === 'ready'
                        ? '配置链路实时检测通过'
                        : operatorPreflightReport.status === 'blocked'
                          ? '配置诊断存在阻断项'
                          : '配置可用，但部分链路仅完成静态验证'
                      : props.operatorPreflightSession.state === 'stale'
                        ? '配置已变更，诊断结果已过期'
                        : '尚未运行配置链路诊断'}
                  </b>
                  <small>
                    {operatorPreflightReport
                      ? operatorPreflightReport.summary
                      : props.operatorPreflightSession.state === 'stale'
                        ? '自动播出已暂停；重新诊断通过后才能恢复。'
                        : '检测模型、语音、本地协调器和当前直播平台，并区分实时与配置证据。'}
                  </small>
                </div>
                {operatorPreflightReport ? (
                  <div className="live-preflight-badges">
                    {operatorPreflightReport.checks.map((check) => (
                      <span
                        key={check.id}
                        className={`is-${check.status}`}
                        title={check.detail}
                      >
                        {check.label}
                        {typeof check.latencyMs === 'number'
                          ? ` ${check.latencyMs}ms`
                          : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={isOperatorPreflightRunning}
                  onClick={() => void props.onRunOperatorPreflight()}
                >
                  {isOperatorPreflightRunning
                    ? '正在检测…'
                    : operatorPreflightReport
                      ? '重新检测'
                      : '运行诊断'}
                </button>
              </div>
              <div
                className={`live-startup-guide is-${liveStartupPlan.phase}`}
                aria-label="一键开播向导"
              >
                <div
                  className={`runtime-lease-diagnostic is-${runtimeLeaseDiagnostic.tone}`}
                  data-testid="runtime-lease-diagnostic"
                >
                  <span aria-hidden="true" />
                  <div>
                    <b>{runtimeLeaseDiagnostic.title}</b>
                    <small>{runtimeLeaseDiagnostic.detail}</small>
                  </div>
                </div>
                <div className="live-startup-progress">
                  {liveStartupPlan.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`is-${step.status}`}
                      title={step.detail}
                    >
                      <span>{step.status === 'ready' ? '✓' : index + 1}</span>
                      <small>{step.label}</small>
                    </div>
                  ))}
                </div>
                <div className="live-startup-next">
                  <div>
                    <b>{liveStartupPlan.title}</b>
                    <small>
                      {startupActionError || liveStartupPlan.detail}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="live-startup-primary"
                    disabled={
                      liveStartupPlan.phase === 'checking' ||
                      liveStartupPlan.phase === 'started' ||
                      Boolean(startupActionInFlight)
                    }
                    onClick={requestStartup}
                  >
                    {startupActionInFlight
                      ? startupActionInFlight === 'claim-runtime'
                        ? '正在接管运行时…'
                        : startupActionInFlight === 'run-preflight'
                          ? '正在诊断…'
                          : '正在启动…'
                      : liveStartupPlan.primaryLabel}
                  </button>
                </div>
              </div>
            </section>
            <section
              className={`operator-attention-center is-${operatorAttention.status}`}
              aria-label="统一运营提醒中心"
              aria-live="polite"
            >
              <div className="operator-attention-heading">
                <span>OPERATOR ATTENTION</span>
                <strong>{operatorAttention.title}</strong>
                <small>{operatorAttention.summary}</small>
              </div>
              <div className="operator-attention-counts" aria-label="提醒统计">
                <span>
                  阻断 <strong>{operatorAttention.counts.blockers}</strong>
                </span>
                <span>
                  提醒 <strong>{operatorAttention.counts.warnings}</strong>
                </span>
              </div>
              {operatorAttention.items.length ? (
                <div className="operator-attention-items">
                  {operatorAttention.items.map((item) => (
                    <article key={item.id} className={`is-${item.severity}`}>
                      <div>
                        <span>{item.domain.toUpperCase()}</span>
                        <b>{item.title}</b>
                        <small>{item.detail}</small>
                      </div>
                      {item.action && item.actionLabel ? (
                        <button
                          type="button"
                          disabled={
                            Boolean(recoveryActionInFlight) ||
                            (item.action === 'run-preflight' &&
                              isOperatorPreflightRunning)
                          }
                          onClick={() => void runAttentionAction(item)}
                        >
                          {recoveryActionInFlight === item.action
                            ? '正在执行…'
                            : item.actionLabel}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="operator-attention-clear">
                  <span aria-hidden="true">
                    {operatorAttention.status === 'checking' ? '…' : '✓'}
                  </span>
                  <small>
                    {operatorAttention.status === 'checking'
                      ? '正在检查全部运营信号'
                      : '无需人工处理'}
                  </small>
                </div>
              )}
              {operatorAttentionHistoryLoaded ? (
                <div className="operator-attention-ledger">
                  <div className="operator-attention-recap">
                    <div>
                      <span>本场复盘</span>
                      <b>
                        出现 {currentAttentionLedger.recap.opened} · 恢复{' '}
                        {currentAttentionLedger.recap.resolved} · 动作{' '}
                        {currentAttentionLedger.recap.actions}
                      </b>
                      <small>
                        当前待处理 {currentAttentionLedger.recap.active}
                        {currentAttentionLedger.recap.failedActions
                          ? ` · 失败动作 ${currentAttentionLedger.recap.failedActions}`
                          : ''}
                        {' · 平均恢复 '}
                        {formatResolutionDuration(
                          currentAttentionLedger.recap.averageResolutionMs,
                        )}
                      </small>
                    </div>
                    {previousAttentionLedger ? (
                      <div>
                        <span>上场复盘</span>
                        <b>
                          出现 {previousAttentionLedger.recap.opened} · 恢复{' '}
                          {previousAttentionLedger.recap.resolved}
                        </b>
                        <small>
                          动作 {previousAttentionLedger.recap.actions} · 失败{' '}
                          {previousAttentionLedger.recap.failedActions}
                        </small>
                      </div>
                    ) : null}
                  </div>
                  {currentAttentionLedger.recent.length ? (
                    <div
                      className="operator-attention-evidence"
                      aria-label="最近提醒处理证据"
                    >
                      {currentAttentionLedger.recent
                        .slice(0, 3)
                        .map((incident) => {
                          const evidence = incident.actions.at(-1);
                          return (
                            <article
                              key={`${incident.attentionId}:${incident.openedAt}`}
                            >
                              <span
                                className={
                                  incident.resolvedAt
                                    ? 'is-resolved'
                                    : 'is-active'
                                }
                              >
                                {incident.resolvedAt ? '已恢复' : '处理中'}
                              </span>
                              <div>
                                <b>{incident.title}</b>
                                <small>
                                  {formatEventTime(incident.openedAt)} 出现
                                  {incident.resolvedAt
                                    ? ` · ${formatEventTime(incident.resolvedAt)} 恢复`
                                    : ''}
                                  {evidence
                                    ? ` · 最近动作${evidence.status === 'failed' ? '失败' : evidence.status === 'completed' ? '已提交' : '执行中'} ${formatEventTime(evidence.at)}`
                                    : ''}
                                </small>
                              </div>
                            </article>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {recoveryFeedback ? (
                <p
                  className={`runtime-recovery-feedback is-${recoveryFeedback.tone}`}
                  role={recoveryFeedback.tone === 'error' ? 'alert' : 'status'}
                >
                  {recoveryFeedback.message}
                </p>
              ) : null}
            </section>
            <section className="live-session-overview" aria-label="直播场次">
              <div className="live-session-overview-heading">
                <div>
                  <span>LIVE SESSION</span>
                  <strong>
                    当前第 {props.liveSessionState.current.sequence} 场
                  </strong>
                </div>
                <small>
                  {props.operatorQueueScope.platform} /{' '}
                  {props.operatorQueueScope.roomId} · 开始于{' '}
                  {new Date(
                    props.liveSessionState.current.startedAt,
                  ).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </div>
              <div className="live-session-metrics">
                <article>
                  <strong>{props.queueDepth}</strong>
                  <span>处理中</span>
                </article>
                <article>
                  <strong>{props.currentSessionQueueSummary.done}</strong>
                  <span>已回应</span>
                </article>
                <article>
                  <strong>{props.currentSessionQueueSummary.skipped}</strong>
                  <span>未采用</span>
                </article>
                <article>
                  <strong>{props.currentSessionQueueSummary.failed}</strong>
                  <span>失败</span>
                </article>
              </div>
              {previousSession && previousSessionRetrospective ? (
                <div className="previous-session-recap">
                  <div>
                    <b>上一场 · 第 {previousSession.sequence} 场</b>
                    <small>
                      {new Date(previousSession.startedAt).toLocaleString(
                        'zh-CN',
                        {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )}
                      {' — '}
                      {previousSession.endedAt
                        ? new Date(previousSession.endedAt).toLocaleTimeString(
                            'zh-CN',
                            {
                              hour: '2-digit',
                              minute: '2-digit',
                            },
                          )
                        : '已结束'}
                    </small>
                  </div>
                  <div
                    className={`previous-session-score is-${previousSessionRetrospective.status}`}
                    aria-label={`上一场复盘评分 ${previousSessionRetrospective.score} 分`}
                  >
                    <strong>{previousSessionRetrospective.score}</strong>
                    <span>
                      {previousSessionRetrospective.title}
                      <small>{previousSessionRetrospective.summary}</small>
                    </span>
                  </div>
                  <details className="previous-session-report">
                    <summary>查看结构化复盘</summary>
                    <div>
                      {previousSessionRetrospective.findings.map((finding) => (
                        <article
                          key={finding.id}
                          className={`is-${finding.tone}`}
                        >
                          <b>{finding.title}</b>
                          <small>{finding.detail}</small>
                        </article>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyPreviousSessionRetrospective()}
                    >
                      {retrospectiveCopyState === 'copied'
                        ? '已复制 Markdown'
                        : retrospectiveCopyState === 'failed'
                          ? '复制失败，请重试'
                          : '复制完整复盘'}
                    </button>
                  </details>
                </div>
              ) : (
                <small className="live-session-first-run">
                  这是当前直播间的首个可追踪场次。切场后，这里会保留上一场复盘。
                </small>
              )}
              <div
                className={`live-session-trend is-${liveSessionTrend.direction}`}
                aria-label="跨场直播质量趋势"
              >
                <div>
                  <span>SESSION TREND</span>
                  <b>{liveSessionTrend.title}</b>
                  <small>{liveSessionTrend.summary}</small>
                </div>
                {liveSessionTrend.records.length ? (
                  <div className="live-session-trend-bars">
                    {liveSessionTrend.records.slice(-6).map((record) => (
                      <div
                        key={record.sessionId}
                        title={`第 ${record.sequence} 场 · ${record.score} 分 · 回应 ${record.responded} · 失败 ${record.failed}`}
                      >
                        <span
                          className={`is-${record.status}`}
                          style={{ height: `${Math.max(8, record.score)}%` }}
                        />
                        <b>{record.score}</b>
                        <small>#{record.sequence}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <small className="live-session-trend-empty">
                    完成一次切场后开始积累趋势
                  </small>
                )}
                <div
                  className={`next-session-improvement is-${nextSessionImprovementPlan.status}`}
                >
                  <div>
                    <span>NEXT SESSION PLAN</span>
                    <b>{adaptiveNextSessionImprovementPlan.title}</b>
                    <small>{adaptiveNextSessionImprovementPlan.summary}</small>
                    <small className="learning-summary">
                      {adaptiveNextSessionImprovementPlan.learningSummary}
                    </small>
                    <small
                      className={`strategy-context is-${
                        improvementStrategyProjection.context?.status ?? 'new'
                      }`}
                    >
                      实验环境：
                      {improvementStrategyProjection.context?.label ??
                        improvementExperimentContext.label}
                      {' · '}
                      {improvementStrategyProjection.context?.status ===
                      'active'
                        ? `当前环境已有 ${
                            improvementStrategyProjection.context
                              .includedAttempts
                          } 次动作证据${
                            improvementStrategyProjection.context
                              .excludedAttempts
                              ? `，另有 ${improvementStrategyProjection.context.excludedAttempts} 次旧环境证据已隔离`
                              : ''
                          }`
                        : improvementStrategyProjection.context?.status ===
                            'rebuilding'
                          ? '检测到运行配置变化，旧证据已隔离，正在重建基线'
                          : '当前运行配置尚无策略样本，将从探索开始'}
                    </small>
                    <div
                      className={`strategy-quality-calibration is-${improvementStrategyQualityCalibration.status}`}
                    >
                      <header>
                        <b>
                          质量门禁 V
                          {improvementStrategyQualityPolicy.version}
                        </b>
                        <span>
                          {improvementStrategyQualityCalibration.status ===
                          'aligned'
                            ? '规则一致'
                            : improvementStrategyQualityCalibration.status ===
                                'too-permissive'
                              ? '门禁偏松'
                              : improvementStrategyQualityCalibration.status ===
                                  'too-strict'
                                ? '门禁偏严'
                                : improvementStrategyQualityCalibration.status ===
                                    'mixed'
                                  ? '信号混合'
                                  : '样本不足'}
                        </span>
                      </header>
                      <small>
                        {improvementStrategyQualityCalibration.summary}
                      </small>
                      <em>
                        可用证据{' '}
                        {improvementStrategyQualityCalibration.evidence.usable}
                        /
                        {
                          improvementStrategyQualityCalibration.evidence
                            .evaluated
                        }
                        {' · '}
                        待观察{' '}
                        {
                          improvementStrategyQualityCalibration.evidence
                            .pending
                        }
                      </em>
                      {improvementStrategyQualityCalibration.recommendations[0] ? (
                        <p>
                          {
                            improvementStrategyQualityCalibration
                              .recommendations[0]
                          }
                        </p>
                      ) : null}
                      {improvementStrategyQualityPolicyObservation ? (
                        <div
                          className={`strategy-quality-release-observation is-${improvementStrategyQualityPolicyObservation.status}`}
                        >
                          <strong>
                            发布后观察窗 · V
                            {
                              improvementStrategyQualityPolicyObservation
                                .current.version
                            }
                          </strong>
                          <small>
                            评审{' '}
                            {
                              improvementStrategyQualityPolicyObservation
                                .current.reviewAttempts
                            }
                            {' · '}
                            已出结果{' '}
                            {
                              improvementStrategyQualityPolicyObservation
                                .current.evidenceEvaluated
                            }
                            {' · '}
                            状态
                            {improvementStrategyQualityPolicyObservation.status ===
                            'healthy'
                              ? '健康'
                              : improvementStrategyQualityPolicyObservation.status ===
                                  'watch'
                                ? '继续观察'
                                : improvementStrategyQualityPolicyObservation.status ===
                                    'rollback-recommended'
                                  ? '建议回滚'
                                  : '样本不足'}
                          </small>
                          <small>
                            证据可用率{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyObservation
                                .baseline.usabilityRate,
                            )}{' '}
                            →{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyObservation
                                .current.usabilityRate,
                            )}
                            {' · '}
                            阻断率{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyObservation
                                .baseline.blockRate,
                            )}{' '}
                            →{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyObservation
                                .current.blockRate,
                            )}
                            {' · '}
                            执行覆盖{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyObservation
                                .baseline.executionRate,
                            )}{' '}
                            →{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyObservation
                                .current.executionRate,
                            )}
                          </small>
                          <small>
                            {
                              improvementStrategyQualityPolicyObservation.summary
                            }
                          </small>
                          {improvementStrategyQualityPolicyObservation.reasons.map(
                            (reason) => (
                              <small key={reason} className="is-regression">
                                {reason}
                              </small>
                            ),
                          )}
                          {improvementStrategyQualityPolicyAttribution ? (
                            <div
                              className={`strategy-quality-policy-attribution is-${improvementStrategyQualityPolicyAttribution.status}`}
                            >
                              <b>
                                参数归因 ·{' '}
                                {improvementStrategyQualityPolicyAttribution
                                  .changedField
                                  ? improvementStrategyQualityPolicyFieldLabels[
                                      improvementStrategyQualityPolicyAttribution
                                        .changedField
                                    ]
                                  : '多变量或无变化'}
                                {' · '}
                                {improvementStrategyQualityPolicyAttribution.status ===
                                'improved'
                                  ? '改善'
                                  : improvementStrategyQualityPolicyAttribution.status ===
                                      'tradeoff'
                                    ? '存在权衡'
                                    : improvementStrategyQualityPolicyAttribution.status ===
                                        'regressed'
                                      ? '退化'
                                      : improvementStrategyQualityPolicyAttribution.status ===
                                          'neutral'
                                        ? '影响中性'
                                        : improvementStrategyQualityPolicyAttribution.status ===
                                            'insufficient'
                                          ? '等待样本'
                                          : '不可归因'}
                              </b>
                              {improvementStrategyQualityPolicyAttribution
                                .changedField ? (
                                <small>
                                  {String(
                                    improvementStrategyQualityPolicyAttribution.from,
                                  )}{' '}
                                  →{' '}
                                  {String(
                                    improvementStrategyQualityPolicyAttribution.to,
                                  )}
                                  {' · '}
                                  正向信号{' '}
                                  {
                                    improvementStrategyQualityPolicyAttribution
                                      .positiveSignals
                                  }
                                  {' · '}
                                  反向信号{' '}
                                  {
                                    improvementStrategyQualityPolicyAttribution
                                      .negativeSignals
                                  }
                                </small>
                              ) : null}
                              <small>
                                {
                                  improvementStrategyQualityPolicyAttribution.summary
                                }
                              </small>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="strategy-quality-effect-ledger">
                        <strong>
                          参数效果账本 ·{' '}
                          {improvementStrategyQualityPolicyEffectLedger.effects.reduce(
                            (total, effect) => total + effect.samples,
                            0,
                          )}{' '}
                          个可归因实验
                        </strong>
                        <small>
                          字段证据参考顺序：{' '}
                          {
                            improvementStrategyQualityPolicyFieldLabels[
                              improvementStrategyQualityPolicyEffectLedger
                                .recommendedFieldOrder[0]
                            ]
                          }
                        </small>
                        <small>
                          当前运行上下文：{improvementExperimentContext.label}
                        </small>
                        <small>
                          字段汇总仅供参考；自动排序要求{' '}
                          {improvementStrategyQualityPolicyEffectFreshnessDays}{' '}
                          天内至少 2 个同方向、当前上下文的精确样本。
                        </small>
                        {improvementStrategyQualityPolicyEffectLedger.effects.map(
                          (effect) => (
                            <small
                              key={effect.field}
                              className={`is-${effect.recommendation}`}
                            >
                              {
                                improvementStrategyQualityPolicyFieldLabels[
                                  effect.field
                                ]
                              }
                              ：
                              {effect.recommendation === 'prefer'
                                ? '历史优先'
                                : effect.recommendation === 'caution'
                                  ? '谨慎使用'
                                  : effect.recommendation === 'neutral'
                                    ? '效果中性'
                                    : '尚未验证'}
                              {' · '}
                              样本 {effect.samples}
                              {' · '}
                              改善 {effect.improved}
                              {' · '}
                              权衡 {effect.tradeoff}
                              {' · '}
                              退化 {effect.regressed}
                              {' · '}
                              置信度
                              {effect.confidence === 'high'
                                ? '高'
                                : effect.confidence === 'medium'
                                  ? '中'
                                  : '低'}
                            </small>
                          ),
                        )}
                        {improvementStrategyQualityPolicyEffectLedger.directionEffects.map(
                          (effect) => (
                            <small
                              key={`${effect.field}:${effect.from}->${effect.to}`}
                              className={`is-${effect.recommendation}`}
                            >
                              {
                                improvementStrategyQualityPolicyFieldLabels[
                                  effect.field
                                ]
                              }{' '}
                              {String(effect.from)} → {String(effect.to)}
                              {' · '}
                              {effect.influence === 'automatic'
                                ? '自动生效'
                                : effect.influence === 'advisory'
                                  ? '仅提示'
                                  : effect.influence === 'revalidate'
                                    ? '待复验'
                                    : '已隔离'}
                              {' · '}
                              精确样本 {effect.exactSamples}
                              {' · '}
                              旧版参考 {effect.legacySamples}
                              {' · '}
                              隔离样本 {effect.excludedContextSamples}
                              {' · '}
                              新鲜 {effect.freshSamples}
                              {' · '}
                              过期 {effect.staleSamples}
                              {' · '}
                              最近证据{' '}
                              {effect.latestEvidenceAt
                                ? formatEventTime(effect.latestEvidenceAt)
                                : '—'}
                            </small>
                          ),
                        )}
                      </div>
                      {improvementStrategyQualityPolicyRevalidation.status !==
                      'idle' ? (
                        <div
                          className={`strategy-quality-policy-governance is-revalidation-${improvementStrategyQualityPolicyRevalidation.status}`}
                        >
                          <strong>
                            复验生命周期 ·{' '}
                            {improvementStrategyQualityPolicyRevalidation.status ===
                            'active'
                              ? '进行中'
                              : improvementStrategyQualityPolicyRevalidation.status ===
                                  'completed'
                                ? '已完成'
                                : improvementStrategyQualityPolicyRevalidation.status ===
                                    'failed'
                                  ? '负向停止'
                                  : improvementStrategyQualityPolicyRevalidation.status ===
                                      'expired'
                                    ? '已过期'
                                    : improvementStrategyQualityPolicyRevalidation.status ===
                                        'cancelled'
                                      ? '已取消'
                                    : improvementStrategyQualityPolicyRevalidation.status ===
                                        'context-changed'
                                      ? '上下文已变化'
                                      : '被其他发布中断'}
                          </strong>
                          {improvementStrategyQualityPolicyRevalidation.target ? (
                            <small>
                              运行 #
                              {
                                improvementStrategyQualityPolicyRevalidation.runId
                                  ?.split(':')
                                  .slice(-1)[0]
                              }
                              {' · '}
                              目标方向：{
                                improvementStrategyQualityPolicyFieldLabels[
                                  improvementStrategyQualityPolicyRevalidation
                                    .target.field
                                ]
                              }{' '}
                              {String(
                                improvementStrategyQualityPolicyRevalidation
                                  .target.from,
                              )}{' '}
                              →{' '}
                              {String(
                                improvementStrategyQualityPolicyRevalidation
                                  .target.to,
                              )}
                              {' · '}
                              阶段{' '}
                              {improvementStrategyQualityPolicyRevalidation.phase ===
                              'reset-baseline'
                                ? '恢复基线'
                                : '测量方向'}
                              {' · '}
                              进度{' '}
                              {
                                improvementStrategyQualityPolicyRevalidation
                                  .progress.collectedFreshSamples
                              }{' '}
                              /{' '}
                              {
                                improvementStrategyQualityPolicyRevalidation
                                  .progress.requiredFreshSamples
                              }
                            </small>
                          ) : null}
                          <small>
                            {
                              improvementStrategyQualityPolicyRevalidation.summary
                            }
                          </small>
                          {improvementStrategyQualityPolicyRevalidation.conclusion ? (
                            <small>
                              结论依据：
                              {
                                improvementStrategyQualityPolicyRevalidationReasonLabels[
                                  improvementStrategyQualityPolicyRevalidation
                                    .conclusion.reason
                                ]
                              }
                              {improvementStrategyQualityPolicyRevalidation
                                .conclusion.evidenceAt !== null
                                ? ` · ${formatEventTime(
                                    improvementStrategyQualityPolicyRevalidation
                                      .conclusion.evidenceAt,
                                  )}`
                                : ''}
                              {' · '}
                              {
                                improvementStrategyQualityPolicyRevalidation
                                  .conclusion.evidenceSummary
                              }
                            </small>
                          ) : null}
                          {improvementStrategyQualityPolicyRevalidation.status ===
                          'active' ? (
                            <button
                              type="button"
                              onClick={() =>
                                controlImprovementStrategyQualityPolicyRevalidation(
                                  'cancel',
                                )
                              }
                            >
                              取消复验
                            </button>
                          ) : improvementStrategyQualityPolicyRevalidation.status ===
                              'cancelled' ||
                            improvementStrategyQualityPolicyRevalidation.status ===
                              'expired' ||
                            improvementStrategyQualityPolicyRevalidation.status ===
                              'interrupted' ? (
                            <button
                              type="button"
                              onClick={() =>
                                controlImprovementStrategyQualityPolicyRevalidation(
                                  'restart',
                                )
                              }
                            >
                              重新开始复验
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {improvementStrategyQualityPolicyRevalidationHistory.runs
                        .length ? (
                        <div className="strategy-quality-effect-ledger">
                          <strong>
                            复验运行历史 ·{' '}
                            {
                              improvementStrategyQualityPolicyRevalidationHistory
                                .runs.length
                            }{' '}
                            轮
                          </strong>
                          {improvementStrategyQualityPolicyRevalidationHistory.runs
                            .slice(0, 3)
                            .map((run) => (
                              <small key={run.runId}>
                                运行 #
                                {run.runId.split(':').slice(-1)[0]}
                                {' · '}
                                {formatEventTime(run.startedAt)}
                                {' · '}
                                {
                                  improvementStrategyQualityPolicyFieldLabels[
                                    run.target.field
                                  ]
                                }{' '}
                                {String(run.target.from)} →{' '}
                                {String(run.target.to)}
                                {' · '}
                                {run.status === 'active'
                                  ? '进行中'
                                  : run.status === 'completed'
                                    ? '已完成'
                                    : run.status === 'failed'
                                      ? '负向停止'
                                      : run.status === 'cancelled'
                                        ? '已取消'
                                        : run.status === 'expired'
                                          ? '已过期'
                                          : run.status === 'context-changed'
                                            ? '上下文变化'
                                            : run.status === 'interrupted'
                                              ? '被中断'
                                              : '已被后续运行替代'}
                                {' · '}
                                {run.actions
                                  .map((action) =>
                                    action === 'measure'
                                      ? '测量'
                                      : action === 'reset-baseline'
                                        ? '恢复基线'
                                        : action === 'cancel'
                                          ? '取消'
                                          : action === 'restart'
                                            ? '重启'
                                            : action === 'completed'
                                              ? '已完成'
                                              : action === 'failed'
                                                ? '负向停止'
                                                : action === 'expired'
                                                  ? '已过期'
                                                  : action ===
                                                      'context-changed'
                                                    ? '上下文变化'
                                                    : '被中断',
                                  )
                                  .join(' → ')}
                                {run.conclusion ? (
                                  <>
                                    {' · '}
                                    {
                                      improvementStrategyQualityPolicyRevalidationReasonLabels[
                                        run.conclusion.reason
                                      ]
                                    }
                                    {run.conclusion.evidenceAt !== null
                                      ? ` @ ${formatEventTime(
                                          run.conclusion.evidenceAt,
                                        )}`
                                      : ''}
                                    {'：'}
                                    {run.conclusion.evidenceSummary}
                                  </>
                                ) : null}
                              </small>
                            ))}
                        </div>
                      ) : null}
                      {improvementStrategyQualityPolicyRevalidationAnalytics
                        .summary.totalRuns > 0 ? (
                        <div className="strategy-quality-effect-ledger">
                          <strong>
                            复验统计 ·{' '}
                            {improvementStrategyQualityPolicyRevalidationAnalytics
                              .summary.dataStatus === 'ready'
                              ? '数据可用'
                              : '样本有限'}
                          </strong>
                          <small>
                            已结论{' '}
                            {
                              improvementStrategyQualityPolicyRevalidationAnalytics
                                .summary.settledRuns
                            }{' '}
                            轮 · 策略评估{' '}
                            {
                              improvementStrategyQualityPolicyRevalidationAnalytics
                                .summary.evaluatedRuns
                            }{' '}
                            轮 · 完成率{' '}
                            {formatPercentage(
                              improvementStrategyQualityPolicyRevalidationAnalytics
                                .summary.successRate === null
                                ? null
                                : Math.round(
                                    improvementStrategyQualityPolicyRevalidationAnalytics
                                      .summary.successRate * 100,
                                  ),
                            )}
                            {' · 平均用时 '}
                            {formatRevalidationDuration(
                              improvementStrategyQualityPolicyRevalidationAnalytics
                                .summary.averageDurationMs,
                            )}
                            {' · 外部中断 '}
                            {
                              improvementStrategyQualityPolicyRevalidationAnalytics
                                .summary.externalInterruptions
                            }
                          </small>
                          {improvementStrategyQualityPolicyRevalidationAnalytics
                            .failureReasons.length ? (
                            <small>
                              未完成原因：
                              {improvementStrategyQualityPolicyRevalidationAnalytics.failureReasons
                                .map(
                                  (reason) =>
                                    `${
                                      improvementStrategyQualityPolicyRevalidationReasonLabels[
                                        reason.reason
                                      ]
                                    } ${reason.count}（${Math.round(
                                      reason.share * 100,
                                    )}%）`,
                                )
                                .join(' · ')}
                            </small>
                          ) : null}
                          {improvementStrategyQualityPolicyRevalidationAnalytics
                            .fieldRisks.length ? (
                            <small>
                              字段风险：
                              {improvementStrategyQualityPolicyRevalidationAnalytics.fieldRisks
                                .slice(0, 3)
                                .map(
                                  (risk) =>
                                    `${
                                      improvementStrategyQualityPolicyFieldLabels[
                                        risk.field
                                      ]
                                    } ${
                                      risk.riskLevel === 'high'
                                        ? '高'
                                        : risk.riskLevel === 'medium'
                                          ? '中'
                                          : '低'
                                    }风险 ${Math.round(
                                      risk.riskRate * 100,
                                    )}%（${risk.adverseRuns}/${risk.evaluatedRuns}）`,
                                )
                                .join(' · ')}
                            </small>
                          ) : null}
                          <small>
                            近期趋势：
                            {improvementStrategyQualityPolicyRevalidationAnalytics
                              .trend.dataStatus === 'insufficient'
                              ? `等待前后窗口各积累至少 ${improvementStrategyQualityPolicyRevalidationAnalytics.trend.minimumWindowRuns} 个可归因结果。`
                              : `${
                                  improvementStrategyQualityPolicyRevalidationAnalytics
                                    .trend.status === 'declining'
                                    ? '下降'
                                    : improvementStrategyQualityPolicyRevalidationAnalytics
                                          .trend.status === 'improving'
                                      ? '改善'
                                      : '稳定'
                                } · 最近 ${
                                  improvementStrategyQualityPolicyRevalidationAnalytics
                                    .trend.recent.runs
                                } 轮完成率 ${formatPercentage(
                                  improvementStrategyQualityPolicyRevalidationAnalytics
                                    .trend.recent.successRate === null
                                    ? null
                                    : Math.round(
                                        improvementStrategyQualityPolicyRevalidationAnalytics
                                          .trend.recent.successRate * 100,
                                      ),
                                )}，前窗 ${formatPercentage(
                                  improvementStrategyQualityPolicyRevalidationAnalytics
                                    .trend.baseline.successRate === null
                                    ? null
                                    : Math.round(
                                        improvementStrategyQualityPolicyRevalidationAnalytics
                                          .trend.baseline.successRate * 100,
                                      ),
                                )} · 近期平均 ${formatRevalidationDuration(
                                  improvementStrategyQualityPolicyRevalidationAnalytics
                                    .trend.recent.averageDurationMs,
                                )}`}
                          </small>
                          {improvementStrategyQualityPolicyRevalidationAnalytics
                            .trend.alerts.length ? (
                            <small>
                              趋势预警：
                              {improvementStrategyQualityPolicyRevalidationAnalytics.trend.alerts
                                .map((alert) =>
                                  alert.kind === 'success-rate-drop'
                                    ? `完成率下降 ${Math.round(
                                        Math.abs(alert.delta) * 100,
                                      )} 个百分点`
                                    : alert.kind === 'duration-increase'
                                      ? `平均耗时升至前窗 ${Math.round(
                                          alert.delta * 10,
                                        ) / 10} 倍`
                                      : `${
                                          improvementStrategyQualityPolicyFieldLabels[
                                            alert.field
                                          ]
                                        }风险上升 ${Math.round(
                                          alert.delta * 100,
                                        )} 个百分点`,
                                )
                                .join(' · ')}
                            </small>
                          ) : null}
                          {improvementStrategyQualityPolicyTrendGovernance
                            .recommendations.length ? (
                            <small>
                              治理建议：
                              {improvementStrategyQualityPolicyTrendGovernance.recommendations
                                .map((recommendation) =>
                                  recommendation.action ===
                                  'review-rollback'
                                    ? '人工审查上一稳定版本'
                                    : recommendation.action ===
                                        'investigate-duration'
                                      ? '检查复验采样与阶段耗时'
                                      : recommendation.action ===
                                          'pause-field-automation'
                                        ? `暂停${
                                            improvementStrategyQualityPolicyFieldLabels[
                                              recommendation.field
                                            ]
                                          }自动晋升`
                                        : `优先复验${
                                            improvementStrategyQualityPolicyFieldLabels[
                                              recommendation.field
                                            ]
                                          }`,
                                )
                                .join(' · ')}
                            </small>
                          ) : null}
                        </div>
                      ) : null}
                      {improvementStrategyQualityPolicyGovernance.status !==
                        'proposal-ready' &&
                      improvementStrategyQualityPolicyGovernance.status !==
                        'revalidation-ready' &&
                      improvementStrategyQualityPolicyGovernance.status !==
                        'no-change' ? (
                        <div
                          className={`strategy-quality-policy-governance is-${improvementStrategyQualityPolicyGovernance.status}`}
                        >
                          <strong>
                            变更治理 ·{' '}
                            {improvementStrategyQualityPolicyGovernance.status ===
                            'observation-pending'
                              ? '观察冷却'
                              : improvementStrategyQualityPolicyGovernance.status ===
                                  'revalidation-blocked'
                                ? '复验等待'
                              : improvementStrategyQualityPolicyGovernance.status ===
                                  'trend-field-blocked'
                                ? '字段自动化暂停'
                              : improvementStrategyQualityPolicyGovernance.status ===
                                  'trend-rollback-review'
                                ? '趋势回滚审查'
                              : improvementStrategyQualityPolicyGovernance.status ===
                                  'regression-watch'
                                ? '退化观察'
                                : improvementStrategyQualityPolicyGovernance.status ===
                                    'historical-match'
                                  ? '历史配置复用'
                                  : '优先回滚'}
                          </strong>
                          <small>
                            {
                              improvementStrategyQualityPolicyGovernance.summary
                            }
                          </small>
                          {improvementStrategyQualityGovernanceRestoreTarget ? (
                            <button
                              type="button"
                              onClick={() =>
                                restoreImprovementStrategyQualityPolicy(
                                  improvementStrategyQualityGovernanceRestoreTarget,
                                )
                              }
                            >
                              {improvementStrategyQualityPolicyGovernance.status ===
                              'historical-match'
                                ? '恢复历史'
                                : '确认回滚至'}{' '}
                              V
                              {
                                improvementStrategyQualityGovernanceRestoreTarget.version
                              }{' '}
                              配置
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {improvementStrategyQualityPolicyProposal ? (
                        <div className="strategy-quality-policy-proposal">
                          <strong>
                            {improvementStrategyQualityPolicyProposal.trigger ===
                            'revalidation'
                              ? '待审复验实验'
                              : '待审单变量实验'}{' '}
                            · V
                            {
                              improvementStrategyQualityPolicyProposal.toVersion
                            }
                          </strong>
                          {improvementStrategyQualityPolicyProposal
                            .revalidation ? (
                            <div className="strategy-quality-effect-ledger">
                              <b>
                                {improvementStrategyQualityPolicyProposal
                                  .revalidation.phase === 'reset-baseline'
                                  ? '恢复下一轮测量基线'
                                  : improvementStrategyQualityPolicyProposal
                                        .revalidation.reason === 'expired'
                                    ? '历史正向证据已过期'
                                    : '新鲜精确样本尚未达标'}
                              </b>
                              <small>
                                目标方向：{
                                  improvementStrategyQualityPolicyFieldLabels[
                                    improvementStrategyQualityPolicyProposal
                                      .revalidation.target.field
                                  ]
                                }{' '}
                                {String(
                                  improvementStrategyQualityPolicyProposal
                                    .revalidation.target.from,
                                )}{' '}
                                →{' '}
                                {String(
                                  improvementStrategyQualityPolicyProposal
                                    .revalidation.target.to,
                                )}
                                {' · '}
                                已收集{' '}
                                {
                                  improvementStrategyQualityPolicyProposal
                                    .revalidation.collectedFreshSamples
                                }{' '}
                                /{' '}
                                {
                                  improvementStrategyQualityPolicyProposal
                                    .revalidation.requiredFreshSamples
                                }{' '}
                                个；还需{' '}
                                {
                                  improvementStrategyQualityPolicyProposal
                                    .revalidation.remainingFreshSamples
                                }{' '}
                                个。
                              </small>
                              <small>
                                复验仍需人工确认发布，并继续经过影子评估、观察窗口和回滚治理。
                              </small>
                            </div>
                          ) : null}
                          {improvementStrategyQualityPolicyProposal.changes.map(
                            (change) => (
                              <small key={change.field}>
                                {
                                  improvementStrategyQualityPolicyFieldLabels[
                                    change.field
                                  ]
                                }
                                ：{String(change.from)} → {String(change.to)}
                                {' · '}
                                {change.reason}
                              </small>
                            ),
                          )}
                          {improvementStrategyQualityPolicyImpact ? (
                            <div className="strategy-quality-shadow-impact">
                              <b>
                                影子评估 ·{' '}
                                {
                                  improvementStrategyQualityPolicyImpact.sampleCount
                                }{' '}
                                个近期自研策略
                              </b>
                              {improvementStrategyQualityPolicyImpact
                                .sampleCount ? (
                                <>
                                  <small>
                                    平均分{' '}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .current.averageScore
                                    }{' '}
                                    →{' '}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .candidate.averageScore
                                    }
                                    {' · '}
                                    可执行{' '}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .current.executable
                                    }{' '}
                                    →{' '}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .candidate.executable
                                    }
                                  </small>
                                  <small>
                                    收紧{' '}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .delta.stricter
                                    }
                                    {' · '}
                                    放宽{' '}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .delta.looser
                                    }
                                    {' · '}
                                    阻断变化{' '}
                                    {improvementStrategyQualityPolicyImpact
                                      .delta.blocked >= 0
                                      ? '+'
                                      : ''}
                                    {
                                      improvementStrategyQualityPolicyImpact
                                        .delta.blocked
                                    }
                                  </small>
                                  {improvementStrategyQualityPolicyImpact.samples
                                    .filter(
                                      ({ effect }) =>
                                        effect !== 'unchanged',
                                    )
                                    .slice(0, 3)
                                    .map((sample) => (
                                      <small
                                        key={sample.assetId}
                                        className={`is-${sample.effect}`}
                                      >
                                        {sample.strategyLabel}：评分{' '}
                                        {sample.current.score} →{' '}
                                        {sample.candidate.score}
                                        {' · '}
                                        {sample.effect === 'stricter'
                                          ? '更严格'
                                          : '更宽松'}
                                      </small>
                                    ))}
                                </>
                              ) : (
                                <small>
                                  暂无可复评的活跃自研策略；可继续人工发布，但当前没有历史样本支撑影响判断。
                                </small>
                              )}
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={publishImprovementStrategyQualityPolicy}
                          >
                            {improvementStrategyQualityPolicyProposal.trigger ===
                            'revalidation'
                              ? improvementStrategyQualityPolicyProposal
                                  .revalidation?.phase === 'reset-baseline'
                                ? '确认并恢复复验基线'
                                : '确认并发布复验'
                              : '确认并发布新门禁'}
                          </button>
                        </div>
                      ) : null}
                      {improvementStrategyQualityRollbackTarget &&
                      !improvementStrategyQualityGovernanceRestoreTarget ? (
                        <div className="strategy-quality-policy-rollback">
                          <small>
                            上一版本 V
                            {
                              improvementStrategyQualityRollbackTarget.version
                            }
                            ：警告扣分{' '}
                            {
                              improvementStrategyQualityRollbackTarget
                                .warningPenalty
                            }
                            ，指令上限{' '}
                            {
                              improvementStrategyQualityRollbackTarget
                                .maxInstructionClauses
                            }
                            ，混杂实验
                            {improvementStrategyQualityRollbackTarget
                              .confoundedExecution === 'block'
                              ? '阻断'
                              : '警告'}
                          </small>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              restoreImprovementStrategyQualityPolicy(
                                improvementStrategyQualityRollbackTarget,
                              )
                            }
                          >
                            回滚至 V
                            {
                              improvementStrategyQualityRollbackTarget.version
                            }{' '}
                            配置
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {adaptiveNextSessionImprovementPlan.items.length ? (
                    <div className="next-session-improvement-items">
                      {adaptiveNextSessionImprovementPlan.items.map((item) => {
                        const nextStrategySelection =
                          selectNextImprovementStrategy(
                            improvementStrategyProjection,
                            item.id,
                          );
                        const hasStrategyEvidence =
                          improvementStrategyProjection.records.some(
                            (record) => record.improvementId === item.id,
                          );
                        const selectedStrategyId =
                          nextStrategySelection.mode === 'wait' &&
                          nextStrategySelection.strategy
                            ? nextStrategySelection.strategy.id
                            : (selectedImprovementStrategies[item.id] ??
                              (!hasStrategyEvidence &&
                              item.disposition === 'reconsider'
                                ? 'alternative-path'
                                : (nextStrategySelection.strategy?.id ??
                                  'standard')));
                        const preparedExperiment = previousSession
                          ? prepareImprovementStrategyExperiment({
                              actions: nextSessionImprovementActionEvents,
                              baseSessionId: previousSession.sessionId,
                              improvementId: item.id,
                              strategyId: selectedStrategyId,
                              strategyCatalog: improvementStrategyCatalog,
                              excludedStrategyIds:
                                improvementStrategyAssets.unavailableStrategyIds,
                            })
                          : null;
                        const effect =
                          nextSessionImprovementEffectiveness.effects.find(
                            ({ improvementId }) => improvementId === item.id,
                          );
                        const strategyEffect =
                          improvementStrategyProjection.strategies.find(
                            (entry) =>
                              entry.improvementId === item.id &&
                              entry.strategyId === selectedStrategyId,
                          );
                        const itemStrategyAssets =
                          improvementStrategyAssets.assets.filter(
                            ({ strategy }) =>
                              strategy.improvementId === item.id,
                          );
                        const strategyComposerOpen =
                          nextStrategySelection.mode === 'review' ||
                          openImprovementStrategyComposers[item.id] === true;
                        const editingStrategyAsset =
                          itemStrategyAssets.find(
                            ({ assetId }) =>
                              assetId ===
                              editingImprovementStrategyAssetIds[item.id],
                          );
                        const strategyDraft =
                          customImprovementStrategyDrafts[item.id] ??
                          createEmptyImprovementStrategyDraft();
                        const strategyQualityReview =
                          reviewImprovementStrategyDraft({
                            improvementId: item.id,
                            draft: strategyDraft,
                            strategies: improvementStrategyCatalog,
                            actions: nextSessionImprovementActionEvents,
                            baseSessionId: previousSession?.sessionId,
                            historyReady: improvementExperimentHistoryReady,
                            selection: nextStrategySelection,
                            editingStrategyId:
                              editingStrategyAsset?.strategy.id,
                            policy: improvementStrategyQualityPolicy,
                          });
                        return (
                          <article
                            key={item.id}
                            className={`is-${item.tone} is-${item.disposition}`}
                          >
                            <div>
                              <b>{item.title}</b>
                              <small>
                                {item.evidence} · {item.detail}
                              </small>
                              <small
                                className={`learning-note is-${item.disposition}`}
                              >
                                {item.learningNote}
                              </small>
                              <em
                                className={`is-${effect?.signal ?? 'insufficient'}`}
                              >
                                {effect?.summary ?? '暂无跨场效果样本'}
                              </em>
                            </div>
                            <aside className="improvement-experiment-controls">
                              <label>
                                <span>本次策略</span>
                                <select
                                  value={selectedStrategyId}
                                  disabled={
                                    nextSessionActionInFlight !== null ||
                                    !improvementExperimentHistoryReady ||
                                    nextStrategySelection.mode === 'wait' ||
                                    nextStrategySelection.mode === 'review'
                                  }
                                  onChange={(event) =>
                                    setSelectedImprovementStrategies(
                                      (current) => ({
                                        ...current,
                                        [item.id]: event.target
                                          .value as ImprovementStrategy['id'],
                                      }),
                                    )
                                  }
                                >
                                  {improvementStrategyCatalog
                                    .filter(
                                      (strategy) =>
                                        !strategy.improvementId ||
                                        strategy.improvementId === item.id,
                                    )
                                    .map((strategy) => {
                                      const historicalDecision =
                                        improvementStrategyProjection.strategies.find(
                                          (entry) =>
                                            entry.improvementId === item.id &&
                                            entry.strategyId === strategy.id,
                                        )?.decision;
                                      return (
                                        <option
                                          key={strategy.id}
                                          value={strategy.id}
                                        >
                                          {strategy.label}
                                          {strategy.origin === 'custom'
                                            ? '（自研）'
                                            : ''}
                                          {historicalDecision === 'recommended'
                                            ? '（推荐）'
                                            : historicalDecision === 'drifting'
                                              ? '（效果漂移）'
                                              : historicalDecision === 'avoid'
                                                ? '（建议停用）'
                                                : ''}
                                        </option>
                                      );
                                    })}
                                </select>
                              </label>
                              {strategyEffect ? (
                                <span
                                  className={`strategy-decision is-${strategyEffect.decision}`}
                                >
                                  {strategyEffect.decision === 'recommended'
                                    ? '推荐'
                                    : strategyEffect.decision === 'leading'
                                      ? '候选领先'
                                      : strategyEffect.decision === 'drifting'
                                        ? '效果漂移'
                                        : strategyEffect.decision === 'avoid'
                                          ? '建议停用'
                                          : '收集中'}
                                  ·
                                  {strategyEffect.confidence === 'high'
                                    ? '高置信'
                                    : strategyEffect.confidence === 'medium'
                                      ? '中置信'
                                      : '低置信'}
                                </span>
                              ) : null}
                              <span
                                className={`strategy-next-choice is-${nextStrategySelection.mode}`}
                              >
                                {!improvementExperimentHistoryReady
                                  ? nextSessionImprovementHistoryState ===
                                    'unavailable'
                                    ? '系统建议：实验历史不可用'
                                    : '系统建议：正在载入实验历史'
                                  : nextStrategySelection.mode === 'exploit'
                                    ? '系统建议：利用胜出策略'
                                    : nextStrategySelection.mode === 'wait'
                                      ? '系统建议：等待下一场复盘'
                                      : nextStrategySelection.mode ===
                                          'explore'
                                        ? `系统建议：探索${nextStrategySelection.strategy?.label ?? ''}`
                                        : '系统建议：人工设计新策略'}
                              </span>
                              <span
                                className={`strategy-evidence-progress is-${nextStrategySelection.stage}`}
                              >
                                {
                                  improvementExperimentStageLabels[
                                    nextStrategySelection.stage
                                  ]
                                }
                                {' · '}
                                证据{' '}
                                {nextStrategySelection.progress.observed +
                                  nextStrategySelection.progress.pending}
                                /{nextStrategySelection.progress.target}
                                {nextStrategySelection.progress.pending
                                  ? `（${nextStrategySelection.progress.pending} 个待观察）`
                                  : nextStrategySelection.progress.remaining
                                    ? `（还需 ${nextStrategySelection.progress.remaining} 个）`
                                    : ''}
                              </span>
                              <small
                                className={
                                  preparedExperiment?.controlled === false
                                    ? 'is-confounded'
                                    : ''
                                }
                              >
                                {strategyEffect
                                  ? `${strategyEffect.summary} ${strategyEffect.decisionSummary}`
                                  : `${nextStrategySelection.reason} ${
                                      preparedExperiment?.explanation ?? ''
                                    }`.trim()}
                              </small>
                              {itemStrategyAssets.length ? (
                                <div className="improvement-strategy-assets">
                                  <strong>自研策略资产</strong>
                                  {itemStrategyAssets.map((asset) => (
                                    <div
                                      key={asset.assetId}
                                      className={`is-${asset.status}`}
                                    >
                                      <span>
                                        {asset.strategy.label} · V
                                        {asset.version}
                                        {asset.quality
                                          ? ` · Q${asset.quality.score}`
                                          : ''}
                                        {asset.status === 'archived'
                                          ? ' · 已归档'
                                          : ''}
                                      </span>
                                      <nav>
                                        {asset.status === 'active' ? (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setCustomImprovementStrategyDrafts(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: {
                                                      label:
                                                        asset.strategy.label,
                                                      variable:
                                                        asset.strategy
                                                          .variable === 'none'
                                                          ? 'method'
                                                          : asset.strategy
                                                              .variable,
                                                      instruction:
                                                        asset.strategy
                                                          .instruction,
                                                      successSignal:
                                                        asset.strategy
                                                          .successSignal ?? '',
                                                    },
                                                  }),
                                                );
                                                setEditingImprovementStrategyAssetIds(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: asset.assetId,
                                                  }),
                                                );
                                                setCopiedFromImprovementStrategyAssetIds(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: undefined,
                                                  }),
                                                );
                                                setOpenImprovementStrategyComposers(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: true,
                                                  }),
                                                );
                                              }}
                                            >
                                              编辑
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setCustomImprovementStrategyDrafts(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: {
                                                      label: `${asset.strategy.label.slice(
                                                        0,
                                                        37,
                                                      )} 副本`,
                                                      variable:
                                                        asset.strategy
                                                          .variable === 'none'
                                                          ? 'method'
                                                          : asset.strategy
                                                              .variable,
                                                      instruction:
                                                        asset.strategy
                                                          .instruction,
                                                      successSignal:
                                                        asset.strategy
                                                          .successSignal ?? '',
                                                    },
                                                  }),
                                                );
                                                setEditingImprovementStrategyAssetIds(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: undefined,
                                                  }),
                                                );
                                                setCopiedFromImprovementStrategyAssetIds(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: asset.assetId,
                                                  }),
                                                );
                                                setOpenImprovementStrategyComposers(
                                                  (current) => ({
                                                    ...current,
                                                    [item.id]: true,
                                                  }),
                                                );
                                              }}
                                            >
                                              复制
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                changeImprovementStrategyAssetStatus(
                                                  asset,
                                                  'archive',
                                                )
                                              }
                                            >
                                              归档
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              changeImprovementStrategyAssetStatus(
                                                asset,
                                                'restore',
                                              )
                                            }
                                          >
                                            恢复
                                          </button>
                                        )}
                                      </nav>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {!strategyComposerOpen ? (
                                <button
                                  type="button"
                                  className="open-strategy-composer"
                                  onClick={() => {
                                    setCustomImprovementStrategyDrafts(
                                      (current) => ({
                                        ...current,
                                        [item.id]:
                                          createEmptyImprovementStrategyDraft(),
                                      }),
                                    );
                                    setEditingImprovementStrategyAssetIds(
                                      (current) => ({
                                        ...current,
                                        [item.id]: undefined,
                                      }),
                                    );
                                    setCopiedFromImprovementStrategyAssetIds(
                                      (current) => ({
                                        ...current,
                                        [item.id]: undefined,
                                      }),
                                    );
                                    setOpenImprovementStrategyComposers(
                                      (current) => ({
                                        ...current,
                                        [item.id]: true,
                                      }),
                                    );
                                  }}
                                >
                                  新建自研策略
                                </button>
                              ) : null}
                              {strategyComposerOpen ? (
                                <div className="improvement-strategy-composer">
                                  <strong>
                                    {editingStrategyAsset
                                      ? `编辑策略 · V${editingStrategyAsset.version + 1}`
                                      : copiedFromImprovementStrategyAssetIds[
                                            item.id
                                          ]
                                        ? '复制为新策略'
                                        : '组合一个自研策略'}
                                  </strong>
                                  <div
                                    className={`strategy-quality-summary is-${strategyQualityReview.status}`}
                                  >
                                    <header>
                                      <b>
                                        质量评分 {strategyQualityReview.score} ·
                                        V
                                        {
                                          improvementStrategyQualityPolicy.version
                                        }
                                      </b>
                                      <span>
                                        {strategyQualityReview.status ===
                                        'ready'
                                          ? '可保存'
                                          : strategyQualityReview.status ===
                                              'review'
                                            ? '建议复核'
                                            : '需要修复'}
                                      </span>
                                    </header>
                                    {strategyQualityReview.checks.map(
                                      (check) => (
                                        <p
                                          key={check.id}
                                          className={`is-${check.status}`}
                                        >
                                          <i>
                                            {check.status === 'pass'
                                              ? '✓'
                                              : check.status === 'warning'
                                                ? '!'
                                                : '×'}
                                          </i>
                                          <span>
                                            <b>{check.label}</b>
                                            {check.detail}
                                          </span>
                                        </p>
                                      ),
                                    )}
                                    <footer
                                      className={`is-${strategyQualityReview.execution.status}`}
                                    >
                                      执行预演：
                                      {strategyQualityReview.execution.detail}
                                    </footer>
                                  </div>
                                  <label>
                                    <span>策略名称</span>
                                    <input
                                      value={
                                        customImprovementStrategyDrafts[item.id]
                                          ?.label ?? ''
                                      }
                                      placeholder="例如：先验证最小链路"
                                      onChange={(event) =>
                                        setCustomImprovementStrategyDrafts(
                                          (current) => ({
                                            ...current,
                                            [item.id]: {
                                              ...(current[item.id] ??
                                                createEmptyImprovementStrategyDraft()),
                                              label: event.target.value,
                                            },
                                          }),
                                        )
                                      }
                                    />
                                    {strategyQualityReview.fieldErrors.label ? (
                                      <em>
                                        {strategyQualityReview.fieldErrors.label}
                                      </em>
                                    ) : null}
                                  </label>
                                  <label>
                                    <span>单一变量</span>
                                    <select
                                      value={
                                        customImprovementStrategyDrafts[item.id]
                                          ?.variable ?? 'method'
                                      }
                                      onChange={(event) =>
                                        setCustomImprovementStrategyDrafts(
                                          (current) => ({
                                            ...current,
                                            [item.id]: {
                                              ...(current[item.id] ??
                                                createEmptyImprovementStrategyDraft()),
                                              variable: event.target
                                                .value as ImprovementStrategyDraft['variable'],
                                            },
                                          }),
                                        )
                                      }
                                    >
                                      <option value="scope">调整范围</option>
                                      <option value="method">更换方法</option>
                                      <option value="evidence">改变证据</option>
                                      <option value="sequence">调整顺序</option>
                                    </select>
                                  </label>
                                  <label>
                                    <span>执行指令</span>
                                    <textarea
                                      value={
                                        customImprovementStrategyDrafts[item.id]
                                          ?.instruction ?? ''
                                      }
                                      placeholder="明确这次只改变什么、如何执行"
                                      onChange={(event) =>
                                        setCustomImprovementStrategyDrafts(
                                          (current) => ({
                                            ...current,
                                            [item.id]: {
                                              ...(current[item.id] ??
                                                createEmptyImprovementStrategyDraft()),
                                              instruction: event.target.value,
                                            },
                                          }),
                                        )
                                      }
                                    />
                                    {strategyQualityReview.fieldErrors
                                      .instruction ? (
                                      <em>
                                        {
                                          strategyQualityReview.fieldErrors
                                            .instruction
                                        }
                                      </em>
                                    ) : null}
                                  </label>
                                  <label>
                                    <span>成功信号</span>
                                    <input
                                      value={
                                        customImprovementStrategyDrafts[item.id]
                                          ?.successSignal ?? ''
                                      }
                                      placeholder="例如：失败项减少且无新增阻断"
                                      onChange={(event) =>
                                        setCustomImprovementStrategyDrafts(
                                          (current) => ({
                                            ...current,
                                            [item.id]: {
                                              ...(current[item.id] ??
                                                createEmptyImprovementStrategyDraft()),
                                              successSignal: event.target.value,
                                            },
                                          }),
                                        )
                                      }
                                    />
                                    {strategyQualityReview.fieldErrors
                                      .successSignal ? (
                                      <em>
                                        {
                                          strategyQualityReview.fieldErrors
                                            .successSignal
                                        }
                                      </em>
                                    ) : null}
                                  </label>
                                  <button
                                    type="button"
                                    disabled={!strategyQualityReview.canSave}
                                    onClick={() =>
                                      addCustomImprovementStrategy(item.id)
                                    }
                                  >
                                    {editingStrategyAsset
                                      ? '保存新版本'
                                      : '保存并加入实验'}
                                  </button>
                                  {nextStrategySelection.mode !== 'review' ? (
                                    <button
                                      type="button"
                                      className="is-secondary"
                                      onClick={() =>
                                        setOpenImprovementStrategyComposers(
                                          (current) => ({
                                            ...current,
                                            [item.id]: false,
                                          }),
                                        )
                                      }
                                    >
                                      取消
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              <button
                                type="button"
                                disabled={
                                  nextSessionActionInFlight !== null ||
                                  !improvementExperimentHistoryReady ||
                                  nextStrategySelection.mode === 'wait' ||
                                  nextStrategySelection.mode === 'review' ||
                                  (item.action === 'run-preflight' &&
                                    isOperatorPreflightRunning)
                                }
                                onClick={() =>
                                  void runNextSessionImprovement(
                                    item,
                                    selectedStrategyId,
                                  )
                                }
                              >
                                {nextSessionActionInFlight === item.id
                                  ? '正在执行…'
                                  : !improvementExperimentHistoryReady
                                    ? nextSessionImprovementHistoryState ===
                                      'unavailable'
                                      ? '实验历史不可用'
                                      : '加载实验历史…'
                                    : nextStrategySelection.mode === 'wait'
                                    ? '等待下一场复盘'
                                    : nextStrategySelection.mode === 'review'
                                      ? '需要新策略'
                                      : item.actionLabel}
                              </button>
                            </aside>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="next-session-improvement-clear">
                      {adaptiveNextSessionImprovementPlan.status === 'waiting'
                        ? '…'
                        : '✓'}
                    </span>
                  )}
                  {nextSessionActionFeedback ? (
                    <p className={`is-${nextSessionActionFeedback.tone}`}>
                      {nextSessionActionFeedback.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
            <div className="interaction-metrics" aria-label="主播协调器状态">
              <article>
                <strong>{props.liveHostSnapshot.phase}</strong>
                <span>主播状态</span>
              </article>
              <article>
                <strong>
                  {props.liveHostSnapshot.activeTurn?.eventId ?? '—'}
                </strong>
                <span>活动回合</span>
              </article>
              <article>
                <strong>
                  {props.liveHostSnapshot.activeTurn?.targetViewerId ?? '—'}
                </strong>
                <span>目标观众</span>
              </article>
              <article>
                <strong>{props.liveHostSnapshot.proactiveRemaining}</strong>
                <span>主动发言余额</span>
              </article>
              <article>
                <strong>
                  {runtimeHealth.runtimeOwner?.active ? '在线' : '失联'}
                </strong>
                <span>执行端心跳</span>
              </article>
              <article>
                <strong>
                  {props.liveHostSnapshot.nextProactiveAt
                    ? new Date(
                        props.liveHostSnapshot.nextProactiveAt,
                      ).toLocaleTimeString('zh-CN')
                    : '—'}
                </strong>
                <span>下次主动发言</span>
              </article>
              <article>
                <strong>
                  {props.liveHostSnapshot.currentBeatIndex === undefined
                    ? '—'
                    : `${props.liveHostSnapshot.currentBeatIndex + 1} / ${
                        props.liveHostSnapshot.currentBeatInterruptible
                          ? '可中断'
                          : '不可中断'
                      }`}
                </strong>
                <span>语音节拍</span>
              </article>
              <article>
                <strong>{props.liveHostSnapshot.recoveryCount}</strong>
                <span>恢复次数</span>
              </article>
              <article>
                <strong>{props.unsupportedAvatarActionCount}</strong>
                <span>不支持动作</span>
              </article>
              <article>
                <strong>{props.reliabilityMetrics.bindingErrors}</strong>
                <span>绑定错误拦截</span>
              </article>
              <article>
                <strong>{props.reliabilityMetrics.staleCallbacks}</strong>
                <span>迟到回调</span>
              </article>
              <article>
                <strong>
                  {props.reliabilityMetrics.proactiveRepeatSuppressions}
                </strong>
                <span>主动重复抑制</span>
              </article>
              <article>
                <strong>
                  {props.reliabilityMetrics.coordinatorRecoveries}
                </strong>
                <span>协调器卡死恢复</span>
              </article>
              <article>
                <strong>
                  {props.reliabilityMetrics.paidInvitationsLastHour}
                </strong>
                <span>近一小时付费引导</span>
              </article>
              <article>
                <strong>
                  {props.reliabilityMetrics.freeInvitationsLastHour}
                </strong>
                <span>近一小时免费引导</span>
              </article>
              <article>
                <strong>
                  {props.reliabilityMetrics.associatedSupportCount}
                </strong>
                <span>十分钟内支持关联</span>
              </article>
              <article>
                <strong>
                  ¥{props.reliabilityMetrics.associatedSupportAmount.toFixed(2)}
                </strong>
                <span>关联金额（非因果）</span>
              </article>
            </div>
            <small className="queue-age">
              最近决策：{props.liveHostSnapshot.lastDecisionReason}
            </small>
            <section className="program-director" aria-label="直播栏目导演">
              <div>
                <b>当前栏目：{liveProgram.mode}</b>
                <small>
                  {liveProgram.locked
                    ? '总控已锁定，智能体不切换栏目'
                    : '智能体按当前互动自动切换'}
                </small>
              </div>
              <div className="program-director-actions">
                {(['companion', 'variety', 'weather', 'urgent'] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      className={liveProgram.mode === mode ? 'is-active' : ''}
                      onClick={() => updateLiveProgram({ mode })}
                    >
                      {mode === 'companion'
                        ? '陪伴'
                        : mode === 'variety'
                          ? '节目'
                          : mode === 'weather'
                            ? '天气'
                            : '紧急'}
                    </button>
                  ),
                )}
                <button
                  onClick={() =>
                    updateLiveProgram({ locked: !liveProgram.locked })
                  }
                >
                  {liveProgram.locked ? '解除锁定' : '锁定栏目'}
                </button>
              </div>
            </section>
            <section
              className="program-director live-safety-console"
              aria-label="直播安全网关"
            >
              <div>
                <b>直播安全网关</b>
                <small>
                  本地静默保护数字人，不会伪装成平台禁言；高危事件请由房管在 B
                  站后台处理。
                </small>
              </div>
              <div className="live-safety-list">
                {liveSafety.viewers.length ? (
                  liveSafety.viewers.map((viewer) => (
                    <div key={viewer.viewerId} className="live-safety-viewer">
                      <span>
                        <b>{viewer.viewerName || viewer.viewerId}</b>
                        <small>
                          {viewer.sourceLabel || '未知来源'} · 风险{' '}
                          {viewer.score}
                        </small>
                      </span>
                      <span>
                        <small>
                          静默至{' '}
                          {viewer.mutedUntil
                            ? new Date(viewer.mutedUntil).toLocaleTimeString(
                                'zh-CN',
                              )
                            : '—'}
                        </small>
                        <button
                          className="quiet-action"
                          onClick={() => releaseViewerSafety(viewer.viewerId)}
                        >
                          解除本地静默
                        </button>
                      </span>
                    </div>
                  ))
                ) : (
                  <small>当前没有本地静默观众。</small>
                )}
              </div>
              {liveSafety.events[0] && (
                <small>
                  最近安全决策：{liveSafety.events[0].action} ·{' '}
                  {liveSafety.events[0].reason}
                </small>
              )}
            </section>
            <small className="queue-age">
              最近故障：
              {(
                [
                  'soul',
                  'model',
                  'skill',
                  'tts',
                  'flashhead',
                  'platform',
                ] as const
              )
                .map((kind) =>
                  runtimeHealth.lastFaults?.[kind]
                    ? `${kind}=${runtimeHealth.lastFaults[kind]?.stage}`
                    : `${kind}=—`,
                )
                .join(' · ')}
              {' · '}重复回复={runtimeHealth.repeatedReplyCount ?? 0}
            </small>
            <div className="control-room-grid">
              <section className="console-panel audience-panel">
                <div className="panel-heading">
                  <span>互动雷达</span>
                  <small>最近 {props.interactionEvents.length} 条</small>
                </div>
                <div className="source-room-board" aria-label="已接入消息来源">
                  <div className="source-room-board-heading">
                    <span>消息来源直播间</span>
                    <small>来源会随每条互动保留</small>
                  </div>
                  <div className="source-room-list">
                    {sourceRooms.map((room) => (
                      <span
                        key={room.id}
                        className={`source-room-chip is-${room.tone}`}
                      >
                        {room.label}
                      </span>
                    ))}
                  </div>
                  <div className="radar-input-row">
                    <input
                      value={radarInput}
                      placeholder="从台风 Boss 雷达发送一条观众提问…"
                      onChange={(event) => setRadarInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submitRadarInput();
                      }}
                    />
                    <button
                      type="button"
                      disabled={!radarInput.trim()}
                      onClick={submitRadarInput}
                    >
                      送入数字人
                    </button>
                  </div>
                </div>
                <div className="interaction-metrics" aria-label="互动处理概览">
                  <button
                    className={`interaction-metric-button ${queueFilter === 'active' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('active')}
                  >
                    <strong>
                      {Math.max(
                        props.queueDepth,
                        props.interactionSummary.pending,
                      )}
                    </strong>
                    <span>等待回复</span>
                  </button>
                  <button
                    className={`interaction-metric-button ${queueFilter === 'replied' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('replied')}
                  >
                    <strong>{props.operatorQueueHistorySummary.done}</strong>
                    <span>已回应</span>
                  </button>
                  <button
                    className={`interaction-metric-button ${queueFilter === 'skipped' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('skipped')}
                  >
                    <strong>{props.operatorQueueHistorySummary.skipped}</strong>
                    <span>未采用</span>
                  </button>
                  <button
                    className={`interaction-metric-button ${queueFilter === 'failed' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('failed')}
                  >
                    <strong>{props.operatorQueueHistorySummary.failed}</strong>
                    <span>执行失败</span>
                  </button>
                  <button
                    className={`interaction-metric-button ${queueFilter === 'archived' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('archived')}
                  >
                    <strong>
                      {props.operatorQueueHistorySummary.archived}
                    </strong>
                    <span>已归档</span>
                  </button>
                </div>
                <small className="queue-age">
                  {Math.max(props.queueDepth, props.interactionSummary.pending)
                    ? `最早等待 ${formatAge(props.oldestQueueAgeMs)}`
                    : '所有已接收互动都已做出处理决定'}
                </small>
                <div
                  id="operator-queue"
                  className="operator-queue"
                  aria-label="可调度的消息队列"
                >
                  {visibleQueue.length ? (
                    visibleQueue.map((item, index) => (
                      <article
                        key={item.eventId}
                        draggable={queueFilter === 'active'}
                        onDragStart={() => setDraggingQueueId(item.eventId)}
                        onDragOver={(event) => {
                          if (queueFilter === 'active') event.preventDefault();
                        }}
                        onDrop={() => {
                          if (
                            queueFilter === 'active' &&
                            draggingQueueId &&
                            draggingQueueId !== item.eventId
                          ) {
                            props.onMoveQueueItem(draggingQueueId, index);
                          }
                          setDraggingQueueId(null);
                        }}
                        onClick={() => setSelectedQueueId(item.eventId)}
                        className={`operator-queue-item is-${queueTone(item.status)} ${selectedQueueItem?.eventId === item.eventId ? 'is-selected' : ''}`}
                      >
                        {queueFilter === 'active' ? (
                          <span className="operator-drag" aria-hidden="true">
                            ⠿
                          </span>
                        ) : null}
                        <div>
                          <b>
                            {item.viewerName || '观众'} ·{' '}
                            {queueStatusLabel(item.status)}
                          </b>
                          <small className="queue-source-room">
                            {(item.sourcesSeen.length
                              ? item.sourcesSeen
                              : [item.source]
                            )
                              .map(formatSourceRoom)
                              .join(' / ')}
                          </small>
                          <p>{item.text}</p>
                        </div>
                        <button
                          className="queue-delete"
                          aria-label="删除此消息"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onDeleteQueueItem(item.eventId);
                          }}
                        >
                          删除
                        </button>
                      </article>
                    ))
                  ) : (
                    <p className="empty-state">
                      {queueFilter === 'replied'
                        ? '暂时没有已回应的消息。'
                        : queueFilter === 'skipped'
                          ? '暂时没有未采用的消息。'
                          : queueFilter === 'failed'
                            ? '暂时没有执行失败的消息。'
                            : queueFilter === 'archived'
                              ? '切换直播场次或迁移旧数据后，未完成任务会安全归档到这里。'
                              : '新互动会先进入这里，LLM 会在播报空档前准备回复。'}
                    </p>
                  )}
                </div>
                <div
                  className="message-list interaction-feed"
                  aria-live="polite"
                >
                  {props.interactionEvents.length ? (
                    props.interactionEvents.slice(0, 12).map((event) => (
                      <article
                        key={event.eventId}
                        className={`interaction-card is-${event.stage}`}
                      >
                        <header>
                          <span>{event.viewerName || '匿名观众'}</span>
                          <small>
                            {(event.sourcesSeen.length
                              ? event.sourcesSeen
                              : ['unknown']
                            )
                              .map(formatSourceRoom)
                              .join(' / ')}
                          </small>
                          <time>{formatEventTime(event.at)}</time>
                        </header>
                        <p>{event.text}</p>
                        <footer>
                          <b>{interactionStageLabels[event.stage]}</b>
                          {event.dropReason ? (
                            <small>
                              {dropReasonLabels[event.dropReason] ||
                                event.dropReason}
                            </small>
                          ) : null}
                        </footer>
                      </article>
                    ))
                  ) : (
                    <p className="empty-state">
                      互动接入后会在这里显示接收、筛选与回应结果。
                    </p>
                  )}
                </div>
                <div className="recent-broadcasts">
                  <span>最近播出</span>
                  {recentMessages
                    .filter((message) => message.role === 'assistant')
                    .slice(0, 2)
                    .map((message) => (
                      <p key={message.id}>{message.content}</p>
                    ))}
                </div>
              </section>

              <section className="console-panel program-panel">
                <div className="panel-heading">
                  <span>{selectedQueueItem ? '模型回复草稿' : '主播台词'}</span>
                  <small>
                    {selectedQueueItem
                      ? '点选左侧队列后查看与编辑'
                      : '空闲时可直接安排主播说话'}
                  </small>
                </div>
                <div className="program-stage">
                  <span className="stage-label">NOW</span>
                  <h1>{stage}</h1>
                  <p>
                    {props.partialResponse ||
                      (props.isSpeaking
                        ? `${activeDigitalHuman?.displayName || '当前主播'}正在播出当前回复。`
                        : '等待新的互动或手动播报。')}
                  </p>
                </div>
                <div className="reply-editor">
                  <div className="panel-heading">
                    <span>
                      {selectedReplyIsHistory
                        ? '回复历史'
                        : selectedQueueItem
                          ? '待播回复'
                          : '手动播报'}
                    </span>
                    <small>
                      {selectedQueueItem
                        ? selectedQueueItem.skills.length
                          ? `已使用 ${selectedQueueItem.skills.join('、')}`
                          : '未使用 Skills'
                        : '输入内容将原样进入播报队列'}
                    </small>
                  </div>
                  {selectedQueueItem && selectedReplyIsHistory ? (
                    <div className="reply-history">
                      <p className="reply-question">
                        观众消息：{selectedQueueItem.text}
                      </p>
                      <article>
                        <span>主播回复</span>
                        <p>
                          {selectedQueueItem.preparedReply ||
                            '该条回复没有保留可展示文本。'}
                        </p>
                      </article>
                      <dl>
                        <div>
                          <dt>观众等待时间</dt>
                          <dd>{formatViewerWait(selectedQueueItem)}</dd>
                        </div>
                        <div>
                          <dt>Skills</dt>
                          <dd>
                            {selectedQueueItem.skills.length
                              ? `已使用 ${selectedQueueItem.skills.join('、')}`
                              : '未使用 Skills'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ) : selectedQueueItem && selectedQueueIsSkipped ? (
                    <div className="reply-history">
                      <p className="reply-question">
                        观众消息：{selectedQueueItem.text}
                      </p>
                      <article>
                        <span>未采用原因</span>
                        <p>{skipReasonLabel(selectedQueueItem.skipReason)}</p>
                      </article>
                      <dl>
                        <div>
                          <dt>处理时间</dt>
                          <dd>
                            {formatEventTime(selectedQueueItem.updatedAt)}
                          </dd>
                        </div>
                        <div>
                          <dt>Skills</dt>
                          <dd>未调用</dd>
                        </div>
                      </dl>
                    </div>
                  ) : selectedQueueItem ? (
                    <>
                      <p className="reply-question">{selectedQueueItem.text}</p>
                      <textarea
                        value={replyDraft}
                        placeholder={
                          selectedQueueItem.status === 'preparing'
                            ? 'LLM 正在准备回复…'
                            : 'LLM 回复会显示在这里'
                        }
                        onChange={(event) => setReplyDraft(event.target.value)}
                      />
                      <button
                        disabled={!replyDraft.trim()}
                        onClick={() =>
                          props.onEditQueueReply(
                            selectedQueueItem.eventId,
                            replyDraft,
                          )
                        }
                      >
                        保存待播回复
                      </button>
                    </>
                  ) : (
                    <div className="idle-broadcast-editor">
                      <p>
                        当前没有待回复消息。输入主播接下来要说的话，发送后会直接进入现有播报队列。
                      </p>
                      <ChatInput
                        onSend={props.onBroadcast}
                        disabled={props.isProcessing}
                        placeholder="输入主播要说的话（Enter 立即播报，Shift+Enter 换行）"
                        sendLabel="安排播报"
                      />
                    </div>
                  )}
                </div>
                <div className="broadcast-pulse" aria-label="播出脉冲">
                  {['接入', '筛选', '生成', '语音', '头像', '播出'].map(
                    (label, index) => (
                      <span
                        key={label}
                        className={
                          index <
                          (props.isSpeaking ? 6 : props.isProcessing ? 3 : 1)
                            ? 'is-complete'
                            : ''
                        }
                      >
                        {label}
                      </span>
                    ),
                  )}
                </div>
              </section>

              <section className="console-panel system-panel">
                <div className="panel-heading">
                  <span>运行预览</span>
                  <small>{props.settings.tts.engine}</small>
                </div>
                <div className="avatar-preview">
                  <AvatarBackground
                    mouthLevel={props.mouthLevel}
                    voiceLevel={props.voiceLevel}
                    isSpeaking={props.isSpeaking}
                    avatarPackage={props.avatarPackage}
                    avatarReaction={props.avatarReaction}
                    idleMotionEnabled={props.settings.visual.idleMotionEnabled}
                    avatarViewTransform={props.avatarViewTransform}
                    onAvatarViewTransformChange={
                      props.onAvatarViewTransformChange
                    }
                    avatarMotion={props.avatarMotion}
                    usePersonaLiveAvatar
                    speakingAvatarVideoUrl={props.speakingAvatarVideoUrl}
                  />
                </div>
                <dl className="health-list">
                  <div>
                    <dt>LLM</dt>
                    <dd>就绪 · {props.settings.llm.model}</dd>
                  </div>
                  <div>
                    <dt>TTS</dt>
                    <dd>
                      {props.isSpeaking ? '播放中' : '就绪'} ·{' '}
                      {props.settings.tts.speaker || '未选择音色'}
                    </dd>
                  </div>
                  <div>
                    <dt>头像</dt>
                    <dd>{props.isSpeaking ? '渲染中' : '待命'}</dd>
                  </div>
                  <div>
                    <dt>消息总线</dt>
                    <dd className={`health-${props.socialBusHealth}`}>
                      {props.socialBusHealth === 'connected'
                        ? 'SSN 已连接'
                        : props.socialBusHealth === 'disabled'
                          ? '未启用'
                          : props.socialBusHealth}
                    </dd>
                  </div>
                </dl>
                <aside className="broadcast-sidebar" aria-label="播出调度">
                  <div className="panel-heading">
                    <span>当前播出</span>
                    <small>{props.isSpeaking ? '播出中' : '待命'}</small>
                  </div>
                  <div className="sidebar-now">
                    <b>{stage}</b>
                    <p>
                      {props.partialResponse ||
                        (props.isSpeaking
                          ? `${activeDigitalHuman?.displayName || '当前主播'}正在播出回复。`
                          : '暂时没有正在播出的内容。')}
                    </p>
                  </div>
                  <div className="panel-heading next-reply-heading">
                    <span>下一个待播回复</span>
                    <small>
                      {
                        props.operatorQueue.filter(
                          (item) => item.status === 'ready',
                        ).length
                      }{' '}
                      条已准备
                    </small>
                  </div>
                  <div className="sidebar-next-replies">
                    {props.operatorQueue
                      .filter((item) => item.status === 'ready')
                      .slice(0, 3)
                      .map((item) => (
                        <article key={item.eventId}>
                          <small>
                            {item.viewerName || '观众'} ·{' '}
                            {item.skills.length
                              ? `已使用 ${item.skills.join('、')}`
                              : '未使用 Skills'}
                          </small>
                          <p>{item.preparedReply || '等待 LLM 回复'}</p>
                        </article>
                      ))}
                    {!props.operatorQueue.some(
                      (item) => item.status === 'ready',
                    ) && <p className="empty-state">暂无已准备的待播回复。</p>}
                  </div>
                </aside>
              </section>
            </div>
          </>
        )}

        {workspace === 'memory' && (
          <section className="workspace-card memory-audit-workspace">
            <div className="workspace-heading">
              <div>
                <span className="stage-label">MEMORY AUDIT</span>
                <h1>跨数字人记忆审计</h1>
              </div>
              <small>{props.memory.records.length} 条记忆痕迹</small>
            </div>
            <p>
              这里观察所有数字人的记忆流动：短时经历等待睡眠整理，有意义的部分进入长时记忆，低价值内容逐渐模糊和遗忘。
            </p>
            <div className="memory-audit-stats">
              <article>
                <span>短时记忆</span>
                <strong>
                  {
                    props.memory.records.filter(
                      (record) =>
                        record.memoryTier === 'short_term' &&
                        record.phase !== 'forgotten',
                    ).length
                  }
                </strong>
                <small>仍在本场意识中</small>
              </article>
              <article>
                <span>长时记忆</span>
                <strong>
                  {
                    props.memory.records.filter(
                      (record) => record.phase === 'long_term',
                    ).length
                  }
                </strong>
                <small>可按线索主动召回</small>
              </article>
              <article>
                <span>正在模糊</span>
                <strong>
                  {
                    props.memory.records.filter(
                      (record) =>
                        record.phase === 'fading' || record.phase === 'dormant',
                    ).length
                  }
                </strong>
                <small>需要强刺激才能唤醒</small>
              </article>
              <article>
                <span>已经遗忘</span>
                <strong>
                  {
                    props.memory.records.filter(
                      (record) => record.phase === 'forgotten',
                    ).length
                  }
                </strong>
                <small>仅保留审计痕迹</small>
              </article>
            </div>
            <section
              className="commitment-radar"
              aria-labelledby="commitment-radar-title"
            >
              <header>
                <div>
                  <span className="stage-label">COMMITMENT RADAR</span>
                  <h2 id="commitment-radar-title">承诺雷达</h2>
                  <p>从现有记忆中提取承诺、期限和下一步，无需重复维护任务。</p>
                </div>
                <div className="commitment-radar-header-actions">
                  <strong>{commitmentRadar.summary.open} 项待兑现</strong>
                  <button
                    type="button"
                    onClick={() => {
                      const digitalHumanId =
                        props.settings.digitalHumans.activeId ||
                        props.settings.digitalHumans.profiles[0]?.id;
                      if (!digitalHumanId) {
                        setCommitmentFeedback({
                          tone: 'error',
                          message: '请先创建一个数字人，再新增承诺。',
                        });
                        return;
                      }
                      setCommitmentDraft({
                        value: createEmptyCommitmentDraft(digitalHumanId),
                      });
                      setCommitmentDraftErrors({});
                      setCommitmentFeedback(null);
                    }}
                  >
                    新增承诺
                  </button>
                </div>
              </header>
              <div className="commitment-radar-stats" aria-label="承诺概览">
                <span className="is-overdue">
                  逾期 <strong>{commitmentRadar.summary.overdue}</strong>
                </span>
                <span className="is-due-soon">
                  7 日内 <strong>{commitmentRadar.summary.dueSoon}</strong>
                </span>
                <span>
                  推进中 <strong>{commitmentRadar.summary.open}</strong>
                </span>
                <span className="is-completed">
                  已完成 <strong>{commitmentRadar.summary.completed}</strong>
                </span>
              </div>
              <div className="commitment-radar-filters">
                <div role="group" aria-label="筛选承诺状态">
                  {(
                    [
                      [
                        'attention',
                        `需关注 ${commitmentRadar.summary.attention}`,
                      ],
                      ['open', `待兑现 ${commitmentRadar.summary.open}`],
                      [
                        'snoozed',
                        `稍后提醒 ${commitmentRadar.summary.snoozed}`,
                      ],
                      [
                        'completed',
                        `已完成 ${commitmentRadar.summary.completed}`,
                      ],
                      ['all', `全部 ${commitmentRadar.summary.total}`],
                    ] as Array<[CommitmentFilter, string]>
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      className={commitmentFilter === value ? 'is-active' : ''}
                      key={value}
                      onClick={() => setCommitmentFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label>
                  数字人
                  <select
                    value={commitmentOwnerFilter}
                    onChange={(event) =>
                      setCommitmentOwnerFilter(event.target.value)
                    }
                  >
                    <option value="all">全部数字人</option>
                    {props.settings.digitalHumans.profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {commitmentDraft && (
                <form
                  className="commitment-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveCommitmentDraft();
                  }}
                >
                  <header>
                    <div>
                      <span>
                        {commitmentDraft.recordId
                          ? 'EDIT COMMITMENT'
                          : 'NEW COMMITMENT'}
                      </span>
                      <strong>
                        {commitmentDraft.recordId ? '编辑承诺' : '新增承诺'}
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCommitmentDraft(null);
                        setCommitmentDraftErrors({});
                      }}
                    >
                      取消
                    </button>
                  </header>
                  <div className="commitment-editor-fields">
                    <label>
                      数字人
                      <select
                        value={commitmentDraft.value.digitalHumanId}
                        disabled={Boolean(commitmentDraft.recordId)}
                        onChange={(event) =>
                          updateCommitmentDraft({
                            digitalHumanId: event.target.value,
                          })
                        }
                      >
                        {props.settings.digitalHumans.profiles.map(
                          (profile) => (
                            <option value={profile.id} key={profile.id}>
                              {profile.displayName}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      承诺标题
                      <input
                        value={commitmentDraft.value.title}
                        onChange={(event) =>
                          updateCommitmentDraft({ title: event.target.value })
                        }
                        aria-invalid={Boolean(commitmentDraftErrors.title)}
                      />
                      {commitmentDraftErrors.title && (
                        <small>{commitmentDraftErrors.title}</small>
                      )}
                    </label>
                    <label>
                      承诺对象
                      <input
                        value={commitmentDraft.value.beneficiary}
                        placeholder="观众、运营团队或具体对象"
                        onChange={(event) =>
                          updateCommitmentDraft({
                            beneficiary: event.target.value,
                          })
                        }
                        aria-invalid={Boolean(
                          commitmentDraftErrors.beneficiary,
                        )}
                      />
                      {commitmentDraftErrors.beneficiary && (
                        <small>{commitmentDraftErrors.beneficiary}</small>
                      )}
                    </label>
                    <label>
                      当前进度
                      <select
                        value={commitmentDraft.value.progress}
                        onChange={(event) =>
                          updateCommitmentDraft({
                            progress: event.target.value,
                          })
                        }
                      >
                        <option value="待开始">待开始</option>
                        <option value="进行中">进行中</option>
                        <option value="已完成">已完成</option>
                      </select>
                    </label>
                    <label>
                      截止时间
                      <input
                        value={commitmentDraft.value.deadline}
                        placeholder="YYYY-MM-DD 或长期有效"
                        onChange={(event) =>
                          updateCommitmentDraft({
                            deadline: event.target.value,
                          })
                        }
                        aria-invalid={Boolean(commitmentDraftErrors.deadline)}
                      />
                      {commitmentDraftErrors.deadline && (
                        <small>{commitmentDraftErrors.deadline}</small>
                      )}
                    </label>
                    <label>
                      可见范围
                      <select
                        value={commitmentDraft.value.visibility}
                        onChange={(event) =>
                          updateCommitmentDraft({
                            visibility: event.target
                              .value as CommitmentDraft['visibility'],
                          })
                        }
                      >
                        <option value="internal">仅内部使用</option>
                        <option value="public">可公开播报</option>
                        <option value="private">私密，不进入播出召回</option>
                      </select>
                    </label>
                    <label className="is-wide">
                      下一步行动
                      <textarea
                        value={commitmentDraft.value.nextAction}
                        onChange={(event) =>
                          updateCommitmentDraft({
                            nextAction: event.target.value,
                          })
                        }
                        aria-invalid={Boolean(commitmentDraftErrors.nextAction)}
                      />
                      {commitmentDraftErrors.nextAction && (
                        <small>{commitmentDraftErrors.nextAction}</small>
                      )}
                    </label>
                    <label className="is-wide">
                      完成证据
                      <input
                        value={commitmentDraft.value.completionEvidence}
                        placeholder="如何判断承诺已经兑现"
                        onChange={(event) =>
                          updateCommitmentDraft({
                            completionEvidence: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="is-wide commitment-importance">
                      <span>
                        重要度
                        <strong>{commitmentDraft.value.importance}</strong>
                      </span>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={commitmentDraft.value.importance}
                        onChange={(event) =>
                          updateCommitmentDraft({
                            importance: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <footer>
                    <small>
                      只有“可公开播报”的未完成承诺，才允许手动加入播报队列。
                    </small>
                    <button type="submit" disabled={commitmentSaving}>
                      {commitmentSaving ? '正在保存…' : '保存承诺'}
                    </button>
                  </footer>
                </form>
              )}
              <div className="commitment-radar-list">
                {visibleCommitments.slice(0, 12).map((item) => {
                  const owner = props.settings.digitalHumans.profiles.find(
                    (profile) => profile.id === item.digitalHumanId,
                  );
                  const completed = item.urgency === 'completed';
                  const record = props.memory.records.find(
                    ({ id }) => id === item.id,
                  );
                  return (
                    <article
                      className={`is-${item.urgency} ${item.isSnoozed ? 'is-snoozed' : ''}`}
                      key={item.id}
                    >
                      <div className="commitment-radar-item-heading">
                        <span>{owner?.displayName || item.digitalHumanId}</span>
                        <mark>
                          {item.isSnoozed
                            ? '明日提醒'
                            : commitmentUrgencyLabels[item.urgency]}
                        </mark>
                      </div>
                      <strong>{item.title}</strong>
                      <p>{item.nextAction}</p>
                      <small>
                        {item.deadline
                          ? `截止 ${item.deadline}`
                          : '尚未设置明确截止时间'}
                        {item.beneficiary
                          ? ` · 对 ${item.beneficiary} 的承诺`
                          : ''}
                        {item.isSnoozed && item.remindAfter
                          ? ` · ${new Date(item.remindAfter).toLocaleString(
                              'zh-CN',
                              {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              },
                            )} 恢复提醒`
                          : ''}
                      </small>
                      <div className="commitment-radar-item-actions">
                        <button
                          type="button"
                          onClick={() => {
                            if (!record) return;
                            setCommitmentDraft({
                              recordId: record.id,
                              value: commitmentDraftFromRecord(record),
                            });
                            setCommitmentDraftErrors({});
                            setCommitmentFeedback(null);
                          }}
                        >
                          编辑
                        </button>
                        {!completed && (
                          <button
                            type="button"
                            disabled={commitmentCompletingId !== null}
                            onClick={() => void completeCommitment(item.id)}
                          >
                            {commitmentCompletingId === item.id
                              ? '正在保存…'
                              : '标记完成'}
                          </button>
                        )}
                        {!completed && (
                          <button
                            type="button"
                            disabled={commitmentReminderInFlight !== null}
                            onClick={() =>
                              void updateCommitmentReminder(
                                item.id,
                                item.isSnoozed ? 'resume' : 'tomorrow',
                              )
                            }
                          >
                            {commitmentReminderInFlight === item.id
                              ? '正在保存…'
                              : item.isSnoozed
                                ? '恢复提醒'
                                : '明天提醒'}
                          </button>
                        )}
                        {!completed && record?.visibility === 'public' && (
                          <button
                            type="button"
                            onClick={() => enqueueCommitmentBroadcast(item.id)}
                          >
                            加入播报队列
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!visibleCommitments.length && (
                  <p className="empty-state">
                    当前筛选下没有承诺。可调整状态或数字人筛选。
                  </p>
                )}
              </div>
              {commitmentFeedback && (
                <p
                  className={`commitment-radar-feedback is-${commitmentFeedback.tone}`}
                  role={
                    commitmentFeedback.tone === 'error' ? 'alert' : 'status'
                  }
                >
                  {commitmentFeedback.message}
                </p>
              )}
            </section>
            <div className="memory-audit-queue">
              {[...props.memory.records]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 12)
                .map((record) => {
                  const owner = props.settings.digitalHumans.profiles.find(
                    (profile) => profile.id === record.digitalHumanId,
                  );
                  return (
                    <article key={record.id}>
                      <span>{owner?.displayName || record.digitalHumanId}</span>
                      <strong>{record.title}</strong>
                      <p>{record.content}</p>
                      <small>
                        {record.phase === 'sleep_queue'
                          ? '等待睡眠'
                          : record.phase === 'long_term'
                            ? '长时记忆'
                            : record.phase === 'forgotten'
                              ? '已经遗忘'
                              : record.phase === 'now'
                                ? '此刻印象'
                                : record.phase === 'dormant'
                                  ? '已经沉睡'
                                  : '正在模糊'}{' '}
                        · {record.subjectName}
                      </small>
                    </article>
                  );
                })}
              {!props.memory.records.length && (
                <p className="empty-state">还没有可审计的记忆记录。</p>
              )}
            </div>
            <div className="digital-human-actions">
              <button onClick={() => setWorkspace('avatars')}>
                进入数字人档案台
              </button>
              <button onClick={props.onOpenLegacySettings}>
                导入或导出记忆
              </button>
            </div>
          </section>
        )}
        {workspace === 'simulator' && (
          <Suspense fallback={workspacePanelFallback}>
            <SimulatorRoomConsole onEmit={props.onSimulateLiveRoomEvent} />
          </Suspense>
        )}
        {workspace === 'insights' && (
          <section className="workspace-card broadcast-strategy-workspace">
            <div className="workspace-heading">
              <div>
                <span className="stage-label">BROADCAST STRATEGY</span>
                <h1>播送策略</h1>
              </div>
              <p>管理主播何时主动开口，以及静息时从哪里获得自然的话题。</p>
            </div>
            <Suspense fallback={workspacePanelFallback}>
              <SoulInspectorPanel {...props.soulInspector} />
            </Suspense>
            <div className="awareness-control-panel">
              <header>
                <div>
                  <span>EMPTY ROOM PULSE</span>
                  <strong>空场意识</strong>
                </div>
                <label className="awareness-master-switch">
                  <input
                    type="checkbox"
                    checked={props.settings.emptyRoomAwareness.enabled}
                    onChange={(event) =>
                      props.onUpdateEmptyRoomAwareness({
                        enabled: event.target.checked,
                      })
                    }
                  />
                  {props.settings.emptyRoomAwareness.enabled
                    ? '已启用'
                    : '已关闭'}
                </label>
              </header>
              <p>
                没有弹幕互动时，主播会偶尔自然说出一个生活化念头。弹幕、礼物、进场等互动会重新计时；安静至少两分钟后才可能触发。
              </p>
              <div className="awareness-strategy-grid" hidden>
                <label>
                  观众条件
                  <select
                    value={props.settings.emptyRoomAwareness.audiencePolicy}
                    onChange={(event) =>
                      props.onUpdateEmptyRoomAwareness({
                        audiencePolicy: event.target.value as
                          | 'any'
                          | 'empty_only'
                          | 'audience_only',
                      })
                    }
                  >
                    <option value="any">不限制在场状态</option>
                    <option value="empty_only">仅无人时自语</option>
                    <option value="audience_only">仅有人在场时主动搭话</option>
                  </select>
                </label>
                <label>
                  口播长度
                  <select
                    value={props.settings.emptyRoomAwareness.maxSentences}
                    onChange={(event) =>
                      props.onUpdateEmptyRoomAwareness({
                        maxSentences: Number(event.target.value) as 1 | 2 | 3,
                      })
                    }
                  >
                    <option value="1">一句，简短出现</option>
                    <option value="2">最多两句，默认</option>
                    <option value="3">最多三句，更完整</option>
                  </select>
                </label>
              </div>
              <div className="awareness-schedule">
                <label className="awareness-master-switch">
                  <input
                    type="checkbox"
                    checked={props.settings.emptyRoomAwareness.scheduleEnabled}
                    onChange={(event) =>
                      props.onUpdateEmptyRoomAwareness({
                        scheduleEnabled: event.target.checked,
                      })
                    }
                  />
                  只在指定时段触发
                </label>
                <div className="awareness-schedule-hours">
                  <label>
                    开始
                    <select
                      disabled={
                        !props.settings.emptyRoomAwareness.scheduleEnabled
                      }
                      value={
                        props.settings.emptyRoomAwareness.scheduleStartHour
                      }
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          scheduleStartHour: Number(event.target.value),
                        })
                      }
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>至</span>
                  <label>
                    结束
                    <select
                      disabled={
                        !props.settings.emptyRoomAwareness.scheduleEnabled
                      }
                      value={props.settings.emptyRoomAwareness.scheduleEndHour}
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          scheduleEndHour: Number(event.target.value),
                        })
                      }
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {String(hour).padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <small>
                  开始与结束设为同一小时，表示全天允许；跨午夜时段也会正确生效。
                </small>
              </div>
              <div className="awareness-window">
                <label>
                  最短间隔
                  <span>
                    <input
                      type="number"
                      min="2"
                      max="60"
                      value={Math.round(
                        props.settings.emptyRoomAwareness.minIntervalMs /
                          60_000,
                      )}
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          minIntervalMs:
                            Number(event.target.value || 2) * 60_000,
                        })
                      }
                    />
                    分钟
                  </span>
                </label>
                <div className="awareness-window-rail" aria-hidden="true">
                  <i />
                  <span>随机触发窗口</span>
                  <i />
                </div>
                <label>
                  最长间隔
                  <span>
                    <input
                      type="number"
                      min="2"
                      max="60"
                      value={Math.round(
                        props.settings.emptyRoomAwareness.maxIntervalMs /
                          60_000,
                      )}
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          maxIntervalMs:
                            Number(event.target.value || 2) * 60_000,
                        })
                      }
                    />
                    分钟
                  </span>
                </label>
              </div>
              <div className="awareness-window">
                <label>
                  每次冷却
                  <span>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={Math.round(
                        props.settings.emptyRoomAwareness.proactiveCooldownMs /
                          60_000,
                      )}
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          proactiveCooldownMs:
                            Number(event.target.value || 1) * 60_000,
                        })
                      }
                    />
                    分钟
                  </span>
                </label>
                <label>
                  单场上限
                  <span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={
                        props.settings.emptyRoomAwareness.maxProactiveTurns
                      }
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          maxProactiveTurns: Number(event.target.value || 1),
                        })
                      }
                    />
                    次
                  </span>
                </label>
              </div>
              {soulOwnsQuietRoomBehavior ? (
                <section
                  className="behavior-strategy-list"
                  aria-label="Soul 自主静息决策"
                >
                  <div className="behavior-strategy-heading">
                    <div>
                      <span>SOUL AUTONOMY</span>
                      <strong>静息行动由目标与评价决定</strong>
                    </div>
                  </div>
                  <p>
                    当前模式只产生一次中性的安静时段机会事件。旧行为策略轮盘、固定人格动力和计数
                    CTA 均不参与决策；Soul
                    可以主动开题、调整注意力、延迟，或有理由地继续沉默。下方旧策略仍保存在
                    Legacy / Shadow 回滚配置中，但此处不执行。
                  </p>
                </section>
              ) : (
                <section
                  className="behavior-strategy-list"
                  aria-label="静息行为策略"
                >
                  <div className="behavior-strategy-heading">
                    <div>
                      <span>BEHAVIOR LIBRARY</span>
                      <strong>静息时主动做什么</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        props.onUpdateEmptyRoomAwareness({
                          behaviorStrategies: [
                            ...props.settings.emptyRoomAwareness
                              .behaviorStrategies,
                            {
                              id: createEmptyRoomStrategyId(),
                              name: '新行为策略',
                              prompt:
                                '描述这一次静息时希望数字人主动做什么，以及需要遵守的边界。',
                              probability: 10,
                              enabled: true,
                            },
                          ],
                        })
                      }
                    >
                      添加策略
                    </button>
                  </div>
                  <p>
                    每次触发会从已启用、概率大于 0
                    的策略中按比例选一条，并将其作为{' '}
                    <code>&lt;behavior_strategy&gt;</code>{' '}
                    模块插入完整静息提示词。
                  </p>
                  {props.settings.emptyRoomAwareness.behaviorStrategies.map(
                    (strategy) => (
                      <article
                        className="behavior-strategy-card"
                        key={strategy.id}
                      >
                        <div className="behavior-strategy-card-header">
                          <label className="awareness-master-switch">
                            <input
                              type="checkbox"
                              checked={strategy.enabled}
                              onChange={(event) =>
                                props.onUpdateEmptyRoomAwareness({
                                  behaviorStrategies:
                                    props.settings.emptyRoomAwareness.behaviorStrategies.map(
                                      (item) =>
                                        item.id === strategy.id
                                          ? {
                                              ...item,
                                              enabled: event.target.checked,
                                            }
                                          : item,
                                    ),
                                })
                              }
                            />
                            {strategy.enabled ? '已启用' : '已停用'}
                          </label>
                          <button
                            type="button"
                            className="behavior-strategy-delete"
                            aria-label={`删除策略：${strategy.name}`}
                            onClick={() =>
                              props.onUpdateEmptyRoomAwareness({
                                behaviorStrategies:
                                  props.settings.emptyRoomAwareness.behaviorStrategies.filter(
                                    (item) => item.id !== strategy.id,
                                  ),
                              })
                            }
                          >
                            删除
                          </button>
                        </div>
                        <label>
                          行为策略名
                          <input
                            value={strategy.name}
                            maxLength={80}
                            onChange={(event) =>
                              props.onUpdateEmptyRoomAwareness({
                                behaviorStrategies:
                                  props.settings.emptyRoomAwareness.behaviorStrategies.map(
                                    (item) =>
                                      item.id === strategy.id
                                        ? { ...item, name: event.target.value }
                                        : item,
                                  ),
                              })
                            }
                          />
                        </label>
                        <label>
                          策略提示词
                          <textarea
                            value={strategy.prompt}
                            maxLength={1600}
                            rows={4}
                            onChange={(event) =>
                              props.onUpdateEmptyRoomAwareness({
                                behaviorStrategies:
                                  props.settings.emptyRoomAwareness.behaviorStrategies.map(
                                    (item) =>
                                      item.id === strategy.id
                                        ? {
                                            ...item,
                                            prompt: event.target.value,
                                          }
                                        : item,
                                  ),
                              })
                            }
                          />
                        </label>
                        <label className="behavior-strategy-probability">
                          <span>
                            行为概率 <strong>{strategy.probability}%</strong>
                          </span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={strategy.probability}
                            onChange={(event) =>
                              props.onUpdateEmptyRoomAwareness({
                                behaviorStrategies:
                                  props.settings.emptyRoomAwareness.behaviorStrategies.map(
                                    (item) =>
                                      item.id === strategy.id
                                        ? {
                                            ...item,
                                            probability: Number(
                                              event.target.value,
                                            ),
                                          }
                                        : item,
                                  ),
                              })
                            }
                          />
                        </label>
                      </article>
                    ),
                  )}
                </section>
              )}
              <div className="awareness-sources" hidden>
                {(
                  [
                    ['interfaceWeight', '当前界面'],
                    ['memoryWeight', '睡眠记忆'],
                    ['inspirationWeight', '灵感种子'],
                    ['audienceWeight', '观众寒暄'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>
                      {label}
                      <strong>{props.settings.emptyRoomAwareness[key]}</strong>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={props.settings.emptyRoomAwareness[key]}
                      onChange={(event) =>
                        props.onUpdateEmptyRoomAwareness({
                          [key]: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <small>
                {soulOwnsQuietRoomBehavior
                  ? '时间窗口只决定何时重新评价，不保证开口；行动与台词由 Soul Runtime 独立仲裁。'
                  : '权重只控制话题来源；实际口播仍由当前数字人的人设与实时提示词生成。'}
              </small>
            </div>
            <div className="digital-human-actions">
              <button onClick={props.onOpenLegacySettings}>打开节目配置</button>
            </div>
          </section>
        )}
        {workspace === 'pipeline' && (
          <Suspense fallback={workspacePanelFallback}>
            <BroadcastTopologyPanel
              records={pipelineLatencyRecords}
              queue={props.operatorQueue}
              health={runtimeHealth}
              events={pipelineRuntimeEvents}
              onOpenModelSettings={props.onOpenLegacySettings}
            />
          </Suspense>
        )}
        {workspace === 'config' && (
          <section className="workspace-card config-workspace">
            <div className="connector-workspace-heading">
              <div>
                <span>LIVE SIGNAL ROUTER</span>
                <h1>直播信号路由台</h1>
              </div>
              <p>
                两个连接器同级运行；每个平台只允许一个连接器接管，所有事件共用回复、TTS
                与数字人链路。
              </p>
            </div>
            <LiveConnectorConsole
              settings={props.settings.liveConnectors}
              ordinaryRoadStatus={props.ordinaryRoadStatus}
              socialBusHealth={props.socialBusHealth}
              socialBusError={props.socialBusError}
              socialDiscoveredPlatforms={props.socialDiscoveredPlatforms}
              onChange={props.onUpdateLiveConnectors}
            />
          </section>
        )}
      </section>
    </main>
  );
}
