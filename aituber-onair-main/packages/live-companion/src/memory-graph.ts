export type TemporalMemoryNodeKindV1 =
  | 'viewer'
  | 'topic'
  | 'event'
  | 'promise'
  | 'preference'
  | 'persona'
  | 'fact';

export interface TemporalMemoryProvenanceV1 {
  source: 'chat' | 'platform' | 'tool' | 'operator' | 'reflection' | 'import';
  sourceId: string;
  observedAt: number;
  uri?: string;
}

export interface TemporalMemoryAssertionV1 {
  id: string;
  kind: TemporalMemoryNodeKindV1;
  content: string;
  entityId: string;
  relation: string;
  validFrom: number;
  validTo?: number;
  recordedAt: number;
  confidence: number;
  salience: number;
  provenance: TemporalMemoryProvenanceV1;
  keywords?: readonly string[];
  embedding?: readonly number[];
  supersedes?: readonly string[];
  contradicts?: readonly string[];
}

export type TemporalMemoryNodeV1 = Omit<
  TemporalMemoryAssertionV1,
  'supersedes' | 'contradicts'
>;

export interface TemporalMemoryEdgeV1 {
  id: string;
  from: string;
  to: string;
  type: 'supersedes' | 'contradicts' | 'has-preference' | 'about' | 'related';
  validFrom: number;
  validTo?: number;
  recordedAt: number;
  provenance: TemporalMemoryProvenanceV1;
}

export interface TemporalMemoryRetractionV1 {
  recordedAt: number;
  reason: string;
  provenance: TemporalMemoryProvenanceV1;
}

export interface TemporalMemoryQueryV1 {
  text?: string;
  embedding?: readonly number[];
  startNodeIds?: readonly string[];
  kinds?: readonly TemporalMemoryNodeKindV1[];
  asOf: number;
  knownAt: number;
  maxHops?: number;
  limit?: number;
}

export interface TemporalMemoryQueryResultV1 {
  node: TemporalMemoryNodeV1;
  score: number;
  graphDistance?: number;
  reasons: readonly ('keyword' | 'vector' | 'recency' | 'salience' | 'graph')[];
}

export interface TemporalMemoryGraphWeightsV1 {
  keyword: number;
  vector: number;
  recency: number;
  salience: number;
  confidence: number;
  graph: number;
}

interface ValidityClosure {
  validTo: number;
  recordedAt: number;
}

interface StoredNode {
  node: TemporalMemoryNodeV1;
  closures: ValidityClosure[];
  retractions: TemporalMemoryRetractionV1[];
}

const DEFAULT_WEIGHTS: TemporalMemoryGraphWeightsV1 = {
  keyword: 0.3,
  vector: 0.25,
  recency: 0.1,
  salience: 0.15,
  confidence: 0.1,
  graph: 0.2,
};

/** Compact in-process graph for live facts; intentionally not a GraphRAG index. */
export class TemporalMemoryGraph {
  private readonly nodes = new Map<string, StoredNode>();
  private readonly edges = new Map<string, TemporalMemoryEdgeV1>();
  private readonly weights: TemporalMemoryGraphWeightsV1;

  constructor(weights: TemporalMemoryGraphWeightsV1 = DEFAULT_WEIGHTS) {
    this.weights = weights;
  }

