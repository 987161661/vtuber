import {
  createSubjectiveFrame,
  hashCanonContent,
  validateCanonCandidate,
  type CanonRevisionV1,
  type CanonValidationResultV1,
  type EvidenceLevel,
  type SoulConstitutionV1,
  type SoulProfileV1,
  type SoulReflectionProposalV1,
  type SoulScopeV1,
  type SubjectiveFactV1,
  type SubjectiveFrameV1,
  type SubjectiveMemoryRefV1,
} from '@aituber-onair/soul';
import type {
  BrowserSoulRuntimeSession,
  SoulModelResponseMetaV1,
} from './soulRuntimeClient';

const MAX_LEDGER_SUMMARIES = 24;
const MAX_SUMMARY_LENGTH = 600;

export interface SoulReflectionLedgerSummaryV1 {
  eventId: string;
  summary: string;
  evidenceLevel: EvidenceLevel;
  provenance?: string;
  /** Trusted, already scope-qualified actor id for canon evidence binding. */
  actorId?: string;
}

export interface SoulReflectionClientInputV1 {
  session: BrowserSoulRuntimeSession;
  constitution: SoulConstitutionV1;
  profile: SoulProfileV1;
  scope: SoulScopeV1;
  ledgerSummary: readonly SoulReflectionLedgerSummaryV1[];
  existingCanon?: readonly CanonRevisionV1[];
  reflectionKey?: string;
  actorId?: string;
  verifiedFacts?: readonly SubjectiveFactV1[];
  memories?: readonly SubjectiveMemoryRefV1[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}

export interface ValidatedCanonProposalV1 {
  candidate: CanonRevisionV1;
  validation: CanonValidationResultV1;
  unknownEvidenceEventIds: readonly string[];
}

export interface SoulReflectionClientResultV1 {
  reflectionId: string;
  frame: SubjectiveFrameV1;
  proposal: SoulReflectionProposalV1;
  meta: SoulModelResponseMetaV1;
  canonCandidates: readonly ValidatedCanonProposalV1[];
}

export class SoulReflectionClientError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'SoulReflectionClientError';
    this.code = code;
  }
}

/**
 * Requests an inert slow-reflection proposal. This function never reserves a
 * decision, mutates SoulState, appends a browser ledger entry, or promotes
 * canon. The server owns proposal-only audit persistence.
 */
