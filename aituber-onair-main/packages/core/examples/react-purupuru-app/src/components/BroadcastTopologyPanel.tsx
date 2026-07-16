import { useEffect, useMemo, useState } from 'react';
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

export type BroadcastRuntimeEvent = {
  eventId?: string;
  stage?: string;
  source?: string;
  at?: number;
};

type Fault = { at: number; stage: string; reason?: string };
export type BroadcastRuntimeHealth = {
  lastFaults?: Partial<Record<'model' | 'skill' | 'tts' | 'flashhead' | 'platform', Fault>>;
};

type NodeId = 'viewer' | 'idle' | 'external' | 'manual' | 'director' | 'model' | 'queue' | 'tts' | 'behavior' | 'renderer' | 'playback';
type EdgeId = 'viewer-director' | 'idle-director' | 'external-director' | 'manual-queue' | 'director-model' | 'model-queue' | 'queue-tts' | 'tts-behavior' | 'tts-renderer' | 'behavior-playback' | 'renderer-playback';

const nodes: Array<{ id: NodeId; label: string; meta: string; x: number; y: number; kind?: string }> = [
  { id: 'viewer', label: '观众弹幕', meta: '直播平台输入', x: 20, y: 28 },
  { id: 'idle', label: '静息意识', meta: '主动脉冲', x: 20, y: 104 },
  { id: 'external', label: '外部信号', meta: '雷达 / 桥接', x: 20, y: 180 },
  { id: 'manual', label: '手动播送', meta: '总控直达', x: 20, y: 280, kind: 'manual' },
  { id: 'director', label: '演播导演', meta: '选择 · 排序 · 接管', x: 260, y: 110 },
  { id: 'model', label: '模型生成', meta: '提示词与回复', x: 445, y: 110 },
  { id: 'queue', label: '播放队列', meta: '技术队列 / 等待播出', x: 455, y: 270 },
  { id: 'tts', label: 'TTS 音频', meta: '语音节拍', x: 665, y: 270 },
  { id: 'behavior', label: '行为计划', meta: '表情 / 动作', x: 840, y: 165 },
  { id: 'renderer', label: 'FlashHead', meta: '音频驱动渲染', x: 840, y: 300 },
  { id: 'playback', label: '播放端', meta: '音画同步放送', x: 995, y: 232 },
];

const edges: Array<{ id: EdgeId; d: string; label?: string }> = [
  { id: 'viewer-director', d: 'M 148 58 C 210 58, 205 140, 260 140' },
  { id: 'idle-director', d: 'M 148 134 C 205 134, 205 140, 260 140' },
  { id: 'external-director', d: 'M 148 210 C 210 210, 205 140, 260 140' },
  { id: 'manual-queue', d: 'M 148 310 C 285 310, 325 300, 455 300', label: '绕过演播导演与模型生成' },
  { id: 'director-model', d: 'M 388 140 L 445 140' },
  { id: 'model-queue', d: 'M 573 140 C 625 140, 615 300, 583 300' },
  { id: 'queue-tts', d: 'M 583 300 L 665 300' },
  { id: 'tts-behavior', d: 'M 793 300 C 820 300, 810 195, 840 195' },
  { id: 'tts-renderer', d: 'M 793 300 L 840 330' },
  { id: 'behavior-playback', d: 'M 968 195 C 990 195, 978 262, 995 262' },
  { id: 'renderer-playback', d: 'M 968 330 C 990 330, 978 262, 995 262' },
];

function isProductionEvent(event: BroadcastRuntimeEvent) {
  if (!event.eventId || !event.stage) return false;
  const stage = event.stage;
  return [
    'received', 'queued', 'generating', 'proactive-selected', 'program_decision',
    'selected', 'generated', 'started', 'speaking', 'tts_first_audio',
    'completed', 'done', 'dropped', 'failed', 'interrupted',
  ].includes(stage)
    || stage.startsWith('tts-')
    || stage.startsWith('model_')
    || stage.includes('avatar_action')
    || stage.includes('_render_');
}

function sourceNode(event?: BroadcastRuntimeEvent, queueItem?: OperatorQueueItem): NodeId {
  const source = `${event?.source || queueItem?.source || ''}`.toLowerCase();
  if (source.includes('quiet') || source.includes('proactive') || source.includes('awareness')) return 'idle';
  if (source.includes('operator-manual')) return 'manual';
  if (source.includes('radar') || source.includes('external') || source.includes('parent')) return 'external';
  return 'viewer';
}

