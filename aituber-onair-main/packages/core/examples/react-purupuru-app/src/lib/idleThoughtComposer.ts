export type IdleExpressionMode =
  | 'notice'
  | 'preference'
  | 'tension'
  | 'experiment'
  | 'unfinished';

export interface IdleExpressionShape {
  mode: IdleExpressionMode;
  instruction: string;
}

export const DEFAULT_IDLE_MIN_INTERVAL_MS = 2 * 60_000;
export const DEFAULT_IDLE_MAX_INTERVAL_MS = 2 * 60_000;
const PREVIOUS_DEFAULT_MIN_INTERVAL_MS = 3 * 60_000;
const PREVIOUS_DEFAULT_MAX_INTERVAL_MS = 11 * 60_000;
const MIN_IDLE_INTERVAL_MS = 2 * 60_000;
const MAX_IDLE_INTERVAL_MS = 60 * 60_000;

export function normalizeIdleCadence(
  cadence: {
    minIntervalMs: number;
    maxIntervalMs: number;
  },
  options: { migratePreviousDefault?: boolean } = {},
) {
  if (
    options.migratePreviousDefault &&
    cadence.minIntervalMs === PREVIOUS_DEFAULT_MIN_INTERVAL_MS &&
    cadence.maxIntervalMs === PREVIOUS_DEFAULT_MAX_INTERVAL_MS
  ) {
    return {
      minIntervalMs: DEFAULT_IDLE_MIN_INTERVAL_MS,
      maxIntervalMs: DEFAULT_IDLE_MAX_INTERVAL_MS,
    };
  }

  const minIntervalMs = Math.min(
    MAX_IDLE_INTERVAL_MS,
    Math.max(
      MIN_IDLE_INTERVAL_MS,
      Math.floor(cadence.minIntervalMs || DEFAULT_IDLE_MIN_INTERVAL_MS),
    ),
  );
  const maxIntervalMs = Math.min(
    MAX_IDLE_INTERVAL_MS,
    Math.max(
      minIntervalMs,
      Math.floor(cadence.maxIntervalMs || DEFAULT_IDLE_MAX_INTERVAL_MS),
    ),
  );
  return { minIntervalMs, maxIntervalMs };
}

const EXPRESSION_SHAPES: readonly IdleExpressionShape[] = [
  {
    mode: 'notice',
    instruction:
      '从主来源里挑一个可确认的具体细节，只说由这个细节引出的当下观察，不先讲大道理',
  },
  {
    mode: 'preference',
    instruction:
      '围绕主来源明确一个带个人取舍的偏好，并顺手给出一个具体理由，不把偏好包装成普遍结论',
  },
  {
    mode: 'tension',
    instruction:
      '说出主来源里两种愿望或判断之间尚未解决的小矛盾，允许停在犹豫中，不强行升华',
  },
  {
    mode: 'experiment',
    instruction:
      '从主来源生出一个现在或下一轮可以尝试的小动作，尺度要小，不写成口号或宏大计划',
  },
  {
    mode: 'unfinished',
    instruction:
      '留下一个仍在形成中的念头或疑问，可以半截停住，但必须指向主来源中的具体对象',
  },
];

/**
 * Rotates reusable speech acts while the selected source supplies the content.
 */
export function selectIdleExpressionShape(
  recentModes: readonly (IdleExpressionMode | undefined)[],
): IdleExpressionShape {
  const recent = recentModes.filter((mode): mode is IdleExpressionMode =>
    Boolean(mode),
  );
  const lastUsedAt = new Map<IdleExpressionMode, number>();
  recent.forEach((mode, index) => lastUsedAt.set(mode, index));

  return [...EXPRESSION_SHAPES].sort(
    (left, right) =>
      (lastUsedAt.get(left.mode) ?? -1) - (lastUsedAt.get(right.mode) ?? -1),
  )[0];
}
