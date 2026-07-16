import { describe, expect, it, vi } from 'vitest';
import {
  hashSoulState,
  type SemanticProposalV1,
  type SoulLedgerInputV1,
  type SoulReflectionProposalV1,
  type SoulSnapshotV1,
} from '@aituber-onair/soul';
import {
  LINGLAN_SOUL_CONSTITUTION,
  LINGLAN_SOUL_PROFILE,
  createLinglanSoulEvent,
} from '../../examples/react-purupuru-app/src/lib/linglanSoul';
import { BrowserSoulRuntimeSession } from '../../examples/react-purupuru-app/src/lib/soulRuntimeClient';
import { createSoulReflectionPolicyApproval } from '../../examples/react-purupuru-app/src/lib/soulReflectionPolicy';

const scope = {
  personaId: 'linglan-queen',
  platform: 'bilibili',
  roomId: 'room-1',
  sessionId: 'session-1',
};

function proposal(eventId: string): SemanticProposalV1 {
  return {
    protocolVersion: '1.0',
    eventId,
    scope,
    modelProfileId: 'minimax-m3-soul-fast-v1',
    confidence: 0.9,
    attribution: 'viewer',
    evidence: [
      {
        dimension: 'identity-respect',
        value: 0.4,
        confidence: 0.8,
        reasonCode: 'respectful-message',
      },
    ],
    candidates: [
      {
        id: 'answer-1',
        action: 'answer',
        truthMode: 'literal',
        utterance: '这句我听见了。',
        targetActorId: 'bilibili:viewer-1',
        goalEffects: [
          { goalId: 'build-reciprocal-connection', progress: 0.3 },
        ],
        relationshipBenefit: 0.5,
        programValue: 0.3,
        novelty: 0.2,
        repetitionCost: 0,
        interruptionCost: 0,
        manipulationRisk: 0,
        factSafetyRisk: 0,
        socialRisks: [],
        reasonCodes: ['answer-specific-message'],
      },
    ],
  };
}

