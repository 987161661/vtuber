import type {
  NextSessionImprovementEffect,
  NextSessionImprovementEffectiveness,
} from './nextSessionImprovementOutcome';
import type {
  NextSessionImprovementItem,
  NextSessionImprovementPlan,
} from './nextSessionImprovementPlan';

export type AdaptiveImprovementDisposition =
  | 'validated'
  | 'unchanged'
  | 'reconsider';

export type AdaptiveImprovementItem = NextSessionImprovementItem & {
  originalPriority: number;
  disposition: AdaptiveImprovementDisposition;
  learningNote: string;
};

export type AdaptiveImprovementPlan = Omit<
  NextSessionImprovementPlan,
  'items'
> & {
  items: AdaptiveImprovementItem[];
  learningSummary: string;
};

function adaptItem(
  item: NextSessionImprovementItem,
  effect: NextSessionImprovementEffect | undefined,
): AdaptiveImprovementItem {
  if (!effect || effect.observed < 2) {
    return {
      ...item,
      originalPriority: item.priority,
      disposition: 'unchanged',
      learningNote: effect?.pending
        ? `已执行 ${effect.pending} 次，等待后续场次形成有效样本。`
        : '历史样本不足，暂按当前场次证据排序。',
    };
  }

  if ((effect.averageScoreDelta ?? 0) >= 5) {
    return {
      ...item,
      priority: item.priority + 15,
      originalPriority: item.priority,
      disposition: 'validated',
      learningNote: `已有 ${effect.observed} 次跨场样本，下一场平均提升 ${effect.averageScoreDelta} 分。`,
    };
  }

  const consistentlyStagnant = effect.observed >= 3 && effect.improved === 0;
  if ((effect.averageScoreDelta ?? 0) <= -5 || consistentlyStagnant) {
    const adjustedPriority =
      item.tone === 'priority'
        ? item.priority
        : Math.max(0, item.priority - (consistentlyStagnant ? 15 : 30));
    return {
      ...item,
      priority: adjustedPriority,
      originalPriority: item.priority,
      disposition: 'reconsider',
      learningNote:
        item.tone === 'priority'
          ? '当前风险仍需优先处理，但历史效果不佳；建议更换处理策略后再执行。'
          : consistentlyStagnant
            ? `连续 ${effect.observed} 次未见改善，建议更换策略而非重复操作。`
            : `已有 ${effect.observed} 次样本且平均下降 ${Math.abs(effect.averageScoreDelta ?? 0)} 分，建议先换策略。`,
    };
  }

  return {
    ...item,
    originalPriority: item.priority,
    disposition: 'unchanged',
    learningNote: `已有 ${effect.observed} 次样本，效果基本持平，继续观察。`,
  };
}

export function adaptNextSessionImprovementPlan(input: {
  plan: NextSessionImprovementPlan;
  effectiveness: NextSessionImprovementEffectiveness;
}): AdaptiveImprovementPlan {
  const effectById = new Map(
    input.effectiveness.effects.map((effect) => [effect.improvementId, effect]),
  );
  const items = input.plan.items
    .map((item) => adaptItem(item, effectById.get(item.id)))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.originalPriority - left.originalPriority,
    );
  const validated = items.filter(
    ({ disposition }) => disposition === 'validated',
  ).length;
  const reconsider = items.filter(
    ({ disposition }) => disposition === 'reconsider',
  ).length;

  return {
    ...input.plan,
    items,
    learningSummary: reconsider
      ? `${reconsider} 项历史效果不佳，已提示更换策略；当前高风险事项仍保留优先级。`
      : validated
        ? `${validated} 项已有正向跨场证据，已提高推荐顺序。`
        : items.length
          ? '跨场样本尚不足，当前仍按本场证据排序。'
          : '当前没有需要学习排序的改进动作。',
  };
}