  assert(assertion: TemporalMemoryAssertionV1): TemporalMemoryNodeV1 {
    validateAssertion(assertion);
    const node = toNode(assertion);
    const existing = this.nodes.get(node.id);
    if (existing) {
      if (JSON.stringify(existing.node) !== JSON.stringify(node)) {
        throw new Error(`Conflicting temporal memory assertion ${node.id}`);
      }
      return cloneNode(existing.node);
    }
    this.nodes.set(node.id, { node, closures: [], retractions: [] });

    for (const target of assertion.supersedes ?? []) {
      const previous = this.requireNode(target);
      previous.closures.push({
        validTo: assertion.validFrom,
        recordedAt: assertion.recordedAt,
      });
      this.connect({
        id: `${assertion.id}:supersedes:${target}`,
        from: assertion.id,
        to: target,
        type: 'supersedes',
        validFrom: assertion.validFrom,
        recordedAt: assertion.recordedAt,
        provenance: assertion.provenance,
      });
    }
    for (const target of assertion.contradicts ?? []) {
      this.requireNode(target);
      this.connect({
        id: `${assertion.id}:contradicts:${target}`,
        from: assertion.id,
        to: target,
        type: 'contradicts',
        validFrom: assertion.validFrom,
        recordedAt: assertion.recordedAt,
        provenance: assertion.provenance,
      });
    }
    return cloneNode(node);
  }

