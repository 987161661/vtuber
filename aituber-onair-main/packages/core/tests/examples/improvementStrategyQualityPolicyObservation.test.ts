import { describe, expect, it } from 'vitest';
import { createImprovementStrategyAssetEvent } from '../../examples/react-purupuru-app/src/lib/improvementStrategyAssets';
import type {
  ImprovementStrategy,
  ImprovementStrategyExperimentRecord,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';
import {
  createImprovementStrategyQualityRejectionEvent,
  observeImprovementStrategyQualityPolicyRelease,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityPolicyObservation';
import type { NextSessionImprovementActionRuntimeEvent } from '../../examples/react-purupuru-app/src/lib/nextSessionImprovementOutcome';

const scope = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
};

function strategy(id: string): ImprovementStrategy {
  return {
    id,
    label: id,
    variable: 'method',
    instruction: `只改变 ${id} 的处理方式。`,
    successSignal: '互动率提升 10%',
    origin: 'custom',
    improvementId: 'engagement',
  };
}

function saved(
  id: string,
  gateVersion: number,
  at: number,
): NextSessionImprovementActionRuntimeEvent {
  return createImprovementStrategyAssetEvent({
    operation: 'save',
    strategy: strategy(id),
    scope,
    quality: {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion,
    },
    at,
  });
}

function executed(
  id: string,
  gateVersion: number,
  at: number,
): NextSessionImprovementActionRuntimeEvent {
  return {
    stage: 'operator_next_session_improvement_action',
    at,
    baseSessionId: `session-${at}`,
    improvementId: 'engagement',
    strategyId: id,
    strategyOrigin: 'custom',
    strategyQualityGateVersion: gateVersion,
    outcome: 'completed',
    ...scope,
  };
}

function record(
  id: string,
  gateVersion: number,
  outcome: ImprovementStrategyExperimentRecord['outcome'],
  index: number,
): ImprovementStrategyExperimentRecord {
  return {
    improvementId: 'engagement',
    strategyId: id,
    strategyLabel: id,
    baseSessionId: `session-${gateVersion}-${index}`,
    qualityGateVersion: gateVersion,
    outcome,
  };
}

describe('improvement strategy quality policy release observation', () => {
  it('records a scoped blocked review without pretending that an asset was saved', () => {
    const event = createImprovementStrategyQualityRejectionEvent({
      improvementId: 'engagement',
      scope,
      gateVersion: 2,
      review: {
        status: 'blocked',
        score: 50,
        blockIds: ['definition', 'novelty'],
      },
      at: 100,
    });

    expect(event).toMatchObject({
      stage: 'operator_next_session_improvement_quality_review',
      improvementId: 'engagement',
      strategyQualityStatus: 'blocked',
      strategyQualityScore: 50,
      strategyQualityGateVersion: 2,
      strategyQualityBlockIds: ['definition', 'novelty'],
      ...scope,
    });
    expect(event.strategyAssetOperation).toBeUndefined();
  });

  it('waits for comparable review and outcome windows before judging a release', () => {
    const observation = observeImprovementStrategyQualityPolicyRelease({
      events: [
        saved('baseline-a', 1, 10),
        saved('baseline-b', 1, 20),
        saved('baseline-c', 1, 30),
        saved('current-a', 2, 40),
        saved('current-b', 2, 50),
      ],
      records: [
        record('baseline-a', 1, 'stable', 1),
        record('baseline-b', 1, 'stable', 2),
        record('baseline-c', 1, 'stable', 3),
        record('current-a', 2, 'stable', 4),
      ],
      scope,
      currentVersion: 2,
      baselineVersion: 1,
    });

    expect(observation).toMatchObject({
      status: 'insufficient',
      recommendRollback: false,
      current: {
        reviewAttempts: 2,
        evidenceEvaluated: 1,
      },
    });
  });

  it('recommends human-confirmed rollback when usability, blocking, and execution coverage regress together', () => {
    const blocked = [60, 70].map((at) =>
      createImprovementStrategyQualityRejectionEvent({
        improvementId: 'engagement',
        scope,
        gateVersion: 2,
        review: {
          status: 'blocked',
          score: 50,
          blockIds: ['execution'],
        },
        at,
      }),
    );
    const events = [
      saved('baseline-a', 1, 10),
      saved('baseline-b', 1, 20),
      saved('baseline-c', 1, 30),
      saved('baseline-d', 1, 40),
      executed('baseline-a', 1, 11),
      executed('baseline-b', 1, 21),
      executed('baseline-c', 1, 31),
      saved('current-a', 2, 50),
      saved('current-b', 2, 55),
      ...blocked,
      executed('current-a', 2, 56),
    ];
    const records = [
      record('baseline-a', 1, 'stable', 1),
      record('baseline-b', 1, 'improved', 2),
      record('baseline-c', 1, 'declined', 3),
      record('current-a', 2, 'stable', 4),
      record('current-a', 2, 'confounded', 5),
      record('current-b', 2, 'context-changed', 6),
    ];

    const observation = observeImprovementStrategyQualityPolicyRelease({
      events,
      records,
      scope,
      currentVersion: 2,
      baselineVersion: 1,
    });

    expect(observation).toMatchObject({
      status: 'rollback-recommended',
      recommendRollback: true,
      baseline: {
        reviewAttempts: 4,
        blockRate: 0,
        executionRate: 75,
        usabilityRate: 100,
      },
      current: {
        reviewAttempts: 4,
        blockRate: 50,
        executionRate: 50,
        usabilityRate: 33,
      },
      delta: {
        blockRate: 50,
        executionRate: -25,
        usabilityRate: -67,
      },
    });
    expect(observation.reasons).toHaveLength(3);
    expect(observation.summary).toContain('建议回滚');
  });

  it('keeps a release when the observation window remains comparable', () => {
    const events = [
      saved('baseline-a', 1, 10),
      saved('baseline-b', 1, 20),
      saved('baseline-c', 1, 30),
      executed('baseline-a', 1, 11),
      executed('baseline-b', 1, 21),
      saved('current-a', 2, 40),
      saved('current-b', 2, 50),
      saved('current-c', 2, 60),
      executed('current-a', 2, 41),
      executed('current-b', 2, 51),
    ];
    const records = [
      record('baseline-a', 1, 'stable', 1),
      record('baseline-b', 1, 'improved', 2),
      record('baseline-c', 1, 'declined', 3),
      record('current-a', 2, 'stable', 4),
      record('current-b', 2, 'improved', 5),
      record('current-c', 2, 'declined', 6),
    ];

    expect(
      observeImprovementStrategyQualityPolicyRelease({
        events,
        records,
        scope,
        currentVersion: 2,
        baselineVersion: 1,
      }),
    ).toMatchObject({
      status: 'healthy',
      recommendRollback: false,
      delta: {
        blockRate: 0,
        executionRate: 0,
        usabilityRate: 0,
      },
    });
  });
});
