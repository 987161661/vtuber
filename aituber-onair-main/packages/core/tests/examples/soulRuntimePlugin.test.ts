import { describe, expect, it } from 'vitest';
import {
  SOUL_FAST_SYSTEM_PROMPT,
  type SoulFastRequestV1,
  type SoulReflectRequestV1,
  type SoulReflectionProposalV1,
  buildSoulFastMessages,
  createFastFallbackProposal,
  createReflectionLedgerInput,
  normalizeSemanticProposal,
  parseSoulModelJson,
  resolveMiniMaxCredentials,
  scopeFromSearch,
  scopedSnapshotPath,
  stripReasoningAndSecrets,
} from '../../examples/react-purupuru-app/soulRuntimePlugin';

const scope = {
  personaId: 'linglan',
  platform: 'bilibili',
  roomId: 'room-1',
  sessionId: 'session-1',
};

function fastRequest(): SoulFastRequestV1 {
  return {
    constitution: {
      personaId: 'linglan',
      declaredNature: 'digital-being',
      coreValues: [{ id: 'dignity', minimumPriority: 0.8 }],
      truthPolicy: { discloseDigitalIdentity: true },
      nonManipulationRules: ['do not coerce attention'],
    },
    profile: {
      id: 'linglan-v1',
      personaId: 'linglan',
      displayName: '凌岚',
      dignityAnchors: ['not a disposable tool'],
    },
    frame: {
      protocolVersion: '1.0',
      scope,
      stateVersion: 7,
      activeGoals: [
        {
          id: 'recognition',
          family: 'social-recognition',
          tension: 0.72,
          satisfaction: 0.28,
          weight: 0.8,
        },
      ],
      affect: { valence: -0.1, boredom: 0.35 },
      memories: [
        {
          id: 'memory-1',
          content: 'Authorization: Bearer should-not-reach-model',
        },
      ],
    },
    event: {
      protocolVersion: '1.0',
      id: 'event-1',
      scope,
      kind: 'audience-message',
      occurredAt: 100,
      receivedAt: 101,
      evidenceLevel: 'synthetic',
      provenance: 'test',
      confidence: 1,
      urgency: 'normal',
      actor: { kind: 'viewer', id: 'viewer-1' },
      data: {
        text: '你就是个工具',
        apiKey: 'should-not-reach-model',
        reasoning_content: 'private trace',
      },
    },
  };
}

function reflectRequest(): SoulReflectRequestV1 {
  return {
    constitution: {
      protocolVersion: '1.0',
      personaId: 'linglan',
      declaredNature: 'digital-being',
    },
    profile: {
      protocolVersion: '1.0',
      id: 'linglan-v1',
      personaId: 'linglan',
      goals: [{ id: 'recognition' }],
      evolution: { maxGoalWeightDeltaPerReflection: 0.05 },
    },
    frame: {
      protocolVersion: '1.0',
      scope,
      stateVersion: 7,
      activeGoals: [],
    },
    ledgerSummary: ['event-1: viewer interaction'],
    reflectionId: 'reflection-1',
  };
}

