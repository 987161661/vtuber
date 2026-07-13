export type StressRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'aborted'
  | 'failed'
  | 'cleaning';

export interface StressRunViewerState {
  id: string;
  name: string;
  role: string;
  status: string;
  completedSteps: number;
  totalSteps: number;
  currentStep?: string;
}

export interface StressRunFailure {
  id: string;
  viewerName?: string;
  stepId?: string;
  code?: string;
  message: string;
  at: number;
  diagnostic?: {
    stage?: string;
    queueStatus?: string;
    finishReason?: string;
    retryCount?: number;
    beatCount?: number;
    completedBeatCount?: number;
    audioByteLength?: number;
    lastRuntimeStage?: string;
    lastRuntimeReason?: string;
    lastRuntimeError?: string;
  };
}

export interface StressDiagnosticCheck {
  id: string;
  level: 'pass' | 'warning' | 'error';
  code: string;
  summary: string;
  detail?: string;
}

export interface StressRunState {
  status: StressRunStatus;
  runId?: string;
  completedSteps: number;
  totalSteps: number;
  startedAt?: number;
  updatedAt?: number;
  etaMs?: number;
  reportPath?: string;
  phase?: string;
  viewers: StressRunViewerState[];
  queue: {
    waiting: number;
    drafting: number;
    ready: number;
    speaking: number;
  };
  currentPlayback?: {
    viewerName?: string;
    stepId?: string;
    text?: string;
  };
  failures: StressRunFailure[];
  diagnostics?: StressDiagnosticCheck[];
}

interface StressTestPanelProps {
  stressRun: StressRunState;
  onDiagnose: () => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
  onCleanup: () => void | Promise<void>;
}

const statusLabels: Record<StressRunStatus, string> = {
  idle: '待启动',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  aborted: '已终止',
  failed: '运行失败',
  cleaning: '清理中',
};

