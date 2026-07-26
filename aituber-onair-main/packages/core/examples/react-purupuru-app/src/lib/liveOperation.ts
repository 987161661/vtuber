export type LiveOperationPhase =
  | 'standby'
  | 'preview'
  | 'live'
  | 'live-paused';

export interface LiveOperationProjection {
  phase: LiveOperationPhase;
  title: string;
  detail: string;
  tone: 'idle' | 'preview' | 'live' | 'paused';
  automationAction: 'start' | 'pause' | 'resume';
  automationLabel: string;
  showPipelineAction: boolean;
}

/**
 * Projects the operational phase from facts the control room can actually
 * prove. Automation alone is only a preview; only an external live signal can
 * promote the phase to a formal broadcast.
 */
export function projectLiveOperation(input: {
  autoBroadcastEnabled: boolean;
  platformLive: boolean;
}): LiveOperationProjection {
  if (input.platformLive) {
    return input.autoBroadcastEnabled
      ? {
          phase: 'live',
          title: '正式直播中',
          detail: '平台已确认开播，数字人正在自动响应。',
          tone: 'live',
          automationAction: 'pause',
          automationLabel: '暂停自动播出',
          showPipelineAction: true,
        }
      : {
          phase: 'live-paused',
          title: '直播中 · 自动播出已暂停',
          detail: '外部推流仍在继续，数字人不会自动消费互动队列。',
          tone: 'paused',
          automationAction: 'resume',
          automationLabel: '恢复自动播出',
          showPipelineAction: true,
        };
  }

  if (input.autoBroadcastEnabled) {
    return {
      phase: 'preview',
      title: '站内预演中',
      detail: '自动播出已运行，但尚未检测到外部正式推流。',
      tone: 'preview',
      automationAction: 'pause',
      automationLabel: '结束站内预演',
      showPipelineAction: true,
    };
  }

  return {
    phase: 'standby',
    title: '播出待命',
    detail: '自动播出未启动，当前不会消费互动队列。',
    tone: 'idle',
    automationAction: 'start',
    automationLabel: '开始站内预演',
    showPipelineAction: false,
  };
}
