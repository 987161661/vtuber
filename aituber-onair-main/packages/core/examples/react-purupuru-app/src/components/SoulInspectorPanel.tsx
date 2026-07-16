import { useMemo, type CSSProperties } from 'react';
import './SoulInspectorPanel.css';

export type SoulInspectorRuntimeMode =
  | 'legacy'
  | 'shadow'
  | 'canary'
  | 'primary';

export type SoulInspectorEvidenceLevel =
  | 'production'
  | 'production-equivalent'
  | 'synthetic';

export type SoulInspectorOutcomeStatus =
  | 'queued'
  | 'generated'
  | 'spoken'
  | 'partial'
  | 'interrupted'
  | 'failed'
  | 'skipped';

export interface SoulInspectorGoalView {
  id: string;
  label?: string;
  family?: string;
  satisfaction?: number;
  targetSatisfaction?: number;
  weight?: number;
  frustration?: number;
  tension: number;
}

export interface SoulInspectorAffectView {
  valence: number;
  arousal: number;
  dominance: number;
  joy: number;
  anger: number;
  boredom: number;
  jealousy: number;
}

export interface SoulInspectorAppraisalView {
  goalCongruence: number;
  identityRespect: number;
  novelty: number;
  controllability: number;
  socialEvaluation: number;
  certainty: number;
  attentionCompetition: number;
  reasonCodes: readonly string[];
}

export interface SoulInspectorStateView {
  version: number;
  stateHash: string;
  constitutionHash?: string;
  updatedAt?: number;
  focusLabel?: string;
  goals: readonly SoulInspectorGoalView[];
  affect: SoulInspectorAffectView;
  lastAppraisal?: SoulInspectorAppraisalView | null;
}

export interface SoulInspectorEventView {
  id: string;
  kind: string;
  evidenceLevel: SoulInspectorEvidenceLevel;
  provenance: string;
  occurredAt?: number;
  actorLabel?: string;
  summary?: string;
}

export interface SoulInspectorCandidateView {
  candidateId: string;
  label?: string;
  utility: number;
  eligible: boolean;
  reasonCodes: readonly string[];
}

export interface SoulInspectorDecisionView {
  id: string;
  action: string;
  truthMode: string;
  utility: number;
  selectedCandidateId?: string;
  goalsServed: readonly string[];
  reasonCodes: readonly string[];
  candidateScores: readonly SoulInspectorCandidateView[];
  internalAffect: SoulInspectorAffectView;
  expressedAffect: SoulInspectorAffectView;
  createdAt?: number;
  expiresAt?: number;
}

export interface SoulInspectorOutcomeView {
  status: SoulInspectorOutcomeStatus;
  occurredAt?: number;
  deliveredFraction?: number;
  reasonCode?: string;
}

export interface SoulInspectorTelemetryView {
  modelProfileId?: string;
  firstContentMs?: number;
  totalMs?: number;
  fastPathMs?: number;
  fallback: boolean;
  fallbackReason?: string;
}

export interface SoulInspectorMemoryRefView {
  id: string;
  provenance: string;
  confidence: number;
}

export interface SoulInspectorControlState {
  cognitionFrozen: boolean;
  memoryIsolated: boolean;
  neutralFallbackActive: boolean;
  operatorHasControl: boolean;
  snapshotRecoveryAvailable?: boolean;
  busyControl?:
    | 'cognition'
    | 'memory'
    | 'fallback'
    | 'snapshot'
    | 'operator';
}

export interface SoulInspectorCanaryView {
  status:
    | 'idle'
    | 'starting'
    | 'active'
    | 'active-elsewhere'
    | 'finishing'
    | 'aborting'
    | 'error';
  runId?: string;
  startedAt?: number;
  elapsedMs?: number;
  scopeLabel?: string;
  runtimeOwnerClaimedAt?: number;
  primaryEligible: boolean;
  canStart: boolean;
  canFinish: boolean;
  canAbort: boolean;
  error?: string;
}

