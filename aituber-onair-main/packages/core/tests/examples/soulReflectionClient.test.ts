import { describe, expect, it, vi } from 'vitest';
import { hashSoulState } from '@aituber-onair/soul';
import {
  LINGLAN_SOUL_CONSTITUTION,
  LINGLAN_SOUL_PROFILE,
} from '../../examples/react-purupuru-app/src/lib/linglanSoul';
import {
  SoulReflectionClientError,
  createSoulReflectionId,
  requestSoulReflection,
  type SoulReflectionLedgerSummaryV1,
} from '../../examples/react-purupuru-app/src/lib/soulReflectionClient';
import { BrowserSoulRuntimeSession } from '../../examples/react-purupuru-app/src/lib/soulRuntimeClient';

const scope = {
  personaId: 'linglan-queen',
  platform: 'bilibili',
  roomId: 'room-reflection',
  sessionId: 'session-reflection',
};

const ledgerSummary: SoulReflectionLedgerSummaryV1[] = [
  {
    eventId: 'event-known',
    evidenceLevel: 'production-equivalent',
    provenance: 'replay-harness',
    summary: 'The host and audience explored a new topic together.',
  },
];

function createSession(): BrowserSoulRuntimeSession {
  return new BrowserSoulRuntimeSession({
    constitution: LINGLAN_SOUL_CONSTITUTION,
    profile: LINGLAN_SOUL_PROFILE,
    scope,
    fetchImpl: vi.fn() as unknown as typeof fetch,
    now: () => 1_000,
  });
}

function reflectionEnvelope(request: Record<string, unknown>) {
  const frame = request.frame as { stateVersion: number };
  return {
    proposal: {
      protocolVersion: '1.0',
      id: request.reflectionId,
      profileId: LINGLAN_SOUL_PROFILE.id,
      sourceStateVersion: frame.stateVersion,
      goalWeightDeltas: [
        {
          goalId: 'encounter-novelty',
          delta: 0.02,
          evidenceEventIds: ['event-known'],
          reasonCode: 'sustained-curiosity',
        },
      ],
      beliefProposals: [],
      canonProposals: [
        {
          id: 'notebook',
          canonKey: 'virtual-notebook',
          content: 'I keep a virtual notebook for unfinished ideas.',
          realityClass: 'authored-history',
          impact: 'low',
          evidenceEventIds: ['event-known'],
          involvesViewerIds: [],
          domainTags: ['digital-life'],
          status: 'active',
        },
        {
          id: 'invented-viewer-history',
          canonKey: 'viewer-shared-trip',
          content: 'A viewer and I once travelled together.',
          realityClass: 'authored-history',
          impact: 'low',
          evidenceEventIds: ['event-known'],
          involvesViewerIds: ['viewer-1'],
          domainTags: ['viewer-history'],
        },
        {
          id: 'unknown-evidence',
          canonKey: 'unverified-event',
          content: 'Something happened outside the supplied ledger.',
          realityClass: 'simulated-offline',
          impact: 'low',
          evidenceEventIds: ['event-hallucinated'],
          involvesViewerIds: [],
          domainTags: ['digital-life'],
        },
      ],
      reasonCodes: ['post-stream-reflection'],
    },
    meta: {
      modelProfileId: 'minimax-m3-soul-slow-v1',
      latencyMs: 800,
      firstContentLatencyMs: 500,
      fallback: false,
      repairApplied: false,
    },
  };
}

describe('soul reflection browser client', () => {
  it('uses a compact frame and returns validated proposal-only canon candidates', async () => {
    const session = createSession();
    const stateBefore = hashSoulState(session.getState());
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        requestBodies.push(request);
        return new Response(JSON.stringify(reflectionEnvelope(request)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    ) as unknown as typeof fetch;
    const input = {
      session,
      constitution: LINGLAN_SOUL_CONSTITUTION,
      profile: LINGLAN_SOUL_PROFILE,
      scope,
      ledgerSummary,
      reflectionKey: 'post-stream',
      fetchImpl,
      now: () => 5_000,
    };

    const first = await requestSoulReflection(input);
    const second = await requestSoulReflection(input);

    expect(first.reflectionId).toBe(second.reflectionId);
    expect(first.reflectionId).toMatch(/^reflection-v1-post-stream-/);
    expect(first.frame.activeGoals.length).toBeLessThanOrEqual(3);
    expect(requestBodies[0]?.ledgerSummary).toHaveLength(1);
    expect(
      JSON.parse((requestBodies[0]?.ledgerSummary as string[])[0]),
    ).toMatchObject({
      eventId: 'event-known',
      evidenceLevel: 'production-equivalent',
    });
    expect(hashSoulState(session.getState())).toBe(stateBefore);
    expect(first.canonCandidates[0]?.candidate.status).toBe('candidate');
    expect(first.canonCandidates[0]?.validation.valid).toBe(true);
    expect(first.canonCandidates[1]?.validation.reasonCodes).toContain(
      'viewer-canon-must-be-runtime-lived',
    );
    expect(first.canonCandidates[2]?.validation.reasonCodes).toContain(
      'canon-evidence-not-in-reflection-ledger',
    );
    expect(
      Object.hasOwn(first.proposal.canonProposals[0] ?? {}, 'status'),
    ).toBe(false);
  });

  it('creates content-bound reflection ids', () => {
    const common = {
      scope,
      profileId: LINGLAN_SOUL_PROFILE.id,
      stateVersion: 0,
      ledgerSummary,
      reflectionKey: 'idle-cycle',
    };

    expect(createSoulReflectionId(common)).toBe(createSoulReflectionId(common));
    expect(createSoulReflectionId(common)).not.toBe(
      createSoulReflectionId({
        ...common,
        ledgerSummary: [
          { ...ledgerSummary[0], summary: 'A different evidence summary.' },
        ],
      }),
    );
  });

  it('rejects secrets in ledger summaries before making a request', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      requestSoulReflection({
        session: createSession(),
        constitution: LINGLAN_SOUL_CONSTITUTION,
        profile: LINGLAN_SOUL_PROFILE,
        scope,
        ledgerSummary: [
          {
            eventId: 'secret-event',
            evidenceLevel: 'synthetic',
            summary: 'api_key=sk-this-must-never-leave-the-browser',
          },
        ],
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(SoulReflectionClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects raw reasoning or secret fields returned by the server', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ...reflectionEnvelope(request),
            reasoning_content: 'private chain of thought',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    ) as unknown as typeof fetch;

    await expect(
      requestSoulReflection({
        session: createSession(),
        constitution: LINGLAN_SOUL_CONSTITUTION,
        profile: LINGLAN_SOUL_PROFILE,
        scope,
        ledgerSummary,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'soul_reflection_sensitive_payload' });
  });

  it('rejects a response bound to another reflection identity', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        const envelope = reflectionEnvelope(request);
        envelope.proposal.id = 'different-reflection';
        return new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    ) as unknown as typeof fetch;

    await expect(
      requestSoulReflection({
        session: createSession(),
        constitution: LINGLAN_SOUL_CONSTITUTION,
        profile: LINGLAN_SOUL_PROFILE,
        scope,
        ledgerSummary,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'soul_reflection_proposal_identity_mismatch',
    });
  });
});
