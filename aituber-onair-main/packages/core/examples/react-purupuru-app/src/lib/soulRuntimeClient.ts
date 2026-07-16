import {
  createSoulRuntime,
  createSubjectiveFrame,
  InMemorySoulLedger,
  isSoulReflectionReviewRecord,
  restoreSoulRuntime,
  type OutcomeEventV1,
  type SemanticProposalV1,
  type SoulConstitutionV1,
  type SoulDecisionV1,
  type SoulEventV1,
  type SoulFastModelRequestV1,
  type SoulProfileV1,
  type SoulReflectionCommitInputV1,
  type SoulReflectionCommitResultV1,
  type SoulScopeV1,
  type SoulSnapshotV1,
  type SoulStateV1,
  type SoulTransitionV1,
  type SubjectiveFactV1,
  type SubjectiveFrameV1,
  type SubjectiveMemoryRefV1,
} from '@aituber-onair/soul';

export interface SoulModelResponseMetaV1 {
  modelProfileId: string;
  latencyMs: number;
  firstContentLatencyMs?: number;
  fallback: boolean;
  fallbackReason?: string;
  repairApplied: boolean;
}

export interface SoulTurnEvaluationV1 {
  frame: SubjectiveFrameV1;
  transition: SoulTransitionV1;
  decision: SoulDecisionV1;
  proposal: SemanticProposalV1;
  meta: SoulModelResponseMetaV1;
  state: SoulStateV1;
  persistenceOk: boolean;
}

export interface SoulTurnContextV1 {
  verifiedFacts?: readonly SubjectiveFactV1[];
  memories?: readonly SubjectiveMemoryRefV1[];
  reserveDecision?: boolean;
  forceFallbackReason?: string;
}

export interface SoulOutcomeResultV1 {
  state: SoulStateV1;
  persistenceOk: boolean;
}

export interface BrowserSoulReflectionCommitResultV1
  extends SoulReflectionCommitResultV1 {
  persistenceOk: boolean;
}

export interface BrowserSoulRuntimeOptions {
  constitution: SoulConstitutionV1;
  profile: SoulProfileV1;
  scope: SoulScopeV1;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Browser-side owner for one persona/room/session projection. The generic Soul
 * package stays network-free; this adapter talks only to the local server
 * gateway and mirrors the pure ledger into its append-only store.
 */
export class BrowserSoulRuntimeSession {
  readonly constitution: SoulConstitutionV1;
  readonly profile: SoulProfileV1;
  readonly scope: SoulScopeV1;

  private runtime;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly evaluations = new Map<string, SoulTurnEvaluationV1>();
  private readonly decisionsByEventId = new Map<string, SoulDecisionV1>();
  private lastSyncedLocalSequence = 0;

  constructor(options: BrowserSoulRuntimeOptions) {
    this.constitution = structuredClone(options.constitution);
    this.profile = structuredClone(options.profile);
    this.scope = structuredClone(options.scope);
    // `window.fetch` is a host method in Chromium. Storing it and later
    // invoking it as `this.fetchImpl(...)` binds `this` to the session object,
    // which Chromium rejects with "Illegal invocation". Bind the native
    // implementation once at the adapter boundary; injected test transports
    // remain untouched.
    this.fetchImpl =
      options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.runtime = createSoulRuntime({
      constitution: this.constitution,
      profile: this.profile,
      scope: this.scope,
      now: this.now,
    });
  }

