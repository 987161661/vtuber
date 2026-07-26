import type { ImprovementStrategyQualitySnapshot } from './improvementStrategyAssets';
import type { ImprovementStrategyExperimentRecord } from './improvementStrategyExperiment';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

type CalibrationScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

export type StrategyQualityEvidence = {
  evaluated: number;
  usable: number;
  unusable: number;
  pending: number;
  usabilityRate: number | null;
};

export type StrategyQualityWarningSignal = {
  warningId: string;
  evaluated: number;
  usable: number;
  usabilityRate: number | null;
  assessment: 'insufficient' | 'retain' | 'consider-relaxing';
};

export type ImprovementStrategyQualityCalibration = {
  status:
    | 'insufficient'
    | 'aligned'
    | 'too-permissive'
    | 'too-strict'
    | 'mixed';
  evidence: StrategyQualityEvidence;
  readyEvidence: StrategyQualityEvidence;
  reviewEvidence: StrategyQualityEvidence;
  warningSignals: StrategyQualityWarningSignal[];
  recommendations: string[];
  summary: string;
};

type QualitySnapshotRecord = ImprovementStrategyQualitySnapshot & {
  strategyId: string;
  at: number;
};

const usableOutcomes = new Set<ImprovementStrategyExperimentRecord['outcome']>(
  ['improved', 'stable', 'declined'],
);

