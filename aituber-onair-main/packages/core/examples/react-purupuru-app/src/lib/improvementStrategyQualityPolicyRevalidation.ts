import type { ImprovementStrategyQualityPolicyEffectLedger } from './improvementStrategyQualityPolicyEffectLedger';
import { IMPROVEMENT_STRATEGY_QUALITY_POLICY_EFFECT_FRESHNESS_MS } from './improvementStrategyQualityPolicyEffectLedger';
import type { ImprovementExperimentContext } from './improvementExperimentContext';
import {
  IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES,
  createImprovementStrategyQualityPolicyRevalidationRunId,
  type ImprovementStrategyQualityPolicyRevalidationTarget,
} from './improvementStrategyQualityPolicy';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

type RevalidationScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

export type ImprovementStrategyQualityPolicyRevalidationTerminalStatus =
  | 'completed'
  | 'failed'
  | 'expired'
  | 'context-changed'
  | 'interrupted';

export type ImprovementStrategyQualityPolicyRevalidationTerminalReason =
  | 'fresh-evidence-threshold-met'
  | 'fresh-negative-evidence'
  | 'freshness-window-elapsed'
  | 'experiment-context-changed'
  | 'policy-release-interrupted';

export type ImprovementStrategyQualityPolicyRevalidationConclusion = {
  reason: ImprovementStrategyQualityPolicyRevalidationTerminalReason;
  evidenceAt: number | null;
  evidenceSummary: string;
};

export type ImprovementStrategyQualityPolicyRevalidationLifecycle = {
  status:
    | 'idle'
    | 'active'
    | 'completed'
    | 'failed'
    | 'expired'
    | 'cancelled'
    | 'context-changed'
    | 'interrupted';
  target: ImprovementStrategyQualityPolicyRevalidationTarget | null;
  runId: string | null;
  phase: 'measure' | 'reset-baseline' | null;
  startedAt: number | null;
  progress: {
    collectedFreshSamples: number;
    requiredFreshSamples: number;
    remainingFreshSamples: number;
  };
  conclusion: ImprovementStrategyQualityPolicyRevalidationConclusion | null;
  summary: string;
};

const terminalReasonByStatus: Record<
  ImprovementStrategyQualityPolicyRevalidationTerminalStatus,
  ImprovementStrategyQualityPolicyRevalidationTerminalReason
> = {
  completed: 'fresh-evidence-threshold-met',
  failed: 'fresh-negative-evidence',
  expired: 'freshness-window-elapsed',
  'context-changed': 'experiment-context-changed',
  interrupted: 'policy-release-interrupted',
};

const validFields = new Set([
  'warningPenalty',
  'maxInstructionClauses',
  'confoundedExecution',
]);