function routeFor(event?: BroadcastRuntimeEvent, queueItem?: OperatorQueueItem) {
  const source = sourceNode(event, queueItem);
  const stage = event?.stage || '';
  let node: NodeId = source;
  let activeEdges: EdgeId[] = [];
  if (!stage && queueItem) {
    if (queueItem.status === 'preparing') activeEdges = source === 'manual' ? ['manual-queue'] : [`${source}-director` as EdgeId];
    if (queueItem.status === 'ready') { node = 'queue'; activeEdges = ['queue-tts']; }
    if (queueItem.status === 'speaking') { node = 'playback'; activeEdges = ['renderer-playback']; }
  }
  if (stage === 'received' || stage === 'queued' || stage === 'proactive-selected') {
    activeEdges = source === 'manual' ? ['manual-queue'] : [`${source}-director` as EdgeId];
  } else if (stage === 'program_decision' || stage === 'selected') {
    node = 'director'; activeEdges = ['director-model'];
  } else if (stage === 'generating' || stage.startsWith('model_')) {
    node = 'model';
  } else if (stage === 'generated') {
    node = 'model'; activeEdges = ['model-queue'];
  } else if (stage === 'started') {
    node = 'queue'; activeEdges = ['queue-tts'];
  } else if (stage === 'tts_first_audio' || stage === 'speaking' || stage.startsWith('tts-beat-')) {
    node = 'tts'; activeEdges = ['tts-behavior', 'tts-renderer'];
  } else if (stage.includes('avatar_action')) {
    node = 'behavior'; activeEdges = ['behavior-playback'];
  } else if (stage.includes('_render_completed')) {
    node = 'renderer'; activeEdges = ['renderer-playback'];
  } else if (stage.includes('_render_')) {
    node = 'renderer';
  } else if (stage === 'completed' || stage === 'done') {
    node = 'playback';
  }
  return { source, node, activeEdges };
}

