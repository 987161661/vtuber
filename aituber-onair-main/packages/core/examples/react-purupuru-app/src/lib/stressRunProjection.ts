import type { StressRunState } from '../components/StressTestPanel';
import type { OperatorQueueItem } from './operatorQueue';
import { STRESS_TEST_PLAN } from './stressTestPlan';

export type StressApiRecord = Record<string, unknown>;

export function parseStressDiagnostics(
  value: unknown,
): StressRunState['diagnostics'] {
  if (!value || typeof value !== 'object') return undefined;
  const checks = (value as StressApiRecord).checks;
  if (!Array.isArray(checks)) return undefined;
  return checks.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const check = raw as StressApiRecord;
    const level = check.level;
    if (level !== 'pass' && level !== 'warning' && level !== 'error') return [];
    return [
      {
        id: typeof check.id === 'string' ? check.id : `diagnostic-${index}`,
        level,
        code:
          typeof check.code === 'string' ? check.code : 'unknown_diagnostic',
        summary:
          typeof check.summary === 'string'
            ? check.summary
            : 'No diagnostic summary.',
        detail: typeof check.detail === 'string' ? check.detail : undefined,
      },
    ];
  });
}

export function projectStressRunState(
  raw: StressApiRecord,
  operatorQueue: readonly OperatorQueueItem[],
  now = Date.now(),
): StressRunState {
  const testItems = operatorQueue.filter(
    (item) =>
      item.testRunId === raw.runId ||
      (raw.lifecycle === 'idle' && item.testRunId),
  );
  const status: StressRunState['status'] =
    raw.cleanupState === 'running'
      ? 'cleaning'
      : raw.lifecycle === 'completed' && raw.hardPass !== true
        ? 'failed'
        : raw.lifecycle === 'running' ||
            raw.lifecycle === 'paused' ||
            raw.lifecycle === 'completed' ||
            raw.lifecycle === 'aborted' ||
            raw.lifecycle === 'failed'
          ? raw.lifecycle
          : raw.lifecycle === 'aborting'
            ? 'paused'
            : testItems.length > 0
              ? 'failed'
              : 'idle';

  return {
    status,
    runId:
      typeof raw.runId === 'string' ? raw.runId : testItems[0]?.testRunId,
    completedSteps: Number(raw.terminalCount || 0),
    totalSteps: Number(raw.messageCount || STRESS_TEST_PLAN.messageCount),
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
    etaMs:
      typeof raw.estimatedRemainingMs === 'number'
        ? raw.estimatedRemainingMs
        : undefined,
    reportPath:
      typeof raw.reportDirectory === 'string'
        ? raw.reportDirectory
        : undefined,
    phase: typeof raw.phaseLabel === 'string' ? raw.phaseLabel : undefined,
    viewers: Array.isArray(raw.viewers)
      ? raw.viewers.map((value) => {
          const viewer = value as StressApiRecord;
          return {
            id: String(viewer.viewerId || ''),
            name: String(viewer.viewerName || ''),
            role: String(viewer.viewerId || ''),
            status: viewer.currentStepId
              ? `当前 ${viewer.currentStepId}`
              : '等待',
            completedSteps: Number(viewer.terminal || 0),
            totalSteps: Number(viewer.quota || 0),
            currentStep:
              typeof viewer.currentStepId === 'string'
                ? viewer.currentStepId
                : undefined,
          };
        })
      : [],
    queue: {
      waiting: testItems.filter((item) => item.status === 'pending').length,
      drafting: testItems.filter((item) => item.status === 'preparing').length,
      ready: testItems.filter((item) => item.status === 'ready').length,
      speaking: testItems.filter((item) => item.status === 'speaking').length,
    },
    currentPlayback:
      raw.currentBroadcast && typeof raw.currentBroadcast === 'object'
        ? {
            viewerName: String(
              (raw.currentBroadcast as StressApiRecord).viewerName || '',
            ),
            stepId: String(
              (raw.currentBroadcast as StressApiRecord).stepId || '',
            ),
            text: testItems.find(
              (item) =>
                item.eventId ===
                (raw.currentBroadcast as StressApiRecord).eventId,
            )?.preparedReply,
          }
        : undefined,
    failures: Array.isArray(raw.failures)
      ? raw.failures.map((value, index: number) => {
          const failure = value as StressApiRecord;
          return {
            id: `${failure.code || 'failure'}-${failure.at || index}`,
            code: typeof failure.code === 'string' ? failure.code : undefined,
            stepId:
              typeof failure.stepId === 'string' ? failure.stepId : undefined,
            message: String(
              failure.message || failure.code || 'unknown failure',
            ),
            at: Number(failure.at || now),
            diagnostic:
              failure.diagnostic && typeof failure.diagnostic === 'object'
                ? (failure.diagnostic as StressRunState['failures'][number]['diagnostic'])
                : undefined,
          };
        })
      : [],
    diagnostics: parseStressDiagnostics(raw.diagnostics),
  };
}
