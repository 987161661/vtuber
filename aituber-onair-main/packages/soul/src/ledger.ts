import type {
  CanonRevisionV1,
  OutcomeEventV1,
  SoulAppraisalV1,
  SoulDecisionV1,
  SoulEventV1,
  SoulProfileV1,
  SoulScopeV1,
  SoulSnapshotV1,
  SoulStateV1,
} from './contracts.js';
import { applySoulOutcome, reserveSoulDecision } from './delivery.js';
import {
  applySoulEvent,
  hashSoulState,
  reduceSoulAppraisal,
} from './reducer.js';
import {
  applySoulReflectionReviewRecord,
  isSoulReflectionReviewRecord,
  SoulReflectionReviewError,
  type SoulReflectionReviewRecordV1,
} from './reflection.js';
import { deepClone, hashValue, stableStringify } from './utils.js';

export type SoulLedgerKind =
  | 'event'
  | 'appraisal'
  | 'decision'
  | 'reservation'
  | 'outcome'
  | 'canon'
  | 'reflection';

export type SoulLedgerPayloadV1 =
  | SoulEventV1
  | SoulAppraisalV1
  | SoulDecisionV1
  | OutcomeEventV1
  | CanonRevisionV1
  | SoulReservationRecordV1
  | SoulReflectionReviewRecordV1
  | Readonly<Record<string, unknown>>;

export interface SoulReservationRecordV1 {
  protocolVersion: '1.0';
  id: string;
  decisionId: string;
  scope: SoulScopeV1;
  reservedAt: number;
}

export interface SoulLedgerInputV1 {
  id: string;
  kind: SoulLedgerKind;
  scope: SoulScopeV1;
  occurredAt: number;
  payload: SoulLedgerPayloadV1;
}

export interface SoulLedgerEntryV1 extends SoulLedgerInputV1 {
  protocolVersion: '1.0';
  sequence: number;
  previousHash: string;
  hash: string;
}

export interface SoulLedgerQueryV1 {
  kinds?: readonly SoulLedgerKind[];
  scope?: Partial<SoulScopeV1>;
  afterSequence?: number;
}

export interface SoulLedgerExportV1 {
  protocolVersion: '1.0';
  entries: readonly SoulLedgerEntryV1[];
  headHash: string;
}

export interface SoulLedgerStore {
  append(input: SoulLedgerInputV1): Promise<SoulLedgerEntryV1>;
  list(query?: SoulLedgerQueryV1): Promise<SoulLedgerEntryV1[]>;
  head(): Promise<SoulLedgerEntryV1 | undefined>;
  export(): Promise<SoulLedgerExportV1>;
}

export class InMemorySoulLedger implements SoulLedgerStore {
  private readonly entries: SoulLedgerEntryV1[] = [];
  private readonly byId = new Map<string, SoulLedgerEntryV1>();

  constructor(source?: SoulLedgerExportV1) {
    if (!source) return;
    verifySoulLedgerExport(source);
    for (const entry of source.entries) {
      const clone = deepClone(entry);
      this.entries.push(clone);
      this.byId.set(clone.id, clone);
    }
  }

