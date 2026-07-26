import { describe, expect, it } from 'vitest';
import type { OperatorAttentionLedger } from '../../examples/react-purupuru-app/src/lib/operatorAttentionLedger';
import { projectLiveSessionRetrospective } from '../../examples/react-purupuru-app/src/lib/liveSessionRetrospective';

function attention(
  update: Partial<OperatorAttentionLedger['recap']> = {},
): Pick<OperatorAttentionLedger, 'recap' | 'incidents'> {
  return {
    recap: {
      sessionId: 'session-1',
      opened: 0,
      resolved: 0,
      active: 0,
      actions: 0,
      failedActions: 0,
      averageResolutionMs: null,
      ...update,
    },
    incidents: [],
  };
}

const session = {
  sessionId: 'session-1',
  sequence: 3,
  startedAt: new Date('2026-07-23T10:00:00+08:00').getTime(),
  endedAt: new Date('2026-07-23T11:30:00+08:00').getTime(),
};

describe('live session retrospective', () => {
  it('projects a clean session without penalizing editorial skips', () => {
    const report = projectLiveSessionRetrospective({
      session,
      queue: {
        total: 12,
        active: 0,
        done: 9,
        skipped: 3,
        failed: 0,
        archived: 0,
      },
      attention: attention(),
      scope: { platform: 'bilibili', roomId: '1001' },
    });

    expect(report).toMatchObject({
      status: 'excellent',
      score: 100,
      title: '稳定闭环',
      metrics: {
        durationMs: 90 * 60_000,
        responded: 9,
        skipped: 3,
        failed: 0,
      },
    });
    expect(report.findings.map(({ id }) => id)).toEqual([
      'queue-clean',
      'attention-clear',
    ]);
  });

  it('degrades transparently for queue failures and unresolved attention', () => {
    const report = projectLiveSessionRetrospective({
      session,
      queue: {
        total: 10,
        active: 0,
        done: 5,
        skipped: 2,
        failed: 3,
        archived: 0,
      },
      attention: attention({
        opened: 3,
        resolved: 1,
        active: 2,
        actions: 3,
        failedActions: 1,
      }),
      scope: { platform: 'douyin', roomId: 'room-a' },
    });

    expect(report.status).toBe('critical');
    expect(report.score).toBe(48);
    expect(report.findings.map(({ id, tone }) => [id, tone])).toEqual([
      ['queue-failures', 'critical'],
      ['attention-unresolved', 'critical'],
      ['action-failures', 'warning'],
    ]);
  });

  it('handles an empty session without divisions or invented failures', () => {
    const report = projectLiveSessionRetrospective({
      session: { ...session, endedAt: session.startedAt },
      queue: {
        total: 0,
        active: 0,
        done: 0,
        skipped: 0,
        failed: 0,
        archived: 0,
      },
      attention: attention(),
      scope: { platform: 'local', roomId: 'empty' },
    });

    expect(report.score).toBe(100);
    expect(report.metrics.durationMs).toBe(0);
    expect(report.findings).toEqual([
      expect.objectContaining({ id: 'attention-clear' }),
    ]);
  });

  it('renders a portable markdown report with incident evidence', () => {
    const report = projectLiveSessionRetrospective({
      session,
      queue: {
        total: 4,
        active: 0,
        done: 3,
        skipped: 0,
        failed: 0,
        archived: 1,
      },
      attention: {
        ...attention({
          opened: 1,
          resolved: 1,
          actions: 1,
          averageResolutionMs: 120_000,
        }),
        incidents: [
          {
            attentionId: 'runtime-owner',
            title: '执行端失联',
            domain: 'runtime',
            severity: 'blocker',
            openedAt: session.startedAt + 60_000,
            resolvedAt: session.startedAt + 180_000,
            actions: [
              {
                action: 'restart-runtime',
                status: 'completed',
                at: session.startedAt + 120_000,
              },
            ],
          },
        ],
      },
      scope: { platform: 'bilibili', roomId: '1001' },
    });

    expect(report.markdown).toContain('# 第 3 场直播复盘');
    expect(report.markdown).toContain('bilibili / 1001');
    expect(report.markdown).toContain('执行端失联');
    expect(report.markdown).toContain('处理动作 1 次');
    expect(report.findings.map(({ id }) => id)).toContain('queue-archived');
  });
});
