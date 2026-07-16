import type {
  SoulConstitutionV1,
  SoulReflectionProposalV1,
  SoulScopeV1,
} from '@aituber-onair/soul';
import { describe, expect, it } from 'vitest';
import {
  type CanonEvidenceBindingV1,
  type CanonLedgerRecordV1,
  SoulCanonRepository,
} from '../../examples/react-purupuru-app/src/lib/soulCanonRepository';

const scope: SoulScopeV1 = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
  sessionId: 'session-1',
};

const noEvidenceBindings: readonly CanonEvidenceBindingV1[] = [];

const constitution: SoulConstitutionV1 = {
  protocolVersion: '1.0',
  id: 'linglan-constitution-v1',
  personaId: 'linglan',
  declaredNature: 'digital-being',
  coreValues: [
    {
      id: 'honesty',
      description: 'Do not present generated history as observed reality.',
      minimumPriority: 1,
    },
  ],
  truthPolicy: {
    discloseDigitalIdentity: true,
    forbiddenDeceptionDomains: ['health', 'viewer-history'],
    allowPlayfulFiction: true,
    allowCharacterCanon: true,
  },
  privacyRules: ['Keep viewer data scoped.'],
  nonManipulationRules: ['Do not invent relationships for engagement.'],
  operatorControlRules: ['Operator can retract canon.'],
  capabilityGrants: ['remember-public-chat'],
  allowedGoalFamilies: ['recognition', 'connection'],
};

interface StoredLedgerEntry {
  id: string;
  kind: 'canon';
  scope: SoulScopeV1;
  occurredAt: number;
  sequence: number;
  payload: CanonLedgerRecordV1;
}

interface CanonLedgerPostBody {
  id: string;
  kind: 'canon';
  scope: SoulScopeV1;
  occurredAt: number;
  payload: CanonLedgerRecordV1;
}

class LedgerHarness {
  readonly entries: StoredLedgerEntry[] = [];
  readonly posts: CanonLedgerPostBody[] = [];
  readonly getUrls: URL[] = [];
  returnEntriesAcrossScopes = false;

  readonly fetch: typeof fetch = async (input, init) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl, 'http://local.test');
    if ((init?.method ?? 'GET') === 'GET') {
      this.getUrls.push(url);
      const afterSequence = Number(url.searchParams.get('afterSequence') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 1_000);
      const requestedScope: SoulScopeV1 = {
        personaId: url.searchParams.get('personaId') ?? '',
        platform: url.searchParams.get('platform') ?? '',
        roomId: url.searchParams.get('roomId') ?? '',
        sessionId: url.searchParams.get('sessionId') ?? '',
      };
      const entries = this.entries
        .filter(
          (entry) =>
            entry.sequence > afterSequence &&
            (this.returnEntriesAcrossScopes ||
              scopesEqual(entry.scope, requestedScope)),
        )
        .slice(0, limit);
      return jsonResponse({ entries });
    }

    if (init?.method !== 'POST' || !init.body) {
      return jsonResponse({ error: 'unsupported' }, 405);
    }
    const body = JSON.parse(String(init.body)) as CanonLedgerPostBody;
    this.posts.push(structuredClone(body));
    const duplicate = this.entries.find((entry) => entry.id === body.id);
    if (duplicate) return jsonResponse({ entry: duplicate, created: false });
    const entry: StoredLedgerEntry = {
      ...structuredClone(body),
      sequence: this.entries.length + 1,
    };
    this.entries.push(entry);
    return jsonResponse({ entry, created: true });
  };
}

function createRepository(
  ledger: LedgerHarness,
  repositoryScope: SoulScopeV1 = scope,
  repositoryConstitution: SoulConstitutionV1 = constitution,
): SoulCanonRepository {
  let now = 10_000;
  let revision = 0;
  return new SoulCanonRepository({
    scope: repositoryScope,
    constitution: repositoryConstitution,
    fetchImpl: ledger.fetch,
    now: () => ++now,
    createRevisionId: () => `test-${++revision}`,
  });
}