  async append(input: SoulLedgerInputV1): Promise<SoulLedgerEntryV1> {
    const existing = this.byId.get(input.id);
    if (existing) {
      const comparableExisting = {
        id: existing.id,
        kind: existing.kind,
        scope: existing.scope,
        occurredAt: existing.occurredAt,
        payload: existing.payload,
      };
      if (stableStringify(comparableExisting) !== stableStringify(input)) {
        throw new Error(`Conflicting append for ledger id ${input.id}`);
      }
      return deepClone(existing);
    }

    const previousHash =
      this.entries[this.entries.length - 1]?.hash ?? 'genesis';
    const entryWithoutHash = {
      protocolVersion: '1.0' as const,
      sequence: this.entries.length + 1,
      ...deepClone(input),
      previousHash,
    };
    const entry: SoulLedgerEntryV1 = {
      ...entryWithoutHash,
      hash: hashValue(entryWithoutHash),
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    return deepClone(entry);
  }

  async list(query: SoulLedgerQueryV1 = {}): Promise<SoulLedgerEntryV1[]> {
    return this.entries
      .filter((entry) => {
        if (query.kinds && !query.kinds.includes(entry.kind)) return false;
        if (
          query.afterSequence !== undefined &&
          entry.sequence <= query.afterSequence
        ) {
          return false;
        }
        if (!query.scope) return true;
        return Object.entries(query.scope).every(
          ([key, value]) =>
            value === undefined ||
            entry.scope[key as keyof SoulScopeV1] === value,
        );
      })
      .map(deepClone);
  }

  async head(): Promise<SoulLedgerEntryV1 | undefined> {
    const head = this.entries.at(-1);
    return head ? deepClone(head) : undefined;
  }

  async export(): Promise<SoulLedgerExportV1> {
    return {
      protocolVersion: '1.0',
      entries: this.entries.map(deepClone),
      headHash: this.entries[this.entries.length - 1]?.hash ?? 'genesis',
    };
  }
}

export function verifySoulLedgerExport(source: SoulLedgerExportV1): void {
  let previousHash = 'genesis';
  const ids = new Set<string>();
  for (let index = 0; index < source.entries.length; index += 1) {
    const entry = source.entries[index];
    if (entry.sequence !== index + 1) {
      throw new Error(`Ledger sequence mismatch at ${entry.id}`);
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate ledger id ${entry.id}`);
    ids.add(entry.id);
    if (entry.previousHash !== previousHash) {
      throw new Error(`Ledger chain mismatch at ${entry.id}`);
    }
    const { hash, ...entryWithoutHash } = entry;
    if (hashValue(entryWithoutHash) !== hash) {
      throw new Error(`Ledger hash mismatch at ${entry.id}`);
    }
    previousHash = hash;
  }
  if (source.headHash !== previousHash) {
    throw new Error('Ledger head hash does not match the entry chain');
  }
}

export function replaySoulEvents(
  initialState: SoulStateV1,
  profile: SoulProfileV1,
  events: readonly SoulEventV1[],
): SoulStateV1 {
  return events.reduce(
    (state, event) => applySoulEvent(state, profile, event).state,
    deepClone(initialState),
  );
}

export function replaySoulLedger(
  initialState: SoulStateV1,
  profile: SoulProfileV1,
  entries: readonly SoulLedgerEntryV1[],
): SoulStateV1 {
  return inspectSoulLedgerReplay(initialState, profile, entries, {
    quarantineInvalidReflectionReviews: false,
  }).state;
}

export interface SoulLedgerReplayInspectionV1 {
  state: SoulStateV1;
  quarantinedReflectionEntryIds: readonly string[];
}

/**
 * Replays an authoritative ledger while optionally identifying legacy
 * reflection-review records that cannot be proven against the state at their
 * original position. The records remain in the server audit ledger; callers
 * may exclude only the returned ids from a reconstructed state projection.
 */
export function inspectSoulLedgerReplay(
  initialState: SoulStateV1,
  profile: SoulProfileV1,
  entries: readonly SoulLedgerEntryV1[],
  options: { quarantineInvalidReflectionReviews: boolean },
): SoulLedgerReplayInspectionV1 {
  const appraisals = new Map<string, SoulAppraisalV1>();
  for (const entry of entries) {
    if (entry.kind === 'appraisal') {
      const appraisal = entry.payload as SoulAppraisalV1;
      appraisals.set(appraisal.eventId, appraisal);
    }
  }
  let state = deepClone(initialState);
  const decisions = new Map<string, SoulDecisionV1>();
  const quarantinedReflectionEntryIds: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'event') {
      const event = entry.payload as SoulEventV1;
      const appraisal = appraisals.get(event.id);
      state = appraisal
        ? reduceSoulAppraisal(state, profile, event, appraisal)
        : applySoulEvent(state, profile, event).state;
      continue;
    }
    if (entry.kind === 'decision') {
      const decision = entry.payload as SoulDecisionV1;
      decisions.set(decision.id, decision);
      continue;
    }
    if (entry.kind === 'reservation') {
      const reservation = entry.payload as SoulReservationRecordV1;
      const decision = decisions.get(reservation.decisionId);
      if (!decision) {
        throw new Error(
          `Reservation references unknown decision ${reservation.decisionId}`,
        );
      }
      state = reserveSoulDecision(state, decision, reservation.reservedAt);
      continue;
    }
    if (entry.kind === 'outcome') {
      const outcome = entry.payload as OutcomeEventV1;
      const decision = decisions.get(outcome.decisionId);
      if (!decision) {
        throw new Error(
          `Outcome references unknown decision ${outcome.decisionId}`,
        );
      }
      state = applySoulOutcome(state, decision, outcome);
      continue;
    }
    if (
      entry.kind === 'reflection' &&
      isSoulReflectionReviewRecord(entry.payload)
    ) {
      try {
        state = applySoulReflectionReviewRecord(state, profile, entry.payload);
      } catch (error) {
        if (
          !options.quarantineInvalidReflectionReviews ||
          !(error instanceof SoulReflectionReviewError)
        ) {
          throw error;
        }
        quarantinedReflectionEntryIds.push(entry.id);
      }
    }
  }
  return { state, quarantinedReflectionEntryIds };
}

export function createSoulSnapshot(
  state: SoulStateV1,
  ledgerSequence: number,
  ledgerHeadHash: string,
  now: number,
  id = `snapshot:${state.scope.sessionId}:${state.version}`,
): SoulSnapshotV1 {
  return {
    protocolVersion: '1.0',
    id,
    scope: deepClone(state.scope),
    state: deepClone(state),
    stateHash: hashSoulState(state),
    ledgerSequence,
    ledgerHeadHash,
    createdAt: now,
  };
}

export function verifySoulSnapshot(snapshot: SoulSnapshotV1): boolean {
  return hashSoulState(snapshot.state) === snapshot.stateHash;
}
