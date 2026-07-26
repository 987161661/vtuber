import { describe, expect, it } from 'vitest';
import {
  createImprovementStrategyAssetEvent,
  type ImprovementStrategyQualitySnapshot,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyAssets';
import type {
  ImprovementStrategy,
  ImprovementStrategyExperimentRecord,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';
import { calibrateImprovementStrategyQuality } from '../../examples/react-purupuru-app/src/lib/improvementStrategyQualityCalibration';

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
    instruction: `只改变 ${id} 的处理方法，并记录执行证据。`,
    successSignal: '失败数量减少且没有新增阻断',
    origin: 'custom',
    improvementId: 'pipeline-review',
  };
}

function assetEvent(
  id: string,
  quality: ImprovementStrategyQualitySnapshot,
  at = 100,
) {
  return createImprovementStrategyAssetEvent({
    operation: 'save',
    strategy: strategy(id),
    scope,
    quality,
    at,
  });
}

function record(
  strategyId: string,
  outcome: ImprovementStrategyExperimentRecord['outcome'],
  index: number,
): ImprovementStrategyExperimentRecord {
  return {
    improvementId: 'pipeline-review',
    strategyId,
    strategyLabel: strategyId,
    baseSessionId: `session-${index}`,
    outcome,
    ...(outcome === 'improved'
      ? { scoreDelta: 8 }
      : outcome === 'stable'
        ? { scoreDelta: 0 }
        : outcome === 'declined'
          ? { scoreDelta: -8 }
          : {}),
  };
}

describe('improvement strategy quality calibration', () => {
  it('keeps calibration insufficient until three outcomes can be evaluated', () => {
    const event = assetEvent('custom-ready', {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion: 1,
    });
    const calibration = calibrateImprovementStrategyQuality({
      events: [event],
      records: [
        record('custom-ready', 'pending', 1),
        record('custom-ready', 'stable', 2),
      ],
      scope,
    });

    expect(calibration).toMatchObject({
      status: 'insufficient',
      evidence: {
        evaluated: 1,
        usable: 1,
        unusable: 0,
        pending: 1,
        usabilityRate: 100,
      },
    });
  });

  it('treats positive, neutral, and negative results as equally usable evidence', () => {
    const event = assetEvent('custom-ready', {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion: 1,
    });
    const calibration = calibrateImprovementStrategyQuality({
      events: [event],
      records: [
        record('custom-ready', 'improved', 1),
        record('custom-ready', 'stable', 2),
        record('custom-ready', 'declined', 3),
      ],
      scope,
    });

    expect(calibration).toMatchObject({
      status: 'aligned',
      evidence: {
        evaluated: 3,
        usable: 3,
        usabilityRate: 100,
      },
    });
  });

  it('marks a ready gate as too permissive when most evidence is unusable', () => {
    const event = assetEvent('custom-ready', {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion: 1,
    });
    const calibration = calibrateImprovementStrategyQuality({
      events: [event],
      records: [
        record('custom-ready', 'confounded', 1),
        record('custom-ready', 'context-changed', 2),
        record('custom-ready', 'stable', 3),
      ],
      scope,
    });

    expect(calibration).toMatchObject({
      status: 'too-permissive',
      readyEvidence: {
        evaluated: 3,
        usable: 1,
        usabilityRate: 33,
      },
    });
    expect(calibration.recommendations.join(' ')).toContain('执行预演');
  });

  it('flags a warning as potentially too strict when reviewable strategies yield usable evidence', () => {
    const event = assetEvent('custom-review', {
      score: 85,
      status: 'review',
      warningIds: ['observation'],
      gateVersion: 1,
    });
    const calibration = calibrateImprovementStrategyQuality({
      events: [event],
      records: [
        record('custom-review', 'improved', 1),
        record('custom-review', 'stable', 2),
        record('custom-review', 'declined', 3),
      ],
      scope,
    });

    expect(calibration).toMatchObject({
      status: 'too-strict',
      reviewEvidence: {
        evaluated: 3,
        usable: 3,
        usabilityRate: 100,
      },
      warningSignals: [
        {
          warningId: 'observation',
          evaluated: 3,
          usable: 3,
          assessment: 'consider-relaxing',
        },
      ],
    });
  });

  it('isolates calibration snapshots by operator scope', () => {
    const event = assetEvent('custom-ready', {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion: 1,
    });

    expect(
      calibrateImprovementStrategyQuality({
        events: [event],
        records: [record('custom-ready', 'stable', 1)],
        scope: { ...scope, roomId: 'another-room' },
      }),
    ).toMatchObject({
      status: 'insufficient',
      evidence: { evaluated: 0 },
    });
  });

  it('restarts calibration evidence when a new gate version is published', () => {
    const versionOne = assetEvent('custom-v1', {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion: 1,
    });
    const versionTwo = assetEvent(
      'custom-v2',
      {
        score: 100,
        status: 'ready',
        warningIds: [],
        gateVersion: 2,
      },
      200,
    );
    const calibration = calibrateImprovementStrategyQuality({
      events: [versionOne, versionTwo],
      records: [
        {
          ...record('custom-v1', 'confounded', 1),
          qualityGateVersion: 1,
        },
        {
          ...record('custom-v1', 'confounded', 2),
          qualityGateVersion: 1,
        },
        {
          ...record('custom-v1', 'confounded', 3),
          qualityGateVersion: 1,
        },
        {
          ...record('custom-v2', 'stable', 4),
          qualityGateVersion: 2,
        },
      ],
      scope,
      gateVersion: 2,
    });

    expect(calibration).toMatchObject({
      status: 'insufficient',
      evidence: {
        evaluated: 1,
        usable: 1,
      },
    });
  });

  it('does not reuse old-version outcomes when the same strategy crosses a gate release', () => {
    const versionOne = assetEvent('custom-shared', {
      score: 100,
      status: 'ready',
      warningIds: [],
      gateVersion: 1,
    });
    const versionTwo = assetEvent(
      'custom-shared',
      {
        score: 100,
        status: 'ready',
        warningIds: [],
        gateVersion: 2,
      },
      200,
    );
    const oldRecord = record('custom-shared', 'confounded', 1);
    const currentRecord = record('custom-shared', 'stable', 2);

    expect(
      calibrateImprovementStrategyQuality({
        events: [versionOne, versionTwo],
        records: [
          { ...oldRecord, qualityGateVersion: 1 },
          { ...oldRecord, baseSessionId: 'session-old-2', qualityGateVersion: 1 },
          { ...oldRecord, baseSessionId: 'session-old-3', qualityGateVersion: 1 },
          { ...currentRecord, qualityGateVersion: 2 },
        ],
        scope,
        gateVersion: 2,
      }),
    ).toMatchObject({
      status: 'insufficient',
      evidence: {
        evaluated: 1,
        usable: 1,
        unusable: 0,
      },
    });
  });
});
