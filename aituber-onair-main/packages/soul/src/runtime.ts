import { arbitrateSoulActions } from './arbiter.js';
import type {
  OutcomeEventV1,
  SemanticProposalV1,
  SoulConstitutionV1,
  SoulDecisionV1,
  SoulEventV1,
  SoulProfileV1,
  SoulScopeV1,
  SoulSnapshotV1,
  SoulStateV1,
  SoulTransitionV1,
} from './contracts.js';
import { applySoulOutcome, reserveSoulDecision } from './delivery.js';
import {
  InMemorySoulLedger,
  type SoulLedgerStore,
  type SoulReservationRecordV1,
  createSoulSnapshot,
  replaySoulLedger,
  verifySoulSnapshot,
} from './ledger.js';
import {
  applySoulEvent,
  createImmutableConstitution,
  createInitialSoulState,
} from './reducer.js';
import {
  applySoulReflectionReviewRecord,
  isSoulReflectionReviewRecord,
  reviewAndCommitSoulReflection,
  SoulReflectionReviewError,
  type SoulReflectionCommitInputV1,
  type SoulReflectionCommitResultV1,
} from './reflection.js';
import { deepClone } from './utils.js';
import { hashValue } from './utils.js';

export class SoulSnapshotRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoulSnapshotRestoreError';
  }
}

export interface SoulRuntimeOptions {
  constitution: SoulConstitutionV1;
  profile: SoulProfileV1;
  scope: SoulScopeV1;
  ledger?: SoulLedgerStore;
  now?: () => number;
  /**
   * A validated checkpoint to restore. A ledger containing the checkpoint
   * prefix is required so its head can be verified before mutation resumes.
   */
  snapshot?: SoulSnapshotV1;
}

export interface SoulRuntimeRestoreOptions extends SoulRuntimeOptions {
  ledger: SoulLedgerStore;
  snapshot: SoulSnapshotV1;
}

export interface SoulRuntime {
  getConstitution(): Readonly<SoulConstitutionV1>;
  getState(): SoulStateV1;
  observe(
    event: SoulEventV1,
    proposal?: SemanticProposalV1,
  ): Promise<SoulTransitionV1>;
  decide(
    event: SoulEventV1,
    proposal: SemanticProposalV1,
    now?: number,
  ): Promise<SoulDecisionV1>;
  reserve(decision: SoulDecisionV1, now?: number): Promise<SoulStateV1>;
  applyOutcome(outcome: OutcomeEventV1): Promise<SoulStateV1>;
  commitReflection(
    input: SoulReflectionCommitInputV1,
  ): Promise<SoulReflectionCommitResultV1>;
  snapshot(now?: number): Promise<SoulSnapshotV1>;
  replay(): Promise<SoulStateV1>;
  getLedger(): SoulLedgerStore;
}

export function createSoulRuntime(options: SoulRuntimeOptions): SoulRuntime {
  return new DefaultSoulRuntime(options);
}

export async function restoreSoulRuntime(
  options: SoulRuntimeRestoreOptions,
): Promise<SoulRuntime> {
  const runtime = createSoulRuntime(options);
  await runtime.replay();
  return runtime;
}

export function validateSoulSnapshotCompatibility(
  snapshot: SoulSnapshotV1,
  constitution: SoulConstitutionV1,
  profile: SoulProfileV1,
  scope: SoulScopeV1,
): void {
  if (
    snapshot.protocolVersion !== '1.0' ||
    snapshot.state.protocolVersion !== '1.0'
  ) {
    throw new SoulSnapshotRestoreError(
      'Soul snapshot protocol version is not supported',
    );
  }
  if (
    !Number.isSafeInteger(snapshot.ledgerSequence) ||
    snapshot.ledgerSequence < 0
  ) {
    throw new SoulSnapshotRestoreError(
      'Soul snapshot ledger sequence is invalid',
    );
  }
  if (!verifySoulSnapshot(snapshot)) {
    throw new SoulSnapshotRestoreError('Soul snapshot state hash is invalid');
  }
  assertSameScope(snapshot.scope, scope, 'snapshot');
  assertSameScope(snapshot.state.scope, scope, 'snapshot state');
  if (snapshot.state.profileId !== profile.id) {
    throw new SoulSnapshotRestoreError(
      `Snapshot profile ${snapshot.state.profileId} does not match ${profile.id}`,
    );
  }
  if (snapshot.state.profileHash !== hashValue(profile)) {
    throw new SoulSnapshotRestoreError(
      'Snapshot profile hash does not match the active profile',
    );
  }
  if (snapshot.state.constitutionId !== constitution.id) {
    throw new SoulSnapshotRestoreError(
      'Snapshot constitution id does not match the active constitution',
    );
  }
  if (snapshot.state.constitutionHash !== hashValue(constitution)) {
    throw new SoulSnapshotRestoreError(
      'Snapshot constitution hash does not match the active constitution',
    );
  }
  if (profile.personaId !== scope.personaId) {
    throw new SoulSnapshotRestoreError(
      'Active profile persona does not match the restore scope',
    );
  }
  if (profile.constitutionId !== constitution.id) {
    throw new SoulSnapshotRestoreError(
      'Active profile references a different constitution',
    );
  }
}

