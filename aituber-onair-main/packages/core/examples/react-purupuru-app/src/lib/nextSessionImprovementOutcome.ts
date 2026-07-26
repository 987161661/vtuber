import type { LiveSessionTrendRecord } from './liveSessionTrend';
import type { LiveSessionRecord } from './liveSessionLifecycle';
import type { NextSessionImprovementItem } from './nextSessionImprovementPlan';
import {
  crossesImprovementExperimentContext,
  type ImprovementExperimentContext,
} from './improvementExperimentContext';

export type NextSessionImprovementActionRuntimeEvent = {
  eventId?: string;
  stage?: string;
  at?: number;
  serverReceivedAt?: number;
  sessionId?: string;
  baseSessionId?: string;
  baseSessionSequence?: number;
  personaId?: string;
  platform?: string;
  roomId?: string;
  improvementId?: string;
  improvementAction?: string;
  strategyId?: string;
  strategyLabel?: string;
  strategyVariable?: string;
  strategyInstruction?: string;
  strategySuccessSignal?: string;
  strategyOrigin?: 'catalog' | 'custom';
  strategyAssetId?: string;
  strategyAssetOperation?: 'save' | 'archive' | 'restore';
  strategyVersion?: number;
  strategyCopiedFromAssetId?: string;
  strategyQualityScore?: number;
  strategyQualityStatus?: 'ready' | 'review' | 'blocked';
  strategyQualityWarningIds?: string[];
  strategyQualityBlockIds?: string[];
  strategyQualityGateVersion?: number;
  strategyQualityPolicyVersion?: number;
  strategyQualityWarningPenalty?: number;
  strategyQualityMaxInstructionClauses?: number;
  strategyQualityConfoundedExecution?: 'warn' | 'block';
  strategyQualityPolicyReason?: string;
  strategyQualityPolicyChangedFields?: string[];
  strategyQualityPolicyRollbackFromVersion?: number;
  strategyQualityPolicyTrigger?:
    | 'calibration'
    | 'revalidation'
    | 'rollback';
  strategyQualityPolicyRevalidationReason?: 'expired' | 'sample-gap';
  strategyQualityPolicyRevalidationPhase?: 'measure' | 'reset-baseline';
  strategyQualityPolicyRevalidationTargetField?: string;
  strategyQualityPolicyRevalidationTargetFrom?: number | string;
  strategyQualityPolicyRevalidationTargetTo?: number | string;
  strategyQualityPolicyRevalidationRequiredSamples?: number;
  strategyQualityPolicyRevalidationCollectedSamples?: number;
  strategyQualityPolicyRevalidationRemainingSamples?: number;
  strategyQualityPolicyRevalidationOperation?: 'cancel' | 'restart';
  strategyQualityPolicyRevalidationRunId?: string;
  strategyQualityPolicyRevalidationTerminalStatus?:
    | 'completed'
    | 'failed'
    | 'expired'
    | 'context-changed'
    | 'interrupted';
  strategyQualityPolicyRevalidationTerminalReason?:
    | 'fresh-evidence-threshold-met'
    | 'fresh-negative-evidence'
    | 'freshness-window-elapsed'
    | 'experiment-context-changed'
    | 'policy-release-interrupted';
  strategyQualityPolicyRevalidationEvidenceAt?: number;
  strategyQualityPolicyRevalidationEvidenceSummary?: string;
  experimentControlled?: boolean;
  experimentContextId?: string;
  experimentContextLabel?: string;
  outcome?: 'completed' | 'failed';
  error?: string;
};

export type NextSessionImprovementOutcomeRecord = {
  improvementId: string;
  improvementAction: string;
  baseSessionId: string;
  baseSequence: number;
  nextSessionId?: string;
  scoreDelta?: number;
  outcome:
    | 'pending'
    | 'improved'
    | 'stable'
    | 'declined'
    | 'confounded'
    | 'context-changed'
    | 'evidence-expired'
    | 'execution-failed';
};

export type NextSessionImprovementEffect = {
  improvementId: string;
  attempts: number;
  observed: number;
  pending: number;
  confounded: number;
  contextChanged: number;
  expired: number;
  executionFailures: number;
  improved: number;
  declined: number;
  averageScoreDelta: number | null;
  signal: 'insufficient' | 'positive' | 'neutral' | 'negative';
  summary: string;
};

export type NextSessionImprovementEffectiveness = {
  records: NextSessionImprovementOutcomeRecord[];
  effects: NextSessionImprovementEffect[];
};

