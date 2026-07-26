import { describe, expect, it } from 'vitest';
import {
  createImprovementStrategyAssetEvent,
  projectImprovementStrategyAssets,
} from '../../examples/react-purupuru-app/src/lib/improvementStrategyAssets';
import type { ImprovementStrategy } from '../../examples/react-purupuru-app/src/lib/improvementStrategyExperiment';

const scope = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
};

function strategy(
  id: string,
  label: string,
  instruction = '只改变当前处理方法，并记录执行前后的失败数量。',
): ImprovementStrategy {
  return {
    id,
    label,
    variable: 'method',
    instruction,
    successSignal: '失败数量下降且没有新增阻断',
    origin: 'custom',
    improvementId: 'readiness:runtime',
  };
}

describe('improvement strategy assets', () => {
  it('saves a custom strategy immediately and restores it from event history', () => {
    const event = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy: strategy('custom-minimal-path', '最小链路验证'),
      scope,
      quality: {
        score: 100,
        status: 'ready',
        warningIds: [],
        gateVersion: 1,
      },
      at: 100,
    });

    expect(event).toMatchObject({
      stage: 'operator_next_session_improvement_strategy_asset',
      strategyAssetOperation: 'save',
      strategyAssetId: 'strategy-asset:custom-minimal-path',
      strategyVersion: 1,
      strategyOrigin: 'custom',
      strategyQualityScore: 100,
      strategyQualityStatus: 'ready',
      strategyQualityGateVersion: 1,
      personaId: 'linglan',
      platform: 'bilibili',
      roomId: 'room-1',
    });
    expect(
      projectImprovementStrategyAssets({ events: [event], scope }),
    ).toEqual({
      assets: [
        expect.objectContaining({
          assetId: 'strategy-asset:custom-minimal-path',
          version: 1,
          status: 'active',
          strategy: expect.objectContaining({
            id: 'custom-minimal-path',
            label: '最小链路验证',
          }),
          quality: {
            score: 100,
            status: 'ready',
            warningIds: [],
            gateVersion: 1,
          },
        }),
      ],
      activeStrategies: [
        expect.objectContaining({ id: 'custom-minimal-path' }),
      ],
      unavailableStrategyIds: [],
    });
  });

  it('keeps a stable asset identity while saving a new strategy version', () => {
    const created = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy: strategy('custom-minimal-path', '最小链路验证'),
      scope,
      at: 100,
    });
    const firstProjection = projectImprovementStrategyAssets({
      events: [created],
      scope,
    });
    const updated = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy: strategy(
        'custom-minimal-path-v2',
        '最小链路验证 V2',
        '先验证最短播出链路，再逐项恢复非关键处理步骤。',
      ),
      scope,
      previous: firstProjection.assets[0],
      at: 200,
    });

    const projection = projectImprovementStrategyAssets({
      events: [created, updated],
      scope,
    });
    expect(updated).toMatchObject({
      strategyAssetId: 'strategy-asset:custom-minimal-path',
      strategyVersion: 2,
    });
    expect(projection.assets).toEqual([
      expect.objectContaining({
        assetId: 'strategy-asset:custom-minimal-path',
        version: 2,
        strategy: expect.objectContaining({
          id: 'custom-minimal-path-v2',
          label: '最小链路验证 V2',
        }),
      }),
    ]);
    expect(projection.activeStrategies.map(({ id }) => id)).toEqual([
      'custom-minimal-path-v2',
    ]);
    expect(projection.unavailableStrategyIds).toEqual([
      'custom-minimal-path',
    ]);
  });

  it('archives and restores an asset without losing its latest version', () => {
    const saved = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy: strategy('custom-minimal-path', '最小链路验证'),
      scope,
      at: 100,
    });
    const active = projectImprovementStrategyAssets({
      events: [saved],
      scope,
    }).assets[0];
    const archived = createImprovementStrategyAssetEvent({
      operation: 'archive',
      asset: active,
      scope,
      at: 200,
    });
    const archivedProjection = projectImprovementStrategyAssets({
      events: [saved, archived],
      scope,
    });

    expect(archivedProjection.assets[0]).toMatchObject({
      version: 1,
      status: 'archived',
    });
    expect(archivedProjection.activeStrategies).toEqual([]);
    expect(archivedProjection.unavailableStrategyIds).toEqual([
      'custom-minimal-path',
    ]);

    const restored = createImprovementStrategyAssetEvent({
      operation: 'restore',
      asset: archivedProjection.assets[0],
      scope,
      at: 300,
    });
    expect(
      projectImprovementStrategyAssets({
        events: [saved, archived, restored],
        scope,
      }).assets[0],
    ).toMatchObject({
      version: 1,
      status: 'active',
      strategy: expect.objectContaining({ id: 'custom-minimal-path' }),
    });
  });

  it('isolates assets by operator scope and preserves copy provenance', () => {
    const original = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy: strategy('custom-minimal-path', '最小链路验证'),
      scope,
      at: 100,
    });
    const copied = createImprovementStrategyAssetEvent({
      operation: 'save',
      strategy: strategy('custom-minimal-path-copy', '最小链路验证副本'),
      copiedFromAssetId: 'strategy-asset:custom-minimal-path',
      scope,
      at: 200,
    });

    const projection = projectImprovementStrategyAssets({
      events: [original, copied],
      scope,
    });
    expect(projection.assets[1]).toMatchObject({
      copiedFromAssetId: 'strategy-asset:custom-minimal-path',
    });
    expect(
      projectImprovementStrategyAssets({
        events: [original, copied],
        scope: { ...scope, roomId: 'another-room' },
      }),
    ).toEqual({
      assets: [],
      activeStrategies: [],
      unavailableStrategyIds: [],
    });
  });
});