export interface SoulInspectorPanelProps {
  runtimeMode: SoulInspectorRuntimeMode;
  onRuntimeModeChange: (mode: SoulInspectorRuntimeMode) => void;
  state?: SoulInspectorStateView | null;
  event?: SoulInspectorEventView | null;
  decision?: SoulInspectorDecisionView | null;
  outcome?: SoulInspectorOutcomeView | null;
  telemetry?: SoulInspectorTelemetryView | null;
  /** References only; private memory content is intentionally not rendered. */
  memoryRefs?: readonly SoulInspectorMemoryRefView[];
  controls: SoulInspectorControlState;
  canary?: SoulInspectorCanaryView;
  onFreezeCognition?: (frozen: boolean) => void | Promise<void>;
  onIsolateMemory?: (isolated: boolean) => void | Promise<void>;
  onEnableNeutralFallback?: (enabled: boolean) => void | Promise<void>;
  onRecoverSnapshot?: () => void | Promise<void>;
  onOperatorTakeover?: (enabled: boolean) => void | Promise<void>;
  onStartCanary?: () => void | Promise<void>;
  onFinishCanary?: () => void | Promise<void>;
  onAbortCanary?: () => void | Promise<void>;
}

const modeLabels: Record<SoulInspectorRuntimeMode, string> = {
  legacy: 'Legacy 旧链',
  shadow: 'Shadow 影子',
  canary: 'Canary 分片',
  primary: 'Primary 主链',
};

const evidenceLabels: Record<SoulInspectorEvidenceLevel, string> = {
  production: '生产证据',
  'production-equivalent': '生产等价',
  synthetic: '合成证据',
};

const outcomeLabels: Record<SoulInspectorOutcomeStatus, string> = {
  queued: '已入队',
  generated: '已生成',
  spoken: '已播出',
  partial: '部分播出',
  interrupted: '已中断',
  failed: '执行失败',
  skipped: '已跳过',
};

const canaryStatusLabels: Record<SoulInspectorCanaryView['status'], string> = {
  idle: '未开始',
  starting: '正在启动',
  active: '服务端计时中',
  'active-elsewhere': '其他控制端持有操作令牌',
  finishing: '正在校验证据',
  aborting: '正在中止',
  error: '需要处理',
};

const appraisalAxes: ReadonlyArray<{
  key: keyof Omit<SoulInspectorAppraisalView, 'reasonCodes'>;
  label: string;
  bipolar?: boolean;
}> = [
  { key: 'goalCongruence', label: '目标一致', bipolar: true },
  { key: 'identityRespect', label: '身份尊重', bipolar: true },
  { key: 'novelty', label: '新颖度' },
  { key: 'controllability', label: '可控性' },
  { key: 'socialEvaluation', label: '社会评价', bipolar: true },
  { key: 'attentionCompetition', label: '注意竞争' },
];

