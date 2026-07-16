import { describe, expect, it } from 'vitest';
import {
  GOLDEN_SCENARIOS,
  createAcceptanceLedger,
  hasSoulPrimaryEvidence,
  recordAcceptanceResult,
  selectAcceptanceScenarios,
} from '../examples/react-purupuru-app/src/lib/acceptanceLedger';

describe('acceptance ledger', () => {
  it('reruns only passed scenarios affected by changed tags', () => {
    let ledger = createAcceptanceLedger();
    for (const scenario of GOLDEN_SCENARIOS) {
      ledger = recordAcceptanceResult(ledger, {
        scenarioId: scenario.id,
        status: 'passed',
        reasonCode: 'verified',
        completedAt: 1,
        tags: scenario.tags,
        subsystems: [],
      });
    }
    const selected = selectAcceptanceScenarios(ledger, ['speech']);
    expect(selected.map((scenario) => scenario.id)).toEqual([
      'proactive-interrupted',
      'answer-gift-message',
      'fault-recovery',
      'soul-delivery-commit',
    ]);
  });

  it('always runs the complete golden suite for a release candidate', () => {
    expect(
      selectAcceptanceScenarios(createAcceptanceLedger(), [], true),
    ).toHaveLength(GOLDEN_SCENARIOS.length);
  });

  it('invalidates prior passes when any artifact fingerprint changes', () => {
    const fingerprint = {
      codeHash: 'code-a',
      modelHash: 'model-a',
      promptHash: 'prompt-a',
      profileHash: 'profile-a',
      configHash: 'config-a',
    };
    let ledger = createAcceptanceLedger();
    for (const scenario of GOLDEN_SCENARIOS) {
      ledger = recordAcceptanceResult(ledger, {
        scenarioId: scenario.id,
        status: 'passed',
        reasonCode: 'verified',
        completedAt: 1,
        tags: scenario.tags,
        subsystems: [],
        evidenceLevel: 'synthetic',
        fingerprint,
      });
    }
    expect(selectAcceptanceScenarios(ledger, [], false, fingerprint)).toEqual(
      [],
    );
    expect(
      selectAcceptanceScenarios(ledger, [], false, {
        ...fingerprint,
        promptHash: 'prompt-b',
      }),
    ).toHaveLength(GOLDEN_SCENARIOS.length);
  });

  it('requires two distinct two-hour production canaries for primary mode', () => {
    const fingerprint = {
      codeHash: 'code-a',
      modelHash: 'model-a',
      promptHash: 'prompt-a',
      profileHash: 'profile-a',
      configHash: 'config-a',
    };
    let ledger = createAcceptanceLedger();
    for (const [index, sessionId] of ['canary-a', 'canary-b'].entries()) {
      const startedAt = 1_000 + index * 10_000_000;
      const durationMs = 2 * 60 * 60_000;
      ledger = recordAcceptanceResult(ledger, {
        scenarioId: `soul-production-canary:server-run-${index}`,
        status: 'passed',
        reasonCode: 'server-attested-stable-two-hour-live-canary',
        completedAt: startedAt + durationMs,
        tags: ['soul', 'recovery', 'speech'],
        subsystems: ['soul-runtime'],
        evidenceLevel: 'production',
        fingerprint,
        evidence: {
          sessionId,
          durationMs,
          startedAt,
          endedAt: startedAt + durationMs,
          productionDecisionCount: 10,
          spokenOutcomeCount: 5,
          serverAttested: true,
          attestationVersion: 1,
        },
      });
      expect(hasSoulPrimaryEvidence(ledger, fingerprint)).toBe(index === 1);
    }
    expect(hasSoulPrimaryEvidence(ledger)).toBe(false);
    expect(
      hasSoulPrimaryEvidence(ledger, { ...fingerprint, promptHash: 'changed' }),
    ).toBe(false);
  });
});