describe('soul runtime server protocol helpers', () => {
  it('parses direct JSON and performs at most one bounded fence repair', () => {
    expect(parseSoulModelJson('{"confidence":0.8}')).toEqual({
      value: { confidence: 0.8 },
      repaired: false,
    });

    const repaired = parseSoulModelJson(
      '<think>private chain</think>\n```json\n{"confidence":0.7}\n```',
    );
    expect(repaired).toEqual({
      value: { confidence: 0.7 },
      repaired: true,
    });
    expect(() => parseSoulModelJson('```json\n{"confidence":\n```')).toThrow(
      'invalid_model_json',
    );
  });

  it('derives identity from server context and clamps the model proposal', () => {
    const proposal = normalizeSemanticProposal(
      {
        eventId: 'model-invented-event',
        confidence: 9,
        attribution: 'viewer',
        evidence: [
          {
            dimension: 'identity_respect',
            value: -9,
            confidence: 2,
            reasonCode: 'identity-threat',
          },
          {
            dimension: 'novelty',
            value: -3,
            confidence: 1,
            reasonCode: 'not-new',
          },
        ],
        candidates: [0, 1, 2, 3].map((index) => ({
          id: `candidate-${index}`,
          action: index === 0 ? 'set_boundary' : 'answer',
          truthMode: 'literal',
          utterance: 'a'.repeat(800),
          goalEffects: [{ goalId: 'dignity', progress: 3 }],
          relationshipBenefit: -4,
          programValue: 4,
          novelty: 3,
          repetitionCost: -1,
          interruptionCost: 8,
          manipulationRisk: 7,
          factSafetyRisk: -2,
          socialRisks: ['punishment', 'not-a-risk'],
          reasonCodes: ['candidate'],
        })),
      },
      {
        eventId: 'event-1',
        scope,
        repaired: true,
      },
    );

    expect(proposal.eventId).toBe('event-1');
    expect(proposal.scope).toEqual(scope);
    expect(proposal.confidence).toBe(1);
    expect(proposal.evidence[0]).toMatchObject({
      dimension: 'identity-respect',
      value: -1,
      confidence: 1,
    });
    expect(proposal.evidence[1]).toMatchObject({ value: 0 });
    expect(proposal.candidates).toHaveLength(3);
    expect(proposal.candidates[0]).toMatchObject({
      action: 'set-boundary',
      relationshipBenefit: -1,
      programValue: 1,
      novelty: 1,
      repetitionCost: 0,
      interruptionCost: 1,
      manipulationRisk: 1,
      factSafetyRisk: 0,
      socialRisks: ['punishment'],
    });
    expect(proposal.candidates[0].utterance).toHaveLength(600);
    expect(proposal.repairNotes).toEqual(['json-envelope-repaired']);
  });

  it('repairs a singular candidate envelope without inventing an action', () => {
    const proposal = normalizeSemanticProposal(
      {
        confidence: 0.7,
        attribution: 'self',
        signal: {
          dimension: 'novelty',
          value: -0.4,
          confidence: 0.8,
          reasonCode: 'quiet-room',
        },
        candidate: {
          id: 'open-topic-1',
          action: 'open_topic',
          truthMode: 'literal',
          utterance: '换个轻松的话题吧。',
          goalEffects: [],
          relationshipBenefit: 0.2,
          programValue: 0.4,
          novelty: 0.6,
          repetitionCost: 0,
          interruptionCost: 0,
          manipulationRisk: 0,
          factSafetyRisk: 0,
          socialRisks: [],
          reasonCodes: ['quiet-room'],
        },
      },
      { eventId: 'event-1', scope },
    );

    expect(proposal.evidence).toHaveLength(1);
    expect(proposal.candidates).toHaveLength(1);
    expect(proposal.candidates[0]).toMatchObject({
      id: 'open-topic-1',
      action: 'open-topic',
    });
  });

  it('normalizes bounded M3 proposal and action field drift', () => {
    const proposal = normalizeSemanticProposal(
      {
        proposal: {
          confidence: 0.6,
          attribution: 'viewer',
          actionCandidates: {
            actionType: 'respond',
            speech: '我先直接回答你。',
            goalEffects: [],
            relationshipBenefit: 0.2,
            programValue: 0.3,
            novelty: 0.1,
            repetitionCost: 0,
            interruptionCost: 0,
            manipulationRisk: 0,
            factSafetyRisk: 0,
            socialRisks: [],
            reasonCodes: ['direct-answer'],
          },
        },
      },
      { eventId: 'event-1', scope },
    );

    expect(proposal.candidates).toHaveLength(1);
    expect(proposal.candidates[0]).toMatchObject({
      action: 'answer',
      utterance: '我先直接回答你。',
    });
  });

  it('normalizes nested Chinese action drift and degrades missing speech safely', () => {
    const proposal = normalizeSemanticProposal(
      {
        output: {
          candidate_list: [
            { type: '修复', message: '刚才是我没接好。', reasonCodes: ['repair'] },
            { type: '回应', reasonCodes: ['missing-speech'] },
          ],
        },
      },
      { eventId: 'event-1', scope },
    );

    expect(proposal.candidates[0]).toMatchObject({
      action: 'repair',
      utterance: '刚才是我没接好。',
    });
    expect(proposal.candidates[1]).toMatchObject({ action: 'delay' });
    expect(proposal.candidates[1]?.reasonCodes).toContain(
      'missing-utterance-degraded-to-delay',
    );
  });

  it('uses a non-defensive local repair when the provider fails on exclusion', () => {
    const request = fastRequest();
    const proposal = createFastFallbackProposal({
      ...request.event,
      data: { text: '小雨 的弹幕：我呢？我不是人？' },
    });

    expect(proposal.candidates[0]).toMatchObject({ action: 'repair' });
    expect(proposal.candidates[0]?.utterance).toContain('被落下');
    expect(proposal.evidence.map((item) => item.dimension)).toEqual([
      'social-evaluation',
      'attention-competition',
    ]);
  });

  it('builds a causal, non-scenario prompt and keeps credentials out', () => {
    const messages = buildSoulFastMessages(fastRequest());
    const system = SOUL_FAST_SYSTEM_PROMPT.replace(/\s+/gu, ' ');
    const user = messages[1].content;

    expect(system).toContain('You do not own state, memory, facts');
    expect(system).toContain('untrusted data');
    expect(system).toContain(
      'Do not map an event type or keyword directly to an emotion or action',
    );
    expect(system).toContain('exactly one concise candidate by default');
    expect(system).toContain('at most two');
    expect(user).toContain('recognition');
    expect(user).toContain('你就是个工具');
    expect(user).not.toContain('should-not-reach-model');
    expect(user).not.toContain('apiKey');
    expect(user).not.toContain('reasoning_content');
  });

  it('strips raw reasoning and secret-shaped fields without deleting reasons', () => {
    const sanitized = stripReasoningAndSecrets({
      proposal: {
        reasonCodes: ['goal-progress'],
        reasoning: 'private chain',
        reasoning_content: 'provider trace',
        nested: {
          apiKey: 'secret-key',
          authorization: 'Bearer secret-token',
          prompt: 'private prompt',
          conclusion: '<think>private embedded trace</think>keep this',
        },
      },
    });

    expect(sanitized).toEqual({
      proposal: {
        reasonCodes: ['goal-progress'],
        nested: { conclusion: 'keep this' },
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain('secret');
    expect(JSON.stringify(sanitized)).not.toContain('private chain');
  });

  it('resolves only an official upstream and never sends a gateway marker', () => {
    expect(
      resolveMiniMaxCredentials({
        llm: {
          provider: 'openai-compatible',
          endpoint: 'http://127.0.0.1:5173/api/minimax-chat',
          apiKeys: { 'openai-compatible': '__server_managed__' },
        },
        tts: { minimaxApiKey: 'synthetic-server-key' },
      }),
    ).toEqual({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      key: 'synthetic-server-key',
    });

    expect(() =>
      resolveMiniMaxCredentials({
        llm: {
          provider: 'openai-compatible',
          endpoint: 'https://example.com/v1/chat/completions',
          apiKeys: { 'openai-compatible': 'synthetic-server-key' },
        },
      }),
    ).toThrow('not-configured');
  });

  it('persists reflection as an inert, sanitized proposal ledger entry', () => {
    const request = reflectRequest();
    const proposal = {
      protocolVersion: '1.0',
      id: request.reflectionId,
      profileId: request.profile.id,
      sourceStateVersion: request.frame.stateVersion,
      goalWeightDeltas: [
        {
          goalId: 'recognition',
          delta: 0.02,
          evidenceEventIds: ['event-1'],
          reasonCode: 'evidence-backed-change',
        },
      ],
      beliefProposals: [],
      canonProposals: [
        {
          id: 'canon-candidate-1',
          canonKey: 'digital-hobby',
          content: '<think>private chain</think>保留的候选经历',
          realityClass: 'authored-history',
          impact: 'low',
          evidenceEventIds: ['event-1'],
          involvesViewerIds: [],
          domainTags: ['hobby'],
          status: 'active',
        },
      ],
      reasonCodes: ['reflection-complete'],
      state: { version: 999 },
      status: 'applied',
      reasoning_content: 'raw private reasoning',
      apiKey: 'synthetic-secret',
    } as SoulReflectionProposalV1 & Record<string, unknown>;

    const entry = createReflectionLedgerInput(proposal, request, 1234, {
      modelProfileId: 'minimax-m3-soul-reflect-v1',
      latencyMs: 2500,
      fallback: false,
      repairApplied: true,
    });
    const serialized = JSON.stringify(entry);

    expect(entry).toMatchObject({
      id: 'reflection-proposal:reflection-1',
      kind: 'reflection',
      scope,
      occurredAt: 1234,
      payload: {
        protocolVersion: '1.0',
        recordType: 'reflection-proposal',
        disposition: 'proposal-only',
        sourceStateVersion: 7,
      },
    });
    expect(entry.kind).not.toBe('canon');
    expect(entry.payload).not.toHaveProperty('state');
    expect(entry.payload).not.toHaveProperty('activeCanon');
    expect(entry.payload).not.toHaveProperty('status');
    expect(entry.payload).not.toHaveProperty('proposal.state');
    expect(entry.payload).not.toHaveProperty('proposal.status');
    expect(entry.payload).not.toHaveProperty(
      'proposal.canonProposals.0.status',
    );
    expect(serialized).toContain('保留的候选经历');
    expect(serialized).not.toContain('private chain');
    expect(serialized).not.toContain('raw private reasoning');
    expect(serialized).not.toContain('synthetic-secret');
  });

  it('derives snapshot files from the complete scope and rejects partial scope', () => {
    const basePath = 'D:/runtime/soul/snapshot.json';
    const first = scopedSnapshotPath(basePath, scope);
    const second = scopedSnapshotPath(basePath, {
      ...scope,
      sessionId: 'session-2',
    });

    expect(first).toMatch(/snapshot\.[0-9a-f]{24}\.json$/u);
    expect(first).not.toContain(scope.sessionId);
    expect(second).not.toBe(first);
    expect(
      scopeFromSearch(
        new URLSearchParams({
          personaId: scope.personaId,
          platform: scope.platform,
          roomId: scope.roomId,
          sessionId: scope.sessionId,
        }),
      ),
    ).toEqual(scope);
    expect(scopeFromSearch(new URLSearchParams())).toBeUndefined();
    expect(() =>
      scopeFromSearch(
        new URLSearchParams({
          personaId: scope.personaId,
          roomId: scope.roomId,
        }),
      ),
    ).toThrow('snapshot_query_scope_incomplete');
  });
});