  connect(edge: TemporalMemoryEdgeV1): TemporalMemoryEdgeV1 {
    this.requireNode(edge.from);
    this.requireNode(edge.to);
    const existing = this.edges.get(edge.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(edge)) {
        throw new Error(`Conflicting temporal memory edge ${edge.id}`);
      }
      return cloneEdge(existing);
    }
    if (edge.validTo !== undefined && edge.validTo <= edge.validFrom) {
      throw new Error('Temporal memory edge validTo must follow validFrom');
    }
    const stored = cloneEdge(edge);
    this.edges.set(edge.id, stored);
    return cloneEdge(stored);
  }

  retract(id: string, retraction: TemporalMemoryRetractionV1): void {
    const stored = this.requireNode(id);
    if (retraction.recordedAt < stored.node.recordedAt) {
      throw new Error('Retraction cannot precede the assertion record');
    }
    stored.retractions.push(cloneRetraction(retraction));
    stored.retractions.sort(
      (left, right) => left.recordedAt - right.recordedAt,
    );
  }

  get(id: string): TemporalMemoryNodeV1 | undefined {
    const stored = this.nodes.get(id);
    return stored ? cloneNode(stored.node) : undefined;
  }

  edgesFrom(id: string): TemporalMemoryEdgeV1[] {
    return [...this.edges.values()]
      .filter((edge) => edge.from === id)
      .map(cloneEdge);
  }

  query(query: TemporalMemoryQueryV1): TemporalMemoryQueryResultV1[] {
    const queryTokens = tokenize(query.text ?? '');
    const distances = this.graphDistances(
      query.startNodeIds ?? [],
      query.asOf,
      query.knownAt,
      query.maxHops ?? 3,
    );
    return [...this.nodes.values()]
      .filter((stored) => this.isNodeVisible(stored, query.asOf, query.knownAt))
      .filter(
        (stored) => !query.kinds || query.kinds.includes(stored.node.kind),
      )
      .map((stored): TemporalMemoryQueryResultV1 => {
        const node = stored.node;
        const nodeTokens = new Set([
          ...tokenize(node.content),
          ...(node.keywords ?? []).flatMap(tokenize),
        ]);
        const keyword = queryTokens.length
          ? queryTokens.filter((token) => nodeTokens.has(token)).length /
            queryTokens.length
          : 0;
        const vector =
          query.embedding && node.embedding
            ? Math.max(0, cosine(query.embedding, node.embedding))
            : 0;
        const age = Math.max(0, query.asOf - node.validFrom);
        const recency = 1 / (1 + age / 86_400_000);
        const graphDistance = distances.get(node.id);
        const graph = graphDistance === undefined ? 0 : 1 / (1 + graphDistance);
        const score =
          this.weights.keyword * keyword +
          this.weights.vector * vector +
          this.weights.recency * recency +
          this.weights.salience * node.salience +
          this.weights.confidence * node.confidence +
          this.weights.graph * graph;
        const reasons: TemporalMemoryQueryResultV1['reasons'][number][] = [];
        if (keyword > 0) reasons.push('keyword');
        if (vector > 0) reasons.push('vector');
        if (recency > 0) reasons.push('recency');
        if (node.salience > 0) reasons.push('salience');
        if (graphDistance !== undefined) reasons.push('graph');
        return {
          node: cloneNode(node),
          score,
          ...(graphDistance === undefined ? {} : { graphDistance }),
          reasons,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.node.id.localeCompare(right.node.id),
      )
      .slice(0, query.limit ?? 20);
  }

  private isNodeVisible(
    stored: StoredNode,
    asOf: number,
    knownAt: number,
  ): boolean {
    const { node } = stored;
    if (node.recordedAt > knownAt || node.validFrom > asOf) return false;
    if (node.validTo !== undefined && node.validTo <= asOf) return false;
    if (stored.retractions.some((item) => item.recordedAt <= knownAt))
      return false;
    return !stored.closures.some(
      (closure) => closure.recordedAt <= knownAt && closure.validTo <= asOf,
    );
  }

  private graphDistances(
    starts: readonly string[],
    asOf: number,
    knownAt: number,
    maxHops: number,
  ): Map<string, number> {
    const distances = new Map<string, number>();
    const queue: string[] = [];
    for (const start of starts) {
      if (this.nodes.has(start)) {
        distances.set(start, 0);
        queue.push(start);
      }
    }
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      const distance = distances.get(current) ?? 0;
      if (distance >= maxHops) continue;
      for (const edge of this.edges.values()) {
        if (!isEdgeVisible(edge, asOf, knownAt)) continue;
        const next =
          edge.from === current
            ? edge.to
            : edge.to === current
              ? edge.from
              : undefined;
        if (!next || distances.has(next)) continue;
        distances.set(next, distance + 1);
        queue.push(next);
      }
    }
    return distances;
  }

  private requireNode(id: string): StoredNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown temporal memory node ${id}`);
    return node;
  }
}

function validateAssertion(assertion: TemporalMemoryAssertionV1): void {
  if (
    !assertion.id ||
    !assertion.content.trim() ||
    !assertion.entityId ||
    !assertion.relation
  ) {
    throw new Error('Temporal memory assertion requires identity and content');
  }
  if (
    assertion.validTo !== undefined &&
    assertion.validTo <= assertion.validFrom
  ) {
    throw new Error('Temporal memory validTo must follow validFrom');
  }
  if (assertion.recordedAt < assertion.provenance.observedAt) {
    throw new Error(
      'Temporal memory cannot be recorded before it was observed',
    );
  }
  if (assertion.confidence < 0 || assertion.confidence > 1) {
    throw new Error('Temporal memory confidence must be between 0 and 1');
  }
  if (assertion.salience < 0 || assertion.salience > 1) {
    throw new Error('Temporal memory salience must be between 0 and 1');
  }
}

function isEdgeVisible(
  edge: TemporalMemoryEdgeV1,
  asOf: number,
  knownAt: number,
): boolean {
  return (
    edge.recordedAt <= knownAt &&
    edge.validFrom <= asOf &&
    (edge.validTo === undefined || edge.validTo > asOf)
  );
}

function toNode(assertion: TemporalMemoryAssertionV1): TemporalMemoryNodeV1 {
  const {
    supersedes: _supersedes,
    contradicts: _contradicts,
    ...node
  } = assertion;
  return cloneNode(node);
}

function cloneNode(node: TemporalMemoryNodeV1): TemporalMemoryNodeV1 {
  return {
    ...node,
    provenance: { ...node.provenance },
    ...(node.keywords ? { keywords: [...node.keywords] } : {}),
    ...(node.embedding ? { embedding: [...node.embedding] } : {}),
  };
}

function cloneEdge(edge: TemporalMemoryEdgeV1): TemporalMemoryEdgeV1 {
  return { ...edge, provenance: { ...edge.provenance } };
}

function cloneRetraction(
  retraction: TemporalMemoryRetractionV1,
): TemporalMemoryRetractionV1 {
  return { ...retraction, provenance: { ...retraction.provenance } };
}

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
