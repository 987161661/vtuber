import type { LiveSessionTrendRecord } from './liveSessionTrend';
import type { NextSessionImprovementActionRuntimeEvent } from './nextSessionImprovementOutcome';
import {
  crossesImprovementExperimentContext,
  type ImprovementExperimentContext,
} from './improvementExperimentContext';

export type ImprovementStrategyVariable =
  | 'none'
  | 'scope'
  | 'method'
  | 'evidence'
  | 'sequence';

export type ImprovementStrategy = {
  id: string;
  label: string;
  variable: ImprovementStrategyVariable;
  instruction: string;
  successSignal?: string;
  origin: 'catalog' | 'custom';
  improvementId?: string;
};

export type ImprovementStrategyDraft = {
  label: string;
  variable: Exclude<ImprovementStrategyVariable, 'none'>;
  instruction: string;
  successSignal: string;
};

export type ImprovementStrategyCompositionResult =
  | { ok: true; strategy: ImprovementStrategy }
  | {
      ok: false;
      errors: Partial<Record<keyof ImprovementStrategyDraft, string>>;
    };

export type PreparedImprovementStrategyExperiment = {
  strategy: ImprovementStrategy;
  controlled: boolean;
  explanation: string;
};

export type ImprovementStrategyExperimentRecord = {
  improvementId: string;
  strategyId: string;
  strategyLabel: string;
  baseSessionId: string;
  nextSessionId?: string;
  scoreDelta?: number;
  qualityGateVersion?: number;
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

export type ImprovementStrategyEffect = {
  improvementId: string;
  strategyId: string;
  strategyLabel: string;
  observed: number;
  improved: number;
  declined: number;
  averageScoreDelta: number | null;
  recentAverageScoreDelta: number | null;
  drift: 'none' | 'suspected' | 'confirmed';
  signal: 'insufficient' | 'positive' | 'neutral' | 'negative';
  decision: 'collecting' | 'leading' | 'recommended' | 'drifting' | 'avoid';
  confidence: 'low' | 'medium' | 'high';
  relativeAdvantage: number | null;
  decisionSummary: string;
  summary: string;
};

export type ImprovementStrategyExperimentProjection = {
  records: ImprovementStrategyExperimentRecord[];
  strategies: ImprovementStrategyEffect[];
  availableStrategies: readonly ImprovementStrategy[];
  context?: {
    id: string;
    label: string;
    status: 'new' | 'rebuilding' | 'active';
    includedAttempts: number;
    excludedAttempts: number;
  };
};

export type NextImprovementStrategySelection = {
  mode: 'explore' | 'exploit' | 'wait' | 'review';
  stage:
    | 'coverage'
    | 'comparison'
    | 'confirmation'
    | 'awaiting-outcome'
    | 'decided'
    | 'revalidation'
    | 'redesign';
  strategy: ImprovementStrategy | null;
  progress: {
    observed: number;
    pending: number;
    target: number;
    remaining: number;
  };
  reason: string;
};

const builtInStrategies: readonly ImprovementStrategy[] = [
  {
    id: 'standard',
    label: '沿用当前方式',
    variable: 'none',
    instruction: '按当前建议完整执行，作为后续策略对照基线。',
    origin: 'catalog',
  },
  {
    id: 'focused-evidence',
    label: '聚焦首要证据',
    variable: 'scope',
    instruction: '只围绕最主要的一条失败或风险证据处理，控制改动范围。',
    origin: 'catalog',
  },
  {
    id: 'alternative-path',
    label: '更换处理路径',
    variable: 'method',
    instruction: '保持改进目标不变，但改用不同的排查或处理方法。',
    origin: 'catalog',
  },
];

const customStrategyVariables = new Set<ImprovementStrategyVariable>([
  'scope',
  'method',
  'evidence',
  'sequence',
]);

function customStrategyId(input: {
  improvementId: string;
  label: string;
  variable: ImprovementStrategyVariable;
  instruction: string;
  successSignal: string;
}): string {
  const serialized = [
    input.improvementId,
    input.label,
    input.variable,
    input.instruction,
    input.successSignal,
  ].join('\u0000');
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 0x01000193);
  }
  return `custom-${(hash >>> 0).toString(36)}`;
}

