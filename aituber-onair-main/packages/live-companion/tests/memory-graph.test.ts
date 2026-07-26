import { describe, expect, it } from 'vitest';
import { TemporalMemoryGraph } from '../src/index.js';

const provenance = (sourceId: string, observedAt: number) => ({
  source: 'chat' as const,
  sourceId,
  observedAt,
});

describe('TemporalMemoryGraph', () => {
  it('answers bitemporal queries using valid time and knowledge time', () => {
    const graph = new TemporalMemoryGraph();
    graph.assert({
      id: 'preference-1',
      kind: 'preference',
      content: 'Mina likes puzzle games.',
      entityId: 'viewer-mina',
      relation: 'likes-genre',
      validFrom: 100,
      recordedAt: 200,
      confidence: 0.9,
      salience: 0.7,
      provenance: provenance('message-1', 100),
      keywords: ['mina', 'puzzle', 'games'],
    });

    expect(graph.query({ asOf: 150, knownAt: 150 })).toEqual([]);
    expect(graph.query({ asOf: 150, knownAt: 250 })[0]?.node.id).toBe(
      'preference-1',
    );

    graph.retract('preference-1', {
      recordedAt: 400,
      reason: 'viewer-correction',
      provenance: provenance('message-2', 390),
    });
    expect(graph.query({ asOf: 150, knownAt: 350 })).toHaveLength(1);
    expect(graph.query({ asOf: 150, knownAt: 450 })).toHaveLength(0);
  });

  it('retains conflict provenance while superseding an old valid-time fact', () => {
    const graph = new TemporalMemoryGraph();
    graph.assert({
      id: 'old-preference',
      kind: 'preference',
      content: 'Mina likes horror games.',
      entityId: 'viewer-mina',
      relation: 'likes-genre',
      validFrom: 100,
      recordedAt: 110,
      confidence: 0.7,
      salience: 0.6,
      provenance: provenance('message-old', 100),
    });
    graph.assert({
      id: 'new-preference',
      kind: 'preference',
      content: 'Mina now prefers puzzle games.',
      entityId: 'viewer-mina',
      relation: 'likes-genre',
      validFrom: 300,
      recordedAt: 310,
      confidence: 0.95,
      salience: 0.8,
      provenance: provenance('message-new', 300),
      supersedes: ['old-preference'],
    });

    expect(graph.query({ asOf: 250, knownAt: 400 }).map((item) => item.node.id)).toEqual([
      'old-preference',
    ]);
    expect(graph.query({ asOf: 350, knownAt: 400 }).map((item) => item.node.id)).toEqual([
      'new-preference',
    ]);
    expect(graph.edgesFrom('new-preference')).toMatchObject([
      { type: 'supersedes', to: 'old-preference' },
    ]);
    expect(graph.get('old-preference')?.provenance.sourceId).toBe('message-old');
  });

  it('combines keywords, vectors, recency, salience, and graph distance', () => {
    const graph = new TemporalMemoryGraph();
    graph.assert({
      id: 'viewer-mina',
      kind: 'viewer',
      content: 'Mina',
      entityId: 'viewer-mina',
      relation: 'identity',
      validFrom: 0,
      recordedAt: 0,
      confidence: 1,
      salience: 1,
      provenance: provenance('profile', 0),
    });
    graph.assert({
      id: 'puzzle-preference',
      kind: 'preference',
      content: 'Enjoys short puzzle games.',
      entityId: 'viewer-mina',
      relation: 'likes-genre',
      validFrom: 900,
      recordedAt: 900,
      confidence: 0.9,
      salience: 0.8,
      provenance: provenance('message-puzzle', 900),
      keywords: ['puzzle', 'short'],
      embedding: [1, 0],
    });
    graph.assert({
      id: 'unrelated-topic',
      kind: 'topic',
      content: 'A cooking discussion.',
      entityId: 'stream-1',
      relation: 'topic',
      validFrom: 990,
      recordedAt: 990,
      confidence: 1,
      salience: 0.9,
      provenance: provenance('topic-change', 990),
      keywords: ['cooking'],
      embedding: [0, 1],
    });
    graph.connect({
      id: 'mina-prefers-puzzle',
      from: 'viewer-mina',
      to: 'puzzle-preference',
      type: 'has-preference',
      validFrom: 900,
      recordedAt: 900,
      provenance: provenance('message-puzzle', 900),
    });

    const results = graph.query({
      text: 'puzzle',
      embedding: [1, 0],
      startNodeIds: ['viewer-mina'],
      asOf: 1_000,
      knownAt: 1_000,
      maxHops: 2,
      limit: 2,
    });

    expect(results[0]?.node.id).toBe('puzzle-preference');
    expect(results[0]?.reasons).toEqual(
      expect.arrayContaining(['keyword', 'vector', 'graph']),
    );
  });
});