function createFetch(eventId: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/fast')) {
      return new Response(
        JSON.stringify({
          proposal: proposal(eventId),
          meta: {
            modelProfileId: 'minimax-m3-soul-fast-v1',
            latencyMs: 120,
            fallback: false,
            repairApplied: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ stored: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('browser soul runtime session', () => {
  it('reserves generated intent and commits it only after spoken outcome', async () => {
    let now = 1_000;
    const event = createLinglanSoulEvent({
      id: 'message-1',
      scope,
      kind: 'audience-message',
      occurredAt: now,
      receivedAt: now,
      evidenceLevel: 'synthetic',
      provenance: 'unit-test',
      actor: { kind: 'viewer', id: 'bilibili:viewer-1' },
      data: { text: '你今晚讲得很好' },
    });
    const runtime = new BrowserSoulRuntimeSession({
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      fetchImpl: createFetch(event.id),
      now: () => now,
    });

    const evaluated = await runtime.evaluate(event, { reserveDecision: true });
    expect(evaluated.persistenceOk).toBe(true);
    expect(
      evaluated.state.delivery.reservations[evaluated.decision.id],
    ).toBeDefined();
    expect(evaluated.state.delivery.committedDecisionIds).not.toContain(
      evaluated.decision.id,
    );

    now += 500;
    const completed = await runtime.applyOutcome(event.id, 'spoken');
    expect(completed.state.delivery.reservations[evaluated.decision.id]).toBe(
      undefined,
    );
    expect(completed.state.delivery.committedDecisionIds).toContain(
      evaluated.decision.id,
    );
  });

  it('uses a deterministic non-speaking fallback when the local gateway fails', async () => {
    const event = createLinglanSoulEvent({
      id: 'message-2',
      scope,
      kind: 'audience-message',
      occurredAt: 2_000,
      receivedAt: 2_000,
      evidenceLevel: 'synthetic',
      provenance: 'unit-test',
      data: { text: '在吗' },
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/fast')) throw new Error('offline');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const runtime = new BrowserSoulRuntimeSession({
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      fetchImpl,
      now: () => 2_000,
    });

    const evaluated = await runtime.evaluate(event);
    expect(evaluated.meta.fallback).toBe(true);
    expect(evaluated.decision.action).toBe('delay');
    expect(evaluated.decision.utterance).toBeUndefined();
  });

  it('restores a scope-isolated snapshot from reconstructed local ledger inputs', async () => {
    let now = 3_000;
    const ledgerInputs: SoulLedgerInputV1[] = [];
    let snapshot: SoulSnapshotV1 | undefined;
    const event = createLinglanSoulEvent({
      id: 'message-recover',
      scope,
      kind: 'audience-message',
      occurredAt: now,
      receivedAt: now,
      evidenceLevel: 'synthetic',
      provenance: 'unit-test',
      actor: { kind: 'viewer', id: 'bilibili:viewer-1' },
      data: { text: 'remember this turn' },
    });
    const persistenceFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/fast')) {
          return new Response(JSON.stringify({ proposal: proposal(event.id) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as
          | SoulLedgerInputV1
          | SoulSnapshotV1;
        if (url.endsWith('/ledger')) {
          if (!ledgerInputs.some((entry) => entry.id === (body as SoulLedgerInputV1).id)) {
            ledgerInputs.push(body as SoulLedgerInputV1);
          }
        } else if (url.endsWith('/snapshot')) {
          snapshot = body as SoulSnapshotV1;
        }
        return new Response('{}', { status: 200 });
      },
    ) as unknown as typeof fetch;
    const original = new BrowserSoulRuntimeSession({
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      fetchImpl: persistenceFetch,
      now: () => now,
    });
    await original.evaluate(event, { reserveDecision: true });
    expect(snapshot).toBeDefined();
    const expectedHash = hashSoulState(original.getState());

    const recoveryFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/soul/snapshot?')) {
        return new Response(JSON.stringify({ snapshot }), { status: 200 });
      }
      if (url.includes('/api/soul/ledger?')) {
        return new Response(
          JSON.stringify({
            entries: ledgerInputs.map((entry, index) => ({
              ...entry,
              protocolVersion: '1.0',
              sequence: index + 1,
              previousHash: index === 0 ? 'genesis' : `server-${index}`,
              hash: `server-${index + 1}`,
            })),
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected recovery request: ${url}`);
    }) as unknown as typeof fetch;
    now += 100;
    const recovered = await BrowserSoulRuntimeSession.recover({
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      fetchImpl: recoveryFetch,
      now: () => now,
    });

    expect(hashSoulState(recovered.getState())).toBe(expectedHash);
    expect(recoveryFetch).toHaveBeenCalledTimes(2);
  });

  it('commits an explicit reflection review and restores it without inert model proposals', async () => {
    let now = 6_000;
    const ledgerInputs: SoulLedgerInputV1[] = [];
    let snapshot: SoulSnapshotV1 | undefined;
    const event = createLinglanSoulEvent({
      id: 'reflection-evidence-1',
      scope,
      kind: 'audience-message',
      occurredAt: now,
      receivedAt: now,
      evidenceLevel: 'synthetic',
      provenance: 'unit-test',
      actor: { kind: 'viewer', id: 'bilibili:viewer-1' },
      data: { text: 'A short opening led to a public reply.' },
    });
    const persistenceFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/fast')) {
          return new Response(JSON.stringify({ proposal: proposal(event.id) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as
          | SoulLedgerInputV1
          | SoulSnapshotV1;
        if (url.endsWith('/ledger')) {
          const entry = body as SoulLedgerInputV1;
          if (!ledgerInputs.some((candidate) => candidate.id === entry.id)) {
            ledgerInputs.push(entry);
          }
        } else if (url.endsWith('/snapshot')) {
          snapshot = body as SoulSnapshotV1;
        }
        return new Response('{}', { status: 200 });
      },
    ) as unknown as typeof fetch;
    const original = new BrowserSoulRuntimeSession({
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      fetchImpl: persistenceFetch,
      now: () => now,
    });
    await original.evaluate(event);
    const reflectionProposal: SoulReflectionProposalV1 = {
      protocolVersion: '1.0',
      id: 'reflection-reviewed-1',
      profileId: LINGLAN_SOUL_PROFILE.id,
      sourceStateVersion: original.getState().version,
      goalWeightDeltas: [
        {
          goalId: 'encounter-novelty',
          delta: 0.02,
          evidenceEventIds: [event.id],
          reasonCode: 'observable-reply-after-short-opening',
        },
      ],
      beliefProposals: [
        {
          id: 'strategy:short-opening',
          proposition: 'Short openings may invite more public replies.',
          confidence: 0.7,
          evidenceEventIds: [event.id],
        },
      ],
      canonProposals: [],
      reasonCodes: ['unit-test-reflection'],
    };
    const approval = createSoulReflectionPolicyApproval({
      profile: LINGLAN_SOUL_PROFILE,
      proposal: reflectionProposal,
      allowedEvidenceEventIds: [event.id],
    });
    now += 100;
    const committed = await original.commitReflection({
      proposal: reflectionProposal,
      allowedEvidenceEventIds: [event.id],
      approval,
      occurredAt: now,
    });

    expect(committed.applied).toBe(true);
    expect(committed.persistenceOk).toBe(true);
    expect(committed.record.recordType).toBe('reflection-review');
    expect(
      original.getState().beliefs['strategy:short-opening'],
    ).toMatchObject({
      kind: 'strategy',
      epistemicStatus: 'hypothesis',
    });
    expect(
      ledgerInputs.filter(
        (entry) =>
          entry.kind === 'reflection' &&
          (entry.payload as { recordType?: string }).recordType ===
            'reflection-review',
      ),
    ).toHaveLength(1);
    expect(snapshot).toBeDefined();
    const expectedHash = hashSoulState(original.getState());

    const reviewIndex = ledgerInputs.findIndex(
      (entry) => entry.kind === 'reflection',
    );
    const inertProposal: SoulLedgerInputV1 = {
      id: 'reflection-proposal:reflection-reviewed-1',
      kind: 'reflection',
      scope,
      occurredAt: now - 50,
      payload: {
        protocolVersion: '1.0',
        recordType: 'reflection-proposal',
        disposition: 'proposal-only',
        proposal: reflectionProposal,
      },
    };
    const serverInputs = [
      ...ledgerInputs.slice(0, reviewIndex),
      inertProposal,
      ...ledgerInputs.slice(reviewIndex),
    ];
    const recoveryFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/soul/snapshot?')) {
        return new Response(JSON.stringify({ snapshot }), { status: 200 });
      }
      if (url.includes('/api/soul/ledger?')) {
        expect(url).toContain('reflection');
        return new Response(
          JSON.stringify({
            entries: serverInputs.map((entry, index) => ({
              ...entry,
              protocolVersion: '1.0',
              sequence: index + 1,
              previousHash: index === 0 ? 'genesis' : `server-${index}`,
              hash: `server-${index + 1}`,
            })),
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected recovery request: ${url}`);
    }) as unknown as typeof fetch;
    now += 100;
    const recovered = await BrowserSoulRuntimeSession.recover({
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      fetchImpl: recoveryFetch,
      now: () => now,
    });

    expect(hashSoulState(recovered.getState())).toBe(expectedHash);
    expect(recovered.getState().processedReflectionIds).toEqual([
      reflectionProposal.id,
    ]);
    expect(
      recovered.getState().beliefs['strategy:short-opening'],
    ).toMatchObject({ sourceReflectionId: reflectionProposal.id });
  });
});
