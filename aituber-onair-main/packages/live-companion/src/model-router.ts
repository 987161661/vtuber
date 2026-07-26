export interface ModelRouteCandidateV1 {
  id: string;
  kind: 'model' | 'cache' | 'rule';
  executionClass: 'deep' | 'fast' | 'instant';
  taskTypes: readonly string[];
  quality: number;
  p95LatencyMs: number;
  estimatedCostPer1kTokens: number;
}

export interface ModelRouteRequestV1 {
  taskType: string;
  now: number;
  deadlineAt: number;
  importance: number;
  queueDepth: number;
  estimatedTokens: number;
}

export interface ModelRouteDecisionV1 {
  selected: ModelRouteCandidateV1;
  fallbacks: readonly ModelRouteCandidateV1[];
  degradationReason:
    | 'none'
    | 'deadline'
    | 'queue-overload'
    | 'circuit-open';
  budgetMs: number;
}

export interface ModelRouteOutcomeV1 {
  status: 'succeeded' | 'failed' | 'timed-out';
  at: number;
  latencyMs?: number;
}

export interface ModelCircuitHealthV1 {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  openedAt?: number;
  latencyEwmaMs?: number;
}

export interface DeadlineAwareModelRouterPolicyV1 {
  deadlineReserveMs: number;
  overloadQueueDepth: number;
  failureThreshold: number;
  circuitCooldownMs: number;
}

const DEFAULT_POLICY: DeadlineAwareModelRouterPolicyV1 = {
  deadlineReserveMs: 50,
  overloadQueueDepth: 6,
  failureThreshold: 3,
  circuitCooldownMs: 30_000,
};

/**
 * Routes execution only. It never edits model quality, persona, memory, or
 * policy weights from online feedback.
 */
export class DeadlineAwareModelRouter {
  private readonly candidates: ModelRouteCandidateV1[];
  private readonly policy: DeadlineAwareModelRouterPolicyV1;
  private readonly healthById = new Map<string, ModelCircuitHealthV1>();

  constructor(
    candidates: readonly ModelRouteCandidateV1[],
    policy: Partial<DeadlineAwareModelRouterPolicyV1> = {},
  ) {
    if (candidates.length === 0) throw new Error('Model router requires candidates');
    this.candidates = candidates.map(validateAndCloneCandidate);
    this.policy = { ...DEFAULT_POLICY, ...policy };
    for (const candidate of this.candidates) {
      this.healthById.set(candidate.id, {
        state: 'closed',
        consecutiveFailures: 0,
      });
    }
  }