function formatDuration(milliseconds?: number) {
  if (milliseconds === undefined) return '计算中';
  if (milliseconds <= 0) return '即将完成';
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatFailureTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function StressTestPanel({
  stressRun,
  onDiagnose,
  onStart,
  onPause,
  onResume,
  onAbort,
  onCleanup,
}: StressTestPanelProps) {
  const totalSteps = stressRun.totalSteps || 60;
  const progress = Math.min(
    100,
    Math.round((stressRun.completedSteps / totalSteps) * 100),
  );
  const canStart = ['idle', 'completed', 'aborted', 'failed'].includes(
    stressRun.status,
  );
  const canCleanup =
    Boolean(stressRun.runId) &&
    ['completed', 'aborted', 'failed'].includes(stressRun.status);

  return (
    <section className="workspace-card stress-test-panel">
      <header className="stress-test-heading">
        <div>
          <span className="stage-label">LIVE PIPELINE / 3 VIEWERS</span>
          <h1>三观众全实播压力测试</h1>
          <p>
            {totalSteps} 条复杂直播测试聊天走生产 operatorQueue、当前模型、Skills、学姐音色 TTS
            和数字人播放链路；真实观众消息不受测试故障影响。
          </p>
          <p className="settings-field-hint">
            启动前需先打开一个直播执行端：OBS 叠加页，或同源地址附加 <code>?listener=1</code> 的运行页。
          </p>
        </div>
        <span className={`stress-run-status status-${stressRun.status}`}>
          {statusLabels[stressRun.status]}
        </span>
      </header>

      <div className="stress-test-actions">
        <button className="quiet-action" onClick={() => void onDiagnose()}>
          运行诊断
        </button>
        <button onClick={() => void onStart()} disabled={!canStart}>
          {stressRun.runId ? '重新启动' : '启动测试'}
        </button>
        {stressRun.status === 'paused' ? (
          <button onClick={() => void onResume()}>继续</button>
        ) : (
          <button
            onClick={() => void onPause()}
            disabled={stressRun.status !== 'running'}
          >
            暂停
          </button>
        )}
        <button
          className="danger-action"
          onClick={() => void onAbort()}
          disabled={!['running', 'paused'].includes(stressRun.status)}
        >
          终止
        </button>
        <button
          className="quiet-action"
          onClick={() => void onCleanup()}
          disabled={!canCleanup}
          title={
            canCleanup
              ? '仅清理当前 runId 对应的测试数据'
              : '测试到达终态后才能清理'
          }
        >
          清理测试数据
        </button>
      </div>

      <div className="stress-progress-card">
        <div className="stress-progress-copy">
          <strong>
            {stressRun.completedSteps} / {totalSteps}
          </strong>
          <span>{progress}%</span>
        </div>
        <div
          className="stress-progress-track"
          role="progressbar"
          aria-label="压力测试进度"
          aria-valuemin={0}
          aria-valuemax={totalSteps}
          aria-valuenow={stressRun.completedSteps}
        >
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="stress-run-meta">
          <span>阶段：{stressRun.phase || '等待启动'}</span>
          <span>ETA：{formatDuration(stressRun.etaMs)}</span>
          <span>Run ID：{stressRun.runId || '—'}</span>
        </div>
      </div>

      {stressRun.diagnostics?.length ? (
        <section className="stress-diagnostics" aria-label="启动诊断">
          <header>
            <h2>启动诊断</h2>
            <small>配置、执行端与 TTS 提供方的即时证据</small>
          </header>
          <div>
            {stressRun.diagnostics.map((check) => (
              <article key={check.id} className={`stress-diagnostic-${check.level}`}>
                <strong>{check.code}</strong>
                <p>{check.summary}</p>
                {check.detail && <small>{check.detail}</small>}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="stress-viewer-grid">
        {stressRun.viewers.map((viewer) => {
          const viewerProgress = viewer.totalSteps
            ? Math.round((viewer.completedSteps / viewer.totalSteps) * 100)
            : 0;
          return (
            <article key={viewer.id} className="stress-viewer-card">
              <header>
                <div>
                  <strong>{viewer.name}</strong>
                  <small>{viewer.role}</small>
                </div>
                <span>{viewer.status}</span>
              </header>
              <div className="stress-viewer-progress">
                <i style={{ width: `${viewerProgress}%` }} />
              </div>
              <footer>
                <span>
                  {viewer.completedSteps} / {viewer.totalSteps}
                </span>
                <small>{viewer.currentStep || '等待下一步骤'}</small>
              </footer>
            </article>
          );
        })}
      </div>

      <div className="stress-runtime-grid">
        <section>
          <h2>生产队列</h2>
          <dl className="stress-queue-metrics">
            <div>
              <dt>等待</dt>
              <dd>{stressRun.queue.waiting}</dd>
            </div>
            <div>
              <dt>撰写</dt>
              <dd>{stressRun.queue.drafting}</dd>
            </div>
            <div>
              <dt>就绪</dt>
              <dd>{stressRun.queue.ready}</dd>
            </div>
            <div>
              <dt>播出</dt>
              <dd>{stressRun.queue.speaking}</dd>
            </div>
          </dl>
          <div className="stress-current-playback">
            <span>当前播出</span>
            <strong>
              {stressRun.currentPlayback?.viewerName ||
                (stressRun.queue.speaking ? '测试消息' : '空闲')}
            </strong>
            {stressRun.currentPlayback?.stepId && (
              <small>{stressRun.currentPlayback.stepId}</small>
            )}
            {stressRun.currentPlayback?.text && (
              <p>{stressRun.currentPlayback.text}</p>
            )}
          </div>
        </section>

        <section>
          <h2>已发现失败 · {stressRun.failures.length}</h2>
          <div className="stress-failure-list">
            {stressRun.failures.length ? (
              stressRun.failures
                .slice(-6)
                .reverse()
                .map((failure) => (
                  <article key={failure.id}>
                    <span>{formatFailureTime(failure.at)}</span>
                    <strong>
                      {[failure.viewerName, failure.stepId]
                        .filter(Boolean)
                        .join(' · ') || '运行级故障'}
                    </strong>
                    {failure.code && <small>{failure.code}</small>}
                    <p>{failure.message}</p>
                    {failure.diagnostic && (
                      <small>
                        {[
                          failure.diagnostic.stage && `stage=${failure.diagnostic.stage}`,
                          failure.diagnostic.queueStatus && `queue=${failure.diagnostic.queueStatus}`,
                          failure.diagnostic.finishReason && `reason=${failure.diagnostic.finishReason}`,
                          typeof failure.diagnostic.retryCount === 'number' && `retries=${failure.diagnostic.retryCount}`,
                          typeof failure.diagnostic.beatCount === 'number' && `beats=${failure.diagnostic.completedBeatCount ?? 0}/${failure.diagnostic.beatCount}`,
                          typeof failure.diagnostic.audioByteLength === 'number' && `bytes=${failure.diagnostic.audioByteLength}`,
                          failure.diagnostic.lastRuntimeStage && `last=${failure.diagnostic.lastRuntimeStage}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    )}
                  </article>
                ))
            ) : (
              <p className="stress-empty-state">尚未发现失败</p>
            )}
          </div>
        </section>
      </div>

      <footer className="stress-report-path">
        <span>独立报告</span>
        <code>{stressRun.reportPath || '测试完成并生成报告后显示路径'}</code>
      </footer>
    </section>
  );
}
