import { useEffect, useMemo, useState } from 'react';
import {
  isCurrentBroadcastFault,
  isProductionEvent,
  routeBroadcastEvent,
  type BroadcastEdgeId as EdgeId,
  type BroadcastFault as Fault,
  type BroadcastNodeId as NodeId,
  type BroadcastRuntimeEvent,
} from '../lib/broadcastTopology';
import type { OperatorQueueItem } from '../lib/operatorQueue';

export type BroadcastTraceRecord = {
  requestId: string;
  eventId?: string;
  input?: string;
  inputAt?: number;
  llmCompletedAt?: number;
  ttsRequestedAt?: number;
  ttsFirstByteAt?: number;
  flashHeadFirstFrameAt?: number;
  endedAt?: number;
  inputToEndMs?: number;
  firstPlaybackAt?: number;
};

type FaultRef = { nodeId: string; at: number; stage: string };
export type BroadcastRuntimeHealth = {
  lastFaults?: Partial<
    Record<'soul' | 'model' | 'skill' | 'tts' | 'flashhead' | 'platform', Fault>
  >;
  supervisor?: {
    state?: string;
    isLive?: boolean;
    connectedClients?: number;
    platforms?: Record<
      string,
      {
        platformId?: string;
        roomId?: string;
        state?: string;
        isLive?: boolean;
        inbound?: boolean;
        outbound?: boolean;
      }
    >;
  };
  runtimeOwner?: {
    active: boolean;
    available: boolean;
    ttsConfigured: boolean;
  };
  model?: {
    provider?: string;
    model?: string;
    credentialConfigured?: boolean;
  };
  obs?: {
    processState?: 'running' | 'not-running' | 'unknown';
    processName?: string;
    overlayTelemetry?: 'runtime-owner-heartbeat';
    streamState?: 'streaming' | 'stopped' | 'unknown';
    checkedAt?: number;
  };
};

const nodes: Array<{
  id: NodeId;
  label: string;
  meta: string;
  x: number;
  y: number;
  kind?: string;
}> = [
  {
    id: 'platform',
    label: '直播平台群',
    meta: '平台聚合',
    x: 1140,
    y: 25,
    kind: 'platform',
  },
  {
    id: 'connector',
    label: '平台连接器',
    meta: '事件接入 / 文字回写',
    x: 940,
    y: 25,
    kind: 'connector',
  },
  { id: 'viewer', label: '观众弹幕', meta: '直播平台输入', x: 20, y: 28 },
  { id: 'idle', label: '静息意识', meta: '主动脉冲', x: 20, y: 104 },
  { id: 'external', label: '外部信号', meta: '雷达 / 桥接', x: 20, y: 180 },
  {
    id: 'manual',
    label: '手动播送',
    meta: '总控直达',
    x: 20,
    y: 280,
    kind: 'manual',
  },
  {
    id: 'director',
    label: '演播导演',
    meta: '选择 · 排序 · 接管',
    x: 260,
    y: 110,
  },
  {
    id: 'persona',
    label: 'Soul 认知决策',
    meta: '目标张力 · 评价 · 情绪 · 效用',
    x: 410,
    y: 110,
  },
  {
    id: 'model',
    label: 'MiniMax M3',
    meta: '语义证据 · 台词候选',
    x: 560,
    y: 110,
  },
  {
    id: 'queue',
    label: '表达计划 / 队列',
    meta: 'SpeechPlanV2 · reservation',
    x: 570,
    y: 270,
  },
  { id: 'tts', label: 'TTS 音频', meta: '语音节拍', x: 720, y: 270 },
  { id: 'behavior', label: '行为计划', meta: '表情 / 动作', x: 865, y: 165 },
  { id: 'renderer', label: 'FlashHead', meta: '音频驱动渲染', x: 865, y: 300 },
  {
    id: 'playback',
    label: '执行与 Outcome',
    meta: '音画输出 · 结果提交',
    x: 1000,
    y: 245,
  },
  {
    id: 'obs',
    label: 'OBS',
    meta: '采集 / 编码 / 推流',
    x: 1140,
    y: 245,
    kind: 'obs',
  },
];

