import { describe, expect, it } from 'vitest';
import {
  buildMemoryContext,
  isNonAttributableViewerCommand,
  selectRelevantMemories,
  suppressViewerMemoriesForOptOut,
} from '../../examples/react-purupuru-app/src/lib/streamerMemory';
import type { StreamerMemoryRecord } from '../../examples/react-purupuru-app/src/types/memory';

function viewerTrace(content: string): StreamerMemoryRecord {
  return {
    id: content,
    digitalHumanId: 'linglan',
    scope: 'viewer',
    kind: 'event',
    dimension: 'relationship',
    layer: 'interaction',
    status: 'candidate',
    title: '小雨的近期互动',
    subjectType: 'viewer',
    subjectId: 'xiaoyu',
    content,
    details: {},
    importance: 5,
    confidence: 0.65,
    temporalScope: 'episode',
    visibility: 'private',
    memoryTier: 'short_term',
    phase: 'now',
    sleepState: 'queued',
    activation: 0.9,
    stability: 0.2,
    halfLifeMs: 10_000,
    salience: 0.5,
    emotionalSalience: 0.1,
    novelty: 0.4,
    goalRelevance: 0.2,
    sessionIds: ['session'],
    sourceType: 'live_event',
    sourceEventIds: ['event'],
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reinforcement: 0,
    disputation: 0,
    versionHistory: [],
  } as StreamerMemoryRecord;
}

describe('streamer memory grounding', () => {
  it('does not retrieve an @city command as a viewer attribute', () => {
    const command = viewerTrace('小雨 的弹幕：@乌鲁木齐');
    expect(isNonAttributableViewerCommand(command)).toBe(true);
    expect(
      buildMemoryContext(
        [command],
        '你在干嘛',
        'xiaoyu',
        1_500,
        undefined,
        'linglan',
      ),
    ).toBe('');
  });

  it('keeps explicit self-report as attributed low-confidence context', () => {
    const selfReport = viewerTrace('我住在乌鲁木齐');
    const context = buildMemoryContext(
      [selfReport],
      '你那边几点',
      'xiaoyu',
      1_500,
      undefined,
      'linglan',
    );
    expect(context).toContain('我住在乌鲁木齐');
    expect(context).toContain('只有“我住在/我来自/我喜欢”等明确自述');
  });

  it('does not inject unrelated private memories into a new topic', () => {
    const catMemory: StreamerMemoryRecord = {
      ...viewerTrace('我家的猫上次在床上捣乱了'),
      status: 'confirmed',
      memoryTier: 'long_term',
      phase: 'long_term',
    };
    const context = buildMemoryContext(
      [catMemory],
      '你到底是真人还是机器人',
      'xiaoyu',
      1_500,
      undefined,
      'linglan',
    );

    expect(context).not.toContain('猫');
    expect(context).not.toContain('床上');
  });

  it('uses the same relevance rule for persona signals during relationship repair', () => {
    const catMemory: StreamerMemoryRecord = {
      ...viewerTrace('溜溜那只猫上次在床上捣乱了'),
      status: 'confirmed',
      memoryTier: 'long_term',
      phase: 'long_term',
    };

    const selected = selectRelevantMemories(
      [catMemory],
      '主播睡着了，都不理我',
      {
        viewerId: 'xiaoyu',
        digitalHumanId: 'linglan',
      },
    );

    expect(selected).toEqual([]);
  });

  it('turns a viewer opt-out into a durable suppression instead of another callback', () => {
    const catMemory: StreamerMemoryRecord = {
      ...viewerTrace('我家的猫上次在床上捣乱了'),
      status: 'confirmed',
      memoryTier: 'long_term',
      phase: 'long_term',
    };
    const input = '那只猫只是偶然说过，别再提这件事了';
    const context = buildMemoryContext(
      [catMemory],
      input,
      'xiaoyu',
      1_500,
      undefined,
      'linglan',
    );
    const suppressed = suppressViewerMemoriesForOptOut(
      [catMemory],
      input,
      'xiaoyu',
      10_000,
    );

    expect(context).toContain('明确要求停止提及旧话题');
    expect(context).not.toContain('我家的猫上次在床上捣乱了');
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]).toMatchObject({
      id: catMemory.id,
      status: 'suppressed',
      phase: 'dormant',
      updatedAt: 10_000,
    });
  });
});
