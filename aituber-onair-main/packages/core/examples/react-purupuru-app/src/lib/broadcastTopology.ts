import type { OperatorQueueItem } from './operatorQueue';

export type BroadcastRuntimeEvent = {
  eventId?: string;
  stage?: string;
  source?: string;
  at?: number;
  runtimeMode?: 'legacy' | 'shadow' | 'canary' | 'primary';
  reason?: string;
  error?: string;
  fallback?: boolean;
  fallbackReason?: string;
};

export type BroadcastFault = { at: number; stage: string; reason?: string };
export type BroadcastFaultRef = {
  nodeId: string;
  at: number;
  stage: string;
};

export type BroadcastNodeId =
  | 'platform'
  | 'connector'
  | 'obs'
  | 'viewer'
  | 'idle'
  | 'external'
  | 'manual'
  | 'director'
  | 'persona'
  | 'model'
  | 'queue'
  | 'tts'
  | 'behavior'
  | 'renderer'
  | 'playback';

export type BroadcastEdgeId =
  | 'connector-platform'
  | 'connector-viewer'
  | 'viewer-director'
  | 'idle-director'
  | 'external-director'
  | 'manual-queue'
  | 'director-persona'
  | 'persona-model'
  | 'model-queue'
  | 'queue-tts'
  | 'tts-behavior'
  | 'tts-renderer'
  | 'behavior-playback'
  | 'renderer-playback'
  | 'playback-connector'
  | 'playback-obs'
  | 'obs-platform';

export function isCurrentBroadcastFault(
  reference: BroadcastFaultRef | undefined,
  current: BroadcastFault | undefined,
): boolean {
  if (!reference) return true;
  return Boolean(
    current && current.at === reference.at && current.stage === reference.stage,
  );
}

export function isProductionEvent(event: BroadcastRuntimeEvent): boolean {
  if (!event.eventId || !event.stage) return false;
  const stage = event.stage;
  return (
    [
      'received',
      'queued',
      'generating',
      'proactive-selected',
      'program_decision',
      'selected',
      'generated',
      'started',
      'speaking',
      'tts_first_audio',
      'completed',
      'done',
      'dropped',
      'failed',
      'interrupted',
    ].includes(stage) ||
    stage.startsWith('persona_plan_') ||
    stage.startsWith('persona_state_') ||
    stage.startsWith('soul_') ||
    stage === 'generation_error' ||
    stage.startsWith('tts-') ||
    stage.startsWith('model_') ||
    stage.startsWith('live_platform_delivery_') ||
    stage.includes('avatar_action') ||
    stage.includes('_render_')
  );
}

export function routeBroadcastEvent(
  event?: BroadcastRuntimeEvent,
  queueItem?: OperatorQueueItem,
): {
  source: BroadcastNodeId;
  node: BroadcastNodeId;
  activeEdges: BroadcastEdgeId[];
} {
  const source = sourceNode(event, queueItem);
  const stage = event?.stage || '';
  let node: BroadcastNodeId = source;
  let activeEdges: BroadcastEdgeId[] = [];
  if (!stage && queueItem) {
    if (queueItem.status === 'preparing') {
      activeEdges =
        source === 'manual'
          ? ['manual-queue']
          : [`${source}-director` as BroadcastEdgeId];
    }
    if (queueItem.status === 'ready') {
      node = 'queue';
      activeEdges = ['queue-tts'];
    }
    if (queueItem.status === 'speaking') {
      node = 'playback';
      activeEdges = ['renderer-playback'];
    }
  }
  if (
    stage === 'received' ||
    stage === 'queued' ||
    stage === 'proactive-selected'
  ) {
    activeEdges =
      source === 'manual'
        ? ['manual-queue']
        : [`${source}-director` as BroadcastEdgeId];
    if (
      source === 'viewer' &&
      isPlatformIngress(event, queueItem) &&
      (stage === 'received' || stage === 'queued')
    ) {
      activeEdges.unshift('connector-platform', 'connector-viewer');
    }
  } else if (stage === 'program_decision' || stage === 'selected') {
    node = 'director';
    activeEdges = ['director-persona'];
  } else if (stage.startsWith('persona_plan_')) {
    node = 'persona';
    activeEdges =
      stage === 'persona_plan_started'
        ? ['director-persona']
        : stage === 'persona_plan_skipped'
          ? []
          : ['persona-model'];
  } else if (stage.startsWith('persona_state_')) {
    node = 'persona';
  } else if (
    stage === 'soul_shadow_decision' ||
    stage === 'soul_decision_selected' ||
    stage === 'soul_formal_silence' ||
    stage.startsWith('soul_reflection_') ||
    stage.startsWith('soul_operator_') ||
    stage.startsWith('soul_snapshot_')
  ) {
    node = 'persona';
    activeEdges = stage === 'soul_formal_silence' ? [] : ['persona-model'];
  } else if (stage === 'soul_speech_plan_built') {
    node = 'queue';
    activeEdges = ['model-queue'];
  } else if (
    stage === 'soul_outcome_committed' ||
    stage === 'soul_delivered_projection_committed'
  ) {
    node = 'playback';
  } else if (stage === 'generating' || stage.startsWith('model_')) {
    node = 'model';
  } else if (stage === 'generated') {
    node = 'model';
    activeEdges = ['model-queue'];
  } else if (stage === 'started') {
    node = 'queue';
    activeEdges = ['queue-tts'];
  } else if (
    stage === 'tts_first_audio' ||
    stage === 'speaking' ||
    stage.startsWith('tts-beat-')
  ) {
    node = 'tts';
    activeEdges = ['tts-behavior', 'tts-renderer'];
  } else if (stage.includes('avatar_action')) {
    node = 'behavior';
    activeEdges = ['behavior-playback'];
  } else if (stage.includes('_render_completed')) {
    node = 'renderer';
    activeEdges = ['renderer-playback'];
  } else if (stage.includes('_render_')) {
    node = 'renderer';
  } else if (stage === 'completed' || stage === 'done') {
    node = 'playback';
  } else if (stage === 'live_platform_delivery_requested') {
    node = 'playback';
    activeEdges = ['playback-connector'];
  } else if (
    stage === 'live_platform_delivery_succeeded' ||
    stage === 'live_platform_delivery_failed'
  ) {
    node = 'connector';
    activeEdges = ['playback-connector', 'connector-platform'];
  }
  return { source, node, activeEdges };
}

function sourceNode(
  event?: BroadcastRuntimeEvent,
  queueItem?: OperatorQueueItem,
): BroadcastNodeId {
  const source = `${event?.source || queueItem?.source || ''}`.toLowerCase();
  if (
    source.includes('quiet') ||
    source.includes('proactive') ||
    source.includes('awareness')
  ) {
    return 'idle';
  }
  if (source.includes('operator-manual')) return 'manual';
  if (
    source.includes('radar') ||
    source.includes('external') ||
    source.includes('parent')
  ) {
    return 'external';
  }
  return 'viewer';
}

function isPlatformIngress(
  event?: BroadcastRuntimeEvent,
  queueItem?: OperatorQueueItem,
): boolean {
  const source = `${event?.source || queueItem?.source || ''}`.toLowerCase();
  return [
    'ordinaryroad',
    'social-stream',
    'bilibili',
    'douyin',
    'douyu',
    'huya',
    'kuaishou',
    'youtube',
    'twitch',
  ].some((platform) => source.includes(platform));
}