function ms(value?: number) {
  if (!value) return '—';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function clockTime(value?: number) {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

function isTerminalStage(stage?: string) {
  return stage === 'completed' || stage === 'done' || stage === 'failed' || stage === 'dropped' || stage === 'interrupted';
}

function nodeTimings(record?: BroadcastTraceRecord) {
  if (!record?.inputAt) return [];
  const elapsed = (from?: number, to?: number) =>
    from && to && to >= from ? to - from : undefined;
  return [
    { node: '模型生成', arrivedAt: record.llmCompletedAt, duration: elapsed(record.inputAt, record.llmCompletedAt) },
    { node: '播放队列', arrivedAt: record.ttsRequestedAt, duration: elapsed(record.llmCompletedAt, record.ttsRequestedAt) },
    { node: 'TTS 首音', arrivedAt: record.ttsFirstByteAt, duration: elapsed(record.ttsRequestedAt, record.ttsFirstByteAt) },
    { node: 'FlashHead 首帧', arrivedAt: record.flashHeadFirstFrameAt, duration: elapsed(record.ttsFirstByteAt, record.flashHeadFirstFrameAt) },
    { node: '播放首帧', arrivedAt: record.firstPlaybackAt, duration: elapsed(record.ttsFirstByteAt, record.firstPlaybackAt) },
    { node: '播放完成', arrivedAt: record.endedAt, duration: elapsed(record.firstPlaybackAt, record.endedAt) },
  ];
}

export function BroadcastTopologyPanel({ records, queue, health, events }: { records: BroadcastTraceRecord[]; queue: OperatorQueueItem[]; health: BroadcastRuntimeHealth; events: BroadcastRuntimeEvent[] }) {
  const [detail, setDetail] = useState<{ title: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const activeItem = queue.find((entry) => ['preparing', 'ready', 'speaking'].includes(entry.status));
  const productionEvents = events.filter(isProductionEvent);
  const event = activeItem
    ? [...productionEvents].reverse().find((entry) => entry.eventId === activeItem.eventId)
    : productionEvents[productionEvents.length - 1];
  const item = activeItem || (event?.eventId ? queue.find((entry) => entry.eventId === event.eventId) : undefined);
  const route = useMemo(() => routeFor(event, item), [event, item]);
  // Reply-latency records are written only after a real end-to-end completion.
  // Keep that completion snapshot visible while the room is idle; clear it as
  // soon as a different dialogue event enters the production pipeline.
  const lastCompleted = records.find((record) => Boolean(record.inputToEndMs));
  const nextDialogueStarted = Boolean(
    event?.eventId &&
    event.eventId !== lastCompleted?.eventId &&
    !isTerminalStage(event.stage),
  );
  const completionTime = clockTime(lastCompleted?.llmCompletedAt ?? lastCompleted?.endedAt);
  const completedNodeTimings = nodeTimings(lastCompleted);
  useEffect(() => {
    if (!detail) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [detail]);
  const nodeFaults = new Map<NodeId, Fault>();
  const freshFault = (fault?: Fault) => fault && Date.now() - fault.at < 120_000 ? fault : undefined;
  const platformFault = freshFault(health.lastFaults?.platform);
  const modelFault = freshFault(health.lastFaults?.model) || freshFault(health.lastFaults?.skill);
  const ttsFault = freshFault(health.lastFaults?.tts);
  const rendererFault = freshFault(health.lastFaults?.flashhead);
  if (platformFault) nodeFaults.set(route.source, platformFault);
  if (modelFault) nodeFaults.set('model', modelFault);
  if (ttsFault) nodeFaults.set('tts', ttsFault);
  if (rendererFault) nodeFaults.set('renderer', rendererFault);
  const itemAge = item ? Date.now() - item.updatedAt : 0;
  if (item?.status === 'preparing' && itemAge > 8_000 && !nodeFaults.has('model')) {
    nodeFaults.set('model', { at: item.updatedAt, stage: 'generation_timeout', reason: `回合 ${item.eventId} 已在模型生成节点停留 ${ms(itemAge)}。` });
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
  const edgeFault = item?.status === 'ready' && itemAge > 12_000 ? 'queue-tts' as EdgeId : undefined;
  const copy = async () => {
    if (!detail) return;
    await navigator.clipboard?.writeText(`${detail.title}\n${detail.text}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 1400);
  };
  return <section className="workspace-card broadcast-topology-workspace">
    <header className="bt-heading"><div><span>LIVE SIGNAL TOPOLOGY</span><h1>链路监控</h1><p>事件沿真实生产路径移动。亮点是当前节点，流光是正在传递的边。</p></div><aside><strong>{nextDialogueStarted ? '—' : ms(lastCompleted?.inputToEndMs)}</strong><small>{nextDialogueStarted ? '新一轮对话已进入链路' : '最近一次端到端'}</small>{!nextDialogueStarted && completionTime && <time>生成完成 {completionTime}</time>}</aside></header>
    <div className="bt-event-strip"><b>{event?.eventId || item?.eventId || '等待生产事件'}</b><span>{event?.stage || item?.status || 'idle'}</span><em>{item?.text || records[0]?.input || '下一次静息脉冲、弹幕、手动稿或外部信号会在图中开始流动'}</em></div>
    <div className="bt-canvas">
      <svg viewBox="0 0 1140 380" preserveAspectRatio="xMidYMid meet" aria-label="四入口放送生产拓扑">
        <defs><filter id="bt-glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {edges.map((edge) => <g key={edge.id}><path pathLength="100" className={`bt-edge bt-edge-${edge.id} ${route.activeEdges.includes(edge.id) ? 'is-live' : ''} ${edgeFault === edge.id ? 'is-broken' : ''}`} d={edge.d}/>{edge.label && <text className="bt-edge-label" x="270" y="332">{edge.label}</text>}</g>)}
      </svg>
      {nodes.map((node) => {
        const fault = nodeFaults.get(node.id);
        return <button type="button" key={node.id} className={`bt-node bt-node-${node.id} ${route.node === node.id ? 'is-live' : ''} ${fault ? 'is-fault' : ''}`} style={{ left: `${node.x / 11.4}%`, top: `${node.y / 3.8}%` }} onClick={() => fault && setDetail({ title: `节点故障：${node.label} / ${fault.stage}`, text: fault.reason || '该节点报告故障，但没有附带更多原因。' })}><i/><strong>{node.label}</strong><small>{node.meta}</small></button>;
      })}
      {edgeFault && <button type="button" className={`bt-breakpoint bt-breakpoint-${edgeFault}`} onClick={() => setDetail({ title: `链路断点：${edgeFault}`, text: `事件 ${item?.eventId || '未知'} 在 ${item?.status || '传递'} 状态停留 ${ms(Date.now() - (item?.updatedAt || Date.now()))}。` })}>!</button>}
    </div>
    <div className="bt-legend"><span><i className="node"/>节点执行</span><span><i className="edge"/>链路传递</span><span><i className="node-fault"/>节点故障</span><span><i className="edge-fault"/>链路中断</span></div>
    <div className="pipeline-history"><div className="pipeline-history-heading"><strong>最近放送</strong><small>真实完成记录</small></div>{records.slice(0, 6).map((record) => <article key={record.requestId}><time>{record.inputAt ? new Date(record.inputAt).toLocaleTimeString('zh-CN') : '—'}</time><p>{record.input || record.eventId || record.requestId}</p><span>{ms(record.inputToEndMs)}</span><em>{record.firstPlaybackAt ? '已放送' : '未完成'}</em></article>)}</div>
    {lastCompleted && <section className="pipeline-node-timings" aria-label="最近一次放送的逐节点耗时"><div><strong>节点经过时间</strong><small>最近一次完成事件 · 每项为本节点处理耗时</small></div><ol>{completedNodeTimings.map((timing) => <li key={timing.node} className={timing.arrivedAt ? 'is-complete' : 'is-pending'}><span>{timing.node}</span><time>{clockTime(timing.arrivedAt) || '未记录'}</time><b>{ms(timing.duration)}</b></li>)}</ol></section>}
    {detail && <section className="pipeline-fault-detail" role="alert"><div><span>故障详情</span><strong>{detail.title}</strong></div><p>{detail.text}</p><div className="pipeline-fault-actions"><button type="button" onClick={() => setDetail(null)}>关闭详情</button><button type="button" onClick={() => void copy()}>{copied ? '已复制' : '一键复制错误'}</button></div></section>}
  </section>;
}
