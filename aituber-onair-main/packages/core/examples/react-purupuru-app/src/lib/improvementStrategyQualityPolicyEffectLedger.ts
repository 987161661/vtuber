import type { ImprovementStrategyExperimentRecord } from './improvementStrategyExperiment';
import { attributeImprovementStrategyQualityPolicyRelease } from './improvementStrategyQualityPolicyAttribution';
import { observeImprovementStrategyQualityPolicyRelease } from './improvementStrategyQualityPolicyObservation';
import type { ImprovementStrategyQualityPolicyAttribution } from './improvementStrategyQualityPolicyAttribution';
import type {
  ImprovementStrategyQualityPolicy,
  ImprovementStrategyQualityPolicyChangeEffect,
  ImprovementStrategyQualityPolicyField,
} from './improvementStrategyQualityPolicy';
import { IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES } from './improvementStrategyQualityPolicy';
import type { ImprovementExperimentContext } from './improvementExperimentContext';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';

type EffectLedgerScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

type AttributionStatus =
  ImprovementStrategyQualityPolicyAttribution['status'];

export type ImprovementStrategyQualityPolicyEffectExperiment = {
  fromVersion: number;
  toVersion: number;
  field: ImprovementStrategyQualityPolicyField;
  from: number | string;
  to: number | string;
  contextId?: string;
  contextLabel?: string;
  releasedAt: number;
  status: AttributionStatus;
  delta: {
    blockRate: number | null;
    executionRate: number | null;
    usabilityRate: number | null;
  };
  summary: string;
};

export type ImprovementStrategyQualityPolicyFieldEffect = {
  field: ImprovementStrategyQualityPolicyField;
  samples: number;
  improved: number;
  neutral: number;
  tradeoff: number;
  regressed: number;
  confidence: 'low' | 'medium' | 'high';
  recommendation: 'prefer' | 'unproven' | 'neutral' | 'caution';
  effectScore: number;
  priorityScore: number;
};

export type ImprovementStrategyQualityPolicyDirectionEffect =
  ImprovementStrategyQualityPolicyChangeEffect & {
    samples: number;
    exactSamples: number;
    legacySamples: number;
    excludedContextSamples: number;
    freshSamples: number;
    staleSamples: number;
    latestEvidenceAt: number | null;
    freshness: 'fresh' | 'stale' | 'none';
    improved: number;
    neutral: number;
    tradeoff: number;
    regressed: number;
    confidence: 'low' | 'medium' | 'high';
    effectScore: number;
  };

export type ImprovementStrategyQualityPolicyEffectLedger = {
  experiments: ImprovementStrategyQualityPolicyEffectExperiment[];
  effects: ImprovementStrategyQualityPolicyFieldEffect[];
  directionEffects: ImprovementStrategyQualityPolicyDirectionEffect[];
  recommendedFieldOrder: ImprovementStrategyQualityPolicyField[];
};

const defaultFieldOrder: readonly ImprovementStrategyQualityPolicyField[] = [
  'confoundedExecution',
  'maxInstructionClauses',
  'warningPenalty',
];

const validFields = new Set<ImprovementStrategyQualityPolicyField>(
  defaultFieldOrder,
);

export const IMPROVEMENT_STRATEGY_QUALITY_POLICY_EFFECT_FRESHNESS_MS =
  30 * 24 * 60 * 60 * 1_000;

function inScope(
  event: NextSessionImprovementActionRuntimeEvent,
  scope: EffectLedgerScope,
): boolean {
  return (
    event.personaId === scope.personaId &&
    event.platform === scope.platform &&
    event.roomId === scope.roomId
  );
}