export function createNextSessionImprovementActionEvent(input: {
  item: NextSessionImprovementItem;
  baseSession: LiveSessionRecord;
  scope: { personaId: string; platform: string; roomId: string };
  outcome: 'completed' | 'failed';
  strategy?: {
    id: string;
    label: string;
    controlled: boolean;
    variable?: string;
    instruction?: string;
    successSignal?: string;
    origin?: 'catalog' | 'custom';
  };
  experimentContext?: ImprovementExperimentContext;
  strategyQualityGateVersion?: number;
  error?: string;
  at?: number;
}): NextSessionImprovementActionRuntimeEvent {
  const at = input.at ?? Date.now();
  return {
    eventId: `next-session-improvement:${input.baseSession.sessionId}:${input.item.id}:${input.outcome}:${at}`,
    stage: 'operator_next_session_improvement_action',
    at,
    sessionId: input.baseSession.sessionId,
    baseSessionId: input.baseSession.sessionId,
    baseSessionSequence: input.baseSession.sequence,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    improvementId: input.item.id,
    improvementAction: input.item.action,
    strategyId: input.strategy?.id,
    strategyLabel: input.strategy?.label,
    strategyVariable: input.strategy?.variable,
    strategyInstruction: input.strategy?.instruction,
    strategySuccessSignal: input.strategy?.successSignal,
    strategyOrigin: input.strategy?.origin,
    strategyQualityGateVersion: input.strategyQualityGateVersion,
    experimentControlled: input.strategy?.controlled,
    experimentContextId: input.experimentContext?.id,
    experimentContextLabel: input.experimentContext?.label,
    outcome: input.outcome,
    error: input.error,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function eventTimestamp(
  event: NextSessionImprovementActionRuntimeEvent,
): number {
  return finiteNumber(event.at) ?? finiteNumber(event.serverReceivedAt) ?? 0;
}

function effectSummary(effect: Omit<NextSessionImprovementEffect, 'summary'>) {
  if (effect.executionFailures > 0 && effect.attempts === 0) {
    return `执行失败 ${effect.executionFailures} 次，尚无可观察的跨场结果。`;
  }
  if (!effect.observed) {
    if (effect.contextChanged) {
      return `${effect.contextChanged} 次动作跨越了模型、语音或播出配置变化，已停止归因并重新建立基线。`;
    }
    if (effect.expired) {
      return `${effect.expired} 次旧动作的基准场次已超出保留窗口，不再等待或参与归因。`;
    }
    if (effect.confounded) {
      return `${effect.confounded} 次动作因同时存在其他主要改动，未纳入跨场归因。`;
    }
    return effect.pending
      ? `已执行 ${effect.pending} 次，等待下一场复盘验证效果。`
      : '暂无跨场效果样本。';
  }
  const delta = effect.averageScoreDelta ?? 0;
  const direction = delta > 0 ? '提升' : delta < 0 ? '下降' : '持平';
  return `已观察 ${effect.observed} 次，下一场平均${direction} ${Math.abs(delta)} 分。`;
}

export function projectNextSessionImprovementEffectiveness(input: {
  actions: readonly NextSessionImprovementActionRuntimeEvent[];
  sessions: readonly LiveSessionTrendRecord[];
  scope: { personaId: string; platform: string; roomId: string };
  context?: ImprovementExperimentContext;
}): NextSessionImprovementEffectiveness {
  const latestActionByAttempt = new Map<
    string,
    NextSessionImprovementActionRuntimeEvent
  >();
  for (const event of input.actions) {
    const baseSessionId = (event.baseSessionId ?? event.sessionId)?.trim();
    const improvementId = event.improvementId?.trim();
    if (
      event.stage !== 'operator_next_session_improvement_action' ||
      !baseSessionId ||
      !improvementId ||
      (event.outcome !== 'completed' && event.outcome !== 'failed') ||
      event.personaId !== input.scope.personaId ||
      event.platform !== input.scope.platform ||
      event.roomId !== input.scope.roomId
    ) {
      continue;
    }
    if (
      input.context &&
      event.experimentContextId?.trim() !== input.context.id
    ) {
      continue;
    }
    const key = `${baseSessionId}:${improvementId}`;
    const existing = latestActionByAttempt.get(key);
    if (!existing || eventTimestamp(event) >= eventTimestamp(existing)) {
      latestActionByAttempt.set(key, event);
    }
  }

  const sessionById = new Map(
    input.sessions.map((session) => [session.sessionId, session]),
  );
  const sessionBySequence = new Map(
    input.sessions.map((session) => [session.sequence, session]),
  );
  const oldestRetainedSequence = input.sessions.length
    ? Math.min(...input.sessions.map(({ sequence }) => sequence))
    : undefined;
  const records: NextSessionImprovementOutcomeRecord[] = [];
  for (const event of latestActionByAttempt.values()) {
    const baseSessionId = (event.baseSessionId ?? event.sessionId) as string;
    const improvementId = event.improvementId as string;
    const base = sessionById.get(baseSessionId);
    const baseSequence =
      base?.sequence ?? finiteNumber(event.baseSessionSequence) ?? 0;
    if (event.outcome === 'failed') {
      records.push({
        improvementId,
        improvementAction: event.improvementAction?.trim() || 'unknown',
        baseSessionId,
        baseSequence,
        outcome: 'execution-failed',
      });
      continue;
    }
    if (event.experimentControlled === false) {
      records.push({
        improvementId,
        improvementAction: event.improvementAction?.trim() || 'unknown',
        baseSessionId,
        baseSequence,
        outcome: 'confounded',
      });
      continue;
    }
    if (!base) {
      records.push({
        improvementId,
        improvementAction: event.improvementAction?.trim() || 'unknown',
        baseSessionId,
        baseSequence,
        outcome:
          oldestRetainedSequence !== undefined &&
          baseSequence > 0 &&
          baseSequence < oldestRetainedSequence
            ? 'evidence-expired'
            : 'pending',
      });
      continue;
    }
    const next = sessionBySequence.get(baseSequence + 1);
    if (!next) {
      records.push({
        improvementId,
        improvementAction: event.improvementAction?.trim() || 'unknown',
        baseSessionId,
        baseSequence,
        outcome: 'pending',
      });
      continue;
    }
    if (
      crossesImprovementExperimentContext({
        actionContextId: event.experimentContextId,
        baseContextId: base.experimentContextId,
        nextContextId: next.experimentContextId,
      })
    ) {
      records.push({
        improvementId,
        improvementAction: event.improvementAction?.trim() || 'unknown',
        baseSessionId,
        baseSequence,
        nextSessionId: next.sessionId,
        outcome: 'context-changed',
      });
      continue;
    }
    const scoreDelta = next.score - base.score;
    records.push({
      improvementId,
      improvementAction: event.improvementAction?.trim() || 'unknown',
      baseSessionId,
      baseSequence,
      nextSessionId: next.sessionId,
      scoreDelta,
      outcome:
        scoreDelta >= 5 ? 'improved' : scoreDelta <= -5 ? 'declined' : 'stable',
    });
  }

  const recordsByImprovement = new Map<
    string,
    NextSessionImprovementOutcomeRecord[]
  >();
  for (const record of records) {
    const entries = recordsByImprovement.get(record.improvementId) ?? [];
    entries.push(record);
    recordsByImprovement.set(record.improvementId, entries);
  }
  const effects = [...recordsByImprovement.entries()]
    .map(([improvementId, entries]) => {
      const observed = entries.filter(
        ({ scoreDelta }) => scoreDelta !== undefined,
      );
      const averageScoreDelta = observed.length
        ? Math.round(
            observed.reduce(
              (total, record) => total + (record.scoreDelta ?? 0),
              0,
            ) / observed.length,
          )
        : null;
      const effectBase = {
        improvementId,
        attempts: entries.filter(
          ({ outcome }) => outcome !== 'execution-failed',
        ).length,
        observed: observed.length,
        pending: entries.filter(({ outcome }) => outcome === 'pending').length,
        confounded: entries.filter(({ outcome }) => outcome === 'confounded')
          .length,
        contextChanged: entries.filter(
          ({ outcome }) => outcome === 'context-changed',
        ).length,
        expired: entries.filter(
          ({ outcome }) => outcome === 'evidence-expired',
        ).length,
        executionFailures: entries.filter(
          ({ outcome }) => outcome === 'execution-failed',
        ).length,
        improved: entries.filter(({ outcome }) => outcome === 'improved')
          .length,
        declined: entries.filter(({ outcome }) => outcome === 'declined')
          .length,
        averageScoreDelta,
        signal:
          averageScoreDelta === null
            ? ('insufficient' as const)
            : averageScoreDelta >= 5
              ? ('positive' as const)
              : averageScoreDelta <= -5
                ? ('negative' as const)
                : ('neutral' as const),
      };
      return { ...effectBase, summary: effectSummary(effectBase) };
    })
    .sort((left, right) => right.observed - left.observed);

  return { records, effects };
}

function improvementActionEventKey(
  event: NextSessionImprovementActionRuntimeEvent,
): string {
  return (
    event.eventId ??
    [
      event.stage,
      event.baseSessionId ?? event.sessionId,
      event.improvementId,
      event.outcome,
      event.at,
    ].join(':')
  );
}

export function mergeNextSessionImprovementActionEvents(input: {
  remote: readonly NextSessionImprovementActionRuntimeEvent[];
  local: readonly NextSessionImprovementActionRuntimeEvent[];
  now?: number;
  optimisticTtlMs?: number;
}): NextSessionImprovementActionRuntimeEvent[] {
  const now = input.now ?? Date.now();
  const optimisticTtlMs = input.optimisticTtlMs ?? 10_000;
  const remoteKeys = new Set(input.remote.map(improvementActionEventKey));
  const pending = input.local.filter((event) => {
    if (remoteKeys.has(improvementActionEventKey(event))) return false;
    const at = eventTimestamp(event);
    return at > 0 && now - at <= optimisticTtlMs;
  });
  return [...input.remote, ...pending].sort(
    (left, right) => eventTimestamp(left) - eventTimestamp(right),
  );
}
