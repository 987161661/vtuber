import { describe, expect, it } from 'vitest';
import type { OperatorAttentionItem } from '../../examples/react-purupuru-app/src/lib/operatorAttention';
import {
  createOperatorAttentionActionEvent,
  mergeOperatorAttentionRuntimeEvents,
  projectOperatorAttentionLedger,
  type OperatorAttentionRuntimeEvent,
} from '../../examples/react-purupuru-app/src/lib/operatorAttentionLedger';

const runtimeItem: OperatorAttentionItem = {
  id: 'runtime-owner',
  domain: 'runtime',
  severity: 'blocker',
  title: '执行端未接管',
  detail: '需要重建运行时',
  action: 'restart-runtime',
  actionLabel: '重建运行时',
  source: 'recovery',
};

function opened(
  at: number,
  sessionId = 'session-1',
): OperatorAttentionRuntimeEvent {
  return {
    stage: 'operator_attention_opened',
    at,
    sessionId,
    attentionId: runtimeItem.id,
    attentionTitle: runtimeItem.title,
    attentionDomain: runtimeItem.domain,
    attentionSeverity: runtimeItem.severity,
  };
}

describe('operator attention ledger', () => {
  it('opens a current incident once and does not duplicate a persisted episode', () => {
    const first = projectOperatorAttentionLedger({
      events: [],
      sessionId: 'session-1',
      currentItems: [runtimeItem],
      now: 100,
    });
    const persisted = projectOperatorAttentionLedger({
      events: first.transitions,
      sessionId: 'session-1',
      currentItems: [runtimeItem],
      now: 200,
    });

    expect(first.transitions).toEqual([
      expect.objectContaining({
        stage: 'operator_attention_opened',
        attentionId: 'runtime-owner',
        sessionId: 'session-1',
        at: 100,
      }),
    ]);
    expect(persisted.incidents).toHaveLength(1);
    expect(persisted.active).toHaveLength(1);
    expect(persisted.transitions).toEqual([]);
  });

  it('resolves an incident only when it leaves the current attention set', () => {
    const projected = projectOperatorAttentionLedger({
      events: [opened(100)],
      sessionId: 'session-1',
      currentItems: [],
      now: 350,
    });
    const resolved = projectOperatorAttentionLedger({
      events: [...projected.transitions, opened(100)],
      sessionId: 'session-1',
    });

    expect(projected.transitions).toEqual([
      expect.objectContaining({
        stage: 'operator_attention_resolved',
        attentionId: 'runtime-owner',
        at: 350,
      }),
    ]);
    expect(resolved.recap).toMatchObject({
      opened: 1,
      resolved: 1,
      active: 0,
      averageResolutionMs: 250,
    });
  });

  it('keeps action evidence separate from actual recovery', () => {
    const started = createOperatorAttentionActionEvent({
      stage: 'operator_attention_action_started',
      sessionId: 'session-1',
      item: runtimeItem,
      action: 'restart-runtime',
      at: 150,
    });
    const failed = createOperatorAttentionActionEvent({
      stage: 'operator_attention_action_failed',
      sessionId: 'session-1',
      item: runtimeItem,
      action: 'restart-runtime',
      at: 180,
      error: 'runtime unavailable',
    });
    const ledger = projectOperatorAttentionLedger({
      events: [opened(100), started, failed],
      sessionId: 'session-1',
      currentItems: [runtimeItem],
      now: 200,
    });

    expect(ledger.active).toHaveLength(1);
    expect(ledger.active[0].actions).toEqual([
      expect.objectContaining({ status: 'started', at: 150 }),
      expect.objectContaining({
        status: 'failed',
        at: 180,
        error: 'runtime unavailable',
      }),
    ]);
    expect(ledger.recap).toMatchObject({
      resolved: 0,
      actions: 1,
      failedActions: 1,
    });
    expect(ledger.transitions).toEqual([]);
  });

  it('isolates recaps by live session and orders recent incidents deterministically', () => {
    const events: OperatorAttentionRuntimeEvent[] = [
      opened(100, 'session-1'),
      {
        ...opened(200, 'session-2'),
        attentionId: 'commitments',
        attentionTitle: '承诺待跟进',
        attentionDomain: 'commitment',
        attentionSeverity: 'warning',
      },
      {
        stage: 'operator_attention_resolved',
        at: 260,
        sessionId: 'session-2',
        attentionId: 'commitments',
      },
    ];

    const previous = projectOperatorAttentionLedger({
      events,
      sessionId: 'session-1',
    });
    const current = projectOperatorAttentionLedger({
      events,
      sessionId: 'session-2',
    });

    expect(previous.recap).toMatchObject({ opened: 1, active: 1 });
    expect(current.recap).toMatchObject({ opened: 1, resolved: 1, active: 0 });
    expect(current.recent.map(({ attentionId }) => attentionId)).toEqual([
      'commitments',
    ]);
  });

  it('keeps fresh optimistic evidence until the server history confirms it', () => {
    const remote = [opened(100)];
    const optimistic = createOperatorAttentionActionEvent({
      stage: 'operator_attention_action_completed',
      sessionId: 'session-1',
      item: runtimeItem,
      action: 'restart-runtime',
      at: 190,
    });

    expect(
      mergeOperatorAttentionRuntimeEvents({
        remote,
        local: [optimistic],
        now: 200,
      }),
    ).toHaveLength(2);
    expect(
      mergeOperatorAttentionRuntimeEvents({
        remote: [...remote, optimistic],
        local: [optimistic],
        now: 200,
      }),
    ).toHaveLength(2);
    expect(
      mergeOperatorAttentionRuntimeEvents({
        remote,
        local: [optimistic],
        now: 20_000,
      }),
    ).toEqual(remote);
  });
});
