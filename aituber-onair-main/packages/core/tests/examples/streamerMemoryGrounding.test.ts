import { describe, expect, it } from 'vitest';
import {
  buildMemoryContext,
  isNonAttributableViewerCommand,
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
});