  route(request: ModelRouteRequestV1): ModelRouteDecisionV1 {
    validateRequest(request);
    const taskCandidates = this.candidates.filter((candidate) =>
      candidate.taskTypes.includes(request.taskType),
    );
    if (taskCandidates.length === 0) {
      throw new Error(`No route supports task type ${request.taskType}`);
    }
    const budgetMs = Math.max(0, request.deadlineAt - request.now);
    const ideal = [...taskCandidates].sort(compareQuality)[0];
    const openIds = new Set<string>();
    const circuitEligible = taskCandidates.filter((candidate) => {
      const health = this.requireHealth(candidate.id);
      if (health.state !== 'open') return true;
      if (
        health.openedAt !== undefined &&
        request.now - health.openedAt >= this.policy.circuitCooldownMs
      ) {
        health.state = 'half-open';
        return true;
      }
      openIds.add(candidate.id);
      return false;
    });
    const queueOverloaded = request.queueDepth >= this.policy.overloadQueueDepth;
    const queueEligible = queueOverloaded
      ? circuitEligible.filter((candidate) => candidate.executionClass !== 'deep')
      : circuitEligible;
    const deadlineEligible = queueEligible.filter(
      (candidate) =>
        candidate.p95LatencyMs <=
        Math.max(0, budgetMs - this.policy.deadlineReserveMs),
    );
    const eligible = deadlineEligible.length
      ? deadlineEligible
      : [...queueEligible].sort(compareLatency).slice(0, 1);
    if (eligible.length === 0) {
      throw new Error(`All routes are unavailable for ${request.taskType}`);
    }
    const ordered = eligible
      .map((candidate) => ({
        candidate,
        score: routeScore(candidate, request, budgetMs),
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.candidate.id.localeCompare(right.candidate.id),
      )
      .map((item) => item.candidate);
    const selected = ordered[0];
    if (!selected) throw new Error(`All routes are unavailable for ${request.taskType}`);

    let degradationReason: ModelRouteDecisionV1['degradationReason'] = 'none';
    if (ideal && openIds.has(ideal.id) && selected.id !== ideal.id) {
      degradationReason = 'circuit-open';
    } else if (queueOverloaded && ideal?.executionClass === 'deep') {
      degradationReason = 'queue-overload';
    } else if (
      ideal &&
      ideal.p95LatencyMs > Math.max(0, budgetMs - this.policy.deadlineReserveMs)
    ) {
      degradationReason = 'deadline';
    }
    return {
      selected: cloneCandidate(selected),
      fallbacks: ordered.slice(1).map(cloneCandidate),
      degradationReason,
      budgetMs,
    };
  }

  recordOutcome(candidateId: string, outcome: ModelRouteOutcomeV1): void {
    const health = this.requireHealth(candidateId);
    if (outcome.latencyMs !== undefined) {
      health.latencyEwmaMs =
        health.latencyEwmaMs === undefined
          ? outcome.latencyMs
          : health.latencyEwmaMs * 0.8 + outcome.latencyMs * 0.2;
    }
    if (outcome.status === 'succeeded') {
      health.state = 'closed';
      health.consecutiveFailures = 0;
      delete health.openedAt;
      return;
    }
    health.consecutiveFailures += 1;
    if (health.consecutiveFailures >= this.policy.failureThreshold) {
      health.state = 'open';
      health.openedAt = outcome.at;
    }
  }

  health(candidateId: string): ModelCircuitHealthV1 {
    return { ...this.requireHealth(candidateId) };
  }

  private requireHealth(candidateId: string): ModelCircuitHealthV1 {
    const health = this.healthById.get(candidateId);
    if (!health) throw new Error(`Unknown model route ${candidateId}`);
    return health;
  }
}

function routeScore(
  candidate: ModelRouteCandidateV1,
  request: ModelRouteRequestV1,
  budgetMs: number,
): number {
  const importance = clamp(request.importance);
  const latencyRatio = candidate.p95LatencyMs / Math.max(1, budgetMs);
  const estimatedCost =
    candidate.estimatedCostPer1kTokens * (request.estimatedTokens / 1_000);
  return (
    candidate.quality * (0.5 + importance * 0.5) -
    latencyRatio * (1 - importance) * 0.4 -
    estimatedCost * (1 - importance) * 0.1
  );
}

function compareQuality(
  left: ModelRouteCandidateV1,
  right: ModelRouteCandidateV1,
): number {
  return right.quality - left.quality || left.id.localeCompare(right.id);
}

function compareLatency(
  left: ModelRouteCandidateV1,
  right: ModelRouteCandidateV1,
): number {
  return left.p95LatencyMs - right.p95LatencyMs || left.id.localeCompare(right.id);
}

function validateAndCloneCandidate(candidate: ModelRouteCandidateV1): ModelRouteCandidateV1 {
  if (!candidate.id || candidate.taskTypes.length === 0) {
    throw new Error('Model route candidate requires identity and task types');
  }
  if (candidate.quality < 0 || candidate.quality > 1 || candidate.p95LatencyMs < 0) {
    throw new Error(`Invalid model route candidate ${candidate.id}`);
  }
  return cloneCandidate(candidate);
}

function validateRequest(request: ModelRouteRequestV1): void {
  if (request.deadlineAt < request.now) throw new Error('Model route deadline has passed');
  if (request.importance < 0 || request.importance > 1) {
    throw new Error('Model route importance must be between 0 and 1');
  }
  if (request.queueDepth < 0 || request.estimatedTokens < 0) {
    throw new Error('Model route load estimates cannot be negative');
  }
}

function cloneCandidate(candidate: ModelRouteCandidateV1): ModelRouteCandidateV1 {
  return { ...candidate, taskTypes: [...candidate.taskTypes] };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
