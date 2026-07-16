import {
  type CanonRevisionV1,
  type SoulConstitutionV1,
  type SoulReflectionProposalV1,
  type SoulScopeV1,
  hashCanonContent,
  promoteCanonCandidate,
  retractCanonRevision,
  validateCanonCandidate,
} from '@aituber-onair/soul';

const CANON_LEDGER_ENDPOINT = '/api/soul/ledger';
const LEDGER_PAGE_SIZE = 1_000;

export type CanonLedgerTransitionV1 =
  | 'candidate-observed'
  | 'candidate-reviewed'
  | 'activated'
  | 'superseded'
  | 'retracted';

export interface CanonEvidenceBindingV1 {
  eventId: string;
  actorId: string;
}

export interface CanonLedgerRecordV1 {
  protocolVersion: '1.0';
  recordType: 'canon-revision';
  transition: CanonLedgerTransitionV1;
  revision: CanonRevisionV1;
  evidenceBindings: readonly CanonEvidenceBindingV1[];
  reflectionIds: readonly string[];
  sourceProposalIds: readonly string[];
  reasonCode: string;
}

export interface SoulCanonProjectionV1 {
  active: readonly CanonRevisionV1[];
  candidates: readonly CanonRevisionV1[];
  superseded: readonly CanonRevisionV1[];
  retracted: readonly CanonRevisionV1[];
}

export interface CanonAcceptanceResultV1 {
  proposalId: string;
  canonKey: string;
  status: 'rejected' | 'candidate' | 'active' | 'already-active';
  revision?: CanonRevisionV1;
  reasonCodes: readonly string[];
}

export interface SoulCanonRepositoryOptions {
  scope: SoulScopeV1;
  constitution: SoulConstitutionV1;
  fetchImpl?: typeof fetch;
  now?: () => number;
  createRevisionId?: () => string;
}

interface CanonLedgerEntryV1 {
  id: string;
  kind: 'canon';
  scope: SoulScopeV1;
  occurredAt: number;
  sequence: number;
  payload: CanonLedgerRecordV1;
}

interface RevisionProjection {
  record: CanonLedgerRecordV1;
  sequence: number;
}

let fallbackRevisionSequence = 0;

/**
 * Scope-bound, append-only client projection for character canon. Candidates
 * never enter active retrieval until the shared Soul validator promotes them.
 */
export class SoulCanonRepository {
  readonly scope: SoulScopeV1;
  readonly constitution: SoulConstitutionV1;

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly createRevisionToken: () => string;
  private readonly revisions = new Map<string, RevisionProjection>();
  private loaded = false;
  private lastSequence = 0;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(options: SoulCanonRepositoryOptions) {
    if (options.scope.personaId !== options.constitution.personaId) {
      throw new Error('canon_repository_persona_scope_mismatch');
    }
    this.scope = structuredClone(options.scope);
    this.constitution = structuredClone(options.constitution);
    this.fetchImpl =
      options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.createRevisionToken = options.createRevisionId ?? defaultRevisionToken;
  }