const affectAxes: ReadonlyArray<{
  key: keyof SoulInspectorAffectView;
  label: string;
  bipolar?: boolean;
}> = [
  { key: 'valence', label: '效价', bipolar: true },
  { key: 'joy', label: '愉悦' },
  { key: 'anger', label: '愤怒' },
  { key: 'boredom', label: '无聊' },
  { key: 'jealousy', label: '吃醋' },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatLatency(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value < 1_000
    ? `${Math.round(value)} ms`
    : `${(value / 1_000).toFixed(2)} s`;
}

function formatDuration(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const totalMinutes = Math.max(0, Math.floor(value / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function formatTime(value?: number) {
  if (!value || !Number.isFinite(value)) return '—';
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function compactHash(value?: string) {
  if (!value) return '未生成';
  if (value.length <= 18) return value;
  return `${value.slice(0, 9)}…${value.slice(-7)}`;
}

function meterStyle(value: number, bipolar = false): CSSProperties {
  if (bipolar) {
    const normalized = clamp(value, -1, 1);
    return {
      '--soul-meter-start': `${normalized < 0 ? 50 + normalized * 50 : 50}%`,
      '--soul-meter-size': `${Math.abs(normalized) * 50}%`,
    } as CSSProperties;
  }
  return {
    '--soul-meter-start': '0%',
    '--soul-meter-size': `${clamp(value) * 100}%`,
  } as CSSProperties;
}

function utilityStyle(value: number, range: number): CSSProperties {
  const normalized = clamp(value / range, -1, 1);
  return {
    '--soul-utility-start': `${normalized < 0 ? 50 + normalized * 50 : 50}%`,
    '--soul-utility-size': `${Math.abs(normalized) * 50}%`,
  } as CSSProperties;
}

function EmptyStage({ children }: { children: string }) {
  return <p className="soul-inspector-empty">{children}</p>;
}

function MetricMeter({
  label,
  value,
  bipolar = false,
}: {
  label: string;
  value: number;
  bipolar?: boolean;
}) {
  return (
    <div className="soul-inspector-metric">
      <span>{label}</span>
      <div
        className={`soul-inspector-meter${bipolar ? ' is-bipolar' : ''}${
          value < 0 ? ' is-negative' : ''
        }`}
        style={meterStyle(value, bipolar)}
        role="meter"
        aria-label={label}
        aria-valuemin={bipolar ? -1 : 0}
        aria-valuemax={1}
        aria-valuenow={clamp(value, bipolar ? -1 : 0, 1)}
      >
        <span />
      </div>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function AffectComparison({
  internal,
  expressed,
}: {
  internal: SoulInspectorAffectView;
  expressed: SoulInspectorAffectView;
}) {
  return (
    <div className="soul-affect-comparison" aria-label="内部与外显情绪对照">
      <div className="soul-affect-legend" aria-hidden="true">
        <span>内部感受</span>
        <span>外显表达</span>
      </div>
      {affectAxes.map(({ key, label, bipolar }) => (
        <div className="soul-affect-row" key={key}>
          <span>{label}</span>
          <div className={`soul-affect-track${bipolar ? ' is-bipolar' : ''}`}>
            <i
              className="is-internal"
              style={{
                left: `${bipolar ? (clamp(internal[key], -1, 1) + 1) * 50 : clamp(internal[key]) * 100}%`,
              }}
            />
            <i
              className="is-expressed"
              style={{
                left: `${bipolar ? (clamp(expressed[key], -1, 1) + 1) * 50 : clamp(expressed[key]) * 100}%`,
              }}
            />
          </div>
          <code>
            {formatNumber(internal[key])}/{formatNumber(expressed[key])}
          </code>
        </div>
      ))}
    </div>
  );
}

function ReasonCodes({ codes }: { codes: readonly string[] }) {
  if (codes.length === 0) return null;
  return (
    <ul className="soul-reason-codes" aria-label="结构化原因码">
      {codes.slice(0, 6).map((code) => (
        <li key={code}>
          <code>{code}</code>
        </li>
      ))}
    </ul>
  );
}

export function SoulInspectorPanel({
  runtimeMode,
  onRuntimeModeChange,
  state,
  event,
  decision,
  outcome,
  telemetry,
  memoryRefs = [],
  controls,
  canary,
  onFreezeCognition,
  onIsolateMemory,
  onEnableNeutralFallback,
  onRecoverSnapshot,
  onOperatorTakeover,
  onStartCanary,
  onFinishCanary,
  onAbortCanary,
}: SoulInspectorPanelProps) {
  const activeGoals = useMemo(
    () =>
      [...(state?.goals ?? [])]
        .sort(
          (left, right) =>
            right.tension * (right.weight ?? 1) -
              left.tension * (left.weight ?? 1) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 3),
    [state?.goals],
  );
  const appraisal = state?.lastAppraisal;
  const candidateRange = Math.max(
    1,
    ...(decision?.candidateScores.map((candidate) =>
      Math.abs(candidate.utility),
    ) ?? []),
  );
  const selectedCandidate = decision?.selectedCandidateId;
  const evidenceLevel = event?.evidenceLevel ?? 'synthetic';
  const fallbackActive =
    controls.neutralFallbackActive || Boolean(telemetry?.fallback);

  return (
    <section
      className={`soul-inspector evidence-${evidenceLevel}`}
      aria-labelledby="soul-inspector-title"
    >
      <header className="soul-inspector-header">
        <div>
          <span className="soul-inspector-kicker">SOUL CAUSAL TRACE · V1</span>
          <h2 id="soul-inspector-title">灵魂检查器</h2>
          <p>只展示可审计的因果证据，不展示模型原始思维链。</p>
        </div>
        <label className="soul-mode-selector">
          <span>执行模式</span>
          <select
            value={runtimeMode}
            onChange={(input) =>
              onRuntimeModeChange(
                input.currentTarget.value as SoulInspectorRuntimeMode,
              )
            }
          >
            {(Object.keys(modeLabels) as SoulInspectorRuntimeMode[]).map(
              (mode) => (
                <option key={mode} value={mode}>
                  {modeLabels[mode]}
                </option>
              ),
            )}
          </select>
        </label>
      </header>

      <div className="soul-inspector-ledger" aria-label="运行状态摘要">
        <div>
          <span>证据等级</span>
          <strong className="soul-evidence-value">
            {evidenceLabels[evidenceLevel]}
          </strong>
        </div>
        <div>
          <span>状态版本</span>
          <strong>v{state?.version ?? '—'}</strong>
        </div>
        <div>
          <span>STATE HASH</span>
          <strong title={state?.stateHash}>{compactHash(state?.stateHash)}</strong>
        </div>
        <div>
          <span>当前关注</span>
          <strong>{state?.focusLabel || '未设定'}</strong>
        </div>
        <div>
          <span>FAST PATH</span>
          <strong>{formatLatency(telemetry?.fastPathMs)}</strong>
        </div>
        <div className={fallbackActive ? 'is-fallback' : ''}>
          <span>降级状态</span>
          <strong>{fallbackActive ? '确定性中性降级' : '未降级'}</strong>
        </div>
      </div>

      <ol className="soul-causal-track" aria-label="灵魂决策因果轨道">
        <li className={`soul-causal-stage${event ? ' has-evidence' : ''}`}>
          <div className="soul-stage-marker" aria-hidden="true">
            E
          </div>
          <article>
            <header>
              <span>01 · EVENT</span>
              <strong>发生了什么</strong>
            </header>
            {event ? (
              <>
                <div className="soul-stage-primary">
                  <strong>{event.kind}</strong>
                  <time>{formatTime(event.occurredAt)}</time>
                </div>
                <p>{event.summary || '事件已进入不可变账本。'}</p>
                <dl className="soul-stage-facts">
                  <div>
                    <dt>来源</dt>
                    <dd>{event.provenance}</dd>
                  </div>
                  <div>
                    <dt>主体</dt>
                    <dd>{event.actorLabel || '环境 / 系统'}</dd>
                  </div>
                  <div>
                    <dt>事件 ID</dt>
                    <dd title={event.id}>{compactHash(event.id)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <EmptyStage>等待下一条带来源的环境或观众事件。</EmptyStage>
            )}
          </article>
        </li>

        <li className={`soul-causal-stage${activeGoals.length ? ' has-evidence' : ''}`}>
          <div className="soul-stage-marker" aria-hidden="true">
            G
          </div>
          <article>
            <header>
              <span>02 · GOAL TENSION</span>
              <strong>哪些目标在拉扯</strong>
            </header>
            {activeGoals.length ? (
              <ol className="soul-goal-list">
                {activeGoals.map((goal, index) => (
                  <li key={goal.id}>
                    <div>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{goal.label || goal.family || goal.id}</strong>
                      <code>{formatNumber(goal.tension)}</code>
                    </div>
                    <div
                      className="soul-goal-tension"
                      role="meter"
                      aria-label={`${goal.label || goal.id}目标张力`}
                      aria-valuemin={0}
                      aria-valuemax={1}
                      aria-valuenow={clamp(goal.tension)}
                    >
                      <span style={{ width: `${clamp(goal.tension) * 100}%` }} />
                    </div>
                    <small>
                      满足 {formatNumber(goal.satisfaction ?? 0)} · 受挫{' '}
                      {formatNumber(goal.frustration ?? 0)} · 权重{' '}
                      {formatNumber(goal.weight ?? 0)}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyStage>状态尚未投影出可比较的目标张力。</EmptyStage>
            )}
          </article>
        </li>

        <li className={`soul-causal-stage${appraisal ? ' has-evidence' : ''}`}>
          <div className="soul-stage-marker" aria-hidden="true">
            A
          </div>
          <article>
            <header>
              <span>03 · APPRAISAL / AFFECT</span>
              <strong>她如何理解与感受</strong>
            </header>
            {appraisal && state ? (
              <>
                <div className="soul-appraisal-grid">
                  {appraisalAxes.map(({ key, label, bipolar }) => (
                    <MetricMeter
                      key={key}
                      label={label}
                      value={appraisal[key]}
                      bipolar={bipolar}
                    />
                  ))}
                </div>
                <div className="soul-affect-state">
                  <span>当前内部感受</span>
                  <strong>
                    愉悦 {formatNumber(state.affect.joy)} · 愤怒{' '}
                    {formatNumber(state.affect.anger)} · 无聊{' '}
                    {formatNumber(state.affect.boredom)}
                  </strong>
                </div>
                <ReasonCodes codes={appraisal.reasonCodes} />
              </>
            ) : (
              <EmptyStage>等待本地 appraisal 从事件与状态计算因果评价。</EmptyStage>
            )}
          </article>
        </li>

        <li className={`soul-causal-stage${decision ? ' has-evidence' : ''}`}>
          <div className="soul-stage-marker" aria-hidden="true">
            D
          </div>
          <article>
            <header>
              <span>04 · DECISION</span>
              <strong>为何选择这个行动</strong>
            </header>
            {decision ? (
              <>
                <div className="soul-decision-line">
                  <div>
                    <span>行动</span>
                    <strong>{decision.action}</strong>
                  </div>
                  <div>
                    <span>披露模式</span>
                    <strong>{decision.truthMode}</strong>
                  </div>
                  <div>
                    <span>效用</span>
                    <strong>{formatNumber(decision.utility)}</strong>
                  </div>
                </div>
                <div className="soul-candidate-list" role="list">
                  {decision.candidateScores.slice(0, 3).map((candidate) => (
                    <div
                      className={`soul-candidate${
                        candidate.candidateId === selectedCandidate
                          ? ' is-selected'
                          : ''
                      }${candidate.eligible ? '' : ' is-ineligible'}`}
                      key={candidate.candidateId}
                      role="listitem"
                    >
                      <div>
                        <strong>
                          {candidate.label || candidate.candidateId}
                        </strong>
                        <span>
                          {candidate.eligible ? '可执行' : '已拦截'} ·{' '}
                          {formatNumber(candidate.utility)}
                        </span>
                      </div>
                      <div
                        className={`soul-utility-track${
                          candidate.utility < 0 ? ' is-negative' : ''
                        }`}
                        style={utilityStyle(candidate.utility, candidateRange)}
                        aria-hidden="true"
                      >
                        <span />
                      </div>
                      {!candidate.eligible && candidate.reasonCodes[0] ? (
                        <small>{candidate.reasonCodes[0]}</small>
                      ) : null}
                    </div>
                  ))}
                </div>
                <AffectComparison
                  internal={decision.internalAffect}
                  expressed={decision.expressedAffect}
                />
                <ReasonCodes codes={decision.reasonCodes} />
                {memoryRefs.length > 0 ? (
                  <dl className="soul-stage-facts" aria-label="Memory references">
                    {memoryRefs.slice(0, 6).map((memory) => (
                      <div key={memory.id}>
                        <dt title={memory.id}>{compactHash(memory.id)}</dt>
                        <dd>
                          {memory.provenance} · {formatNumber(memory.confidence)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </>
            ) : (
              <EmptyStage>暂无经过本地效用与安全资格仲裁的决定。</EmptyStage>
            )}
          </article>
        </li>

        <li className={`soul-causal-stage${outcome ? ' has-evidence' : ''}`}>
          <div className="soul-stage-marker" aria-hidden="true">
            O
          </div>
          <article>
            <header>
              <span>05 · OUTCOME</span>
              <strong>现实执行结果</strong>
            </header>
            {outcome ? (
              <>
                <div className={`soul-outcome-status status-${outcome.status}`}>
                  <strong>{outcomeLabels[outcome.status]}</strong>
                  <time>{formatTime(outcome.occurredAt)}</time>
                </div>
                <dl className="soul-stage-facts">
                  <div>
                    <dt>播出比例</dt>
                    <dd>
                      {outcome.deliveredFraction === undefined
                        ? '—'
                        : `${Math.round(clamp(outcome.deliveredFraction) * 100)}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>结果原因</dt>
                    <dd>{outcome.reasonCode || 'outcome-recorded'}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <EmptyStage>决定尚未获得 queued / spoken / failed 等执行回执。</EmptyStage>
            )}
            <dl className="soul-telemetry">
              <div>
                <dt>首内容</dt>
                <dd>{formatLatency(telemetry?.firstContentMs)}</dd>
              </div>
              <div>
                <dt>完整响应</dt>
                <dd>{formatLatency(telemetry?.totalMs)}</dd>
              </div>
              <div>
                <dt>模型档案</dt>
                <dd>{telemetry?.modelProfileId || '—'}</dd>
              </div>
            </dl>
            {fallbackActive ? (
              <p className="soul-fallback-reason">
                {telemetry?.fallbackReason || '操作员已启用中性确定性降级。'}
              </p>
            ) : null}
          </article>
        </li>
      </ol>

      {canary ? (
        <section className="soul-canary-strip" aria-label="生产 Canary 验收">
          <div className="soul-canary-copy">
            <span>SERVER-ATTESTED CANARY</span>
            <strong>{canaryStatusLabels[canary.status]}</strong>
            <small>
              {canary.runId ? compactHash(canary.runId) : '等待一场真实直播'}
              {' · '}
              {formatDuration(canary.elapsedMs)}
              {canary.scopeLabel ? ` · ${canary.scopeLabel}` : ''}
            </small>
            {canary.runtimeOwnerClaimedAt ? (
              <small>
                Runtime Owner 已领取事件凭证 ·{' '}
                {formatTime(canary.runtimeOwnerClaimedAt)}
              </small>
            ) : null}
            {canary.error ? (
              <small className="soul-canary-error">{canary.error}</small>
            ) : null}
          </div>
          <div className="soul-canary-actions">
            <span>
              Primary 门禁：
              {canary.primaryEligible ? '已满足' : '需两场独立 2h 生产验收'}
            </span>
            <div>
              <button
                type="button"
                disabled={!canary.canStart || !onStartCanary}
                onClick={() => onStartCanary?.()}
              >
                开始本场验收
              </button>
              <button
                type="button"
                disabled={!canary.canFinish || !onFinishCanary}
                onClick={() => onFinishCanary?.()}
              >
                完成并校验
              </button>
              <button
                type="button"
                className="is-abort"
                disabled={!canary.canAbort || !onAbortCanary}
                onClick={() => onAbortCanary?.()}
              >
                中止本场
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <footer className="soul-operator-strip">
        <div>
          <span>OPERATOR BOUNDARY</span>
          <strong>
            {controls.operatorHasControl
              ? '操作员已接管执行权'
              : '灵魂层受协调器与安全门约束'}
          </strong>
        </div>
        <div className="soul-operator-controls" aria-label="灵魂运行安全控制">
          <button
            type="button"
            className={controls.cognitionFrozen ? 'is-active' : ''}
            aria-pressed={controls.cognitionFrozen}
            disabled={
              !onFreezeCognition || controls.busyControl === 'cognition'
            }
            onClick={() => onFreezeCognition?.(!controls.cognitionFrozen)}
          >
            {controls.cognitionFrozen ? '恢复认知' : '冻结认知'}
          </button>
          <button
            type="button"
            className={controls.memoryIsolated ? 'is-active' : ''}
            aria-pressed={controls.memoryIsolated}
            disabled={!onIsolateMemory || controls.busyControl === 'memory'}
            onClick={() => onIsolateMemory?.(!controls.memoryIsolated)}
          >
            {controls.memoryIsolated ? '解除记忆隔离' : '隔离记忆写入'}
          </button>
          <button
            type="button"
            className={controls.neutralFallbackActive ? 'is-active' : ''}
            aria-pressed={controls.neutralFallbackActive}
            disabled={
              !onEnableNeutralFallback || controls.busyControl === 'fallback'
            }
            onClick={() =>
              onEnableNeutralFallback?.(!controls.neutralFallbackActive)
            }
          >
            {controls.neutralFallbackActive ? '退出中性降级' : '启用中性降级'}
          </button>
          <button
            type="button"
            disabled={
              !onRecoverSnapshot ||
              !controls.snapshotRecoveryAvailable ||
              controls.busyControl === 'snapshot'
            }
            onClick={() => onRecoverSnapshot?.()}
          >
            恢复快照
          </button>
          <button
            type="button"
            className="is-takeover"
            aria-pressed={controls.operatorHasControl}
            disabled={
              !onOperatorTakeover || controls.busyControl === 'operator'
            }
            onClick={() => onOperatorTakeover?.(!controls.operatorHasControl)}
          >
            {controls.operatorHasControl ? '归还执行权' : '操作员接管'}
          </button>
        </div>
      </footer>
    </section>
  );
}
