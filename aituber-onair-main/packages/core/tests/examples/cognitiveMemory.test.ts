import { describe, expect, it } from 'vitest';
import { LINGLAN_PROFILE } from '../../examples/react-purupuru-app/src/config/characterProfile';
import {
  createDefaultMemoryArchive,
  createMemoryRecord,
} from '../../examples/react-purupuru-app/src/config/memoryArchiveSeed';
import {
  createInteractionTrace,
  runSleepCycle,
} from '../../examples/react-purupuru-app/src/lib/cognitiveMemory';
import type { MemoryInteraction } from '../../examples/react-purupuru-app/src/types/memory';

const HUMAN_ID = 'linglan';
const NOW = Date.UTC(2026, 6, 12, 12);

function interaction(
  input: string,
  sessionId: string,
  index = 0,
): ReturnType<typeof createInteractionTrace> {
  const event: MemoryInteraction = {
    id: `event-${sessionId}-${index}`,
    at: NOW + index,
    viewerId: 'viewer-1',
    viewerName: '小海',
    input,
    reply: '我听见了。',
    source: 'live',
  };
  return createInteractionTrace(event, HUMAN_ID, sessionId);
}

describe('cognitive memory sleep cycle', () => {
  it('forgets a one-off greeting instead of turning it into a profile fact', () => {
    const trace = interaction('你好', 'session-1');
    const result = runSleepCycle([trace], HUMAN_ID, 'post_stream', NOW + 1_000);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].phase).toBe('forgotten');
    expect(result.report.promoted).toBe(0);
  });

  it('promotes repeated stimulation across sessions into long-term memory', () => {
    const traces = ['session-1', 'session-2', 'session-3'].map(
      (sessionId, index) =>
        interaction('我每周五晚上都会来直播间一起看天气', sessionId, index),
    );
    const result = runSleepCycle(traces, HUMAN_ID, 'deep', NOW + 2_000);
    const longTerm = result.records.find(
      (record) => record.memoryTier === 'long_term',
    );

    expect(result.report.promoted).toBe(1);
    expect(longTerm?.longTermType).toBe('relational');
    expect(longTerm?.sessionIds).toHaveLength(3);
    expect(longTerm?.occurrenceCount).toBe(3);
  });

  it('strengthens a matching long-term memory when it is stimulated again', () => {
    const existing = createMemoryRecord({
      digitalHumanId: HUMAN_ID,
      scope: 'viewer',
      kind: 'summary',
      dimension: 'relationship',
      layer: 'reflection',
      status: 'confirmed',
      title: '小海常来直播间',
      subjectType: 'viewer',
      subjectId: 'viewer-1',
      subjectName: '小海',
      content: '小海每周五晚上都会来直播间一起看天气',
      importance: 7,
      confidence: 0.8,
      temporalScope: 'pattern',
      visibility: 'private',
      memoryTier: 'long_term',
      longTermType: 'relational',
      phase: 'long_term',
      sleepState: 'settled',
      activation: 0.55,
      stability: 0.55,
      halfLifeMs: 30 * 86_400_000,
      salience: 0.7,
      emotionalSalience: 0.3,
      novelty: 0.3,
      goalRelevance: 0.5,
      sessionIds: ['session-0'],
      firstSeenAt: NOW - 86_400_000,
      lastSeenAt: NOW - 86_400_000,
    });
    const traces = [
      interaction('我每周五晚上都会来直播间一起看天气', 'session-1'),
      interaction('每周五晚上我还是会来一起看天气', 'session-2', 1),
    ];
    const result = runSleepCycle(
      [existing, ...traces],
      HUMAN_ID,
      'deep',
      NOW + 2_000,
    );
    const strengthened = result.records.find(
      (record) => record.id === existing.id,
    );

    expect(result.report.strengthened).toBe(1);
    expect(strengthened?.stability).toBeGreaterThan(existing.stability);
    expect(strengthened?.occurrenceCount).toBe(3);
  });

  it('lets an unstimulated long-term memory become dormant', () => {
    const memory = createMemoryRecord({
      digitalHumanId: HUMAN_ID,
      scope: 'knowledge',
      kind: 'summary',
      dimension: 'knowledge',
      layer: 'reflection',
      status: 'confirmed',
      title: '很久以前的细节',
      subjectType: 'self',
      subjectName: '凌岚',
      content: '一个长期没有被再次提起的普通细节',
      importance: 3,
      confidence: 0.7,
      temporalScope: 'pattern',
      visibility: 'internal',
      memoryTier: 'long_term',
      longTermType: 'semantic',
      phase: 'long_term',
      sleepState: 'settled',
      activation: 0.7,
      stability: 0.2,
      halfLifeMs: 86_400_000,
      salience: 0.2,
      emotionalSalience: 0.1,
      novelty: 0.2,
      goalRelevance: 0.1,
      sessionIds: ['session-old'],
      firstSeenAt: NOW - 10 * 86_400_000,
      lastSeenAt: NOW - 10 * 86_400_000,
    });
    const result = runSleepCycle([memory], HUMAN_ID, 'deep', NOW);

    expect(['dormant', 'forgotten']).toContain(result.records[0].phase);
    expect(result.records[0].activation).toBeLessThan(0.055);
  });
});

describe('Linglan autobiographical foundation', () => {
  it('seeds four protected memories in each of the six dimensions', () => {
    const memories = createDefaultMemoryArchive(LINGLAN_PROFILE);
    const counts = Object.fromEntries(
      [
        'self',
        'relationship',
        'preference',
        'episode',
        'commitment',
        'knowledge',
      ].map((dimension) => [
        dimension,
        memories.filter((memory) => memory.dimension === dimension).length,
      ]),
    );

    expect(memories).toHaveLength(24);
    expect(counts).toEqual({
      self: 4,
      relationship: 4,
      preference: 4,
      episode: 4,
      commitment: 4,
      knowledge: 4,
    });
    expect(memories.every((memory) => memory.protected)).toBe(true);
    expect(
      memories.every((memory) => memory.sourceType === 'operator_seed'),
    ).toBe(true);
  });

  it('does not decay protected autobiographical memories during deep sleep', () => {
    const memories = createDefaultMemoryArchive(LINGLAN_PROFILE).map(
      (memory) => ({
        ...memory,
        activation: 0.1,
        stability: 0.2,
        lastSeenAt: NOW - 365 * 86_400_000,
      }),
    );
    const result = runSleepCycle(memories, LINGLAN_PROFILE.id, 'deep', NOW);

    expect(result.records.every((memory) => memory.phase === 'long_term')).toBe(
      true,
    );
    expect(result.records.every((memory) => memory.activation >= 0.82)).toBe(
      true,
    );
    expect(result.records.every((memory) => memory.stability >= 0.86)).toBe(
      true,
    );
  });
});
