import { describe, expect, it } from 'vitest';
import { projectStressRunState } from '../../examples/react-purupuru-app/src/lib/stressRunProjection';
import type { OperatorQueueItem } from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function item(
  eventId: string,
  status: OperatorQueueItem['status'],
): OperatorQueueItem {
  return {
    eventId,
    attemptId: `${eventId}:attempt:1`,
    turnVersion: 2,
    text: eventId,
    source: 'stress-test',
    sourcesSeen: ['stress-test'],
    createdAt: 1,
    updatedAt: 1,
    order: 0,
    status,
    skills: [],
    testRunId: 'run-1',
  };
}

describe('stress run projection', () => {
  it('projects transport data and queue evidence into one control-room state', () => {
    const result = projectStressRunState(
      {
        lifecycle: 'running',
        runId: 'run-1',
        terminalCount: 2,
        messageCount: 5,
        currentBroadcast: { eventId: 'ready-1', viewerName: 'Alice', stepId: 's2' },
        viewers: [
          {
            viewerId: 'v1',
            viewerName: 'Alice',
            currentStepId: 's2',
            terminal: 2,
            quota: 5,
          },
        ],
        diagnostics: {
          checks: [
            { level: 'error', code: 'tts_missing', summary: 'TTS unavailable' },
          ],
        },
      },
      [item('pending-1', 'pending'), { ...item('ready-1', 'ready'), preparedReply: 'hello' }],
      20_000,
    );

    expect(result).toMatchObject({
      status: 'running',
      runId: 'run-1',
      completedSteps: 2,
      totalSteps: 5,
      queue: { waiting: 1, drafting: 0, ready: 1, speaking: 0 },
      currentPlayback: { viewerName: 'Alice', stepId: 's2', text: 'hello' },
      viewers: [
        {
          id: 'v1',
          name: 'Alice',
          status: '当前 s2',
          completedSteps: 2,
          totalSteps: 5,
        },
      ],
      diagnostics: [
        {
          id: 'diagnostic-0',
          level: 'error',
          code: 'tts_missing',
          summary: 'TTS unavailable',
        },
      ],
    });
  });

  it('does not report a completed run as passed without hard-pass evidence', () => {
    expect(
      projectStressRunState(
        { lifecycle: 'completed', hardPass: false, messageCount: 1 },
        [],
        1,
      ).status,
    ).toBe('failed');
  });
});
