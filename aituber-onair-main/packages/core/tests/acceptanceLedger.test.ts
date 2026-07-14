import { describe, expect, it } from 'vitest';
import {
  GOLDEN_SCENARIOS,
  createAcceptanceLedger,
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
    ]);
  });

  it('always runs the complete golden suite for a release candidate', () => {
    expect(
      selectAcceptanceScenarios(createAcceptanceLedger(), [], true),
    ).toHaveLength(10);
  });
});