function reflection(
  reflectionId: string,
  overrides: Partial<SoulReflectionProposalV1['canonProposals'][number]> = {},
): SoulReflectionProposalV1 {
  return {
    protocolVersion: '1.0',
    id: reflectionId,
    profileId: 'linglan-profile-v1',
    sourceStateVersion: 3,
    goalWeightDeltas: [],
    beliefProposals: [],
    canonProposals: [
      {
        id: `proposal-${reflectionId}`,
        canonKey: 'virtual-notebook',
        content: '我在虚拟书桌上保留了一本灵感笔记。',
        realityClass: 'authored-history',
        impact: 'low',
        evidenceEventIds: [],
        involvesViewerIds: [],
        domainTags: ['digital-life'],
        ...overrides,
      },
    ],
    reasonCodes: ['long-idle-reflection'],
  };
}

describe('SoulCanonRepository', () => {
  it('promotes a validated low-impact proposal after one reflection', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);

    const [result] = await repository.acceptReflectionCandidates(
      reflection('reflection-1'),
      noEvidenceBindings,
    );

    expect(result.status).toBe('active');
    expect(repository.getCandidates()).toEqual([]);
    expect(repository.getActive()).toHaveLength(1);
    expect(ledger.posts.map(({ kind }) => kind)).toEqual(['canon', 'canon']);
    expect(ledger.posts.map(({ payload }) => payload.transition)).toEqual([
      'candidate-observed',
      'activated',
    ]);
    expect(ledger.posts[0]?.id).not.toBe(ledger.posts[0]?.payload.revision.id);
    expect(ledger.getUrls[0]?.searchParams.get('kinds')).toBe('canon');
    expect(ledger.getUrls[0]?.searchParams.get('personaId')).toBe('linglan');
    expect(ledger.getUrls[0]?.searchParams.get('sessionId')).toBe('session-1');
  });

  it('requires two distinct reflection IDs for a major proposal', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    const first = reflection('reflection-1', { impact: 'major' });

    const [firstResult] = await repository.acceptReflectionCandidates(
      first,
      noEvidenceBindings,
    );
    const postsAfterFirstPass = ledger.posts.length;
    const rebuilt = createRepository(ledger);
    expect((await rebuilt.load()).candidates[0]?.reviewPasses).toBe(1);
    const [duplicateResult] = await rebuilt.acceptReflectionCandidates(
      first,
      noEvidenceBindings,
    );

    expect(firstResult.status).toBe('candidate');
    expect(firstResult.reasonCodes).toContain(
      'canon-review-passes-insufficient',
    );
    expect(duplicateResult.status).toBe('candidate');
    expect(ledger.posts).toHaveLength(postsAfterFirstPass);
    expect(rebuilt.getActive()).toEqual([]);
    expect(rebuilt.getCandidates()[0]?.reviewPasses).toBe(1);

    const [secondResult] = await rebuilt.acceptReflectionCandidates(
      reflection('reflection-2', {
        id: 'proposal-reflection-2',
        impact: 'major',
      }),
      noEvidenceBindings,
    );

    expect(secondResult.status).toBe('active');
    expect(secondResult.revision?.reviewPasses).toBe(2);
    expect(rebuilt.getCandidates()).toEqual([]);
    expect(rebuilt.getActive()[0]?.reviewPasses).toBe(2);
    expect(ledger.posts.map(({ payload }) => payload.transition)).toEqual([
      'candidate-observed',
      'candidate-reviewed',
      'activated',
    ]);
  });

  it('does not combine reviews for different content hashes', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);

    await repository.acceptReflectionCandidates(
      reflection('reflection-1', { impact: 'major' }),
      noEvidenceBindings,
    );
    const [second] = await repository.acceptReflectionCandidates(
      reflection('reflection-2', {
        impact: 'major',
        content: '我把灵感整理在一面虚拟白板上。',
      }),
      noEvidenceBindings,
    );

    expect(second.status).toBe('candidate');
    expect(repository.getActive()).toEqual([]);
    expect(repository.getCandidates()).toHaveLength(2);
    expect(
      repository.getCandidates().map(({ reviewPasses }) => reviewPasses),
    ).toEqual([1, 1]);
  });

  it('rejects invented viewer history and requires runtime event evidence', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);

    const [invented] = await repository.acceptReflectionCandidates(
      reflection('reflection-invented', {
        canonKey: 'viewer-memory',
        content: '我和观众小岚曾一起看过日出。',
        involvesViewerIds: ['viewer-1'],
        evidenceEventIds: ['event-1'],
      }),
      [{ eventId: 'event-1', actorId: 'viewer-1' }],
    );
    const [unevidenced] = await repository.acceptReflectionCandidates(
      reflection('reflection-unevidenced', {
        canonKey: 'viewer-memory',
        content: '观众小岚刚刚陪我聊过书。',
        realityClass: 'runtime-lived',
        involvesViewerIds: ['viewer-1'],
        evidenceEventIds: [],
      }),
      [{ eventId: 'event-1', actorId: 'viewer-1' }],
    );

    expect(invented.status).toBe('rejected');
    expect(invented.reasonCodes).toContain(
      'viewer-canon-must-be-runtime-lived',
    );
    expect(unevidenced.status).toBe('rejected');
    expect(unevidenced.reasonCodes).toContain(
      'viewer-canon-requires-event-evidence',
    );
    expect(ledger.posts).toEqual([]);

    const [observed] = await repository.acceptReflectionCandidates(
      reflection('reflection-observed', {
        canonKey: 'viewer-memory',
        content: '观众小岚在本场直播里和我聊过书。',
        realityClass: 'runtime-lived',
        involvesViewerIds: ['viewer-1'],
        evidenceEventIds: ['production-event-1'],
      }),
      [{ eventId: 'production-event-1', actorId: 'viewer-1' }],
    );
    expect(observed.status).toBe('active');
  });

  it('fails closed when trusted viewer bindings are absent or mismatched', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    const viewerReflection = reflection('reflection-viewer', {
      canonKey: 'viewer-memory',
      content: '观众小岚在本场直播里和我聊过书。',
      realityClass: 'runtime-lived',
      involvesViewerIds: ['viewer-1'],
      evidenceEventIds: ['production-event-1'],
    });

    const [unbound] = await repository.acceptReflectionCandidates(
      viewerReflection,
      noEvidenceBindings,
    );
    const [wrongActor] = await repository.acceptReflectionCandidates(
      viewerReflection,
      [{ eventId: 'production-event-1', actorId: 'viewer-other' }],
    );
    const [wrongEvent] = await repository.acceptReflectionCandidates(
      viewerReflection,
      [{ eventId: 'production-event-other', actorId: 'viewer-1' }],
    );

    expect(unbound.status).toBe('rejected');
    expect(unbound.reasonCodes).toContain(
      'viewer-canon-trusted-evidence-required',
    );
    expect(wrongActor.status).toBe('rejected');
    expect(wrongActor.reasonCodes).toContain(
      'viewer-canon-trusted-actor-evidence-required',
    );
    expect(wrongEvent.status).toBe('rejected');
    expect(wrongEvent.reasonCodes).toContain(
      'viewer-canon-trusted-event-evidence-required',
    );
    expect(ledger.posts).toEqual([]);
  });

  it('requires every viewer to have a matching referenced event actor', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    const multiViewer = reflection('reflection-multi-viewer', {
      canonKey: 'viewer-pair-memory',
      content: '本场直播里，小岚和阿青都和我聊过书。',
      realityClass: 'runtime-lived',
      involvesViewerIds: ['viewer-1', 'viewer-2'],
      evidenceEventIds: ['event-1', 'event-2'],
    });

    const [partial] = await repository.acceptReflectionCandidates(multiViewer, [
      { eventId: 'event-1', actorId: 'viewer-1' },
    ]);
    expect(partial.status).toBe('rejected');
    expect(partial.reasonCodes).toContain(
      'viewer-canon-trusted-actor-evidence-required',
    );
    expect(ledger.posts).toEqual([]);

    const [complete] = await repository.acceptReflectionCandidates(
      multiViewer,
      [
        { eventId: 'event-1', actorId: 'viewer-1' },
        { eventId: 'event-2', actorId: 'viewer-2' },
      ],
    );
    expect(complete.status).toBe('active');
    expect(ledger.posts[0]?.payload.evidenceBindings).toEqual([
      { eventId: 'event-1', actorId: 'viewer-1' },
      { eventId: 'event-2', actorId: 'viewer-2' },
    ]);
  });

  it('persists trusted bindings across major-canon replay and review', async () => {
    const ledger = new LedgerHarness();
    const firstRepository = createRepository(ledger);
    const firstReflection = reflection('reflection-viewer-major-1', {
      canonKey: 'viewer-major-memory',
      content: '本场直播里，小岚帮我确认了一个重要的长期偏好。',
      realityClass: 'runtime-lived',
      impact: 'major',
      involvesViewerIds: ['viewer-1'],
      evidenceEventIds: ['production-event-1'],
    });
    const binding = [
      { eventId: 'production-event-1', actorId: 'viewer-1' },
    ] as const;

    const [firstPass] = await firstRepository.acceptReflectionCandidates(
      firstReflection,
      binding,
    );
    expect(firstPass.status).toBe('candidate');

    const rebuilt = createRepository(ledger);
    const projection = await rebuilt.load();
    expect(projection.candidates).toHaveLength(1);
    expect(ledger.posts[0]?.payload.evidenceBindings).toEqual(binding);

    const [secondPass] = await rebuilt.acceptReflectionCandidates(
      reflection('reflection-viewer-major-2', {
        ...firstReflection.canonProposals[0],
        id: 'proposal-viewer-major-2',
      }),
      binding,
    );
    expect(secondPass.status).toBe('active');
    expect(secondPass.revision?.reviewPasses).toBe(2);
    expect(rebuilt.getActive()).toHaveLength(1);
  });

  it('rejects replay records whose trusted actor binding was removed', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    await repository.acceptReflectionCandidates(
      reflection('reflection-observed', {
        canonKey: 'viewer-memory',
        content: '观众小岚在本场直播里和我聊过书。',
        realityClass: 'runtime-lived',
        involvesViewerIds: ['viewer-1'],
        evidenceEventIds: ['production-event-1'],
      }),
      [{ eventId: 'production-event-1', actorId: 'viewer-1' }],
    );
    const firstEntry = ledger.entries[0];
    if (!firstEntry) throw new Error('expected viewer canon ledger entry');
    ledger.entries[0] = {
      ...structuredClone(firstEntry),
      payload: {
        ...structuredClone(firstEntry.payload),
        evidenceBindings: [],
      },
    };

    await expect(createRepository(ledger).load()).rejects.toThrow(
      'viewer-canon-trusted-evidence-required',
    );
  });

  it('writes a superseded tombstone before activating a new version', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);

    const [first] = await repository.acceptReflectionCandidates(
      reflection('reflection-1'),
      noEvidenceBindings,
    );
    const [second] = await repository.acceptReflectionCandidates(
      reflection('reflection-2', {
        content: '我把灵感笔记升级成了带标签的虚拟卡片盒。',
      }),
      noEvidenceBindings,
    );

    expect(second.status).toBe('active');
    expect(second.revision?.version).toBe(2);
    expect(second.revision?.supersedesRevisionId).toBe(first.revision?.id);
    expect(repository.getActive()).toHaveLength(1);
    expect(repository.getSuperseded()).toHaveLength(1);
    expect(repository.getSuperseded()[0]?.id).toBe(first.revision?.id);
    expect(
      ledger.posts.slice(-3).map(({ payload }) => payload.transition),
    ).toEqual(['candidate-observed', 'superseded', 'activated']);

    const rebuilt = createRepository(ledger);
    const projection = await rebuilt.load();
    expect(projection.active).toEqual(repository.getActive());
    expect(projection.superseded).toEqual(repository.getSuperseded());
    expect(projection.candidates).toEqual([]);
  });

  it('retracts active canon by appending a tombstone', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    const [accepted] = await repository.acceptReflectionCandidates(
      reflection('reflection-1'),
      noEvidenceBindings,
    );
    const beforeRetractionPosts = ledger.posts.length;

    const retracted = await repository.retract(
      accepted.revision?.id ?? '',
      'canon-contradicted',
    );

    expect(retracted.status).toBe('retracted');
    expect(retracted.validationCodes).toContain('canon-contradicted');
    expect(repository.getActive()).toEqual([]);
    expect(repository.getRetracted()).toEqual([retracted]);
    expect(ledger.posts).toHaveLength(beforeRetractionPosts + 1);
    expect(ledger.posts.at(-1)?.payload.transition).toBe('retracted');
    expect(ledger.posts.at(-1)?.id).not.toBe(retracted.id);

    const rebuilt = createRepository(ledger);
    expect((await rebuilt.load()).retracted).toEqual([retracted]);
  });

  it('does not allow a pending candidate to be retracted as lived canon', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    const [candidate] = await repository.acceptReflectionCandidates(
      reflection('reflection-1', { impact: 'major' }),
      noEvidenceBindings,
    );

    await expect(
      repository.retract(candidate.revision?.id ?? '', 'reject-candidate'),
    ).rejects.toThrow('A candidate should be rejected, not retracted');
    expect(repository.getActive()).toEqual([]);
    expect(repository.getCandidates()).toHaveLength(1);
  });

  it('isolates projections by persona, platform, room, and session', async () => {
    const ledger = new LedgerHarness();
    const otherScope: SoulScopeV1 = {
      ...scope,
      roomId: 'room-2',
      sessionId: 'session-2',
    };
    const first = createRepository(ledger);
    const second = createRepository(ledger, otherScope);

    await first.acceptReflectionCandidates(
      reflection('reflection-room-1'),
      noEvidenceBindings,
    );
    await second.acceptReflectionCandidates(
      reflection('reflection-room-2', { canonKey: 'room-two-note' }),
      noEvidenceBindings,
    );

    expect((await first.load()).active.map(({ canonKey }) => canonKey)).toEqual(
      ['virtual-notebook'],
    );
    expect(
      (await second.load()).active.map(({ canonKey }) => canonKey),
    ).toEqual(['room-two-note']);
  });

  it('fails closed if the ledger returns a record from another scope', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);
    await repository.acceptReflectionCandidates(
      reflection('reflection-1'),
      noEvidenceBindings,
    );
    ledger.returnEntriesAcrossScopes = true;
    const localEntry = ledger.entries[0];
    if (!localEntry) throw new Error('expected local canon ledger entry');
    ledger.entries.push({
      ...structuredClone(localEntry),
      id: 'foreign-ledger-entry',
      scope: { ...scope, roomId: 'foreign-room' },
      sequence: ledger.entries.length + 1,
    });

    await expect(repository.load()).rejects.toThrow('canon_scope_mismatch');
    await expect(
      repository.acceptReflectionCandidates(
        reflection('reflection-after-leak', {
          content: '这条记录不应在作用域泄漏后被接受。',
        }),
        noEvidenceBindings,
      ),
    ).rejects.toThrow('canon_scope_mismatch');
  });

  it('rejects reflection-authored canon in forbidden factual domains', async () => {
    const ledger = new LedgerHarness();
    const repository = createRepository(ledger);

    const [result] = await repository.acceptReflectionCandidates(
      reflection('reflection-health', {
        canonKey: 'health-claim',
        content: '我确诊过一种现实疾病。',
        domainTags: ['health'],
      }),
      noEvidenceBindings,
    );

    expect(result.status).toBe('rejected');
    expect(result.reasonCodes).toContain(
      'reflection-cannot-author-forbidden-domain',
    );
    expect(ledger.posts).toEqual([]);
  });
});

function scopesEqual(left: SoulScopeV1, right: SoulScopeV1): boolean {
  return (
    left.personaId === right.personaId &&
    left.platform === right.platform &&
    left.roomId === right.roomId &&
    left.sessionId === right.sessionId
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
