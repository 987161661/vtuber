import { useEffect, useMemo, useState } from 'react';
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
import type { OperatorQueueItem } from '../lib/operatorQueue';
import {
  fetchMinimaxVoiceOptions,
  type MinimaxVoiceOption,
} from '../lib/minimaxVoicePreview';
import type { StressRunState } from './StressTestPanel';
import { LiveConnectorConsole } from './LiveConnectorConsole';
import { SimulatorRoomConsole } from './SimulatorRoomConsole';
import {
  BroadcastTopologyPanel,
  type BroadcastRuntimeHealth,
} from './BroadcastTopologyPanel';
import {
  SoulInspectorPanel,
  type SoulInspectorPanelProps,
} from './SoulInspectorPanel';
import type { LiveHostSnapshot } from '@aituber-onair/live-companion';

type Workspace =
  | 'avatars'
  | 'overview'
  | 'simulator'
  | 'memory'
  | 'insights'
  | 'pipeline'
  | 'config';

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
  autoBroadcastEnabled: boolean;
  onToggleAutoBroadcast: () => void;
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
  repeatedReplyCount?: number;
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
  const [workspace, setWorkspace] = useState<Workspace>('overview');
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
  const [pipelineLatencyRecords, setPipelineLatencyRecords] = useState<
    PipelineLatencyRecord[]
  >([]);
  const [pipelineRuntimeEvents, setPipelineRuntimeEvents] = useState<
    PipelineRuntimeEvent[]
  >([]);
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
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetch('/api/live-runtime-health', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : {}))
        .then((health: RuntimeHealth) => {
          if (!cancelled) setRuntimeHealth(health);
        })
        .catch(() => undefined);
    };
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
      void fetch('/api/live-runtime-events?history=1&limit=80', {
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { events?: PipelineRuntimeEvent[] } | null) => {
          if (!cancelled && Array.isArray(payload?.events))
            setPipelineRuntimeEvents(payload.events);
        })
        .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 600);
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
    'active' | 'replied' | 'skipped' | 'failed'
  >('active');
  const visibleQueue = useMemo(() => {
    const matching = props.operatorQueue.filter((item) => {
      if (queueFilter === 'replied') return item.status === 'done';
      if (queueFilter === 'skipped') return item.status === 'skipped';
      if (queueFilter === 'failed') return item.status === 'failed';
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
  }, [props.operatorQueue, queueFilter]);
  const selectedQueueItem =
    visibleQueue.find((item) => item.eventId === selectedQueueId) ??
    visibleQueue[0];
  const selectedReplyIsHistory = selectedQueueItem?.status === 'done';
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
        <div className="control-room-pulse" aria-label={`当前状态：${stage}`}>
          <span
            className={`pulse-dot ${props.isSpeaking || props.isProcessing ? 'is-live' : ''}`}
          />
          {stage}
        </div>
        <div className="control-room-actions">
          <div className="auto-broadcast-stack">
            <button
              className={props.autoBroadcastEnabled ? 'is-armed' : ''}
              onClick={props.onToggleAutoBroadcast}
            >
              {props.autoBroadcastEnabled
                ? '自动播出：已启用'
                : '自动播出：已暂停'}
            </button>
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
              {(['soul', 'model', 'skill', 'tts', 'flashhead', 'platform'] as const)
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
                    <strong>
                      {
                        props.operatorQueue.filter(
                          (item) => item.status === 'done',
                        ).length
                      }
                    </strong>
                    <span>已回应</span>
                  </button>
                  <button
                    className={`interaction-metric-button ${queueFilter === 'skipped' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('skipped')}
                  >
                    <strong>
                      {
                        props.operatorQueue.filter(
                          (item) => item.status === 'skipped',
                        ).length
                      }
                    </strong>
                    <span>未采用</span>
                  </button>
                  <button
                    className={`interaction-metric-button ${queueFilter === 'failed' ? 'is-active' : ''}`}
                    onClick={() => setQueueFilter('failed')}
                  >
                    <strong>
                      {
                        props.operatorQueue.filter(
                          (item) => item.status === 'failed',
                        ).length
                      }
                    </strong>
                    <span>执行失败</span>
                  </button>
                </div>
                <small className="queue-age">
                  {Math.max(props.queueDepth, props.interactionSummary.pending)
                    ? `最早等待 ${formatAge(props.oldestQueueAgeMs)}`
                    : '所有已接收互动都已做出处理决定'}
                </small>
                <div className="operator-queue" aria-label="可调度的消息队列">
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
          <SimulatorRoomConsole onEmit={props.onSimulateLiveRoomEvent} />
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
            <SoulInspectorPanel {...props.soulInspector} />
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
          <BroadcastTopologyPanel
            records={pipelineLatencyRecords}
            queue={props.operatorQueue}
            health={runtimeHealth}
            events={pipelineRuntimeEvents}
            onOpenModelSettings={props.onOpenLegacySettings}
          />
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