class DefaultSoulRuntime implements SoulRuntime {
  private readonly constitution: Readonly<SoulConstitutionV1>;
  private readonly profile: SoulProfileV1;
  private readonly ledger: SoulLedgerStore;
  private readonly now: () => number;
  private readonly initialState: SoulStateV1;
  private readonly checkpoint?: SoulSnapshotV1;
  private state: SoulStateV1;
  private readonly decisions = new Map<string, SoulDecisionV1>();
  private restoreVerified: boolean;

  constructor(options: SoulRuntimeOptions) {
    this.constitution = createImmutableConstitution(options.constitution);
    this.profile = deepClone(options.profile);
    if (options.snapshot) {
      validateSoulSnapshotCompatibility(
        options.snapshot,
        this.constitution,
        this.profile,
        options.scope,
      );
    }
    if (options.snapshot && !options.ledger) {
      throw new SoulSnapshotRestoreError(
        'Snapshot restore requires its append-only ledger',
      );
    }
    this.ledger = options.ledger ?? new InMemorySoulLedger();
    this.now = options.now ?? Date.now;
    this.checkpoint = options.snapshot
      ? deepClone(options.snapshot)
      : undefined;
    this.initialState = options.snapshot
      ? deepClone(options.snapshot.state)
      : createInitialSoulState(
          this.constitution,
          this.profile,
          options.scope,
          this.now(),
        );
    this.state = deepClone(this.initialState);
    this.restoreVerified = options.snapshot === undefined;
  }

  getConstitution(): Readonly<SoulConstitutionV1> {
    return this.constitution;
  }

  getState(): SoulStateV1 {
    return deepClone(this.state);
  }

  async observe(
    event: SoulEventV1,
    proposal?: SemanticProposalV1,
  ): Promise<SoulTransitionV1> {
    await this.ensureRestoreVerified();
    const transition = applySoulEvent(
      this.state,
      this.profile,
      event,
      proposal,
    );
    if (!transition.applied) return transition;
    await this.ledger.append({
      id: `ledger:event:${event.id}`,
      kind: 'event',
      scope: event.scope,
      occurredAt: event.occurredAt,
      payload: event,
    });
    await this.ledger.append({
      id: `ledger:appraisal:${event.id}`,
      kind: 'appraisal',
      scope: event.scope,
      occurredAt: event.occurredAt,
      payload: transition.appraisal,
    });
    this.state = transition.state;
    return {
      ...transition,
      state: deepClone(transition.state),
      appraisal: deepClone(transition.appraisal),
    };
  }

  async decide(
    event: SoulEventV1,
    proposal: SemanticProposalV1,
    now = this.now(),
  ): Promise<SoulDecisionV1> {
    await this.ensureRestoreVerified();
    const appraisal = this.state.lastAppraisal;
    if (!appraisal || appraisal.eventId !== event.id) {
      throw new Error(
        'observe(event, proposal) must run before deciding on that event',
      );
    }
    const decision = arbitrateSoulActions(
      this.constitution,
      this.profile,
      this.state,
      event,
      appraisal,
      proposal,
      { now },
    );
    await this.ledger.append({
      id: `ledger:${decision.id}`,
      kind: 'decision',
      scope: decision.scope,
      occurredAt: decision.createdAt,
      payload: decision,
    });
    this.decisions.set(decision.id, deepClone(decision));
    return deepClone(decision);
  }

  async reserve(
    decision: SoulDecisionV1,
    now = this.now(),
  ): Promise<SoulStateV1> {
    await this.ensureRestoreVerified();
    const next = reserveSoulDecision(this.state, decision, now);
    const record: SoulReservationRecordV1 = {
      protocolVersion: '1.0',
      id: `reservation:${decision.id}`,
      decisionId: decision.id,
      scope: deepClone(decision.scope),
      reservedAt: now,
    };
    await this.ledger.append({
      id: `ledger:${record.id}`,
      kind: 'reservation',
      scope: record.scope,
      occurredAt: now,
      payload: record,
    });
    this.decisions.set(decision.id, deepClone(decision));
    this.state = next;
    return deepClone(this.state);
  }