export async function requestSoulReflection(
  input: SoulReflectionClientInputV1,
): Promise<SoulReflectionClientResultV1> {
  assertSessionCompatibility(input);
  const summaries = normalizeLedgerSummary(input.ledgerSummary);
  const state = input.session.getState();
  const frame = createSubjectiveFrame(state, input.profile, {
    actorId: input.actorId,
    verifiedFacts: input.verifiedFacts,
    memories: input.memories,
    maxGoals: 3,
    maxFacts: 8,
    maxMemories: 6,
  });
  const reflectionId = createSoulReflectionId({
    scope: input.scope,
    profileId: input.profile.id,
    stateVersion: frame.stateVersion,
    ledgerSummary: summaries,
    reflectionKey: input.reflectionKey,
  });
  const fetchImpl =
    input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const requestBody = {
    constitution: input.constitution,
    profile: input.profile,
    frame,
    ledgerSummary: summaries.map(serializeLedgerSummary),
    reflectionId,
  };
  assertNoSensitivePayload(requestBody, 'request');
  const response = await fetchImpl('/api/soul/reflect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: input.signal,
  });
  if (!response.ok) {
    throw new SoulReflectionClientError(
      'soul_reflection_http_error',
      `soul_reflection_http_${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SoulReflectionClientError('soul_reflection_invalid_json');
  }
  assertNoSensitivePayload(body, 'response');
  const envelope = recordValue(body);
  if (!envelope) {
    throw new SoulReflectionClientError('soul_reflection_invalid_response');
  }
  const proposal = normalizeProposal(
    envelope.proposal,
    reflectionId,
    input.profile,
    frame,
  );
  const meta = normalizeMeta(envelope.meta, proposal);
  const now = (input.now ?? Date.now)();
  const knownEventIds = new Set(summaries.map((summary) => summary.eventId));
  const existingCanon = input.existingCanon ?? [];
  const canonCandidates = proposal.canonProposals.map((canon) =>
    validateProposedCanon(
      canon,
      reflectionId,
      input.constitution,
      input.scope,
      existingCanon,
      knownEventIds,
      now,
    ),
  );

  return {
    reflectionId,
    frame,
    proposal,
    meta,
    canonCandidates,
  };
}

export interface CreateSoulReflectionIdInputV1 {
  scope: SoulScopeV1;
  profileId: string;
  stateVersion: number;
  ledgerSummary: readonly SoulReflectionLedgerSummaryV1[];
  reflectionKey?: string;
}

/** A content-bound id: identical reflection evidence yields the same id. */
export function createSoulReflectionId(
  input: CreateSoulReflectionIdInputV1,
): string {
  const key = input.reflectionKey
    ? normalizeReflectionKey(input.reflectionKey)
    : 'scheduled';
  const digest = deterministicDigest({
    protocolVersion: '1.0',
    scope: input.scope,
    profileId: input.profileId,
    stateVersion: input.stateVersion,
    ledgerSummary: input.ledgerSummary,
    reflectionKey: key,
  });
  return `reflection-v1-${key}-${digest}`.slice(0, 160);
}

function assertSessionCompatibility(input: SoulReflectionClientInputV1): void {
  assertSameScope(input.session.scope, input.scope, 'session');
  assertSameScope(input.session.getState().scope, input.scope, 'state');
  if (
    stableStringify(input.session.constitution) !==
    stableStringify(input.constitution)
  ) {
    throw new SoulReflectionClientError(
      'soul_reflection_constitution_mismatch',
    );
  }
  if (
    stableStringify(input.session.profile) !== stableStringify(input.profile)
  ) {
    throw new SoulReflectionClientError('soul_reflection_profile_mismatch');
  }
  if (
    input.profile.personaId !== input.scope.personaId ||
    input.constitution.personaId !== input.scope.personaId
  ) {
    throw new SoulReflectionClientError('soul_reflection_persona_mismatch');
  }
}

function normalizeLedgerSummary(
  value: readonly SoulReflectionLedgerSummaryV1[],
): SoulReflectionLedgerSummaryV1[] {
  if (value.length === 0 || value.length > MAX_LEDGER_SUMMARIES) {
    throw new SoulReflectionClientError(
      'soul_reflection_summary_count_invalid',
    );
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const eventId = boundedString(item.eventId, 160);
    const summary = boundedString(item.summary, MAX_SUMMARY_LENGTH);
    const provenance = item.provenance
      ? boundedString(item.provenance, 120)
      : undefined;
    const actorId = item.actorId ? boundedString(item.actorId, 200) : undefined;
    if (!eventId || !summary) {
      throw new SoulReflectionClientError('soul_reflection_summary_invalid');
    }
    if (seen.has(eventId)) {
      throw new SoulReflectionClientError(
        'soul_reflection_duplicate_summary_event',
      );
    }
    seen.add(eventId);
    assertNoSecretText(summary);
    if (provenance) assertNoSecretText(provenance);
    if (actorId) assertNoSecretText(actorId);
    if (
      item.evidenceLevel !== 'production' &&
      item.evidenceLevel !== 'production-equivalent' &&
      item.evidenceLevel !== 'synthetic'
    ) {
      throw new SoulReflectionClientError(
        'soul_reflection_evidence_level_invalid',
      );
    }
    return {
      eventId,
      summary,
      evidenceLevel: item.evidenceLevel,
      provenance,
      actorId,
    };
  });
}

function serializeLedgerSummary(value: SoulReflectionLedgerSummaryV1): string {
  return JSON.stringify({
    eventId: value.eventId,
    evidenceLevel: value.evidenceLevel,
    provenance: value.provenance,
    actorId: value.actorId,
    summary: value.summary,
  });
}

function normalizeProposal(
  value: unknown,
  reflectionId: string,
  profile: SoulProfileV1,
  frame: SubjectiveFrameV1,
): SoulReflectionProposalV1 {
  const proposal = recordValue(value);
  if (
    !proposal ||
    proposal.protocolVersion !== '1.0' ||
    proposal.id !== reflectionId ||
    proposal.profileId !== profile.id ||
    proposal.sourceStateVersion !== frame.stateVersion ||
    !Array.isArray(proposal.goalWeightDeltas) ||
    !Array.isArray(proposal.beliefProposals) ||
    !Array.isArray(proposal.canonProposals) ||
    !Array.isArray(proposal.reasonCodes)
  ) {
    throw new SoulReflectionClientError(
      'soul_reflection_proposal_identity_mismatch',
    );
  }
  const allowedGoals = new Set(profile.goals.map((goal) => goal.id));
  const maxDelta = profile.evolution.maxGoalWeightDeltaPerReflection;
  const goalWeightDeltas = proposal.goalWeightDeltas
    .slice(0, 16)
    .map(recordValue)
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => ({
      goalId: boundedString(item.goalId, 120),
      delta: clamp(numberValue(item.delta), -maxDelta, maxDelta),
      evidenceEventIds: stringList(item.evidenceEventIds, 16, 160),
      reasonCode: boundedString(item.reasonCode, 120) || 'model-reflection',
    }))
    .filter(
      (item) =>
        allowedGoals.has(item.goalId) && item.evidenceEventIds.length > 0,
    );
  const beliefProposals = proposal.beliefProposals
    .slice(0, 16)
    .map(recordValue)
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => ({
      id: boundedString(item.id, 160),
      proposition: boundedString(item.proposition, 800),
      confidence: clamp(numberValue(item.confidence, 0.5), 0, 1),
      evidenceEventIds: stringList(item.evidenceEventIds, 16, 160),
    }))
    .filter(
      (item) =>
        item.id.length > 0 &&
        item.proposition.length > 0 &&
        item.evidenceEventIds.length > 0,
    );
  const canonProposals = proposal.canonProposals
    .slice(0, 8)
    .map(recordValue)
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => ({
      id: boundedString(item.id, 160),
      canonKey: boundedString(item.canonKey, 160),
      content: boundedString(item.content, 1_200),
      realityClass: normalizeRealityClass(item.realityClass),
      impact: item.impact === 'major' ? ('major' as const) : ('low' as const),
      evidenceEventIds: stringList(item.evidenceEventIds, 16, 160),
      involvesViewerIds: stringList(item.involvesViewerIds, 12, 160),
      domainTags: stringList(item.domainTags, 12, 80),
    }))
    .filter(
      (item) => item.id.length > 0 && item.canonKey && item.content.length > 0,
    );
  return {
    protocolVersion: '1.0',
    id: reflectionId,
    profileId: profile.id,
    sourceStateVersion: frame.stateVersion,
    goalWeightDeltas,
    beliefProposals,
    canonProposals,
    reasonCodes: stringList(proposal.reasonCodes, 16, 120),
    repairNotes: stringList(proposal.repairNotes, 8, 120),
  };
}

function normalizeMeta(
  value: unknown,
  proposal: SoulReflectionProposalV1,
): SoulModelResponseMetaV1 {
  const meta = recordValue(value);
  return {
    modelProfileId:
      boundedString(meta?.modelProfileId, 120) || 'minimax-m3-soul-slow-v1',
    latencyMs: Math.max(0, numberValue(meta?.latencyMs)),
    firstContentLatencyMs:
      meta?.firstContentLatencyMs === undefined
        ? undefined
        : Math.max(0, numberValue(meta.firstContentLatencyMs)),
    fallback: meta?.fallback === true,
    fallbackReason: boundedString(meta?.fallbackReason, 120) || undefined,
    repairApplied:
      meta?.repairApplied === true ||
      proposal.repairNotes?.includes('json-envelope-repaired') === true,
  };
}

function validateProposedCanon(
  proposal: SoulReflectionProposalV1['canonProposals'][number],
  reflectionId: string,
  constitution: SoulConstitutionV1,
  scope: SoulScopeV1,
  existing: readonly CanonRevisionV1[],
  knownEventIds: ReadonlySet<string>,
  now: number,
): ValidatedCanonProposalV1 {
  const matching = existing.filter(
    (revision) => revision.canonKey === proposal.canonKey,
  );
  const active = matching
    .filter((revision) => revision.status === 'active')
    .sort((left, right) => right.version - left.version)[0];
  const version =
    matching.reduce(
      (maximum, revision) => Math.max(maximum, revision.version),
      0,
    ) + 1;
  const candidate: CanonRevisionV1 = {
    protocolVersion: '1.0',
    id: `canon-reflection:${reflectionId}:${proposal.id}`,
    canonKey: proposal.canonKey,
    personaId: scope.personaId,
    version,
    content: proposal.content,
    realityClass: proposal.realityClass,
    status: 'candidate',
    impact: proposal.impact,
    source: 'reflection',
    evidenceEventIds: [...proposal.evidenceEventIds],
    involvesViewerIds: [...proposal.involvesViewerIds],
    domainTags: [...proposal.domainTags],
    reviewPasses: 1,
    validationCodes: ['reflection-proposal-only'],
    supersedesRevisionId: active?.id,
    contentHash: hashCanonContent(proposal.content),
    createdAt: now,
    updatedAt: now,
  };
  const coreValidation = validateCanonCandidate(
    constitution,
    candidate,
    existing,
  );
  const unknownEvidenceEventIds = candidate.evidenceEventIds.filter(
    (eventId) => !knownEventIds.has(eventId),
  );
  const validation: CanonValidationResultV1 = {
    ...coreValidation,
    valid: coreValidation.valid && unknownEvidenceEventIds.length === 0,
    reasonCodes:
      unknownEvidenceEventIds.length === 0
        ? coreValidation.reasonCodes
        : [
            ...coreValidation.reasonCodes,
            'canon-evidence-not-in-reflection-ledger',
          ],
  };
  return { candidate, validation, unknownEvidenceEventIds };
}

function assertNoSensitivePayload(value: unknown, path: string): void {
  if (typeof value === 'string') {
    assertNoSecretText(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitivePayload(item, `${path}.${index}`),
    );
    return;
  }
  const record = recordValue(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (
      [
        'reasoning',
        'reasoningcontent',
        'rawreasoning',
        'chainofthought',
        'thinking',
        'thoughts',
        'apikey',
        'authorization',
        'password',
        'secret',
        'clientsecret',
        'cookie',
        'setcookie',
        'accesstoken',
        'refreshtoken',
      ].includes(normalized)
    ) {
      throw new SoulReflectionClientError(
        'soul_reflection_sensitive_payload',
        `Sensitive field rejected at ${path}.${key}`,
      );
    }
    assertNoSensitivePayload(child, `${path}.${key}`);
  }
}

function assertNoSecretText(value: string): void {
  if (
    /\b(?:api[_-]?key|authorization|password|client[_-]?secret|cookie)\s*[:=]/i.test(
      value,
    ) ||
    /\bbearer\s+[a-z0-9._-]{8,}/i.test(value) ||
    /\bsk-[a-z0-9_-]{8,}/i.test(value)
  ) {
    throw new SoulReflectionClientError('soul_reflection_secret_rejected');
  }
}

function assertSameScope(
  actual: SoulScopeV1,
  expected: SoulScopeV1,
  label: string,
): void {
  for (const key of ['personaId', 'platform', 'roomId', 'sessionId'] as const) {
    if (actual[key] !== expected[key]) {
      throw new SoulReflectionClientError(
        'soul_reflection_scope_mismatch',
        `${label}.${key} does not match`,
      );
    }
  }
}

function normalizeReflectionKey(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!normalized) {
    throw new SoulReflectionClientError('soul_reflection_key_invalid');
  }
  return normalized;
}

function normalizeRealityClass(
  value: unknown,
): SoulReflectionProposalV1['canonProposals'][number]['realityClass'] {
  return value === 'runtime-lived' ||
    value === 'simulated-offline' ||
    value === 'authored-history' ||
    value === 'dream'
    ? value
    : 'authored-history';
}

function stringList(value: unknown, limit: number, length: number): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundedString(item, length))
    .filter(Boolean)
    .slice(0, limit);
}

function boundedString(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function deterministicDigest(value: unknown): string {
  const input = stableStringify(value);
  return `${fnv1a32(input, 0x811c9dc5)}${fnv1a32(
    input.split('').reverse().join(''),
    0x9e3779b9,
  )}`;
}

function fnv1a32(input: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForSerialization(value));
}

function sortForSerialization(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForSerialization);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForSerialization(child)]),
    );
  }
  return value;
}
