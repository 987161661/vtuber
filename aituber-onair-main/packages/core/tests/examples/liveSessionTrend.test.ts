import { describe, expect, it } from 'vitest';
import type { LiveSessionRetrospective } from '../../examples/react-purupuru-app/src/lib/liveSessionRetrospective';
import {
  createLiveSessionRetrospectiveEvent,
  mergeLiveSessionRetrospectiveEvents,
  projectLiveSessionTrend,
  retrospectiveRevision,
  type LiveSessionRetrospectiveRuntimeEvent,
} from '../../examples/react-purupuru-app/src/lib/liveSessionTrend';

function event(
  sessionId: string,
  sequence: number,
  score: number,
  at = sequence * 100,
): LiveSessionRetrospectiveRuntimeEvent {
  return {
    stage: 'operator_session_retrospective',
    at,
    sessionId,
    sessionSequence: sequence,
    sessionEndedAt: sequence * 1_000,
    personaId: 'persona-1',
    platform: 'bilibili',
    roomId: '1001',
    retrospectiveScore: score,
    retrospectiveStatus:
      score >= 95
        ? 'excellent'
        : score >= 80
          ? 'stable'
          : score >= 60
            ? 'needs-review'
            : 'critical',
    queueResponded: sequence,
    queueFailed: 0,
    attentionOpened: 0,
    attentionResolved: 0,
  };
}

const report: LiveSessionRetrospective = {
  status: 'stable',
  score: 90,
  title: '整体稳定',
  summary: '60 分钟 · 回应 8',
  metrics: {
    durationMs: 3_600_000,
    total: 10,
    responded: 8,
    skipped: 1,
    failed: 1,
    archived: 0,
    attentionOpened: 2,
    attentionResolved: 2,
    failedActions: 0,
  },
  findings: [],
  markdown: '# report',
};

describe('live session trend', () => {
  it('creates a compact, revision-addressed retrospective event', () => {
    const runtimeEvent = createLiveSessionRetrospectiveEvent({
      report,
      session: {
        sessionId: 'session-3',
        sequence: 3,
        startedAt: 100,
        endedAt: 200,
      },
      scope: {
        personaId: 'persona-1',
        platform: 'douyin',
        roomId: 'room-a',
      },
      experimentContext: {
        id: 'experiment-v1-context-a',
        label: 'gpt-5 · openai · 自动播出',
      },
      at: 250,
    });

    expect(runtimeEvent).toMatchObject({
      stage: 'operator_session_retrospective',
      eventId: `session-retrospective:session-3:${retrospectiveRevision(report)}`,
      sessionId: 'session-3',
      sessionSequence: 3,
      retrospectiveScore: 90,
      queueResponded: 8,
      attentionResolved: 2,
      experimentContextId: 'experiment-v1-context-a',
      experimentContextLabel: 'gpt-5 · openai · 自动播出',
    });
  });

  it('deduplicates session revisions by the newest event', () => {
    const trend = projectLiveSessionTrend([
      event('session-1', 1, 60, 100),
      event('session-1', 1, 85, 200),
      event('session-2', 2, 90, 300),
    ]);

    expect(
      trend.records.map(({ sessionId, score }) => [sessionId, score]),
    ).toEqual([
      ['session-1', 85],
      ['session-2', 90],
    ]);
    expect(trend.direction).toBe('improving');
    expect(trend.scoreDelta).toBe(5);
  });

  it('distinguishes improving, stable and declining changes', () => {
    expect(
      projectLiveSessionTrend([event('a', 1, 70), event('b', 2, 80)]).direction,
    ).toBe('improving');
    expect(
      projectLiveSessionTrend([event('a', 1, 80), event('b', 2, 77)]).direction,
    ).toBe('stable');
    expect(
      projectLiveSessionTrend([event('a', 1, 90), event('b', 2, 80)]).direction,
    ).toBe('declining');
  });

  it('returns an explicit baseline state until two sessions exist', () => {
    const empty = projectLiveSessionTrend([]);
    const baseline = projectLiveSessionTrend([event('session-1', 1, 92)]);

    expect(empty).toMatchObject({
      direction: 'insufficient',
      averageScore: null,
      records: [],
    });
    expect(baseline).toMatchObject({
      direction: 'insufficient',
      averageScore: 92,
      scoreDelta: null,
    });
  });

  it('isolates trends by live-room scope', () => {
    const otherRoom = {
      ...event('other', 9, 10, 900),
      roomId: 'other-room',
    };
    const trend = projectLiveSessionTrend(
      [event('session-1', 1, 92), otherRoom],
      {
        personaId: 'persona-1',
        platform: 'bilibili',
        roomId: '1001',
      },
    );

    expect(trend.records.map(({ sessionId }) => sessionId)).toEqual([
      'session-1',
    ]);
    expect(trend.averageScore).toBe(92);
  });

  it('keeps the compact default while allowing a larger evidence window', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      event(`session-${index + 1}`, index + 1, 70 + index),
    );

    expect(projectLiveSessionTrend(events).records).toHaveLength(8);
    expect(
      projectLiveSessionTrend(events, {
        platform: 'bilibili',
        roomId: '1001',
        recordLimit: 12,
      }).records,
    ).toHaveLength(12);
  });

  it('keeps an optimistic snapshot until history confirms it', () => {
    const optimistic = event('session-1', 1, 90, 100);
    optimistic.eventId = 'snapshot-1';

    expect(
      mergeLiveSessionRetrospectiveEvents({
        remote: [],
        local: [optimistic],
        now: 200,
      }),
    ).toEqual([optimistic]);
    expect(
      mergeLiveSessionRetrospectiveEvents({
        remote: [optimistic],
        local: [optimistic],
        now: 200,
      }),
    ).toEqual([optimistic]);
    expect(
      mergeLiveSessionRetrospectiveEvents({
        remote: [],
        local: [optimistic],
        now: 20_000,
      }),
    ).toEqual([]);
  });
});