const edges: Array<{ id: EdgeId; d: string; label?: string }> = [
  {
    id: 'connector-platform',
    d: 'M 1074 55 L 1140 55',
  },
  {
    id: 'connector-viewer',
    d: 'M 940 55 C 800 55, 800 18, 650 18 C 420 18, 280 18, 148 58',
  },
  { id: 'viewer-director', d: 'M 148 58 C 210 58, 205 140, 260 140' },
  { id: 'idle-director', d: 'M 148 134 C 205 134, 205 140, 260 140' },
  { id: 'external-director', d: 'M 148 210 C 210 210, 205 140, 260 140' },
  {
    id: 'manual-queue',
    d: 'M 148 310 C 330 310, 390 300, 570 300',
    label: '手动播报直达表达队列',
  },
  { id: 'director-persona', d: 'M 388 140 L 410 140' },
  { id: 'persona-model', d: 'M 538 140 L 560 140' },
  { id: 'model-queue', d: 'M 688 140 C 725 140, 700 300, 698 300' },
  { id: 'queue-tts', d: 'M 698 300 L 720 300' },
  { id: 'tts-behavior', d: 'M 848 300 C 875 300, 835 195, 865 195' },
  { id: 'tts-renderer', d: 'M 848 300 L 865 330' },
  { id: 'behavior-playback', d: 'M 993 195 C 1020 195, 975 275, 1000 275' },
  { id: 'renderer-playback', d: 'M 993 330 C 1020 330, 975 275, 1000 275' },
  { id: 'playback-connector', d: 'M 1064 245 C 1100 175, 1080 105, 1004 85' },
  { id: 'playback-obs', d: 'M 1128 275 L 1140 275' },
  { id: 'obs-platform', d: 'M 1204 245 C 1230 190, 1230 110, 1204 85' },
];

