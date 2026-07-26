import type { ImprovementStrategyExperimentRecord } from './improvementStrategyExperiment';
import { calibrateImprovementStrategyQuality } from './improvementStrategyQualityCalibration';
import type { ImprovementStrategyQualityCheck } from './improvementStrategyQuality';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

type ObservationScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

export type ImprovementStrategyQualityPolicyReleaseMetrics = {
  version: number;
  reviewAttempts: number;
  blockedReviews: number;
  blockRate: number | null;
  eligibleStrategies: number;
  executedStrategies: number;
  executionRate: number | null;
  evidenceEvaluated: number;
  usabilityRate: number | null;
};

export type ImprovementStrategyQualityPolicyReleaseObservation = {
  status: 'insufficient' | 'healthy' | 'watch' | 'rollback-recommended';
  recommendRollback: boolean;
  baseline: ImprovementStrategyQualityPolicyReleaseMetrics;
  current: ImprovementStrategyQualityPolicyReleaseMetrics;
  delta: {
    blockRate: number | null;
    executionRate: number | null;
    usabilityRate: number | null;
  };
  reasons: string[];
  summary: string;
};

function inScope(
  event: NextSessionImprovementActionRuntimeEvent,
  scope: ObservationScope,
): boolean {
  return (
    event.personaId === scope.personaId &&
    event.platform === scope.platform &&
    event.roomId === scope.roomId
  );
}

function rate(part: number, total: number): number | null {
  return total ? Math.round((part / total) * 100) : null;
}

function delta(
  current: number | null,
  baseline: number | null,
): number | null {
  return current === null || baseline === null
    ? null
    : current - baseline;
}

function releaseMetrics(input: {
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  records: readonly ImprovementStrategyExperimentRecord[];
  scope: ObservationScope;
  version: number;
}): ImprovementStrategyQualityPolicyReleaseMetrics {
  const scopedEvents = input.events.filter((event) =>
    inScope(event, input.scope),
  );
  const savedReviews = scopedEvents.filter(
    (event) =>
      event.stage ===
        'operator_next_session_improvement_strategy_asset' &&
      event.strategyAssetOperation === 'save' &&
      event.strategyQualityGateVersion === input.version &&
      (event.strategyQualityStatus === 'ready' ||
        event.strategyQualityStatus === 'review'),
  );
  const blockedReviews = scopedEvents.filter(
    (event) =>
      event.stage ===
        'operator_next_session_improvement_quality_review' &&
      event.strategyQualityGateVersion === input.version &&
      event.strategyQualityStatus === 'blocked',
  );
  const eligibleStrategyIds = new Set(
    savedReviews
      .map(({ strategyId }) => strategyId?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const executedStrategyIds = new Set(
    scopedEvents
      .filter(
        (event) =>
          event.stage === 'operator_next_session_improvement_action' &&
          event.outcome === 'completed' &&
          event.strategyOrigin === 'custom' &&
          event.strategyQualityGateVersion === input.version &&
          eligibleStrategyIds.has(event.strategyId?.trim() ?? ''),
      )
      .map(({ strategyId }) => strategyId as string),
  );
  const calibration = calibrateImprovementStrategyQuality({
    events: input.events,
    records: input.records,
    scope: input.scope,
    gateVersion: input.version,
  });
  const reviewAttempts = savedReviews.length + blockedReviews.length;
  return {
    version: input.version,
    reviewAttempts,
    blockedReviews: blockedReviews.length,
    blockRate: rate(blockedReviews.length, reviewAttempts),
    eligibleStrategies: eligibleStrategyIds.size,
    executedStrategies: executedStrategyIds.size,
    executionRate: rate(
      executedStrategyIds.size,
      eligibleStrategyIds.size,
    ),
    evidenceEvaluated: calibration.evidence.evaluated,
    usabilityRate: calibration.evidence.usabilityRate,
  };
}

export function createImprovementStrategyQualityRejectionEvent(input: {
  improvementId: string;
  scope: ObservationScope;
  gateVersion: number;
  review: {
    status: 'blocked';
    score: number;
    blockIds: ImprovementStrategyQualityCheck['id'][];
  };
  at?: number;
}): NextSessionImprovementActionRuntimeEvent {
  const at = input.at ?? Date.now();
  return {
    eventId: `improvement-strategy-quality-review:${input.gateVersion}:${at}`,
    stage: 'operator_next_session_improvement_quality_review',
    at,
    improvementId: input.improvementId,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    strategyQualityStatus: 'blocked',
    strategyQualityScore: Math.max(
      0,
      Math.min(100, Math.round(input.review.score)),
    ),
    strategyQualityGateVersion: input.gateVersion,
    strategyQualityBlockIds: [
      ...new Set(input.review.blockIds),
    ],
  };
}

export function observeImprovementStrategyQualityPolicyRelease(input: {
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  records: readonly ImprovementStrategyExperimentRecord[];
  scope: ObservationScope;
  currentVersion: number;
  baselineVersion: number;
}): ImprovementStrategyQualityPolicyReleaseObservation {
  const baseline = releaseMetrics({
    ...input,
    version: input.baselineVersion,
  });
  const current = releaseMetrics({
    ...input,
    version: input.currentVersion,
  });
  const releaseDelta = {
    blockRate: delta(current.blockRate, baseline.blockRate),
    executionRate: delta(
      current.executionRate,
      baseline.executionRate,
    ),
    usabilityRate: delta(
      current.usabilityRate,
      baseline.usabilityRate,
    ),
  };
  const comparable =
    baseline.reviewAttempts >= 3 &&
    current.reviewAttempts >= 3 &&
    baseline.evidenceEvaluated >= 3 &&
    current.evidenceEvaluated >= 3;
  if (!comparable) {
    return {
      status: 'insufficient',
      recommendRollback: false,
      baseline,
      current,
      delta: releaseDelta,
      reasons: [],
      summary: `观察窗尚未就绪：当前 V${current.version} 已有 ${current.reviewAttempts}/3 次评审、${current.evidenceEvaluated}/3 个结果。`,
    };
  }
  const reasons: string[] = [];
  if ((releaseDelta.usabilityRate ?? 0) <= -20) {
    reasons.push(
      `证据可用率较 V${baseline.version} 下降 ${Math.abs(releaseDelta.usabilityRate ?? 0)} 个百分点。`,
    );
  }
  if ((releaseDelta.blockRate ?? 0) >= 20) {
    reasons.push(
      `策略阻断率较 V${baseline.version} 上升 ${releaseDelta.blockRate} 个百分点。`,
    );
  }
  if ((releaseDelta.executionRate ?? 0) <= -20) {
    reasons.push(
      `策略执行覆盖率较 V${baseline.version} 下降 ${Math.abs(releaseDelta.executionRate ?? 0)} 个百分点。`,
    );
  }
  const recommendRollback =
    reasons.length >= 2 || (releaseDelta.usabilityRate ?? 0) <= -35;
  const status: ImprovementStrategyQualityPolicyReleaseObservation['status'] =
    recommendRollback
      ? 'rollback-recommended'
      : reasons.length
        ? 'watch'
        : 'healthy';
  return {
    status,
    recommendRollback,
    baseline,
    current,
    delta: releaseDelta,
    reasons,
    summary: recommendRollback
      ? `V${current.version} 的发布后指标持续退化，建议回滚到 V${baseline.version} 配置并由操作者确认。`
      : reasons.length
        ? `V${current.version} 出现单项退化信号，继续观察后再决定是否回滚。`
        : `V${current.version} 与 V${baseline.version} 的观察指标保持一致，可继续使用当前门禁。`,
  };
}