function eventTimestamp(
  event: NextSessionImprovementActionRuntimeEvent,
): number {
  const value = event.at ?? event.serverReceivedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inScope(
  event: NextSessionImprovementActionRuntimeEvent,
  scope: RevalidationScope,
): boolean {
  return (
    event.personaId === scope.personaId &&
    event.platform === scope.platform &&
    event.roomId === scope.roomId
  );
}

function targetFromEvent(
  event: NextSessionImprovementActionRuntimeEvent,
): ImprovementStrategyQualityPolicyRevalidationTarget | null {
  const field = event.strategyQualityPolicyRevalidationTargetField;
  const from = event.strategyQualityPolicyRevalidationTargetFrom;
  const to = event.strategyQualityPolicyRevalidationTargetTo;
  if (
    typeof field !== 'string' ||
    !validFields.has(field) ||
    (typeof from !== 'number' && typeof from !== 'string') ||
    (typeof to !== 'number' && typeof to !== 'string')
  ) {
    return null;
  }
  return {
    field: field as ImprovementStrategyQualityPolicyRevalidationTarget['field'],
    from,
    to,
  };
}

function sameTarget(
  left: ImprovementStrategyQualityPolicyRevalidationTarget,
  right: ImprovementStrategyQualityPolicyRevalidationTarget,
): boolean {
  return (
    left.field === right.field &&
    left.from === right.from &&
    left.to === right.to
  );
}

function runIdFromEvent(
  event: NextSessionImprovementActionRuntimeEvent,
  target: ImprovementStrategyQualityPolicyRevalidationTarget,
): string {
  return (
    event.strategyQualityPolicyRevalidationRunId ??
    `legacy-${createImprovementStrategyQualityPolicyRevalidationRunId(
      target,
      eventTimestamp(event),
    )}`
  );
}

function conclusionFromTerminalEvent(
  event: NextSessionImprovementActionRuntimeEvent,
  status: ImprovementStrategyQualityPolicyRevalidationTerminalStatus,
): ImprovementStrategyQualityPolicyRevalidationConclusion {
  return {
    reason:
      event.strategyQualityPolicyRevalidationTerminalReason ??
      terminalReasonByStatus[status],
    evidenceAt:
      typeof event.strategyQualityPolicyRevalidationEvidenceAt ===
        'number' &&
      Number.isFinite(
        event.strategyQualityPolicyRevalidationEvidenceAt,
      )
        ? event.strategyQualityPolicyRevalidationEvidenceAt
        : eventTimestamp(event),
    evidenceSummary:
      event.strategyQualityPolicyRevalidationEvidenceSummary ??
      '该终态由旧版审计事件恢复，未保存详细证据摘要。',
  };
}

export function projectImprovementStrategyQualityPolicyRevalidationLifecycle(
  input: {
    events: readonly NextSessionImprovementActionRuntimeEvent[];
    ledger: ImprovementStrategyQualityPolicyEffectLedger;
    scope: RevalidationScope;
    context?: ImprovementExperimentContext;
    now?: number;
    freshnessWindowMs?: number;
  },
): ImprovementStrategyQualityPolicyRevalidationLifecycle {
  const scopedLifecycleEvents = input.events
    .filter(
      (event) =>
        inScope(event, input.scope) &&
        (event.stage ===
          'operator_next_session_improvement_quality_policy' ||
          event.stage ===
            'operator_next_session_improvement_quality_policy_revalidation_control'),
    )
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
  const latestRevalidation = [...scopedLifecycleEvents]
    .reverse()
    .find(
      (event) =>
        (event.strategyQualityPolicyTrigger === 'revalidation' ||
          event.strategyQualityPolicyRevalidationOperation === 'cancel' ||
          event.strategyQualityPolicyRevalidationOperation === 'restart' ||
          event.strategyQualityPolicyRevalidationTerminalStatus !==
            undefined) &&
        targetFromEvent(event) !== null,
    );
  const emptyProgress = {
    collectedFreshSamples: 0,
    requiredFreshSamples:
      IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES,
    remainingFreshSamples:
      IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES,
  };
  if (!latestRevalidation) {
    return {
      status: 'idle',
      target: null,
      runId: null,
      phase: null,
      startedAt: null,
      progress: emptyProgress,
      conclusion: null,
      summary: '当前没有进行中的质量门禁复验。',
    };
  }
  const target = targetFromEvent(latestRevalidation)!;
  const runId = runIdFromEvent(latestRevalidation, target);
  const startedAt = Math.min(
    ...scopedLifecycleEvents
      .filter((event) => {
        const eventTarget = targetFromEvent(event);
        return (
          eventTarget !== null &&
          runIdFromEvent(event, eventTarget) === runId
        );
      })
      .map(eventTimestamp),
  );
  const requiredFreshSamples =
    latestRevalidation.strategyQualityPolicyRevalidationRequiredSamples ??
    IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES;
  const effect = input.ledger.directionEffects.find((candidate) =>
    sameTarget(candidate, target),
  );
  const collectedFreshSamples = Math.min(
    requiredFreshSamples,
    Math.max(
      latestRevalidation
        .strategyQualityPolicyRevalidationCollectedSamples ?? 0,
      effect?.freshSamples ?? 0,
    ),
  );
  const progress = {
    collectedFreshSamples,
    requiredFreshSamples,
    remainingFreshSamples: Math.max(
      0,
      requiredFreshSamples - collectedFreshSamples,
    ),
  };
  const laterRelease = scopedLifecycleEvents.find(
    (event) =>
      eventTimestamp(event) > startedAt &&
      event.stage ===
        'operator_next_session_improvement_quality_policy' &&
      event.strategyQualityPolicyTrigger !== 'revalidation',
  );
  const phase =
    latestRevalidation.strategyQualityPolicyRevalidationPhase ?? 'measure';
  const now = input.now ?? Date.now();
  const freshnessWindowMs =
    input.freshnessWindowMs ??
    IMPROVEMENT_STRATEGY_QUALITY_POLICY_EFFECT_FRESHNESS_MS;
  const terminalStatus =
    latestRevalidation.strategyQualityPolicyRevalidationTerminalStatus;
  if (terminalStatus) {
    const terminalSummary: Record<
      ImprovementStrategyQualityPolicyRevalidationTerminalStatus,
      string
    > = {
      completed: '复验已完成，终态结论已写入审计记录。',
      failed: '复验产生新鲜负向证据，失败结论已写入审计记录。',
      expired: '复验未在有效期内完成，过期结论已写入审计记录。',
      'context-changed': '运行上下文已变化，本轮复验终止并完成审计。',
      interrupted: '其他质量门禁发布中断了本轮复验，终态已完成审计。',
    };
    return {
      status: terminalStatus,
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: conclusionFromTerminalEvent(
        latestRevalidation,
        terminalStatus,
      ),
      summary: terminalSummary[terminalStatus],
    };
  }
  if (
    latestRevalidation.strategyQualityPolicyRevalidationOperation ===
    'cancel'
  ) {
    return {
      status: 'cancelled',
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: null,
      summary: '运营者已显式取消复验，目标锁已解除。',
    };
  }
  if (
    input.context &&
    latestRevalidation.experimentContextId &&
    latestRevalidation.experimentContextId !== input.context.id
  ) {
    return {
      status: 'context-changed',
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: {
        reason: 'experiment-context-changed',
        evidenceAt: now,
        evidenceSummary:
          `启动上下文 ${latestRevalidation.experimentContextId}，` +
          `当前上下文 ${input.context.id}。`,
      },
      summary: '当前运行上下文与复验启动上下文不同，目标锁已解除。',
    };
  }
  if (laterRelease) {
    return {
      status: 'interrupted',
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: {
        reason: 'policy-release-interrupted',
        evidenceAt: eventTimestamp(laterRelease),
        evidenceSummary:
          `V${laterRelease.strategyQualityPolicyVersion ?? '?'} ` +
          `${laterRelease.strategyQualityPolicyTrigger ?? 'unknown'} 发布中断复验。`,
      },
      summary: '复验开始后出现了其他门禁发布，目标锁已解除。',
    };
  }
  if (
    effect?.influence === 'automatic' &&
    progress.remainingFreshSamples === 0
  ) {
    return {
      status: 'completed',
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: {
        reason: 'fresh-evidence-threshold-met',
        evidenceAt: effect.latestEvidenceAt,
        evidenceSummary:
          `新鲜精准样本 ${progress.collectedFreshSamples}/` +
          `${progress.requiredFreshSamples}；影响级别 automatic。`,
      },
      summary: '复验已补齐新鲜精确样本，目标方向恢复自动影响。',
    };
  }
  if (
    effect?.recommendation === 'caution' &&
    (effect.latestEvidenceAt ?? 0) >= startedAt
  ) {
    return {
      status: 'failed',
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: {
        reason: 'fresh-negative-evidence',
        evidenceAt: effect.latestEvidenceAt,
        evidenceSummary:
          `建议 caution；改进 ${effect.improved}，退化 ` +
          `${effect.regressed}，新鲜样本 ${effect.freshSamples}。`,
      },
      summary: '复验产生了新鲜负向证据，目标锁已停止。',
    };
  }
  if (now - startedAt > freshnessWindowMs) {
    return {
      status: 'expired',
      target,
      runId,
      phase,
      startedAt,
      progress,
      conclusion: {
        reason: 'freshness-window-elapsed',
        evidenceAt: now,
        evidenceSummary:
          `已收集 ${progress.collectedFreshSamples}/` +
          `${progress.requiredFreshSamples} 个新鲜精准样本，` +
          `仍缺 ${progress.remainingFreshSamples}。`,
      },
      summary: '复验在有效期内未完成，目标锁已过期。',
    };
  }
  return {
    status: 'active',
    target,
    runId,
    phase,
    startedAt,
    progress,
    conclusion: null,
    summary:
      phase === 'reset-baseline'
        ? '复验正在恢复测量基线，完成观察后继续目标方向。'
        : '复验正在积累目标方向的新鲜精确样本。',
  };
}

export function createImprovementStrategyQualityPolicyRevalidationControlEvent(
  input: {
    operation: 'cancel' | 'restart';
    target: ImprovementStrategyQualityPolicyRevalidationTarget;
    scope: RevalidationScope;
    context?: ImprovementExperimentContext;
    progress?: {
      collectedFreshSamples: number;
      requiredFreshSamples: number;
    };
    runId?: string;
    at?: number;
  },
): NextSessionImprovementActionRuntimeEvent {
  const at = input.at ?? Date.now();
  const requiredFreshSamples =
    input.progress?.requiredFreshSamples ??
    IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES;
  const collectedFreshSamples = Math.min(
    requiredFreshSamples,
    Math.max(0, input.progress?.collectedFreshSamples ?? 0),
  );
  const runId =
    input.operation === 'restart'
      ? createImprovementStrategyQualityPolicyRevalidationRunId(
          input.target,
          at,
        )
      : input.runId ??
        createImprovementStrategyQualityPolicyRevalidationRunId(
          input.target,
          at,
        );
  return {
    eventId: `improvement-strategy-quality-policy-revalidation:${input.operation}:${at}`,
    stage:
      'operator_next_session_improvement_quality_policy_revalidation_control',
    at,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    strategyQualityPolicyRevalidationOperation: input.operation,
    strategyQualityPolicyRevalidationRunId: runId,
    strategyQualityPolicyRevalidationTargetField: input.target.field,
    strategyQualityPolicyRevalidationTargetFrom: input.target.from,
    strategyQualityPolicyRevalidationTargetTo: input.target.to,
    strategyQualityPolicyRevalidationRequiredSamples:
      requiredFreshSamples,
    strategyQualityPolicyRevalidationCollectedSamples:
      collectedFreshSamples,
    strategyQualityPolicyRevalidationRemainingSamples: Math.max(
      0,
      requiredFreshSamples - collectedFreshSamples,
    ),
    experimentContextId: input.context?.id,
    experimentContextLabel: input.context?.label,
  };
}

export function createImprovementStrategyQualityPolicyRevalidationTerminalEvent(
  input: {
    lifecycle: ImprovementStrategyQualityPolicyRevalidationLifecycle & {
      status: ImprovementStrategyQualityPolicyRevalidationTerminalStatus;
      target: ImprovementStrategyQualityPolicyRevalidationTarget;
      runId: string;
    };
    scope: RevalidationScope;
    context?: ImprovementExperimentContext;
    at?: number;
  },
): NextSessionImprovementActionRuntimeEvent {
  const at = input.at ?? Date.now();
  const { lifecycle } = input;
  const conclusion =
    lifecycle.conclusion ??
    ({
      reason: terminalReasonByStatus[lifecycle.status],
      evidenceAt: at,
      evidenceSummary:
        '终态由兼容路径写入，未提供详细证据摘要。',
    } satisfies ImprovementStrategyQualityPolicyRevalidationConclusion);
  return {
    eventId:
      `improvement-strategy-quality-policy-revalidation:terminal:` +
      `${lifecycle.runId}:${lifecycle.status}`,
    stage:
      'operator_next_session_improvement_quality_policy_revalidation_control',
    at,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    strategyQualityPolicyRevalidationTerminalStatus: lifecycle.status,
    strategyQualityPolicyRevalidationTerminalReason: conclusion.reason,
    strategyQualityPolicyRevalidationEvidenceAt:
      conclusion.evidenceAt ?? undefined,
    strategyQualityPolicyRevalidationEvidenceSummary:
      conclusion.evidenceSummary,
    strategyQualityPolicyRevalidationRunId: lifecycle.runId,
    strategyQualityPolicyRevalidationPhase: lifecycle.phase ?? 'measure',
    strategyQualityPolicyRevalidationTargetField: lifecycle.target.field,
    strategyQualityPolicyRevalidationTargetFrom: lifecycle.target.from,
    strategyQualityPolicyRevalidationTargetTo: lifecycle.target.to,
    strategyQualityPolicyRevalidationRequiredSamples:
      lifecycle.progress.requiredFreshSamples,
    strategyQualityPolicyRevalidationCollectedSamples:
      lifecycle.progress.collectedFreshSamples,
    strategyQualityPolicyRevalidationRemainingSamples:
      lifecycle.progress.remainingFreshSamples,
    experimentContextId: input.context?.id,
    experimentContextLabel: input.context?.label,
  };
}

export type ImprovementStrategyQualityPolicyRevalidationRun = {
  runId: string;
  target: ImprovementStrategyQualityPolicyRevalidationTarget;
  status:
    | Exclude<
        ImprovementStrategyQualityPolicyRevalidationLifecycle['status'],
        'idle'
      >
    | 'superseded';
  startedAt: number;
  endedAt: number;
  actions: Array<
    | 'measure'
    | 'reset-baseline'
    | 'cancel'
    | 'restart'
    | ImprovementStrategyQualityPolicyRevalidationTerminalStatus
  >;
  eventCount: number;
  conclusion: ImprovementStrategyQualityPolicyRevalidationConclusion | null;
};

export type ImprovementStrategyQualityPolicyRevalidationHistory = {
  runs: ImprovementStrategyQualityPolicyRevalidationRun[];
};

function revalidationAction(
  event: NextSessionImprovementActionRuntimeEvent,
): ImprovementStrategyQualityPolicyRevalidationRun['actions'][number] | null {
  if (event.strategyQualityPolicyRevalidationTerminalStatus) {
    return event.strategyQualityPolicyRevalidationTerminalStatus;
  }
  if (event.strategyQualityPolicyRevalidationOperation) {
    return event.strategyQualityPolicyRevalidationOperation;
  }
  if (event.strategyQualityPolicyTrigger === 'revalidation') {
    return event.strategyQualityPolicyRevalidationPhase ?? 'measure';
  }
  return null;
}

export function projectImprovementStrategyQualityPolicyRevalidationHistory(
  input: {
    events: readonly NextSessionImprovementActionRuntimeEvent[];
    current: ImprovementStrategyQualityPolicyRevalidationLifecycle;
    scope: RevalidationScope;
  },
): ImprovementStrategyQualityPolicyRevalidationHistory {
  const grouped = new Map<
    string,
    {
      target: ImprovementStrategyQualityPolicyRevalidationTarget;
      events: NextSessionImprovementActionRuntimeEvent[];
    }
  >();
  for (const event of input.events) {
    if (!inScope(event, input.scope) || !revalidationAction(event)) {
      continue;
    }
    const target = targetFromEvent(event);
    if (!target) continue;
    const runId = runIdFromEvent(event, target);
    const group = grouped.get(runId);
    if (group) {
      group.events.push(event);
    } else {
      grouped.set(runId, { target, events: [event] });
    }
  }
  const runs = [...grouped.entries()]
    .map(([runId, group]) => {
      const events = [...group.events].sort(
        (left, right) => eventTimestamp(left) - eventTimestamp(right),
      );
      const actions = events
        .map(revalidationAction)
        .filter(
          (
            action,
          ): action is ImprovementStrategyQualityPolicyRevalidationRun['actions'][number] =>
            action !== null,
        );
      const terminalStatus = [...events]
        .reverse()
        .map(
          (event) =>
            event.strategyQualityPolicyRevalidationTerminalStatus,
        )
        .find(
          (
            status,
          ): status is ImprovementStrategyQualityPolicyRevalidationTerminalStatus =>
            status !== undefined,
        );
      const terminalEvent = [...events]
        .reverse()
        .find(
          (event) =>
            event.strategyQualityPolicyRevalidationTerminalStatus !==
            undefined,
        );
      const finalAction = actions.at(-1);
      const status:
        | ImprovementStrategyQualityPolicyRevalidationRun['status'] =
        input.current.runId === runId &&
        input.current.status !== 'idle'
          ? input.current.status
          : terminalStatus
            ? terminalStatus
            : finalAction === 'cancel'
              ? 'cancelled'
              : 'superseded';
      const conclusion =
        input.current.runId === runId && input.current.conclusion
          ? input.current.conclusion
          : terminalEvent?.strategyQualityPolicyRevalidationTerminalStatus
            ? conclusionFromTerminalEvent(
                terminalEvent,
                terminalEvent.strategyQualityPolicyRevalidationTerminalStatus,
              )
            : null;
      return {
        runId,
        target: group.target,
        status,
        startedAt: eventTimestamp(events[0]),
        endedAt: eventTimestamp(events[events.length - 1]),
        actions,
        eventCount: events.length,
        conclusion,
      };
    })
    .sort((left, right) => right.startedAt - left.startedAt);
  return { runs };
}
