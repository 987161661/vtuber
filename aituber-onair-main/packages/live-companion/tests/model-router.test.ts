import { describe, expect, it } from 'vitest';
import {
  DeadlineAwareModelRouter,
  type ModelRouteCandidateV1,
} from '../src/index.js';

const candidates: ModelRouteCandidateV1[] = [
  {
    id: 'deep-model',
    kind: 'model',
    executionClass: 'deep',
    taskTypes: ['reply', 'reflection'],
    quality: 0.95,
    p95LatencyMs: 1_500,
    estimatedCostPer1kTokens: 0.02,
  },
  {
    id: 'fast-model',
    kind: 'model',
    executionClass: 'fast',
    taskTypes: ['reply'],
    quality: 0.72,
    p95LatencyMs: 250,
    estimatedCostPer1kTokens: 0.002,
  },
  {
    id: 'semantic-cache',
    kind: 'cache',
    executionClass: 'instant',
    taskTypes: ['reply'],
    quality: 0.6,
    p95LatencyMs: 15,
    estimatedCostPer1kTokens: 0,
  },
  {
    id: 'safe-rule',
    kind: 'rule',
    executionClass: 'instant',
    taskTypes: ['reply'],
    quality: 0.35,
    p95LatencyMs: 5,
    estimatedCostPer1kTokens: 0,
  },
];

describe('DeadlineAwareModelRouter', () => {
  it('uses the highest-quality model when an important turn has enough budget', () => {
    const router = new DeadlineAwareModelRouter(candidates);

    const decision = router.route({
      taskType: 'reply',
      now: 1_000,
      deadlineAt: 4_000,
      importance: 0.9,
      queueDepth: 0,
      estimatedTokens: 500,
    });

    expect(decision.selected.id).toBe('deep-model');
    expect(decision.degradationReason).toBe('none');
    expect(decision.fallbacks.map((candidate) => candidate.id)).toEqual([
      'fast-model',
      'semantic-cache',
      'safe-rule',
    ]);
  });

  it('degrades to an instant safe path before a hard deadline', () => {
    const router = new DeadlineAwareModelRouter(candidates);

    const decision = router.route({
      taskType: 'reply',
      now: 1_000,
      deadlineAt: 1_100,
      importance: 0.8,
      queueDepth: 0,
      estimatedTokens: 300,
    });

    expect(['semantic-cache', 'safe-rule']).toContain(decision.selected.id);
    expect(decision.degradationReason).toBe('deadline');
  });

  it('keeps expensive work out of the live path during queue overload', () => {
    const router = new DeadlineAwareModelRouter(candidates, {
      overloadQueueDepth: 4,
    });

    const decision = router.route({
      taskType: 'reply',
      now: 0,
      deadlineAt: 5_000,
      importance: 1,
      queueDepth: 8,
      estimatedTokens: 1_000,
    });

    expect(decision.selected.executionClass).not.toBe('deep');
    expect(decision.degradationReason).toBe('queue-overload');
  });

  it('opens and recovers a circuit without mutating candidate quality', () => {
    const router = new DeadlineAwareModelRouter(candidates, {
      failureThreshold: 2,
      circuitCooldownMs: 1_000,
    });
    router.recordOutcome('deep-model', { status: 'failed', at: 100 });
    router.recordOutcome('deep-model', { status: 'failed', at: 200 });

    const duringOutage = router.route({
      taskType: 'reply',
      now: 500,
      deadlineAt: 5_000,
      importance: 1,
      queueDepth: 0,
      estimatedTokens: 500,
    });
    expect(duringOutage.selected.id).toBe('fast-model');
    expect(duringOutage.degradationReason).toBe('circuit-open');

    const probe = router.route({
      taskType: 'reply',
      now: 1_201,
      deadlineAt: 5_000,
      importance: 1,
      queueDepth: 0,
      estimatedTokens: 500,
    });
    expect(probe.selected.id).toBe('deep-model');
    router.recordOutcome('deep-model', { status: 'succeeded', at: 1_300, latencyMs: 800 });
    expect(router.health('deep-model')).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
    expect(candidates[0]?.quality).toBe(0.95);
  });
});
