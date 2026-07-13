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
import { StressTestPanel, type StressRunState } from './StressTestPanel';

type Workspace =
  | 'avatars'
  | 'overview'
  | 'stress'
  | 'memory'
  | 'insights'
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
  onSend: (text: string) => void;
  onStop: () => void;
  autoBroadcastEnabled: boolean;
  onToggleAutoBroadcast: () => void;
  onUpdateEmptyRoomAwareness: (
    update: Partial<AppSettings['emptyRoomAwareness']>,
  ) => void;
  onOpenLegacySettings: () => void;
  socialBusHealth: StreamBusHealth;
  socialBusError: string;
  onUpdateSocialStream: (update: Partial<AppSettings['socialStream']>) => void;
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
}

const workspaceLabels: Record<Workspace, string> = {
  avatars: '数字人管理',
  overview: '总控',
  stress: '压力测试',
  memory: '记忆',
  insights: '洞察',
  config: '配置',
};

function formatAge(milliseconds: number) {
  if (!milliseconds) return '—';
  return `${Math.max(1, Math.round(milliseconds / 1000))} 秒`;
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

function queueTone(status: OperatorQueueItem['status']) {
  if (status === 'done') return 'replied';
  if (status === 'skipped') return 'skipped';
  if (status === 'pending') return 'waiting';
  return 'replying';
}

function queueStatusLabel(status: OperatorQueueItem['status']) {
  if (status === 'done') return '已回复';
  if (status === 'skipped') return '未采用（重复强调）';
  if (status === 'pending') return '待回复';
  if (status === 'preparing') return '正在撰写';
  if (status === 'ready') return '等待播出';
  return '正在播出';
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

export function ControlRoom(props: ControlRoomProps) {
  const [workspace, setWorkspace] = useState<Workspace>('overview');
  const [minimaxVoices, setMinimaxVoices] = useState<MinimaxVoiceOption[]>([]);
  const [voiceLoadError, setVoiceLoadError] = useState('');
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(
    null,
  );
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [draggingQueueId, setDraggingQueueId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<
    'active' | 'replied' | 'skipped'
  >('active');
  const selectedQueueItem =
    props.operatorQueue.find((item) => item.eventId === selectedQueueId) ??
    props.operatorQueue[0];
  const selectedReplyIsHistory = selectedQueueItem?.status === 'done';
  const selectedQueueIsSkipped = selectedQueueItem?.status === 'skipped';
  const visibleQueue = useMemo(() => {
    const matching = props.operatorQueue.filter((item) => {
      if (queueFilter === 'replied') return item.status === 'done';
      if (queueFilter === 'skipped') return item.status === 'skipped';
      return item.status !== 'done' && item.status !== 'skipped';
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
  const toggleBusPlatform = (platform: string) => {
    const platforms = props.settings.socialStream.platforms;
    props.onUpdateSocialStream({
      platforms: platforms.includes(platform)
        ? platforms.filter((item) => item !== platform)
        : [...platforms, platform],
    });
  };
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
    <main className="control-room">
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
            <details className="empty-room-control">
              <summary>
                <span
                  className={`awareness-status ${props.settings.emptyRoomAwareness.enabled ? 'is-enabled' : ''}`}
                />
                空场意识 ·{' '}
                {props.settings.emptyRoomAwareness.enabled
                  ? '运行中'
                  : '已关闭'}
              </summary>
              <div className="awareness-control-panel">
                <header>
                  <div>
                    <span>EMPTY ROOM PULSE</span>
                    <strong>无观众时偶尔产生一个念头</strong>
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
                    启用
                  </label>
                </header>
                <p>
                  这是直播总控能力，自动作用于当前数字人；有人进入、发言或正在播出时会重新计时。
                </p>
                <div className="awareness-window">
                  <label>
                    最短
                    <span>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={Math.round(
                          props.settings.emptyRoomAwareness.minIntervalMs /
                            60_000,
                        )}
                        onChange={(event) =>
                          props.onUpdateEmptyRoomAwareness({
                            minIntervalMs:
                              Number(event.target.value || 1) * 60_000,
                          })
                        }
                      />
                      分钟
                    </span>
                  </label>
                  <div className="awareness-window-rail" aria-hidden="true">
                    <i />
                    <span>随机时间窗</span>
                    <i />
                  </div>
                  <label>
                    最长
                    <span>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={Math.round(
                          props.settings.emptyRoomAwareness.maxIntervalMs /
                            60_000,
                        )}
                        onChange={(event) =>
                          props.onUpdateEmptyRoomAwareness({
                            maxIntervalMs:
                              Number(event.target.value || 1) * 60_000,
                          })
                        }
                      />
                      分钟
                    </span>
                  </label>
                </div>
                <div className="awareness-sources">
                  {(
                    [
                      ['interfaceWeight', '当前界面'],
                      ['memoryWeight', '睡眠记忆'],
                      ['inspirationWeight', '灵感种子'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>
                        {label}
                        <strong>
                          {props.settings.emptyRoomAwareness[key]}
                        </strong>
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
                  权重只决定灵感来源；真正说出口的内容始终由当前数字人的人设和模型临场生成。
                </small>
              </div>
            </details>
          </div>
          <button
            className="danger-action"
            onClick={props.onStop}
            disabled={!props.isSpeaking && !props.isProcessing}
          >
            停止当前播出
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
          <div className="control-room-grid">
            <section className="console-panel audience-panel">
              <div className="panel-heading">
                <span>互动雷达</span>
                <small>最近 {props.interactionEvents.length} 条</small>
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
              <div className="message-list interaction-feed" aria-live="polite">
                {props.interactionEvents.length ? (
                  props.interactionEvents.slice(0, 12).map((event) => (
                    <article
                      key={event.eventId}
                      className={`interaction-card is-${event.stage}`}
                    >
                      <header>
                        <span>{event.viewerName || '匿名观众'}</span>
                        <small>
                          {event.sourcesSeen.join(' / ') || '直播间'}
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
                <span>模型回复草稿</span>
                <small>点选左侧队列后查看与编辑</small>
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
                    {selectedReplyIsHistory ? '回复历史' : '待播回复'}
                  </span>
                  <small>
                    {selectedQueueItem
                      ? selectedQueueItem.skills.length
                        ? `已使用 ${selectedQueueItem.skills.join('、')}`
                        : '未使用 Skills'
                      : '点选左侧消息查看'}
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
                        <dd>{formatEventTime(selectedQueueItem.updatedAt)}</dd>
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
                ) : null}
              </div>
              <div className="manual-send">
                <div className="panel-heading">
                  <span>手动播报</span>
                  <small>直接送入当前安全链路</small>
                </div>
                <ChatInput
                  onSend={props.onSend}
                  disabled={props.isProcessing}
                />
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
                <div className="sidebar-manual">
                  <ChatInput
                    onSend={props.onSend}
                    disabled={props.isProcessing}
                  />
                </div>
              </aside>
            </section>
          </div>
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
              {props.memory.records
                .filter(
                  (record) =>
                    record.phase === 'sleep_queue' ||
                    record.phase === 'fading' ||
                    record.phase === 'dormant',
                )
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
                          : record.phase === 'dormant'
                            ? '已经沉睡'
                            : '正在模糊'}{' '}
                        · {record.subjectName}
                      </small>
                    </article>
                  );
                })}
              {!props.memory.records.some(
                (record) =>
                  record.phase === 'sleep_queue' ||
                  record.phase === 'fading' ||
                  record.phase === 'dormant',
              ) && (
                <p className="empty-state">
                  当前没有等待整理或正在淡去的记忆。
                </p>
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
        {workspace === 'stress' && (
          <StressTestPanel
            stressRun={props.stressRun}
            onDiagnose={props.onDiagnoseStressTest}
            onStart={props.onStartStressTest}
            onPause={props.onPauseStressTest}
            onResume={props.onResumeStressTest}
            onAbort={props.onAbortStressTest}
            onCleanup={props.onCleanupStressTest}
          />
        )}
        {workspace === 'insights' && (
          <section className="workspace-card">
            <h1>节目与台风洞察</h1>
            <p>
              屏幕视觉、台风事实核验与主动播报保持现有运行方式；新版总控会在下一阶段把它们移入此工作区。
            </p>
            <button onClick={props.onOpenLegacySettings}>打开节目配置</button>
          </section>
        )}
        {workspace === 'config' && (
          <section className="workspace-card config-workspace">
            <h1>平台与消息总线</h1>
            <p>
              SSN 是可选的外部消息接入层。它不会取得模型密钥、语音或头像控制权。
            </p>
            <label>
              <input
                type="checkbox"
                checked={props.settings.socialStream.enabled}
                onChange={(event) =>
                  props.onUpdateSocialStream({ enabled: event.target.checked })
                }
              />{' '}
              启用 Social Stream Ninja
            </label>
            <label>
              Session ID
              <input
                value={props.settings.socialStream.sessionId}
                onChange={(event) =>
                  props.onUpdateSocialStream({ sessionId: event.target.value })
                }
                placeholder="SSN session ID"
              />
            </label>
            <label>
              消息总线地址
              <input
                value={props.settings.socialStream.serverUrl}
                onChange={(event) =>
                  props.onUpdateSocialStream({ serverUrl: event.target.value })
                }
              />
            </label>
            <div className="bus-platforms">
              <span>交由 SSN 接入的平台</span>
              {['youtube', 'twitch', 'bilibili', 'kick', 'tiktok'].map(
                (platform) => (
                  <label key={platform}>
                    <input
                      type="checkbox"
                      checked={props.settings.socialStream.platforms.includes(
                        platform,
                      )}
                      onChange={() => toggleBusPlatform(platform)}
                    />{' '}
                    {platform}
                  </label>
                ),
              )}
            </div>
            {props.socialBusError && (
              <p className="config-error">{props.socialBusError}</p>
            )}
            <button onClick={props.onOpenLegacySettings}>
              打开完整运行配置
            </button>
          </section>
        )}
      </section>
    </main>
  );
}
