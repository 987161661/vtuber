import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDLE_MAX_INTERVAL_MS,
  DEFAULT_IDLE_MIN_INTERVAL_MS,
  normalizeIdleCadence,
  selectIdleExpressionShape,
} from '../../examples/react-purupuru-app/src/lib/idleThoughtComposer';

describe('idle thought composer', () => {
  it('uses a fixed two minute cadence by default', () => {
    expect(DEFAULT_IDLE_MIN_INTERVAL_MS).toBe(120_000);
    expect(DEFAULT_IDLE_MAX_INTERVAL_MS).toBe(120_000);
  });

  it('migrates the previous broad natural window to the new two minute default', () => {
    expect(
      normalizeIdleCadence(
        { minIntervalMs: 3 * 60_000, maxIntervalMs: 11 * 60_000 },
        { migratePreviousDefault: true },
      ),
    ).toEqual({
      minIntervalMs: DEFAULT_IDLE_MIN_INTERVAL_MS,
      maxIntervalMs: DEFAULT_IDLE_MAX_INTERVAL_MS,
    });
  });

  it('preserves an operator-authored cadence instead of treating it as a legacy default', () => {
    expect(
      normalizeIdleCadence({
        minIntervalMs: 5 * 60_000,
        maxIntervalMs: 8 * 60_000,
      }),
    ).toEqual({
      minIntervalMs: 5 * 60_000,
      maxIntervalMs: 8 * 60_000,
    });
  });

  it('uses every expression shape before cycling back', () => {
    const recent = [] as Array<
      ReturnType<typeof selectIdleExpressionShape>['mode']
    >;
    for (let index = 0; index < 5; index += 1) {
      recent.push(selectIdleExpressionShape(recent).mode);
    }

    expect(new Set(recent).size).toBe(5);
  });
});