  async load(): Promise<SoulCanonProjectionV1> {
    this.loaded = false;
    this.revisions.clear();
    this.lastSequence = 0;
    let afterSequence = 0;
    while (true) {
      const params = new URLSearchParams({
        kinds: 'canon',
        personaId: this.scope.personaId,
        platform: this.scope.platform,
        roomId: this.scope.roomId,
        sessionId: this.scope.sessionId,
        afterSequence: String(afterSequence),
        limit: String(LEDGER_PAGE_SIZE),
      });
      const response = await this.fetchImpl(
        `${CANON_LEDGER_ENDPOINT}?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`canon_ledger_load_http_${response.status}`);
      }
      const body = recordValue(await response.json());
      const entries = arrayValue(body?.entries);
      if (!entries) throw new Error('canon_ledger_load_invalid');
      let pageHighWater = afterSequence;
      for (const value of entries) {
        const entry = parseCanonLedgerEntry(value);
        assertScope(this.scope, entry.scope);
        this.applyRecord(entry.payload, entry.sequence);
        pageHighWater = Math.max(pageHighWater, entry.sequence);
      }
      if (entries.length < LEDGER_PAGE_SIZE) break;
      if (pageHighWater <= afterSequence) {
        throw new Error('canon_ledger_pagination_stalled');
      }
      afterSequence = pageHighWater;
    }
    this.assertUniqueActiveKeys();
    this.loaded = true;
    return this.getProjection();
  }

  getProjection(): SoulCanonProjectionV1 {
    const revisions = [...this.revisions.values()]
      .map(({ record }) => record.revision)
      .sort(compareRevisions);
    return {
      active: cloneRevisions(
        revisions.filter((revision) => revision.status === 'active'),
      ),
      candidates: cloneRevisions(
        revisions.filter((revision) => revision.status === 'candidate'),
      ),
      superseded: cloneRevisions(
        revisions.filter((revision) => revision.status === 'superseded'),
      ),
      retracted: cloneRevisions(
        revisions.filter((revision) => revision.status === 'retracted'),
      ),
    };
  }

  getActive(canonKey?: string): readonly CanonRevisionV1[] {
    return this.getProjection().active.filter(
      (revision) => canonKey === undefined || revision.canonKey === canonKey,
    );
  }

  getCandidates(): readonly CanonRevisionV1[] {
    return this.getProjection().candidates;
  }

  getSuperseded(): readonly CanonRevisionV1[] {
    return this.getProjection().superseded;
  }

  getRetracted(): readonly CanonRevisionV1[] {
    return this.getProjection().retracted;
  }

  acceptReflectionCandidates(
    reflection: SoulReflectionProposalV1,
    evidenceBindings: readonly CanonEvidenceBindingV1[],
  ): Promise<readonly CanonAcceptanceResultV1[]> {
    return this.enqueueMutation(() =>
      this.acceptReflectionCandidatesInternal(
        reflection,
        normalizeEvidenceBindings(evidenceBindings),
      ),
    );
  }

  retract(revisionId: string, reasonCode: string): Promise<CanonRevisionV1> {
    return this.enqueueMutation(() =>
      this.retractInternal(revisionId, reasonCode),
    );
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.catch(() => undefined);
    return result;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async acceptReflectionCandidatesInternal(
    reflection: SoulReflectionProposalV1,
    evidenceBindings: readonly CanonEvidenceBindingV1[],
  ): Promise<readonly CanonAcceptanceResultV1[]> {
    await this.ensureLoaded();
    const reflectionId = boundedString(reflection.id, 160);
    if (!reflectionId) throw new Error('canon_reflection_id_required');
    if (!this.constitution.truthPolicy.allowCharacterCanon) {
      return reflection.canonProposals.map((proposal) => ({
        proposalId: boundedString(proposal.id, 160),
        canonKey: boundedString(proposal.canonKey, 160),
        status: 'rejected' as const,
        reasonCodes: ['canon-disabled-by-constitution'],
      }));
    }

    const results: CanonAcceptanceResultV1[] = [];
    for (const proposal of reflection.canonProposals) {
      results.push(
        await this.acceptOneProposal(reflectionId, proposal, evidenceBindings),
      );
    }
    return results;
  }

  private async acceptOneProposal(
    reflectionId: string,
    proposal: SoulReflectionProposalV1['canonProposals'][number],
    evidenceBindings: readonly CanonEvidenceBindingV1[],
  ): Promise<CanonAcceptanceResultV1> {
    const proposalId = boundedString(proposal.id, 160);
    const canonKey = boundedString(proposal.canonKey, 160);
    const content = boundedString(proposal.content, 1_200);
    if (!proposalId || !canonKey || !content) {
      return {
        proposalId,
        canonKey,
        status: 'rejected',
        reasonCodes: ['canon-proposal-shape-invalid'],
      };
    }
    const contentHash = hashCanonContent(content);
    const active = this.findActive(canonKey);
    if (active?.record.revision.contentHash === contentHash) {
      return {
        proposalId,
        canonKey,
        status: 'already-active',
        revision: structuredClone(active.record.revision),
        reasonCodes: ['canon-content-already-active'],
      };
    }

    const pending = this.findPending(canonKey, contentHash);
    const priorReflectionIds = pending?.record.reflectionIds ?? [];
    const reflectionIds = uniqueStrings([...priorReflectionIds, reflectionId]);
    const sourceProposalIds = uniqueStrings([
      ...(pending?.record.sourceProposalIds ?? []),
      proposalId,
    ]);
    const reviewAdded = reflectionIds.length > priorReflectionIds.length;
    const now = this.now();
    const candidate = pending
      ? this.updatePendingCandidate(
          pending.record.revision,
          proposal,
          reflectionIds.length,
          now,
        )
      : this.createCandidate(proposal, content, contentHash, active, now);
    candidate.reviewPasses = reflectionIds.length;
    candidate.validationCodes = [
      'reflection-review-recorded',
      ...(candidate.impact === 'major' && candidate.reviewPasses < 2
        ? ['canon-awaiting-independent-review']
        : []),
    ];
    const retainedEvidenceBindings = relevantEvidenceBindings(candidate, [
      ...(pending?.record.evidenceBindings ?? []),
      ...evidenceBindings,
    ]);

    const validation = validateCanonCandidate(
      this.constitution,
      candidate,
      this.currentRevisions(),
    );
    const viewerEvidenceReasons = validateTrustedViewerEvidence(
      candidate,
      evidenceBindings,
    );
    const hardReasons = validation.valid
      ? []
      : validation.reasonCodes.filter(
          (reason) => reason !== 'canon-review-passes-insufficient',
        );
    const rejectionReasons = uniqueStrings([
      ...hardReasons,
      ...viewerEvidenceReasons,
    ]);
    if (rejectionReasons.length > 0) {
      return {
        proposalId,
        canonKey,
        status: 'rejected',
        reasonCodes: rejectionReasons,
      };
    }

    if (!pending || reviewAdded) {
      await this.appendRecord({
        protocolVersion: '1.0',
        recordType: 'canon-revision',
        transition: pending ? 'candidate-reviewed' : 'candidate-observed',
        revision: candidate,
        evidenceBindings: retainedEvidenceBindings,
        reflectionIds,
        sourceProposalIds,
        reasonCode: pending
          ? 'independent-reflection-recorded'
          : 'reflection-candidate-recorded',
      });
    }

    if (!validation.valid) {
      return {
        proposalId,
        canonKey,
        status: 'candidate',
        revision: structuredClone(candidate),
        reasonCodes: validation.reasonCodes,
      };
    }

    const promoted = promoteCanonCandidate(
      this.constitution,
      candidate,
      this.currentRevisions(),
      now,
    );
    if (active) {
      const superseded: CanonRevisionV1 = {
        ...structuredClone(active.record.revision),
        status: 'superseded',
        updatedAt: now,
        validationCodes: uniqueStrings([
          ...active.record.revision.validationCodes,
          `superseded-by:${promoted.id}`,
        ]),
      };
      await this.appendRecord({
        protocolVersion: '1.0',
        recordType: 'canon-revision',
        transition: 'superseded',
        revision: superseded,
        evidenceBindings: active.record.evidenceBindings,
        reflectionIds: active.record.reflectionIds,
        sourceProposalIds: active.record.sourceProposalIds,
        reasonCode: `superseded-by:${promoted.id}`,
      });
    }
    await this.appendRecord({
      protocolVersion: '1.0',
      recordType: 'canon-revision',
      transition: 'activated',
      revision: promoted,
      evidenceBindings: retainedEvidenceBindings,
      reflectionIds,
      sourceProposalIds,
      reasonCode: 'canon-candidate-promoted',
    });
    this.assertUniqueActiveKeys();
    return {
      proposalId,
      canonKey,
      status: 'active',
      revision: structuredClone(promoted),
      reasonCodes: promoted.validationCodes,
    };
  }

  private createCandidate(
    proposal: SoulReflectionProposalV1['canonProposals'][number],
    content: string,
    contentHash: string,
    active: RevisionProjection | undefined,
    now: number,
  ): CanonRevisionV1 {
    const versions = this.currentRevisions()
      .filter((revision) => revision.canonKey === proposal.canonKey)
      .map((revision) => revision.version);
    return {
      protocolVersion: '1.0',
      id: `canon-revision:${boundedString(this.createRevisionToken(), 120)}`,
      canonKey: boundedString(proposal.canonKey, 160),
      personaId: this.scope.personaId,
      version: Math.max(0, ...versions) + 1,
      content,
      realityClass: proposal.realityClass,
      status: 'candidate',
      impact: proposal.impact,
      source: 'reflection',
      evidenceEventIds: uniqueStrings(proposal.evidenceEventIds),
      involvesViewerIds: uniqueStrings(proposal.involvesViewerIds),
      domainTags: uniqueStrings(proposal.domainTags),
      reviewPasses: 1,
      validationCodes: ['reflection-review-recorded'],
      supersedesRevisionId: active?.record.revision.id,
      contentHash,
      createdAt: now,
      updatedAt: now,
    };
  }

  private updatePendingCandidate(
    pending: CanonRevisionV1,
    proposal: SoulReflectionProposalV1['canonProposals'][number],
    reviewPasses: number,
    now: number,
  ): CanonRevisionV1 {
    return {
      ...structuredClone(pending),
      impact:
        pending.impact === 'major' || proposal.impact === 'major'
          ? 'major'
          : 'low',
      evidenceEventIds: uniqueStrings([
        ...pending.evidenceEventIds,
        ...proposal.evidenceEventIds,
      ]),
      involvesViewerIds: uniqueStrings([
        ...pending.involvesViewerIds,
        ...proposal.involvesViewerIds,
      ]),
      domainTags: uniqueStrings([
        ...pending.domainTags,
        ...proposal.domainTags,
      ]),
      reviewPasses,
      updatedAt: now,
    };
  }

  private async retractInternal(
    revisionId: string,
    reasonCode: string,
  ): Promise<CanonRevisionV1> {
    await this.ensureLoaded();
    const current = this.revisions.get(revisionId);
    if (!current) throw new Error('canon_revision_not_found');
    if (current.record.revision.status === 'retracted') {
      return structuredClone(current.record.revision);
    }
    const boundedReason = boundedString(reasonCode, 120);
    if (!boundedReason) throw new Error('canon_retraction_reason_required');
    const retracted = retractCanonRevision(
      current.record.revision,
      this.now(),
      boundedReason,
    );
    await this.appendRecord({
      protocolVersion: '1.0',
      recordType: 'canon-revision',
      transition: 'retracted',
      revision: retracted,
      evidenceBindings: current.record.evidenceBindings,
      reflectionIds: current.record.reflectionIds,
      sourceProposalIds: current.record.sourceProposalIds,
      reasonCode: boundedReason,
    });
    return structuredClone(retracted);
  }

  private async appendRecord(record: CanonLedgerRecordV1): Promise<void> {
    const ledgerId = canonLedgerInputId(record);
    if (ledgerId === record.revision.id) {
      throw new Error('canon_ledger_id_must_differ_from_revision_id');
    }
    const response = await this.fetchImpl(CANON_LEDGER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: ledgerId,
        kind: 'canon',
        scope: this.scope,
        occurredAt: record.revision.updatedAt,
        payload: record,
      }),
    });
    if (!response.ok) {
      throw new Error(`canon_ledger_append_http_${response.status}`);
    }
    let sequence = this.lastSequence + 1;
    try {
      const body = recordValue(await response.json());
      const entry = recordValue(body?.entry);
      if (Number.isInteger(entry?.sequence)) sequence = Number(entry?.sequence);
      if (entry?.scope) assertScope(this.scope, parseScope(entry.scope));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('canon_scope_')) {
        throw error;
      }
      // A successful append can omit its echo; the submitted record remains
      // the authoritative local projection until the next full load.
    }
    this.applyRecord(structuredClone(record), sequence);
  }

  private applyRecord(record: CanonLedgerRecordV1, sequence: number): void {
    validateCanonLedgerRecord(record);
    const revision = record.revision;
    if (revision.personaId !== this.scope.personaId) {
      throw new Error('canon_record_persona_scope_mismatch');
    }
    const previous = this.revisions.get(revision.id);
    if (previous) {
      assertSameRevisionIdentity(previous.record.revision, revision);
      assertValidStatusTransition(
        previous.record.revision.status,
        revision.status,
      );
      if (revision.reviewPasses < previous.record.revision.reviewPasses) {
        throw new Error('canon_review_passes_regressed');
      }
      if (sequence <= previous.sequence) return;
    }
    this.revisions.set(revision.id, {
      record: structuredClone(record),
      sequence,
    });
    this.lastSequence = Math.max(this.lastSequence, sequence);
  }

  private currentRevisions(): CanonRevisionV1[] {
    return [...this.revisions.values()].map(({ record }) => record.revision);
  }

  private findActive(canonKey: string): RevisionProjection | undefined {
    return [...this.revisions.values()].find(
      ({ record }) =>
        record.revision.canonKey === canonKey &&
        record.revision.status === 'active',
    );
  }

  private findPending(
    canonKey: string,
    contentHash: string,
  ): RevisionProjection | undefined {
    return [...this.revisions.values()].find(
      ({ record }) =>
        record.revision.canonKey === canonKey &&
        record.revision.contentHash === contentHash &&
        record.revision.status === 'candidate',
    );
  }

  private assertUniqueActiveKeys(): void {
    const keys = new Set<string>();
    for (const revision of this.getProjection().active) {
      if (keys.has(revision.canonKey)) {
        throw new Error('canon_multiple_active_revisions');
      }
      keys.add(revision.canonKey);
    }
  }
}

function parseCanonLedgerEntry(value: unknown): CanonLedgerEntryV1 {
  const entry = recordValue(value);
  if (
    !entry ||
    entry.kind !== 'canon' ||
    !Number.isInteger(entry.sequence) ||
    typeof entry.id !== 'string'
  ) {
    throw new Error('canon_ledger_entry_invalid');
  }
  const payload = parseCanonLedgerRecord(entry.payload);
  return {
    id: entry.id,
    kind: 'canon',
    scope: parseScope(entry.scope),
    occurredAt: finiteNumber(entry.occurredAt),
    sequence: Number(entry.sequence),
    payload,
  };
}

function parseCanonLedgerRecord(value: unknown): CanonLedgerRecordV1 {
  const record = recordValue(value);
  if (
    record?.protocolVersion !== '1.0' ||
    record.recordType !== 'canon-revision' ||
    !isCanonTransition(record.transition)
  ) {
    throw new Error('canon_ledger_record_invalid');
  }
  const parsed: CanonLedgerRecordV1 = {
    protocolVersion: '1.0',
    recordType: 'canon-revision',
    transition: record.transition,
    revision: parseCanonRevision(record.revision),
    evidenceBindings: parseEvidenceBindings(record.evidenceBindings),
    reflectionIds: stringArray(record.reflectionIds),
    sourceProposalIds: stringArray(record.sourceProposalIds),
    reasonCode: boundedString(record.reasonCode, 120),
  };
  validateCanonLedgerRecord(parsed);
  return parsed;
}

function parseCanonRevision(value: unknown): CanonRevisionV1 {
  const revision = recordValue(value);
  if (
    revision?.protocolVersion !== '1.0' ||
    !isCanonStatus(revision.status) ||
    !isRealityClass(revision.realityClass) ||
    !isCanonImpact(revision.impact) ||
    !isCanonSource(revision.source)
  ) {
    throw new Error('canon_revision_invalid');
  }
  const parsed = {
    protocolVersion: '1.0' as const,
    id: boundedString(revision.id, 200),
    canonKey: boundedString(revision.canonKey, 160),
    personaId: boundedString(revision.personaId, 160),
    version: finiteNumber(revision.version),
    content: boundedString(revision.content, 1_200),
    realityClass: revision.realityClass,
    status: revision.status,
    impact: revision.impact,
    source: revision.source,
    evidenceEventIds: stringArray(revision.evidenceEventIds),
    involvesViewerIds: stringArray(revision.involvesViewerIds),
    domainTags: stringArray(revision.domainTags),
    reviewPasses: finiteNumber(revision.reviewPasses),
    validationCodes: stringArray(revision.validationCodes),
    supersedesRevisionId: optionalString(revision.supersedesRevisionId),
    contentHash: boundedString(revision.contentHash, 120),
    createdAt: finiteNumber(revision.createdAt),
    updatedAt: finiteNumber(revision.updatedAt),
  } satisfies CanonRevisionV1;
  if (
    !parsed.id ||
    !parsed.canonKey ||
    !parsed.personaId ||
    !parsed.content ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 1 ||
    !Number.isInteger(parsed.reviewPasses) ||
    parsed.reviewPasses < 0 ||
    parsed.contentHash !== hashCanonContent(parsed.content)
  ) {
    throw new Error('canon_revision_invalid');
  }
  return parsed;
}

function validateCanonLedgerRecord(record: CanonLedgerRecordV1): void {
  const expectedStatus: Record<
    CanonLedgerTransitionV1,
    CanonRevisionV1['status']
  > = {
    'candidate-observed': 'candidate',
    'candidate-reviewed': 'candidate',
    activated: 'active',
    superseded: 'superseded',
    retracted: 'retracted',
  };
  if (record.revision.status !== expectedStatus[record.transition]) {
    throw new Error('canon_transition_status_mismatch');
  }
  if (!record.reasonCode) throw new Error('canon_transition_reason_required');
  if (
    (record.transition === 'candidate-observed' ||
      record.transition === 'candidate-reviewed' ||
      record.transition === 'activated') &&
    record.reflectionIds.length === 0
  ) {
    throw new Error('canon_reflection_evidence_required');
  }
  const viewerEvidenceReasons = validateTrustedViewerEvidence(
    record.revision,
    record.evidenceBindings,
  );
  if (viewerEvidenceReasons.length > 0) {
    throw new Error(`canon_ledger_${viewerEvidenceReasons[0]}`);
  }
}

function assertSameRevisionIdentity(
  previous: CanonRevisionV1,
  next: CanonRevisionV1,
): void {
  if (
    previous.id !== next.id ||
    previous.canonKey !== next.canonKey ||
    previous.personaId !== next.personaId ||
    previous.version !== next.version ||
    previous.contentHash !== next.contentHash ||
    previous.content !== next.content
  ) {
    throw new Error('canon_revision_identity_changed');
  }
}

function assertValidStatusTransition(
  previous: CanonRevisionV1['status'],
  next: CanonRevisionV1['status'],
): void {
  const allowed: Record<
    CanonRevisionV1['status'],
    CanonRevisionV1['status'][]
  > = {
    candidate: ['candidate', 'active'],
    active: ['superseded', 'retracted'],
    superseded: ['retracted'],
    retracted: [],
  };
  if (!allowed[previous].includes(next)) {
    throw new Error(`canon_status_transition_invalid:${previous}:${next}`);
  }
}

function canonLedgerInputId(record: CanonLedgerRecordV1): string {
  const discriminator = hashCanonContent(
    JSON.stringify({
      transition: record.transition,
      revisionId: record.revision.id,
      status: record.revision.status,
      contentHash: record.revision.contentHash,
      evidenceBindings: [...record.evidenceBindings].sort(
        (left, right) =>
          left.eventId.localeCompare(right.eventId) ||
          left.actorId.localeCompare(right.actorId),
      ),
      reflectionIds: [...record.reflectionIds].sort(),
      sourceProposalIds: [...record.sourceProposalIds].sort(),
      reasonCode: record.reasonCode,
    }),
  ).replace(':', '-');
  return `canon-ledger:${record.transition}:${discriminator}:${record.revision.id}`.slice(
    0,
    200,
  );
}

function assertScope(expected: SoulScopeV1, actual: SoulScopeV1): void {
  if (
    expected.personaId !== actual.personaId ||
    expected.platform !== actual.platform ||
    expected.roomId !== actual.roomId ||
    expected.sessionId !== actual.sessionId
  ) {
    throw new Error('canon_scope_mismatch');
  }
}

function parseScope(value: unknown): SoulScopeV1 {
  const scope = recordValue(value);
  const parsed = {
    personaId: boundedString(scope?.personaId, 160),
    platform: boundedString(scope?.platform, 80),
    roomId: boundedString(scope?.roomId, 160),
    sessionId: boundedString(scope?.sessionId, 160),
  };
  if (
    !parsed.personaId ||
    !parsed.platform ||
    !parsed.roomId ||
    !parsed.sessionId
  ) {
    throw new Error('canon_scope_invalid');
  }
  return parsed;
}

function compareRevisions(
  left: CanonRevisionV1,
  right: CanonRevisionV1,
): number {
  return (
    left.canonKey.localeCompare(right.canonKey) ||
    left.version - right.version ||
    left.id.localeCompare(right.id)
  );
}

function cloneRevisions(
  revisions: readonly CanonRevisionV1[],
): CanonRevisionV1[] {
  return revisions.map((revision) => structuredClone(revision));
}

function parseEvidenceBindings(value: unknown): CanonEvidenceBindingV1[] {
  if (!Array.isArray(value)) {
    throw new Error('canon_evidence_bindings_invalid');
  }
  return normalizeEvidenceBindings(value);
}

function normalizeEvidenceBindings(value: unknown): CanonEvidenceBindingV1[] {
  if (!Array.isArray(value)) return [];
  const bindings = value.map((item) => {
    const binding = recordValue(item);
    const eventId = boundedString(binding?.eventId, 200);
    const actorId = boundedString(binding?.actorId, 200);
    if (!eventId || !actorId) {
      throw new Error('canon_evidence_binding_invalid');
    }
    return { eventId, actorId };
  });
  const unique = new Map<string, CanonEvidenceBindingV1>();
  for (const binding of bindings) {
    unique.set(`${binding.eventId}\u0000${binding.actorId}`, binding);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.eventId.localeCompare(right.eventId) ||
      left.actorId.localeCompare(right.actorId),
  );
}

function relevantEvidenceBindings(
  revision: CanonRevisionV1,
  bindings: readonly CanonEvidenceBindingV1[],
): CanonEvidenceBindingV1[] {
  const eventIds = new Set(revision.evidenceEventIds);
  const viewerIds = new Set(revision.involvesViewerIds);
  return normalizeEvidenceBindings(
    bindings.filter(
      ({ eventId, actorId }) => eventIds.has(eventId) && viewerIds.has(actorId),
    ),
  );
}

function validateTrustedViewerEvidence(
  revision: CanonRevisionV1,
  bindings: readonly CanonEvidenceBindingV1[],
): string[] {
  if (revision.involvesViewerIds.length === 0) return [];
  const reasons: string[] = [];
  if (revision.realityClass !== 'runtime-lived') {
    reasons.push('viewer-canon-must-be-runtime-lived');
  }
  if (revision.evidenceEventIds.length === 0) {
    reasons.push('viewer-canon-requires-event-evidence');
  }
  if (bindings.length === 0) {
    reasons.push('viewer-canon-trusted-evidence-required');
    return uniqueStrings(reasons);
  }
  const referenced = bindings.filter(({ eventId }) =>
    revision.evidenceEventIds.includes(eventId),
  );
  if (referenced.length === 0) {
    reasons.push('viewer-canon-trusted-event-evidence-required');
  }
  if (
    revision.involvesViewerIds.some(
      (viewerId) => !referenced.some(({ actorId }) => actorId === viewerId),
    )
  ) {
    reasons.push('viewer-canon-trusted-actor-evidence-required');
  }
  return uniqueStrings(reasons);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function defaultRevisionToken(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackRevisionSequence += 1;
  return `${Date.now()}-${fallbackRevisionSequence}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function optionalString(value: unknown): string | undefined {
  const result = boundedString(value, 200);
  return result || undefined;
}

function stringArray(value: unknown): string[] {
  return uniqueStrings(
    (arrayValue(value) ?? []).filter(
      (item): item is string => typeof item === 'string',
    ),
  );
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('canon_number_invalid');
  }
  return value;
}

function isCanonTransition(value: unknown): value is CanonLedgerTransitionV1 {
  return [
    'candidate-observed',
    'candidate-reviewed',
    'activated',
    'superseded',
    'retracted',
  ].includes(String(value));
}

function isCanonStatus(value: unknown): value is CanonRevisionV1['status'] {
  return ['candidate', 'active', 'superseded', 'retracted'].includes(
    String(value),
  );
}

function isRealityClass(
  value: unknown,
): value is CanonRevisionV1['realityClass'] {
  return [
    'runtime-lived',
    'simulated-offline',
    'authored-history',
    'dream',
  ].includes(String(value));
}

function isCanonImpact(value: unknown): value is CanonRevisionV1['impact'] {
  return value === 'low' || value === 'major';
}

function isCanonSource(value: unknown): value is CanonRevisionV1['source'] {
  return [
    'runtime-observation',
    'reflection',
    'operator',
    'migration',
  ].includes(String(value));
}