function timestamp(event: NextSessionImprovementActionRuntimeEvent): number {
  const value = event.at ?? event.serverReceivedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function snapshotFromEvent(
  event: NextSessionImprovementActionRuntimeEvent,
): QualitySnapshotRecord | null {
  const strategyId = event.strategyId?.trim();
  const score = event.strategyQualityScore;
  const status = event.strategyQualityStatus;
  const gateVersion = event.strategyQualityGateVersion;
  if (
    event.stage !== 'operator_next_session_improvement_strategy_asset' ||
    event.strategyAssetOperation !== 'save' ||
    !strategyId ||
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100 ||
    (status !== 'ready' && status !== 'review') ||
    typeof gateVersion !== 'number' ||
    !Number.isInteger(gateVersion) ||
    gateVersion < 1
  ) {
    return null;
  }
  return {
    strategyId,
    score,
    status,
    gateVersion,
    warningIds: Array.isArray(event.strategyQualityWarningIds)
      ? [...new Set(event.strategyQualityWarningIds)].filter(Boolean)
      : [],
    at: timestamp(event),
  };
}

function evidence(
  records: readonly ImprovementStrategyExperimentRecord[],
): StrategyQualityEvidence {
  const pending = records.filter(({ outcome }) => outcome === 'pending').length;
  const evaluatedRecords = records.filter(({ outcome }) => outcome !== 'pending');
  const usable = evaluatedRecords.filter(({ outcome }) =>
    usableOutcomes.has(outcome),
  ).length;
  return {
    evaluated: evaluatedRecords.length,
    usable,
    unusable: evaluatedRecords.length - usable,
    pending,
    usabilityRate: evaluatedRecords.length
      ? Math.round((usable / evaluatedRecords.length) * 100)
      : null,
  };
}

function recommendations(input: {
  status: ImprovementStrategyQualityCalibration['status'];
  records: readonly ImprovementStrategyExperimentRecord[];
  warningSignals: readonly StrategyQualityWarningSignal[];
}): string[] {
  if (input.status === 'insufficient') {
    return ['继续收集至少 3 个已出结果的自研策略实验，再校准质量门禁。'];
  }
  const result: string[] = [];
  if (input.status === 'too-permissive' || input.status === 'mixed') {
    if (input.records.some(({ outcome }) => outcome === 'confounded')) {
      result.push('加强执行预演对同场竞争实验的阻断或确认。');
    }
    if (input.records.some(({ outcome }) => outcome === 'context-changed')) {
      result.push('在保存质量快照时强化运行上下文稳定性检查。');
    }
    if (!result.length) {
      result.push('提高高分策略对可归因证据的准入要求。');
    }
  }
  if (input.status === 'too-strict' || input.status === 'mixed') {
    const warningIds = input.warningSignals
      .filter(({ assessment }) => assessment === 'consider-relaxing')
      .map(({ warningId }) => warningId);
    result.push(
      warningIds.length
        ? `复核 ${warningIds.join('、')} 警告的扣分权重。`
        : '复核当前警告项的扣分权重，避免阻碍可用实验。',
    );
  }
  if (input.status === 'aligned') {
    result.push('质量门禁与证据可用性一致，保持当前规则并继续观察。');
  }
  return result;
}

export function calibrateImprovementStrategyQuality(input: {
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  records: readonly ImprovementStrategyExperimentRecord[];
  scope: CalibrationScope;
  gateVersion?: number;
}): ImprovementStrategyQualityCalibration {
  const latestSnapshotByStrategy = new Map<string, QualitySnapshotRecord>();
  for (const event of input.events) {
    if (
      event.personaId !== input.scope.personaId ||
      event.platform !== input.scope.platform ||
      event.roomId !== input.scope.roomId
    ) {
      continue;
    }
    const snapshot = snapshotFromEvent(event);
    if (
      !snapshot ||
      (input.gateVersion !== undefined &&
        snapshot.gateVersion !== input.gateVersion)
    ) {
      continue;
    }
    const current = latestSnapshotByStrategy.get(snapshot.strategyId);
    if (!current || snapshot.at >= current.at) {
      latestSnapshotByStrategy.set(snapshot.strategyId, snapshot);
    }
  }
  const matchedRecords = input.records.filter((record) => {
    if (!latestSnapshotByStrategy.has(record.strategyId)) return false;
    return (
      input.gateVersion === undefined ||
      record.qualityGateVersion === input.gateVersion
    );
  });
  const recordsForStatus = (status: 'ready' | 'review') =>
    matchedRecords.filter(
      ({ strategyId }) =>
        latestSnapshotByStrategy.get(strategyId)?.status === status,
    );
  const readyRecords = recordsForStatus('ready');
  const reviewRecords = recordsForStatus('review');
  const allEvidence = evidence(matchedRecords);
  const readyEvidence = evidence(readyRecords);
  const reviewEvidence = evidence(reviewRecords);
  const warningIds = [
    ...new Set(
      [...latestSnapshotByStrategy.values()]
        .filter(({ status }) => status === 'review')
        .flatMap(({ warningIds: ids }) => ids),
    ),
  ];
  const warningSignals = warningIds.map((warningId) => {
    const warningStrategyIds = new Set(
      [...latestSnapshotByStrategy.values()]
        .filter(
          (snapshot) =>
            snapshot.status === 'review' &&
            snapshot.warningIds.includes(warningId),
        )
        .map(({ strategyId }) => strategyId),
    );
    const signalEvidence = evidence(
      matchedRecords.filter(({ strategyId }) =>
        warningStrategyIds.has(strategyId),
      ),
    );
    return {
      warningId,
      evaluated: signalEvidence.evaluated,
      usable: signalEvidence.usable,
      usabilityRate: signalEvidence.usabilityRate,
      assessment:
        signalEvidence.evaluated < 3
          ? ('insufficient' as const)
          : (signalEvidence.usabilityRate ?? 0) >= 80
            ? ('consider-relaxing' as const)
            : ('retain' as const),
    };
  });
  const readyTooPermissive =
    readyEvidence.evaluated >= 3 &&
    (readyEvidence.usabilityRate ?? 0) < 67;
  const reviewTooStrict =
    reviewEvidence.evaluated >= 3 &&
    (reviewEvidence.usabilityRate ?? 0) >= 80;
  const hasCalibratableCohort =
    readyEvidence.evaluated >= 3 || reviewEvidence.evaluated >= 3;
  const status: ImprovementStrategyQualityCalibration['status'] =
    !hasCalibratableCohort
      ? 'insufficient'
      : readyTooPermissive && reviewTooStrict
        ? 'mixed'
        : readyTooPermissive
          ? 'too-permissive'
          : reviewTooStrict
            ? 'too-strict'
            : 'aligned';
  const calibrationRecommendations = recommendations({
    status,
    records: matchedRecords,
    warningSignals,
  });
  const rate =
    allEvidence.usabilityRate === null
      ? '暂无'
      : `${allEvidence.usabilityRate}%`;
  return {
    status,
    evidence: allEvidence,
    readyEvidence,
    reviewEvidence,
    warningSignals,
    recommendations: calibrationRecommendations,
    summary:
      status === 'insufficient'
        ? `质量校准样本不足：已有 ${allEvidence.evaluated}/3 个可评估结果。`
        : `质量门禁已评估 ${allEvidence.evaluated} 个结果，证据可用率 ${rate}。`,
  };
}