function eventTimestamp(
  event: NextSessionImprovementActionRuntimeEvent,
): number {
  const value = event.at ?? event.serverReceivedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function summarizeField(
  field: ImprovementStrategyQualityPolicyField,
  experiments: readonly ImprovementStrategyQualityPolicyEffectExperiment[],
): ImprovementStrategyQualityPolicyFieldEffect {
  const attributable = experiments.filter(
    (experiment) =>
      experiment.field === field &&
      ['improved', 'neutral', 'tradeoff', 'regressed'].includes(
        experiment.status,
      ),
  );
  const improved = attributable.filter(
    ({ status }) => status === 'improved',
  ).length;
  const neutral = attributable.filter(
    ({ status }) => status === 'neutral',
  ).length;
  const tradeoff = attributable.filter(
    ({ status }) => status === 'tradeoff',
  ).length;
  const regressed = attributable.filter(
    ({ status }) => status === 'regressed',
  ).length;
  const samples = attributable.length;
  const effectScore = improved * 2 - tradeoff - regressed * 2;
  const confidence: 'low' | 'medium' | 'high' =
    samples >= 4 ? 'high' : samples >= 2 ? 'medium' : 'low';
  const confidenceWeight =
    confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  const recommendation:
    | 'prefer'
    | 'unproven'
    | 'neutral'
    | 'caution' =
    samples === 0
      ? 'unproven'
      : improved > regressed + tradeoff
        ? 'prefer'
        : regressed > improved || tradeoff >= 2
          ? 'caution'
          : 'neutral';
  return {
    field,
    samples,
    improved,
    neutral,
    tradeoff,
    regressed,
    confidence,
    recommendation,
    effectScore,
    priorityScore: effectScore * confidenceWeight,
  };
}

function sameValue(
  left: number | string,
  right: number | string,
): boolean {
  return left === right;
}

function summarizeDirection(
  matchingDirection: readonly ImprovementStrategyQualityPolicyEffectExperiment[],
  context?: ImprovementExperimentContext,
  now = Date.now(),
  freshnessWindowMs =
    IMPROVEMENT_STRATEGY_QUALITY_POLICY_EFFECT_FRESHNESS_MS,
): ImprovementStrategyQualityPolicyDirectionEffect {
  const template = matchingDirection[0];
  const exact = context
    ? matchingDirection.filter(
        (experiment) => experiment.contextId === context.id,
      )
    : [...matchingDirection];
  const legacy = context
    ? matchingDirection.filter((experiment) => !experiment.contextId)
    : [];
  const excluded = context
    ? matchingDirection.filter(
        (experiment) =>
          Boolean(experiment.contextId) &&
          experiment.contextId !== context.id,
      )
    : [];
  const exactAttributable = exact.filter((experiment) =>
    ['improved', 'neutral', 'tradeoff', 'regressed'].includes(
      experiment.status,
    ),
  );
  const legacyAttributable = legacy.filter((experiment) =>
    ['improved', 'neutral', 'tradeoff', 'regressed'].includes(
      experiment.status,
    ),
  );
  const isFresh = (
    experiment: ImprovementStrategyQualityPolicyEffectExperiment,
  ) =>
    experiment.releasedAt > 0 &&
    now - experiment.releasedAt <= freshnessWindowMs;
  const freshExact = exactAttributable.filter(isFresh);
  const staleExact = exactAttributable.filter(
    (experiment) => !isFresh(experiment),
  );
  const freshLegacy = legacyAttributable.filter(isFresh);
  const staleLegacy = legacyAttributable.filter(
    (experiment) => !isFresh(experiment),
  );
  const attributable =
    freshExact.length > 0
      ? freshExact
      : freshLegacy.length > 0
        ? freshLegacy
        : staleExact.length > 0
          ? staleExact
          : staleLegacy;
  const improved = attributable.filter(
    ({ status }) => status === 'improved',
  ).length;
  const neutral = attributable.filter(
    ({ status }) => status === 'neutral',
  ).length;
  const tradeoff = attributable.filter(
    ({ status }) => status === 'tradeoff',
  ).length;
  const regressed = attributable.filter(
    ({ status }) => status === 'regressed',
  ).length;
  const samples = attributable.length;
  const freshSamples = freshExact.length + freshLegacy.length;
  const staleSamples = staleExact.length + staleLegacy.length;
  const latestEvidenceAt =
    [...exactAttributable, ...legacyAttributable].reduce<number | null>(
      (latest, experiment) =>
        latest === null
          ? experiment.releasedAt
          : Math.max(latest, experiment.releasedAt),
      null,
    );
  const freshness: 'fresh' | 'stale' | 'none' =
    freshSamples > 0 ? 'fresh' : staleSamples > 0 ? 'stale' : 'none';
  const effectScore = improved * 2 - tradeoff - regressed * 2;
  const confidence: 'low' | 'medium' | 'high' =
    freshExact.length === 0 && staleExact.length === 0
      ? 'low'
      : samples >= 4
        ? 'high'
        : samples >= 2
          ? 'medium'
          : 'low';
  const confidenceWeight =
    confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  const recommendation:
    | 'prefer'
    | 'unproven'
    | 'neutral'
    | 'caution' =
    samples === 0
      ? 'unproven'
      : improved > regressed + tradeoff
        ? 'prefer'
        : regressed > improved || tradeoff >= 2
          ? 'caution'
          : 'neutral';
  const influence:
    | 'automatic'
    | 'advisory'
    | 'revalidate'
    | 'isolated' =
    freshExact.length >=
    IMPROVEMENT_STRATEGY_QUALITY_POLICY_REQUIRED_FRESH_SAMPLES
      ? 'automatic'
      : freshSamples > 0
        ? 'advisory'
        : staleSamples > 0
          ? 'revalidate'
          : 'isolated';
  return {
    field: template.field,
    from: template.from,
    to: template.to,
    samples,
    exactSamples: exactAttributable.length,
    legacySamples: legacyAttributable.length,
    excludedContextSamples: excluded.length,
    freshSamples,
    staleSamples,
    latestEvidenceAt,
    freshness,
    improved,
    neutral,
    tradeoff,
    regressed,
    confidence,
    recommendation,
    influence,
    effectScore,
    priorityScore: effectScore * confidenceWeight,
  };
}

export function projectImprovementStrategyQualityPolicyEffectLedger(input: {
  policies: readonly ImprovementStrategyQualityPolicy[];
  events: readonly NextSessionImprovementActionRuntimeEvent[];
  records: readonly ImprovementStrategyExperimentRecord[];
  scope: EffectLedgerScope;
  context?: ImprovementExperimentContext;
  now?: number;
  freshnessWindowMs?: number;
}): ImprovementStrategyQualityPolicyEffectLedger {
  const policyByVersion = new Map(
    input.policies.map((policy) => [policy.version, policy]),
  );
  const releaseByVersion = new Map<
    number,
    {
      field: ImprovementStrategyQualityPolicyField;
      at: number;
      contextId?: string;
      contextLabel?: string;
    }
  >();
  for (const event of input.events) {
    const version = event.strategyQualityPolicyVersion;
    const fields = event.strategyQualityPolicyChangedFields;
    if (
      !inScope(event, input.scope) ||
      event.stage !==
        'operator_next_session_improvement_quality_policy' ||
      !Number.isInteger(version) ||
      event.strategyQualityPolicyRollbackFromVersion !== undefined ||
      event.strategyQualityPolicyRevalidationPhase ===
        'reset-baseline' ||
      !Array.isArray(fields) ||
      fields.length !== 1 ||
      !validFields.has(fields[0] as ImprovementStrategyQualityPolicyField)
    ) {
      continue;
    }
    const at = eventTimestamp(event);
    const existing = releaseByVersion.get(version as number);
    if (!existing || at >= existing.at) {
      releaseByVersion.set(version as number, {
        field: fields[0] as ImprovementStrategyQualityPolicyField,
        at,
        contextId: event.experimentContextId?.trim() || undefined,
        contextLabel: event.experimentContextLabel?.trim() || undefined,
      });
    }
  }
  const experiments: ImprovementStrategyQualityPolicyEffectExperiment[] = [];
  for (const [toVersion, release] of [...releaseByVersion.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const current = policyByVersion.get(toVersion);
    const baseline = policyByVersion.get(toVersion - 1);
    if (!current || !baseline) continue;
    const observation = observeImprovementStrategyQualityPolicyRelease({
      events: input.events,
      records: input.records,
      scope: input.scope,
      currentVersion: current.version,
      baselineVersion: baseline.version,
    });
    const attribution =
      attributeImprovementStrategyQualityPolicyRelease({
        baseline,
        current,
        observation,
      });
    experiments.push({
      fromVersion: baseline.version,
      toVersion: current.version,
      field: release.field,
      from: baseline[release.field],
      to: current[release.field],
      contextId: release.contextId,
      contextLabel: release.contextLabel,
      releasedAt: release.at,
      status:
        attribution.changedField === release.field
          ? attribution.status
          : 'unattributable',
      delta: observation.delta,
      summary:
        attribution.changedField === release.field
          ? attribution.summary
          : `发布事件记录的 ${release.field} 与实际配置差异不一致，停止归因。`,
    });
  }
  const directionGroups: ImprovementStrategyQualityPolicyEffectExperiment[][] =
    [];
  for (const experiment of experiments) {
    const group = directionGroups.find(
      ([template]) =>
        template.field === experiment.field &&
        sameValue(template.from, experiment.from) &&
        sameValue(template.to, experiment.to),
    );
    if (group) {
      group.push(experiment);
    } else {
      directionGroups.push([experiment]);
    }
  }
  const directionEffects = directionGroups.map((group) =>
    summarizeDirection(
      group,
      input.context,
      input.now,
      input.freshnessWindowMs,
    ),
  );
  const transferableExperiments = input.context
    ? experiments.filter(
        (experiment) =>
          !experiment.contextId ||
          experiment.contextId === input.context?.id,
      )
    : experiments;
  const effectByField = new Map(
    defaultFieldOrder.map((field) => [
      field,
      summarizeField(field, transferableExperiments),
    ]),
  );
  const recommendationRank = {
    prefer: 0,
    unproven: 1,
    neutral: 2,
    caution: 3,
  } as const;
  const recommendedFieldOrder = [...defaultFieldOrder].sort(
    (left, right) => {
      const leftEffect = effectByField.get(left)!;
      const rightEffect = effectByField.get(right)!;
      return (
        recommendationRank[leftEffect.recommendation] -
          recommendationRank[rightEffect.recommendation] ||
        rightEffect.priorityScore - leftEffect.priorityScore ||
        defaultFieldOrder.indexOf(left) - defaultFieldOrder.indexOf(right)
      );
    },
  );
  return {
    experiments,
    effects: recommendedFieldOrder.map((field) => effectByField.get(field)!),
    directionEffects,
    recommendedFieldOrder,
  };
}