function ms(value?: number) {
  if (!value) return '—';
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

function clockTime(value?: number) {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

const PLATFORM_LABELS: Record<string, string> = {
  bilibili: 'B站',
  douyin: '抖音',
  douyu: '斗鱼',
  huya: '虎牙',
  kuaishou: '快手',
  youtube: 'YouTube',
  twitch: 'Twitch',
};

function platformLabel(platformId: string) {
  return PLATFORM_LABELS[platformId.toLowerCase()] || platformId;
}

function isTerminalStage(stage?: string) {
  return (
    stage === 'completed' ||
    stage === 'done' ||
    stage === 'failed' ||
    stage === 'dropped' ||
    stage === 'interrupted' ||
    stage === 'persona_plan_skipped'
  );
}

function nodeTimings(record?: BroadcastTraceRecord) {
  if (!record?.inputAt) return [];
  const elapsed = (from?: number, to?: number) =>
    from && to && to >= from ? to - from : undefined;
  return [
    {
      node: '模型生成',
      arrivedAt: record.llmCompletedAt,
      duration: elapsed(record.inputAt, record.llmCompletedAt),
    },
    {
      node: '播放队列',
      arrivedAt: record.ttsRequestedAt,
      duration: elapsed(record.llmCompletedAt, record.ttsRequestedAt),
    },
    {
      node: 'TTS 首音',
      arrivedAt: record.ttsFirstByteAt,
      duration: elapsed(record.ttsRequestedAt, record.ttsFirstByteAt),
    },
    {
      node: 'FlashHead 首帧',
      arrivedAt: record.flashHeadFirstFrameAt,
      duration: elapsed(record.ttsFirstByteAt, record.flashHeadFirstFrameAt),
    },
    {
      node: '播放首帧',
      arrivedAt: record.firstPlaybackAt,
      duration: elapsed(record.ttsFirstByteAt, record.firstPlaybackAt),
    },
    {
      node: '播放完成',
      arrivedAt: record.endedAt,
      duration: elapsed(record.firstPlaybackAt, record.endedAt),
    },
  ];
}

export function BroadcastTopologyPanel({
  records,
  queue,
  health,
  events,
  onOpenModelSettings,
}: {
  records: BroadcastTraceRecord[];
  queue: OperatorQueueItem[];
  health: BroadcastRuntimeHealth;
  events: BroadcastRuntimeEvent[];
  onOpenModelSettings?: () => void;
}) {
  const [detail, setDetail] = useState<{
    title: string;
    text: string;
    action?: 'open-model-settings';
    faultRef?: FaultRef;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const activeItem = queue.find((entry) =>
    ['preparing', 'ready', 'speaking'].includes(entry.status),
  );
  const productionEvents = events.filter(isProductionEvent);
  const event = activeItem
    ? [...productionEvents]
        .reverse()
        .find((entry) => entry.eventId === activeItem.eventId)
    : productionEvents[productionEvents.length - 1];
  const item =
    activeItem ||
    (event?.eventId
      ? queue.find((entry) => entry.eventId === event.eventId)
      : undefined);
  const route = useMemo(() => routeBroadcastEvent(event, item), [event, item]);
  // Reply-latency records are written only after a real end-to-end completion.
  // Keep that completion snapshot visible while the room is idle; clear it as
  // soon as a different dialogue event enters the production pipeline.
  const lastCompleted = records.find((record) => Boolean(record.inputToEndMs));
  const nextDialogueStarted = Boolean(
    event?.eventId &&
      event.eventId !== lastCompleted?.eventId &&
      !isTerminalStage(event.stage),
  );
  const completionTime = clockTime(
    lastCompleted?.llmCompletedAt ?? lastCompleted?.endedAt,
  );
  const completedNodeTimings = nodeTimings(lastCompleted);
  const nodeFaults = new Map<NodeId, Fault>();
  const freshFault = (fault?: Fault) =>
    fault && now - fault.at < 120_000 ? fault : undefined;
  const platformFault = freshFault(health.lastFaults?.platform);
  const soulFault = freshFault(health.lastFaults?.soul);
  const modelFault =
    health.model?.credentialConfigured === false
      ? {
          at: now,
          stage: 'generation_auth_failed',
          reason:
            'MiniMax 服务端凭据为空。请在设置 → LLM → OpenAI-Compatible → API 密钥中重新输入原 key；无需轮换。',
        }
      : freshFault(health.lastFaults?.model) ||
        freshFault(health.lastFaults?.skill);
  const ttsFault = freshFault(health.lastFaults?.tts);
  const rendererFault = freshFault(health.lastFaults?.flashhead);
  if (platformFault) nodeFaults.set('connector', platformFault);
  if (soulFault) nodeFaults.set('persona', soulFault);
  if (modelFault) nodeFaults.set('model', modelFault);
  if (ttsFault) nodeFaults.set('tts', ttsFault);
  if (rendererFault) nodeFaults.set('renderer', rendererFault);
  const detailFaultIsCurrent = detail?.faultRef
    ? isCurrentBroadcastFault(
        detail.faultRef,
        nodeFaults.get(detail.faultRef.nodeId as NodeId),
      )
    : true;
  const visibleDetail = detailFaultIsCurrent ? detail : null;
  useEffect(() => {
    if (!visibleDetail) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [visibleDetail]);
  const itemAge = item ? now - item.updatedAt : 0;
  if (
    item?.status === 'preparing' &&
    itemAge > 8_000 &&
    !nodeFaults.has('model')
  ) {
    nodeFaults.set('model', {
      at: item.updatedAt,
      stage: 'generation_timeout',
      reason: `回合 ${item.eventId} 已在模型生成节点停留 ${ms(itemAge)}。`,
    });
  }
  if (item?.status === 'speaking' && itemAge > 30_000) {
    const completed = event?.stage === 'done' || event?.stage === 'completed';
    nodeFaults.set(completed ? 'queue' : 'playback', {
      at: item.updatedAt,
      stage: completed ? 'queue_state_stale' : 'playback_timeout',
      reason: completed
        ? `回合 ${item.eventId} 已收到完成事件，但技术播放队列仍保持 speaking，队列状态没有正确收尾。`
        : `回合 ${item.eventId} 已在播放端停留 ${ms(itemAge)}，没有收到完成事件。`,
    });
  }
  const edgeFault = platformFault
    ? ('connector-platform' as EdgeId)
    : item?.status === 'ready' && itemAge > 12_000
      ? ('queue-tts' as EdgeId)
      : undefined;
  const connectorState = `${health.supervisor?.state || ''}`.toLowerCase();
  const connectorOnline = ['online', 'connected', 'running'].includes(
    connectorState,
  );
  const configuredPlatforms = Object.entries(
    health.supervisor?.platforms || {},
  ).filter(([, platform]) => {
    const state = `${platform.state || ''}`.toLowerCase();
    return state !== 'disabled' && Boolean(platform.roomId);
  });
  const platformOnline = configuredPlatforms.some(([, platform]) =>
    ['online', 'connected', 'running'].includes(
      `${platform.state || ''}`.toLowerCase(),
    ),
  );
  const connectorMeta = platformFault
    ? '平台回写失败'
    : connectorOnline
      ? `OrdinaryRoad · ${health.supervisor?.connectedClients ?? 0} 路监听`
      : connectorState
        ? '连接器离线'
        : '等待连接器状态';
  const platformMeta = configuredPlatforms.length
    ? `${configuredPlatforms.length} 个已配置 · ${configuredPlatforms.some(([, platform]) => platform.isLive) ? '直播中' : '待开播'}`
    : '未配置真实平台';
  const obsProcessRunning = health.obs?.processState === 'running';
  const overlayOnline = health.runtimeOwner?.active === true;
  const obsMeta = obsProcessRunning
    ? overlayOnline
      ? '进程在线 · 叠加页有心跳'
      : '进程在线 · 未见叠加页'
    : health.obs?.processState === 'not-running'
      ? '进程未运行'
      : '进程状态不可用';
  const statusEdges = new Set<EdgeId>(route.activeEdges);
  if (overlayOnline) statusEdges.add('playback-obs');
  if (health.obs?.streamState === 'streaming') statusEdges.add('obs-platform');
  const copy = async () => {
    if (!visibleDetail) return;
    await navigator.clipboard?.writeText(
      `${visibleDetail.title}\n${visibleDetail.text}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <section className="workspace-card broadcast-topology-workspace">
      <header className="bt-heading">
        <div>
          <span>LIVE SIGNAL TOPOLOGY</span>
          <h1>链路监控</h1>
          <p>事件沿真实生产路径移动。亮点是当前节点，流光是正在传递的边。</p>
        </div>
        <aside>
          <strong>
            {nextDialogueStarted ? '—' : ms(lastCompleted?.inputToEndMs)}
          </strong>
          <small>
            {nextDialogueStarted ? '新一轮对话已进入链路' : '最近一次端到端'}
          </small>
          {!nextDialogueStarted && completionTime && (
            <time>生成完成 {completionTime}</time>
          )}
        </aside>
      </header>
      <div className="bt-event-strip">
        <b>{event?.eventId || item?.eventId || '等待生产事件'}</b>
        <span>
          {event?.runtimeMode ? `${event.runtimeMode} · ` : ''}
          {event?.stage || item?.status || 'idle'}
        </span>
        <em>
          {item?.text ||
            records[0]?.input ||
            '下一次静息脉冲、弹幕、手动稿或外部信号会在图中开始流动'}
        </em>
      </div>
      <div className="bt-canvas">
        <svg
          viewBox="0 0 1280 400"
          preserveAspectRatio="none"
          aria-label="直播平台群、连接器、生产、播放端与 OBS 推流闭环拓扑"
        >
          <defs>
            <filter id="bt-glow">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map((edge) => (
            <g key={edge.id}>
              <path
                pathLength="100"
                className={`bt-edge bt-edge-${edge.id} ${statusEdges.has(edge.id) ? 'is-live' : ''} ${edge.id === 'obs-platform' && health.obs?.streamState !== 'streaming' ? 'is-unverified' : ''} ${edgeFault === edge.id ? 'is-broken' : ''}`}
                d={edge.d}
              />
              {edge.label && (
                <text className="bt-edge-label" x="270" y="332">
                  {edge.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {nodes.map((node) => {
          const fault = nodeFaults.get(node.id);
          const meta =
            node.id === 'platform'
              ? platformMeta
              : node.id === 'connector'
                ? connectorMeta
                : node.id === 'obs'
                  ? obsMeta
                  : node.id === 'model' &&
                      health.model?.credentialConfigured === false
                    ? 'MiniMax key 未保存'
                    : node.meta;
          const offline =
            (node.id === 'platform' &&
              configuredPlatforms.length > 0 &&
              !platformOnline) ||
            (node.id === 'connector' &&
              Boolean(connectorState) &&
              !connectorOnline) ||
            (node.id === 'model' &&
              health.model?.credentialConfigured === false) ||
            (node.id === 'obs' && health.obs?.processState === 'not-running');
          const active =
            route.node === node.id ||
            (node.id === 'obs' && obsProcessRunning && overlayOnline) ||
            (node.id === 'platform' &&
              configuredPlatforms.some(([, platform]) => platform.isLive));
          const online =
            (node.id === 'platform' && platformOnline) ||
            (node.id === 'connector' && connectorOnline);
          return (
            <button
              type="button"
              key={node.id}
              className={`bt-node bt-node-${node.id} ${active ? 'is-live' : ''} ${online ? 'is-online' : ''} ${fault ? 'is-fault' : ''} ${offline ? 'is-offline' : ''} ${node.id === 'obs' && health.obs?.streamState !== 'streaming' ? 'is-unverified' : ''}`}
              style={{ left: `${node.x / 12.8}%`, top: `${node.y / 4}%` }}
              onClick={() =>
                fault &&
                setDetail({
                  title: `节点故障：${node.label} / ${fault.stage}`,
                  text: fault.reason || '该节点报告故障，但没有附带更多原因。',
                  faultRef: {
                    nodeId: node.id,
                    at: fault.at,
                    stage: fault.stage,
                  },
                  action:
                    fault.stage === 'generation_auth_failed'
                      ? 'open-model-settings'
                      : undefined,
                })
              }
            >
              <i />
              <strong>{node.label}</strong>
              <small>{meta}</small>
              {node.id === 'platform' && configuredPlatforms.length > 0 && (
                <span className="bt-platform-chips">
                  {configuredPlatforms
                    .slice(0, 4)
                    .map(([platformId, platform]) => (
                      <b
                        key={platformId}
                        className={`is-${`${platform.state || 'unknown'}`.toLowerCase()}`}
                      >
                        {platformLabel(platformId)}
                      </b>
                    ))}
                </span>
              )}
            </button>
          );
        })}
        {edgeFault && (
          <button
            type="button"
            className={`bt-breakpoint bt-breakpoint-${edgeFault}`}
            onClick={() =>
              setDetail({
                title: `链路断点：${edgeFault}`,
                text: `事件 ${item?.eventId || '未知'} 在 ${item?.status || '传递'} 状态停留 ${ms(now - (item?.updatedAt || now))}。`,
              })
            }
          >
            !
          </button>
        )}
      </div>
      <div className="bt-legend">
        <span>
          <i className="node" />
          节点执行
        </span>
        <span>
          <i className="edge" />
          链路传递
        </span>
        <span>
          <i className="node-fault" />
          节点故障
        </span>
        <span>
          <i className="edge-fault" />
          链路中断
        </span>
        <span>
          <i className="edge-unverified" />
          未接入遥测
        </span>
      </div>
      <div className="pipeline-history">
        <div className="pipeline-history-heading">
          <strong>最近放送</strong>
          <small>真实完成记录</small>
        </div>
        {records.slice(0, 6).map((record) => (
          <article key={record.requestId}>
            <time>
              {record.inputAt
                ? new Date(record.inputAt).toLocaleTimeString('zh-CN')
                : '—'}
            </time>
            <p>{record.input || record.eventId || record.requestId}</p>
            <span>{ms(record.inputToEndMs)}</span>
            <em>{record.firstPlaybackAt ? '已放送' : '未完成'}</em>
          </article>
        ))}
      </div>
      {lastCompleted && (
        <section
          className="pipeline-node-timings"
          aria-label="最近一次放送的逐节点耗时"
        >
          <div>
            <strong>节点经过时间</strong>
            <small>最近一次完成事件 · 每项为本节点处理耗时</small>
          </div>
          <ol>
            {completedNodeTimings.map((timing) => (
              <li
                key={timing.node}
                className={timing.arrivedAt ? 'is-complete' : 'is-pending'}
              >
                <span>{timing.node}</span>
                <time>{clockTime(timing.arrivedAt) || '未记录'}</time>
                <b>{ms(timing.duration)}</b>
              </li>
            ))}
          </ol>
        </section>
      )}
      {visibleDetail && (
        <section className="pipeline-fault-detail" role="alert">
          <div>
            <span>故障详情</span>
            <strong>{visibleDetail.title}</strong>
          </div>
          <p>{visibleDetail.text}</p>
          <div className="pipeline-fault-actions">
            {visibleDetail.action === 'open-model-settings' &&
              onOpenModelSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setDetail(null);
                    onOpenModelSettings();
                  }}
                >
                  打开 LLM 密钥设置
                </button>
              )}
            <button type="button" onClick={() => setDetail(null)}>
              关闭详情
            </button>
            <button type="button" onClick={() => void copy()}>
              {copied ? '已复制' : '一键复制错误'}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
