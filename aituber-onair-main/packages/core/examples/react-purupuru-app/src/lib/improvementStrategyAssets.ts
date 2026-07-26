import type { ImprovementStrategy } from './improvementStrategyExperiment';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

export type ImprovementStrategyQualitySnapshot = {
  score: number;
  status: 'ready' | 'review';
  warningIds: string[];
  gateVersion: number;
};

export type ImprovementStrategyAsset = {
  assetId: string;
  strategy: ImprovementStrategy;
  version: number;
  status: 'active' | 'archived';
  updatedAt: number;
  copiedFromAssetId?: string;
  quality?: ImprovementStrategyQualitySnapshot;
};

export type ImprovementStrategyAssetProjection = {
  assets: ImprovementStrategyAsset[];
  activeStrategies: ImprovementStrategy[];
  unavailableStrategyIds: string[];
};

type StrategyAssetScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

type SaveStrategyAssetInput = {
  operation: 'save';
  strategy: ImprovementStrategy;
  scope: StrategyAssetScope;
  previous?: ImprovementStrategyAsset;
  copiedFromAssetId?: string;
  quality?: ImprovementStrategyQualitySnapshot;
  at?: number;
};

type ChangeStrategyAssetStatusInput = {
  operation: 'archive' | 'restore';
  asset: ImprovementStrategyAsset;
  scope: StrategyAssetScope;
  at?: number;
};

export type CreateImprovementStrategyAssetEventInput =
  | SaveStrategyAssetInput
  | ChangeStrategyAssetStatusInput;

function eventTimestamp(
  event: NextSessionImprovementActionRuntimeEvent,
): number {
  const value = event.at ?? event.serverReceivedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strategyFromEvent(
  event: NextSessionImprovementActionRuntimeEvent,
): ImprovementStrategy | null {
  const id = event.strategyId?.trim();
  const label = event.strategyLabel?.trim();
  const instruction = event.strategyInstruction?.trim();
  const successSignal = event.strategySuccessSignal?.trim();
  const improvementId = event.improvementId?.trim();
  const variable = event.strategyVariable;
  if (
    event.strategyOrigin !== 'custom' ||
    !id?.startsWith('custom-') ||
    !label ||
    !instruction ||
    !successSignal ||
    !improvementId ||
    !['scope', 'method', 'evidence', 'sequence'].includes(variable ?? '')
  ) {
    return null;
  }
  return {
    id,
    label,
    variable: variable as ImprovementStrategy['variable'],
    instruction,
    successSignal,
    origin: 'custom',
    improvementId,
  };
}

function qualityFromEvent(
  event: NextSessionImprovementActionRuntimeEvent,
): ImprovementStrategyQualitySnapshot | undefined {
  const score = event.strategyQualityScore;
  const status = event.strategyQualityStatus;
  const gateVersion = event.strategyQualityGateVersion;
  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100 ||
    (status !== 'ready' && status !== 'review') ||
    typeof gateVersion !== 'number' ||
    !Number.isInteger(gateVersion) ||
    gateVersion < 1
  ) {
    return undefined;
  }
  return {
    score,
    status,
    warningIds: Array.isArray(event.strategyQualityWarningIds)
      ? [
          ...new Set(
            event.strategyQualityWarningIds
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ].slice(0, 10)
      : [],
    gateVersion,
  };
}

export function createImprovementStrategyAssetEvent(
  input: CreateImprovementStrategyAssetEventInput,
): NextSessionImprovementActionRuntimeEvent {
  const at = input.at ?? Date.now();
  const strategy = input.operation === 'save' ? input.strategy : input.asset.strategy;
  const assetId =
    input.operation === 'save'
      ? (input.previous?.assetId ?? `strategy-asset:${strategy.id}`)
      : input.asset.assetId;
  const version =
    input.operation === 'save'
      ? (input.previous?.version ?? 0) + 1
      : input.asset.version;
  const copiedFromAssetId =
    input.operation === 'save'
      ? (input.copiedFromAssetId ?? input.previous?.copiedFromAssetId)
      : input.asset.copiedFromAssetId;
  const quality =
    input.operation === 'save' ? input.quality : input.asset.quality;
  return {
    eventId: [
      'improvement-strategy-asset',
      assetId,
      input.operation,
      version,
      at,
    ].join(':'),
    stage: 'operator_next_session_improvement_strategy_asset',
    at,
    personaId: input.scope.personaId,
    platform: input.scope.platform,
    roomId: input.scope.roomId,
    improvementId: strategy.improvementId,
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    strategyVariable: strategy.variable,
    strategyInstruction: strategy.instruction,
    strategySuccessSignal: strategy.successSignal,
    strategyOrigin: strategy.origin,
    strategyAssetId: assetId,
    strategyAssetOperation: input.operation,
    strategyVersion: version,
    strategyCopiedFromAssetId: copiedFromAssetId,
    strategyQualityScore: quality?.score,
    strategyQualityStatus: quality?.status,
    strategyQualityWarningIds: quality?.warningIds,
    strategyQualityGateVersion: quality?.gateVersion,
  };
}

export function projectImprovementStrategyAssets(input: {
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  scope: StrategyAssetScope;
}): ImprovementStrategyAssetProjection {
  const latestByAsset = new Map<string, ImprovementStrategyAsset>();
  const strategyIdsByAsset = new Map<string, Set<string>>();
  for (const event of input.events) {
    const assetId = event.strategyAssetId?.trim();
    const strategy = strategyFromEvent(event);
    const version = event.strategyVersion;
    const operation = event.strategyAssetOperation;
    if (
      event.stage !== 'operator_next_session_improvement_strategy_asset' ||
      event.personaId !== input.scope.personaId ||
      event.platform !== input.scope.platform ||
      event.roomId !== input.scope.roomId ||
      !assetId ||
      !strategy ||
      !Number.isInteger(version) ||
      (version ?? 0) < 1 ||
      !operation
    ) {
      continue;
    }
    const strategyIds = strategyIdsByAsset.get(assetId) ?? new Set<string>();
    strategyIds.add(strategy.id);
    strategyIdsByAsset.set(assetId, strategyIds);
    const current = latestByAsset.get(assetId);
    const updatedAt = eventTimestamp(event);
    if (
      current &&
      (current.version > (version as number) ||
        (current.version === version && current.updatedAt > updatedAt))
    ) {
      continue;
    }
    latestByAsset.set(assetId, {
      assetId,
      strategy,
      version: version as number,
      status: operation === 'archive' ? 'archived' : 'active',
      updatedAt,
      copiedFromAssetId: event.strategyCopiedFromAssetId?.trim() || undefined,
      quality: qualityFromEvent(event),
    });
  }
  const assets = [...latestByAsset.values()].sort(
    (left, right) =>
      left.updatedAt - right.updatedAt || left.assetId.localeCompare(right.assetId),
  );
  return {
    assets,
    activeStrategies: assets
      .filter(({ status }) => status === 'active')
      .map(({ strategy }) => strategy),
    unavailableStrategyIds: assets.flatMap(({ assetId, status, strategy }) =>
      [...(strategyIdsByAsset.get(assetId) ?? [])].filter(
        (strategyId) => status === 'archived' || strategyId !== strategy.id,
      ),
    ),
  };
}