export function composeImprovementStrategy(input: {
  improvementId: string;
  draft: ImprovementStrategyDraft;
}): ImprovementStrategyCompositionResult {
  const improvementId = input.improvementId.trim();
  const label = input.draft.label.trim();
  const instruction = input.draft.instruction.trim();
  const successSignal = input.draft.successSignal.trim();
  const errors: Partial<Record<keyof ImprovementStrategyDraft, string>> = {};
  if (label.length < 2 || label.length > 40) {
    errors.label = '策略名称需要 2–40 个字符';
  }
  if (!customStrategyVariables.has(input.draft.variable)) {
    errors.variable = '请选择一个可控变量';
  }
  if (instruction.length < 10 || instruction.length > 240) {
    errors.instruction = '执行指令需要 10–240 个字符';
  }
  if (successSignal.length < 4 || successSignal.length > 120) {
    errors.successSignal = '成功信号需要 4–120 个字符';
  }
  if (!improvementId) {
    errors.label = errors.label ?? '改进项无效，无法创建策略';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const strategy = {
    id: customStrategyId({
      improvementId,
      label,
      variable: input.draft.variable,
      instruction,
      successSignal,
    }),
    label,
    variable: input.draft.variable,
    instruction,
    successSignal,
    origin: 'custom' as const,
    improvementId,
  };
  return { ok: true, strategy };
}

function strategyFromAction(
  event: NextSessionImprovementActionRuntimeEvent,
): ImprovementStrategy | undefined {
  const id = event.strategyId?.trim();
  const label = event.strategyLabel?.trim();
  const instruction = event.strategyInstruction?.trim();
  const successSignal = event.strategySuccessSignal?.trim();
  const improvementId = event.improvementId?.trim();
  const variable = event.strategyVariable;
  if (
    event.stage !== 'operator_next_session_improvement_action' ||
    event.strategyOrigin !== 'custom' ||
    !id?.startsWith('custom-') ||
    !label ||
    !instruction ||
    !successSignal ||
    !improvementId ||
    !customStrategyVariables.has(variable as ImprovementStrategyVariable)
  ) {
    return undefined;
  }
  return {
    id,
    label: label.slice(0, 40),
    variable: variable as ImprovementStrategyVariable,
    instruction: instruction.slice(0, 240),
    successSignal: successSignal.slice(0, 120),
    origin: 'custom',
    improvementId,
  };
}

export function listImprovementStrategies(input?: {
  actions?: readonly NextSessionImprovementActionRuntimeEvent[];
  additions?: readonly ImprovementStrategy[];
  improvementId?: string;
  excludedStrategyIds?: readonly string[];
}): readonly ImprovementStrategy[] {
  const catalog = new Map<string, ImprovementStrategy>(
    builtInStrategies.map((strategy) => [strategy.id, strategy]),
  );
  for (const strategy of input?.additions ?? []) {
    if (!catalog.has(strategy.id)) catalog.set(strategy.id, strategy);
  }
  for (const event of input?.actions ?? []) {
    const strategy = strategyFromAction(event);
    if (strategy && !catalog.has(strategy.id)) {
      catalog.set(strategy.id, strategy);
    }
  }
  const excludedStrategyIds = new Set(input?.excludedStrategyIds ?? []);
  return [...catalog.values()].filter(
    (strategy) =>
      !excludedStrategyIds.has(strategy.id) &&
      (!strategy.improvementId ||
        !input?.improvementId ||
        strategy.improvementId === input.improvementId),
  );
}

export function prepareImprovementStrategyExperiment(input: {
  actions: readonly NextSessionImprovementActionRuntimeEvent[];
  baseSessionId: string;
  improvementId: string;
  strategyId: ImprovementStrategy['id'];
  strategyCatalog?: readonly ImprovementStrategy[];
  excludedStrategyIds?: readonly string[];
}): PreparedImprovementStrategyExperiment {
  const availableStrategies = listImprovementStrategies({
    actions: input.actions,
    additions: input.strategyCatalog,
    improvementId: input.improvementId,
    excludedStrategyIds: input.excludedStrategyIds,
  });
  const strategy =
    availableStrategies.find(({ id }) => id === input.strategyId) ??
    builtInStrategies[0];
  const competingExperiment = input.actions.some(
    (event) =>
      (event.baseSessionId ?? event.sessionId) === input.baseSessionId &&
      event.stage === 'operator_next_session_improvement_action' &&
      event.outcome === 'completed' &&
      Boolean(event.strategyId) &&
      event.experimentControlled !== false &&
      event.improvementId !== input.improvementId,
  );

  return {
    strategy,
    controlled: !competingExperiment,
    explanation: competingExperiment
      ? '该基准场次已有另一项受控实验；本动作仍可执行，但不纳入策略效果对照。'
      : strategy.instruction,
  };
}

function timestamp(event: NextSessionImprovementActionRuntimeEvent): number {
  return event.at ?? event.serverReceivedAt ?? 0;
}

function strategySummary(
  effect: Pick<ImprovementStrategyEffect, 'observed' | 'averageScoreDelta'>,
): string {
  if (!effect.observed) return '尚无可归因的后续场次样本。';
  const delta = effect.averageScoreDelta ?? 0;
  const direction = delta >= 5 ? '提升' : delta <= -5 ? '下降' : '持平';
  return `${effect.observed} 次受控样本，下一场平均${direction} ${Math.abs(delta)} 分。`;
}

function evaluateStrategies(
  effects: Array<
    Omit<
      ImprovementStrategyEffect,
      'decision' | 'confidence' | 'relativeAdvantage' | 'decisionSummary'
    >
  >,
): ImprovementStrategyEffect[] {
  return effects.map((effect) => {
    const peers = effects
      .filter(
        (candidate) =>
          candidate.improvementId === effect.improvementId &&
          candidate.strategyId !== effect.strategyId &&
          candidate.observed >= 2,
      )
      .sort(
        (left, right) =>
          (right.averageScoreDelta ?? 0) - (left.averageScoreDelta ?? 0),
      );
    const comparator = peers[0];
    const relativeAdvantage = comparator
      ? (effect.averageScoreDelta ?? 0) - (comparator.averageScoreDelta ?? 0)
      : null;
    const confidence =
      effect.observed >= 3
        ? ('high' as const)
        : effect.observed >= 2
          ? ('medium' as const)
          : ('low' as const);
    if (effect.drift === 'confirmed') {
      return {
        ...effect,
        decision: 'drifting' as const,
        confidence: 'high' as const,
        relativeAdvantage,
        decisionSummary:
          '长期效果仍为正向，但最近两个受控场次连续下降；已撤销推荐并重新探索。',
      };
    }
    if (effect.drift === 'suspected') {
      return {
        ...effect,
        decision: 'leading' as const,
        confidence: 'medium' as const,
        relativeAdvantage,
        decisionSummary:
          '最近一次结果明显退化，暂缓自动推荐并等待下一次受控验证。',
      };
    }
    const harmful =
      effect.observed >= 3 &&
      (effect.averageScoreDelta ?? 0) <= -5 &&
      effect.declined / effect.observed >= 2 / 3;
    if (harmful) {
      return {
        ...effect,
        decision: 'avoid' as const,
        confidence,
        relativeAdvantage,
        decisionSummary: '连续受控样本显示负向结果，建议暂停该策略。',
      };
    }
    const positiveLeader =
      effect.observed >= 2 &&
      (effect.averageScoreDelta ?? 0) >= 5 &&
      !peers.some(
        (candidate) =>
          (candidate.averageScoreDelta ?? 0) > (effect.averageScoreDelta ?? 0),
      );
    const recommendable =
      positiveLeader &&
      effect.observed >= 3 &&
      effect.improved / effect.observed >= 2 / 3 &&
      relativeAdvantage !== null &&
      relativeAdvantage >= 5;
    if (recommendable) {
      return {
        ...effect,
        decision: 'recommended' as const,
        confidence: 'high' as const,
        relativeAdvantage,
        decisionSummary: `相对可比策略平均领先 ${relativeAdvantage} 分，可作为下一次默认策略。`,
      };
    }
    if (positiveLeader) {
      return {
        ...effect,
        decision: 'leading' as const,
        confidence,
        relativeAdvantage,
        decisionSummary: comparator
          ? '当前效果领先，但样本量或相对优势尚未达到自动推荐门槛。'
          : '当前效果积极，仍需补充至少一种可比策略样本。',
      };
    }
    return {
      ...effect,
      decision: 'collecting' as const,
      confidence,
      relativeAdvantage,
      decisionSummary:
        effect.observed < 2
          ? '样本不足，继续收集受控场次。'
          : '尚未形成稳定正向优势，继续观察。',
    };
  });
}

export function projectImprovementStrategyExperiments(input: {
  actions: readonly NextSessionImprovementActionRuntimeEvent[];
  sessions: readonly LiveSessionTrendRecord[];
  scope: { personaId: string; platform: string; roomId: string };
  context?: ImprovementExperimentContext;
  strategyCatalog?: readonly ImprovementStrategy[];
  excludedStrategyIds?: readonly string[];
}): ImprovementStrategyExperimentProjection {
  const scopedStrategyActions = input.actions.filter(
    (event) =>
      event.personaId === input.scope.personaId &&
      event.platform === input.scope.platform &&
      event.roomId === input.scope.roomId,
  );
  const availableStrategies = listImprovementStrategies({
    actions: scopedStrategyActions,
    additions: input.strategyCatalog,
    excludedStrategyIds: input.excludedStrategyIds,
  });
  const latestByAttempt = new Map<
    string,
    NextSessionImprovementActionRuntimeEvent
  >();
  const includedAttemptKeys = new Set<string>();
  const excludedAttemptKeys = new Set<string>();
  for (const event of input.actions) {
    const baseSessionId = event.baseSessionId ?? event.sessionId;
    if (
      event.stage !== 'operator_next_session_improvement_action' ||
      !baseSessionId ||
      !event.improvementId ||
      !event.strategyId ||
      (event.outcome !== 'completed' && event.outcome !== 'failed') ||
      event.personaId !== input.scope.personaId ||
      event.platform !== input.scope.platform ||
      event.roomId !== input.scope.roomId
    ) {
      continue;
    }
    const key = `${baseSessionId}:${event.improvementId}`;
    if (
      input.context &&
      event.experimentContextId?.trim() !== input.context.id
    ) {
      excludedAttemptKeys.add(
        `${event.experimentContextId?.trim() || 'legacy'}:${key}`,
      );
      continue;
    }
    includedAttemptKeys.add(key);
    const existing = latestByAttempt.get(key);
    if (!existing || timestamp(event) >= timestamp(existing)) {
      latestByAttempt.set(key, event);
    }
  }

  const controlledImprovementsBySession = new Map<string, Set<string>>();
  for (const event of latestByAttempt.values()) {
    if (event.outcome !== 'completed' || event.experimentControlled === false) {
      continue;
    }
    const baseSessionId = (event.baseSessionId ?? event.sessionId) as string;
    const improvements =
      controlledImprovementsBySession.get(baseSessionId) ?? new Set<string>();
    improvements.add(event.improvementId as string);
    controlledImprovementsBySession.set(baseSessionId, improvements);
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
  const records = [...latestByAttempt.values()]
    .sort((left, right) => timestamp(left) - timestamp(right))
    .map((event): ImprovementStrategyExperimentRecord => {
      const baseSessionId = (event.baseSessionId ?? event.sessionId) as string;
      const improvementId = event.improvementId as string;
      const strategyId = event.strategyId as string;
      const strategyLabel = event.strategyLabel?.trim() || strategyId;
      const qualityGateVersion = event.strategyQualityGateVersion;
      const gate =
        Number.isInteger(qualityGateVersion) &&
        (qualityGateVersion ?? 0) >= 1
          ? { qualityGateVersion }
          : {};
      if (event.outcome === 'failed') {
        return {
          improvementId,
          strategyId,
          strategyLabel,
          baseSessionId,
          ...gate,
          outcome: 'execution-failed',
        };
      }
      if (
        event.experimentControlled === false ||
        (controlledImprovementsBySession.get(baseSessionId)?.size ?? 0) > 1
      ) {
        return {
          improvementId,
          strategyId,
          strategyLabel,
          baseSessionId,
          ...gate,
          outcome: 'confounded',
        };
      }
      const base = sessionById.get(baseSessionId);
      const baseSequence = base?.sequence ?? event.baseSessionSequence;
      if (!base) {
        return {
          improvementId,
          strategyId,
          strategyLabel,
          baseSessionId,
          ...gate,
          outcome:
            oldestRetainedSequence !== undefined &&
            baseSequence !== undefined &&
            baseSequence < oldestRetainedSequence
              ? 'evidence-expired'
              : 'pending',
        };
      }
      const next =
        baseSequence === undefined
          ? undefined
          : sessionBySequence.get(baseSequence + 1);
      if (!next) {
        return {
          improvementId,
          strategyId,
          strategyLabel,
          baseSessionId,
          ...gate,
          outcome: 'pending',
        };
      }
      if (
        crossesImprovementExperimentContext({
          actionContextId: event.experimentContextId,
          baseContextId: base.experimentContextId,
          nextContextId: next.experimentContextId,
        })
      ) {
        return {
          improvementId,
          strategyId,
          strategyLabel,
          baseSessionId,
          ...gate,
          nextSessionId: next.sessionId,
          outcome: 'context-changed',
        };
      }
      const scoreDelta = next.score - base.score;
      return {
        improvementId,
        strategyId,
        strategyLabel,
        baseSessionId,
        ...gate,
        nextSessionId: next.sessionId,
        scoreDelta,
        outcome:
          scoreDelta >= 5
            ? 'improved'
            : scoreDelta <= -5
              ? 'declined'
              : 'stable',
      };
    });

  const observedByStrategy = new Map<
    string,
    ImprovementStrategyExperimentRecord[]
  >();
  for (const record of records) {
    if (record.scoreDelta === undefined) continue;
    const key = `${record.improvementId}:${record.strategyId}`;
    const entries = observedByStrategy.get(key) ?? [];
    entries.push(record);
    observedByStrategy.set(key, entries);
  }
  const strategyEffects = [...observedByStrategy.values()].map((entries) => {
    const first = entries[0];
    const averageScoreDelta = Math.round(
      entries.reduce((total, record) => total + (record.scoreDelta ?? 0), 0) /
        entries.length,
    );
    const recentEntries = entries.slice(-2);
    const recentAverageScoreDelta = recentEntries.length
      ? Math.round(
          recentEntries.reduce(
            (total, record) => total + (record.scoreDelta ?? 0),
            0,
          ) / recentEntries.length,
        )
      : null;
    const priorEntries = entries.slice(0, -recentEntries.length);
    const priorAverageScoreDelta = priorEntries.length
      ? priorEntries.reduce(
          (total, record) => total + (record.scoreDelta ?? 0),
          0,
        ) / priorEntries.length
      : null;
    const recentDeclines = recentEntries.filter(
      ({ outcome }) => outcome === 'declined',
    ).length;
    const drift =
      entries.length >= 5 &&
      recentEntries.length === 2 &&
      recentDeclines === 2 &&
      (priorAverageScoreDelta ?? 0) >= 5 &&
      (recentAverageScoreDelta ?? 0) <= -5
        ? ('confirmed' as const)
        : entries.length >= 4 &&
            recentEntries.at(-1)?.outcome === 'declined' &&
            (priorAverageScoreDelta ?? 0) >= 5
          ? ('suspected' as const)
          : ('none' as const);
    const effectBase = {
      improvementId: first.improvementId,
      strategyId: first.strategyId,
      strategyLabel: first.strategyLabel,
      observed: entries.length,
      improved: entries.filter(({ outcome }) => outcome === 'improved').length,
      declined: entries.filter(({ outcome }) => outcome === 'declined').length,
      averageScoreDelta,
      recentAverageScoreDelta,
      drift,
      signal:
        averageScoreDelta >= 5
          ? ('positive' as const)
          : averageScoreDelta <= -5
            ? ('negative' as const)
            : ('neutral' as const),
    };
    return { ...effectBase, summary: strategySummary(effectBase) };
  });
  const strategiesProjection = evaluateStrategies(strategyEffects);
  const includedAttempts = includedAttemptKeys.size;
  const excludedAttempts = excludedAttemptKeys.size;

  const context = input.context
    ? {
        id: input.context.id,
        label: input.context.label,
        status: includedAttempts
          ? ('active' as const)
          : excludedAttempts
            ? ('rebuilding' as const)
            : ('new' as const),
        includedAttempts,
        excludedAttempts,
      }
    : undefined;

  return {
    records,
    strategies: strategiesProjection,
    availableStrategies,
    ...(context ? { context } : {}),
  };
}

export function selectNextImprovementStrategy(
  projection: ImprovementStrategyExperimentProjection,
  improvementId: string,
): NextImprovementStrategySelection {
  const effects = projection.strategies.filter(
    (effect) => effect.improvementId === improvementId,
  );
  const strategyCatalog = projection.availableStrategies.filter(
    (strategy) =>
      !strategy.improvementId || strategy.improvementId === improvementId,
  );
  const effectByStrategy = new Map(
    effects.map((effect) => [effect.strategyId, effect]),
  );
  const pendingRecords = projection.records.filter(
    (record) =>
      record.improvementId === improvementId && record.outcome === 'pending',
  );
  if (pendingRecords.length) {
    const pendingRecord = pendingRecords.at(-1) as
      | ImprovementStrategyExperimentRecord
      | undefined;
    const strategy =
      strategyCatalog.find(({ id }) => id === pendingRecord?.strategyId) ??
      null;
    const observed = pendingRecord
      ? (effectByStrategy.get(pendingRecord.strategyId)?.observed ?? 0)
      : 0;
    return {
      mode: 'wait',
      stage: 'awaiting-outcome',
      strategy,
      progress: {
        observed,
        pending: pendingRecords.length,
        target: observed + pendingRecords.length,
        remaining: 0,
      },
      reason: `已有 ${pendingRecords.length} 个受控动作正在等待下一场复盘；结果产生前不会启动重复实验。`,
    };
  }
  const recommended = effects.find(
    ({ decision }) => decision === 'recommended',
  );
  if (recommended) {
    const strategy =
      strategyCatalog.find(({ id }) => id === recommended.strategyId) ?? null;
    if (strategy) {
      return {
        mode: 'exploit',
        stage: 'decided',
        strategy,
        progress: {
          observed: recommended.observed,
          pending: 0,
          target: Math.max(3, recommended.observed),
          remaining: 0,
        },
        reason: `该策略已达到高置信推荐门槛，优先复用胜出方案。${recommended.decisionSummary}`,
      };
    }
  }

  const drifting = effects.some(({ decision }) => decision === 'drifting');
  const eligible = strategyCatalog
    .filter(
      ({ id }) =>
        effectByStrategy.get(id)?.decision !== 'avoid' &&
        effectByStrategy.get(id)?.decision !== 'drifting',
    )
    .map((strategy, catalogIndex) => ({
      strategy,
      catalogIndex,
      observed: effectByStrategy.get(strategy.id)?.observed ?? 0,
    }))
    .sort(
      (left, right) =>
        left.observed - right.observed ||
        left.catalogIndex - right.catalogIndex,
    );
  const totalObserved = effects.reduce(
    (total, effect) => total + effect.observed,
    0,
  );
  if (!eligible.length) {
    return {
      mode: 'review',
      stage: 'redesign',
      strategy: null,
      progress: {
        observed: totalObserved,
        pending: 0,
        target: totalObserved,
        remaining: 0,
      },
      reason: '所有已知策略均被负向证据标记为建议停用，需要人工设计新方案。',
    };
  }
  if (
    eligible.every(({ observed }) => observed >= 3)
  ) {
    return {
      mode: 'review',
      stage: 'redesign',
      strategy: null,
      progress: {
        observed: totalObserved,
        pending: 0,
        target: totalObserved,
        remaining: 0,
      },
      reason:
        '当前策略均已达到 3 个样本上限，样本预算已经耗尽但仍未形成可推荐优势；需要重新设计实验变量。',
    };
  }

  const initialCoverageComplete = eligible.every(
    ({ observed }) => observed >= 1,
  );
  const confirmableLeader = initialCoverageComplete
    ? effects
        .filter(
          (effect) =>
            effect.decision === 'leading' &&
            effect.observed >= 2 &&
            effect.observed < 3 &&
            effects.some(
              (candidate) =>
                candidate.strategyId !== effect.strategyId &&
                candidate.observed >= 2,
            ),
        )
        .sort(
          (left, right) =>
            (right.averageScoreDelta ?? 0) - (left.averageScoreDelta ?? 0),
        )[0]
    : undefined;
  const next = confirmableLeader
    ? eligible.find(
        ({ strategy }) => strategy.id === confirmableLeader.strategyId,
      )
    : eligible[0];
  if (!next) {
    return {
      mode: 'review',
      stage: 'redesign',
      strategy: null,
      progress: {
        observed: totalObserved,
        pending: 0,
        target: totalObserved,
        remaining: 0,
      },
      reason: '当前证据无法映射到可用策略，需要人工检查实验记录。',
    };
  }
  const stage = drifting
    ? ('revalidation' as const)
    : confirmableLeader
      ? ('confirmation' as const)
      : eligible.some(({ observed }) => observed === 0)
        ? ('coverage' as const)
        : next.observed < 2
          ? ('comparison' as const)
          : ('confirmation' as const);
  const target = Math.min(3, next.observed + 1);
  return {
    mode: 'explore',
    stage,
    strategy: next.strategy,
    progress: {
      observed: next.observed,
      pending: 0,
      target,
      remaining: target - next.observed,
    },
    reason:
      stage === 'revalidation'
        ? `原领先策略已发生效果漂移；为可用替代策略补充第 ${target} 个验证样本。`
        : stage === 'coverage'
          ? '该策略尚无可归因样本，先完成首轮覆盖以建立可比较基线。'
          : stage === 'comparison'
            ? `该策略只有 ${next.observed} 个可归因样本，补齐双样本对照。`
            : confirmableLeader
              ? '该策略在初步对照中领先，再补充 1 个样本即可检验高置信推荐门槛。'
              : '首轮对照尚未形成明确优势，追加一个受控样本提高分辨率。',
  };
}