  async applyOutcome(outcome: OutcomeEventV1): Promise<SoulStateV1> {
    await this.ensureRestoreVerified();
    const decision = this.decisions.get(outcome.decisionId);
    if (!decision) {
      throw new Error(`Unknown soul decision ${outcome.decisionId}`);
    }
    const next = applySoulOutcome(this.state, decision, outcome);
    await this.ledger.append({
      id: `ledger:outcome:${outcome.id}`,
      kind: 'outcome',
      scope: outcome.scope,
      occurredAt: outcome.occurredAt,
      payload: outcome,
    });
    this.state = next;
    return deepClone(this.state);
  }

  async commitReflection(
    input: SoulReflectionCommitInputV1,
  ): Promise<SoulReflectionCommitResultV1> {
    await this.ensureRestoreVerified();
    const ledgerId = reflectionReviewLedgerId(input.proposal.id);
    const existing = (await this.ledger.list({ kinds: ['reflection'] })).find(
      (entry) => entry.id === ledgerId,
    );
    if (existing) {
      if (!isSoulReflectionReviewRecord(existing.payload)) {
        throw new SoulReflectionReviewError(
          `Ledger id ${ledgerId} is not a reflection review record`,
        );
      }
      this.state = applySoulReflectionReviewRecord(
        this.state,
        this.profile,
        existing.payload,
      );
      return {
        state: deepClone(this.state),
        record: deepClone(existing.payload),
        applied: false,
      };
    }

    const result = reviewAndCommitSoulReflection(
      this.state,
      this.constitution,
      this.profile,
      input,
    );
    await this.ledger.append({
      id: ledgerId,
      kind: 'reflection',
      scope: result.record.scope,
      occurredAt: result.record.occurredAt,
      payload: result.record,
    });
    this.state = result.state;
    return {
      state: deepClone(this.state),
      record: deepClone(result.record),
      applied: result.applied,
    };
  }

  async snapshot(now = this.now()): Promise<SoulSnapshotV1> {
    await this.ensureRestoreVerified();
    const head = await this.ledger.head();
    return createSoulSnapshot(
      this.state,
      head?.sequence ?? 0,
      head?.hash ?? 'genesis',
      now,
    );
  }

  async replay(): Promise<SoulStateV1> {
    const entries = await this.ledger.list();
    const replayEntries = this.selectEntriesAfterCheckpoint(entries);
    this.decisions.clear();
    for (const entry of entries) {
      if (entry.kind === 'decision') {
        const decision = entry.payload as SoulDecisionV1;
        this.decisions.set(decision.id, deepClone(decision));
      }
    }
    this.state = replaySoulLedger(
      this.initialState,
      this.profile,
      replayEntries,
    );
    this.restoreVerified = true;
    return deepClone(this.state);
  }

  getLedger(): SoulLedgerStore {
    return this.ledger;
  }

  private async ensureRestoreVerified(): Promise<void> {
    if (this.restoreVerified) return;
    await this.replay();
  }

  private selectEntriesAfterCheckpoint(
    entries: Awaited<ReturnType<SoulLedgerStore['list']>>,
  ): Awaited<ReturnType<SoulLedgerStore['list']>> {
    if (!this.checkpoint) return entries;
    if (this.checkpoint.ledgerSequence === 0) {
      if (this.checkpoint.ledgerHeadHash !== 'genesis') {
        throw new SoulSnapshotRestoreError(
          'Empty snapshot checkpoint must use the genesis ledger hash',
        );
      }
      return entries;
    }
    const checkpointEntry = entries.find(
      (entry) => entry.sequence === this.checkpoint?.ledgerSequence,
    );
    if (!checkpointEntry) {
      throw new SoulSnapshotRestoreError(
        'Snapshot ledger checkpoint is missing from the supplied ledger',
      );
    }
    if (checkpointEntry.hash !== this.checkpoint.ledgerHeadHash) {
      throw new SoulSnapshotRestoreError(
        'Snapshot ledger head does not match the supplied ledger',
      );
    }
    const checkpointSequence = this.checkpoint.ledgerSequence;
    const earlierDecisions = entries.filter(
      (entry) =>
        entry.kind === 'decision' && entry.sequence <= checkpointSequence,
    );
    const tail = entries.filter((entry) => entry.sequence > checkpointSequence);
    return [...earlierDecisions, ...tail];
  }
}

function reflectionReviewLedgerId(reflectionId: string): string {
  return `ledger:reflection-review:${reflectionId}`;
}

function assertSameScope(
  actual: SoulScopeV1,
  expected: SoulScopeV1,
  label: string,
): void {
  const fields: (keyof SoulScopeV1)[] = [
    'personaId',
    'platform',
    'roomId',
    'sessionId',
  ];
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      throw new SoulSnapshotRestoreError(
        `${label} ${field} ${actual[field]} does not match ${expected[field]}`,
      );
    }
  }
}