  static async recover(
    options: BrowserSoulRuntimeOptions,
  ): Promise<BrowserSoulRuntimeSession> {
    const fetchImpl =
      options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const scopeQuery = new URLSearchParams({
      personaId: options.scope.personaId,
      platform: options.scope.platform,
      roomId: options.scope.roomId,
      sessionId: options.scope.sessionId,
    });
    const snapshotResponse = await fetchImpl(
      `/api/soul/snapshot?${scopeQuery.toString()}`,
      { cache: 'no-store' },
    );
    if (!snapshotResponse.ok) {
      throw new Error(`soul_snapshot_http_${snapshotResponse.status}`);
    }
    const snapshotBody = (await snapshotResponse.json()) as {
      snapshot?: SoulSnapshotV1;
    };
    if (!snapshotBody.snapshot) throw new Error('soul_snapshot_missing');

    const ledger = new InMemorySoulLedger();
    let afterSequence = 0;
    for (;;) {
      const pageQuery = new URLSearchParams(scopeQuery);
      pageQuery.set('afterSequence', String(afterSequence));
      pageQuery.set('limit', '500');
      pageQuery.set(
        'kinds',
        'event,appraisal,decision,reservation,outcome,reflection',
      );
      const response = await fetchImpl(
        `/api/soul/ledger?${pageQuery.toString()}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error(`soul_ledger_http_${response.status}`);
      const body = (await response.json()) as {
        entries?: Array<{
          id: string;
          kind: Parameters<InMemorySoulLedger['append']>[0]['kind'];
          scope: SoulScopeV1;
          occurredAt: number;
          payload: Parameters<InMemorySoulLedger['append']>[0]['payload'];
          sequence: number;
        }>;
      };
      const entries = Array.isArray(body.entries) ? body.entries : [];
      for (const entry of entries) {
        // Slow-model proposals share the server's `reflection` kind for audit,
        // but only a deterministic local review record is state-authoritative.
        // Filtering before reconstruction also keeps the browser checkpoint
        // sequence/hash independent from inert server audit records.
        if (
          entry.kind === 'reflection' &&
          !isSoulReflectionReviewRecord(entry.payload)
        ) {
          continue;
        }
        await ledger.append({
          id: entry.id,
          kind: entry.kind,
          scope: entry.scope,
          occurredAt: entry.occurredAt,
          payload: entry.payload,
        });
      }
      if (entries.length < 500) break;
      afterSequence = entries[entries.length - 1].sequence;
    }

    const session = new BrowserSoulRuntimeSession(options);
    session.runtime = await restoreSoulRuntime({
      constitution: session.constitution,
      profile: session.profile,
      scope: session.scope,
      ledger,
      snapshot: snapshotBody.snapshot,
      now: options.now,
    });
    session.lastSyncedLocalSequence = (
      await session.runtime.getLedger().list()
    ).length;
    return session;
  }

  getState(): SoulStateV1 {
    return this.runtime.getState();
  }

  getDecision(eventId: string): SoulDecisionV1 | undefined {
    const decision = this.decisionsByEventId.get(eventId);
    return decision ? structuredClone(decision) : undefined;
  }

  async reserveDecision(eventId: string): Promise<SoulOutcomeResultV1> {
    const decision = this.decisionsByEventId.get(eventId);
    if (!decision) throw new Error(`Unknown Soul event ${eventId}`);
    const state = await this.runtime.reserve(decision, this.now());
    return { state, persistenceOk: await this.persistProjection() };
  }

  async evaluate(
    event: SoulEventV1,
    context: SoulTurnContextV1 = {},
  ): Promise<SoulTurnEvaluationV1> {
    const cached = this.evaluations.get(event.id);
    if (cached) return structuredClone(cached);

    const frame = createSubjectiveFrame(this.runtime.getState(), this.profile, {
      actorId: event.actor?.id,
      verifiedFacts: context.verifiedFacts,
      memories: context.memories,
    });
    const { proposal, meta } = context.forceFallbackReason
      ? {
          proposal: createLocalFallbackProposal(event),
          meta: {
            modelProfileId: 'local-soul-fallback-v1',
            latencyMs: 0,
            fallback: true,
            fallbackReason: context.forceFallbackReason,
            repairApplied: false,
          } satisfies SoulModelResponseMetaV1,
        }
      : await this.requestFast({
          constitution: this.constitution,
          profile: this.profile,
          frame,
          event,
        });
    const transition = await this.runtime.observe(event, proposal);
    const decision = await this.runtime.decide(event, proposal, this.now());
    if (context.reserveDecision) {
      await this.runtime.reserve(decision, this.now());
    }
    this.decisionsByEventId.set(event.id, decision);
    const persistenceOk = await this.persistProjection();
    const result: SoulTurnEvaluationV1 = {
      frame,
      transition,
      decision,
      proposal,
      meta,
      state: this.runtime.getState(),
      persistenceOk,
    };
    this.evaluations.set(event.id, structuredClone(result));
    return result;
  }

  async applyOutcome(
    eventId: string,
    status: OutcomeEventV1['status'],
    options: {
      deliveredFraction?: number;
      reasonCode?: string;
      feedbackGoalEvidence?: OutcomeEventV1['feedbackGoalEvidence'];
    } = {},
  ): Promise<SoulOutcomeResultV1> {
    const decision = this.decisionsByEventId.get(eventId);
    if (!decision) throw new Error(`Unknown Soul event ${eventId}`);
    const occurredAt = this.now();
    const outcome: OutcomeEventV1 = {
      protocolVersion: '1.0',
      id: `outcome:${eventId}:${status}:${occurredAt}`,
      decisionId: decision.id,
      scope: structuredClone(this.scope),
      occurredAt,
      status,
      deliveredFraction: options.deliveredFraction,
      reasonCode: options.reasonCode,
      feedbackGoalEvidence: options.feedbackGoalEvidence,
    };
    const state = await this.runtime.applyOutcome(outcome);
    return { state, persistenceOk: await this.persistProjection() };
  }

  /**
   * Commits only an explicitly policy-approved slow-reflection review. The
   * model proposal cannot reach state without the Soul kernel's deterministic
   * evidence, profile, and policy gates.
   */
  async commitReflection(
    input: SoulReflectionCommitInputV1,
  ): Promise<BrowserSoulReflectionCommitResultV1> {
    const result = await this.runtime.commitReflection(input);
    return {
      ...result,
      persistenceOk: await this.persistProjection(),
    };
  }

  private async requestFast(
    request: SoulFastModelRequestV1,
  ): Promise<{
    proposal: SemanticProposalV1;
    meta: SoulModelResponseMetaV1;
  }> {
    const startedAt = this.now();
    try {
      const response = await this.fetchImpl('/api/soul/fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`soul_fast_http_${response.status}`);
      const body = (await response.json()) as {
        proposal?: SemanticProposalV1;
        meta?: SoulModelResponseMetaV1;
      };
      if (
        !body.proposal ||
        body.proposal.eventId !== request.event.id ||
        body.proposal.scope.personaId !== request.event.scope.personaId ||
        !Array.isArray(body.proposal.candidates) ||
        body.proposal.candidates.length === 0
      ) {
        throw new Error('invalid_soul_fast_response');
      }
      return {
        proposal: body.proposal,
        meta: body.meta ?? {
          modelProfileId: body.proposal.modelProfileId,
          latencyMs: Math.max(0, this.now() - startedAt),
          fallback: false,
          repairApplied: false,
        },
      };
    } catch (error) {
      return {
        proposal: createLocalFallbackProposal(request.event),
        meta: {
          modelProfileId: 'local-soul-fallback-v1',
          latencyMs: Math.max(0, this.now() - startedAt),
          fallback: true,
          fallbackReason:
            error instanceof Error ? error.message.slice(0, 120) : 'network',
          repairApplied: false,
        },
      };
    }
  }

  private async persistProjection(): Promise<boolean> {
    try {
      const entries = await this.runtime.getLedger().list({
        afterSequence: this.lastSyncedLocalSequence,
      });
      for (const entry of entries) {
        const response = await this.fetchImpl('/api/soul/ledger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: entry.id,
            kind: entry.kind,
            scope: entry.scope,
            occurredAt: entry.occurredAt,
            payload: entry.payload,
          }),
        });
        if (!response.ok) return false;
        this.lastSyncedLocalSequence = entry.sequence;
      }
      const snapshot = await this.runtime.snapshot(this.now());
      const snapshotResponse = await this.fetchImpl('/api/soul/snapshot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      return snapshotResponse.ok;
    } catch {
      return false;
    }
  }
}

function createLocalFallbackProposal(event: SoulEventV1): SemanticProposalV1 {
  const requiresImmediateResponse =
    event.urgency === 'urgent' || event.urgency === 'high';
  return {
    protocolVersion: '1.0',
    eventId: event.id,
    scope: structuredClone(event.scope),
    modelProfileId: 'local-soul-fallback-v1',
    confidence: 0,
    attribution: 'unknown',
    evidence: [],
    candidates: [
      {
        id: 'local-deterministic-fallback',
        action: requiresImmediateResponse ? 'acknowledge' : 'delay',
        truthMode: 'literal',
        utterance: requiresImmediateResponse
          ? '先按已经确认的安全信息行动，我只补充核实过的部分。'
          : undefined,
        goalEffects: [],
        relationshipBenefit: 0,
        programValue: 0,
        novelty: 0,
        repetitionCost: 0,
        interruptionCost: 0,
        manipulationRisk: 0,
        factSafetyRisk: 0,
        socialRisks: [],
        reasonCodes: ['local-provider-fallback'],
      },
    ],
    repairNotes: ['local-provider-fallback'],
  };
}
