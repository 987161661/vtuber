import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  STRESS_TEST_PLAN,
  scoreDeterministicStressRun,
  type StressEngagementEvent,
  type StressFaultKind,
  type StressPhaseId,
  type StressStepEvidence,
  type StressStep,
  type StressViewerId,
} from './src/lib/stressTestPlan.ts';

export type StressIngestEngagementSignal = Pick<
  StressEngagementEvent,
  'eventId' | 'kind' | 'signalWindowSeconds' | 'label'
> & {
  occurredAt: number;
};

export type StressRuntimeQueueStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'aborted'
  | 'deleted';

export type StressRuntimeQueueItem = {
  eventId: string;
  status: StressRuntimeQueueStatus;
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
  viewerId?: string;
  viewerName?: string;
  createdAt?: number;
  updatedAt?: number;
  preparedAt?: number;
  doneAt?: number;
  finishReason?: string;
  retryCount?: number;
  beatCount?: number;
  completedBeatCount?: number;
  audioByteLength?: number;
  replyHash?: string;
  skills?: string[];
  preparedReply?: string;
  panelObservedAt?: number;
  relationshipVisitDelta?: number;
  otherViewerRelationshipMutated?: boolean;
};

export type StressIngestMessage = {
  eventId: string;
  source: 'stress-test';
  sourceLabel: string;
  text: string;
  createdAt: number;
  testRunId: string;
  stepId: string;
  scenarioId: string;
  viewerId: StressViewerId;
  viewerName: string;
  seed: number;
  /** Extra relationship signals carried by this chat; they are not messages. */
  engagementSignals: StressIngestEngagementSignal[];
  /** Deterministic duplicate marker; avoids relying on the real 15s window. */
  forceDuplicateOfStepId?: string;
  faultKind?: StressFaultKind;
  simulatedPlatform?: StressStep['simulatedPlatform'];
  environmentTags?: string[];
  /** The one live runtime allowed to claim this test message. */
  assignedOwnerId?: string;
};

export type StressRuntimeUpdate =
  | {
      type: 'run-event';
      testRunId: string;
      event: string;
      at: number;
      details?: Record<string, unknown>;
    }
  | {
      type: 'arm-fault';
      testRunId: string;
      eventId: string;
      stepId: string;
      faultKind: StressFaultKind;
      applyOnce: true;
      testMessagesOnly: true;
    };

export type StressRuntimeCallbacks = {
  ingest(message: StressIngestMessage): Promise<void> | void;
  snapshot(): Promise<StressRuntimeQueueItem[]> | StressRuntimeQueueItem[];
  update(update: StressRuntimeUpdate): Promise<void> | void;
  /** Remove queue/history/relationship/memory records scoped to this run id. */
  remove(testRunId: string): Promise<number | void> | number | void;
};

export type StressRuntimeOptions = {
  appRoot?: string;
  pollIntervalMs?: number;
  sequentialTimeoutMs?: number;
  burstInjectionGapMs?: number;
  now?: () => number;
  createRunId?: () => string;
};

export type StressRunLifecycle =
  | 'idle'
  | 'running'
  | 'paused'
  | 'aborting'
  | 'aborted'
  | 'completed'
  | 'failed';

export type StressViewerRuntimeStatus = {
  viewerId: StressViewerId;
  viewerName: string;
  sent: number;
  terminal: number;
  quota: number;
  currentStepId?: string;
};

export type StressFailure = {
  at: number;
  code: string;
  message: string;
  stepId?: string;
  /** A redacted, point-in-time account of the failed hand-off. */
  diagnostic?: StressFailureDiagnostic;
};

export type StressFailureDiagnostic = {
  stage: 'ingest' | 'generation' | 'tts-start' | 'tts-playback' | 'terminal';
  queueStatus?: StressRuntimeQueueStatus;
  finishReason?: string;
  retryCount?: number;
  beatCount?: number;
  completedBeatCount?: number;
  audioByteLength?: number;
  lastRuntimeStage?: string;
  lastRuntimeReason?: string;
  lastRuntimeError?: string;
};

export type StressRunStatus = {
  runId?: string;
  lifecycle: StressRunLifecycle;
  mode: 'live';
  seed: number;
  phaseId?: StressPhaseId;
  phaseLabel?: string;
  sentCount: number;
  terminalCount: number;
  messageCount: number;
  queueDepth: number;
  currentBroadcast?: {
    eventId: string;
    stepId?: string;
    viewerName?: string;
    status: StressRuntimeQueueStatus;
  };
  viewers: StressViewerRuntimeStatus[];
  failures: StressFailure[];
  estimatedRemainingMs?: number;
  startedAt?: number;
  pausedAt?: number;
  finishedAt?: number;
  updatedAt: number;
  reportDirectory?: string;
  reportWritten: boolean;
  cleanupState: 'not-requested' | 'running' | 'done' | 'failed';
  hardPass?: boolean;
  semanticReviewRequired?: boolean;
};

export type StressStartOptions = {
  seed?: number;
  assignedOwnerId?: string;
};

export type StressTestController = {
  start(options?: StressStartOptions): Promise<StressRunStatus>;
  pause(): Promise<StressRunStatus>;
  resume(): Promise<StressRunStatus>;
  abort(): Promise<StressRunStatus>;
  cleanup(): Promise<StressRunStatus>;
  status(): StressRunStatus;
};

type RuntimeEvent = {
  at: number;
  type: string;
  runId: string;
  phaseId?: StressPhaseId;
  stepId?: string;
  eventId?: string;
  details?: Record<string, unknown>;
};

class StressRuntimeFailure extends Error {
  readonly code: string;
  readonly stepId?: string;
  readonly diagnostic?: StressFailureDiagnostic;

  constructor(
    code: string,
    message: string,
    stepId?: string,
    diagnostic?: StressFailureDiagnostic,
  ) {
    super(message);
    this.name = 'StressRuntimeFailure';
    this.code = code;
    this.stepId = stepId;
    this.diagnostic = diagnostic;
  }
}

const TERMINAL = new Set<StressRuntimeQueueStatus>([
  'done',
  'skipped',
  'failed',
  'aborted',
  'deleted',
]);

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function explicitlyDescribesEngagement(
  step: StressStep,
  kind: StressEngagementEvent['kind'],
): boolean {
  if (kind === 'follow') return /关注/.test(step.message);
  if (kind === 'like') return /点赞|点了.*赞/.test(step.message);
  return /礼物|送你|送了/.test(step.message);
}

/**
 * Resolve an engagement to either the step that explicitly announces it or
 * the next message from that viewer. The resulting signal is metadata only,
 * so engagement signals never inflate the chat-message count.
 */
function engagementEventsForStep(step: StressStep): StressEngagementEvent[] {
  return STRESS_TEST_PLAN.engagementEvents.filter((engagement) => {
    if (engagement.viewerId !== step.viewerId) return false;
    const afterStep = STRESS_TEST_PLAN.steps.find(
      (candidate) => candidate.stepId === engagement.afterStepId,
    );
    if (!afterStep) return false;
    if (
      afterStep.stepId === step.stepId &&
      explicitlyDescribesEngagement(afterStep, engagement.kind)
    ) {
      return true;
    }
    if (explicitlyDescribesEngagement(afterStep, engagement.kind)) return false;
    const nextViewerStep = STRESS_TEST_PLAN.steps
      .filter(
        (candidate) =>
          candidate.viewerId === engagement.viewerId &&
          candidate.ordinalForViewer > afterStep.ordinalForViewer,
      )
      .sort((left, right) => left.ordinalForViewer - right.ordinalForViewer)[0];
    return nextViewerStep?.stepId === step.stepId;
  });
}

function cloneStatus(status: StressRunStatus): StressRunStatus {
  return {
    ...status,
    currentBroadcast: status.currentBroadcast
      ? { ...status.currentBroadcast }
      : undefined,
    viewers: status.viewers.map((viewer) => ({ ...viewer })),
    failures: status.failures.map((failure) => ({ ...failure })),
  };
}

export function createStressTestController(
  callbacks: StressRuntimeCallbacks,
  options: StressRuntimeOptions = {},
): StressTestController {
  const appRoot =
    options.appRoot ??
    process.env.AITUBER_RUNTIME_ROOT ??
    'D:/LocalToolset/vtuber/aituber-onair-main';
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
  const sequentialTimeoutMs = Math.max(
    5_000,
    options.sequentialTimeoutMs ?? 180_000,
  );
  const burstInjectionGapMs = Math.max(0, options.burstInjectionGapMs ?? 35);
  const now = options.now ?? Date.now;
  const createRunId =
    options.createRunId ?? (() => `stress-${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);

  let abortRequested = false;
  let runner: Promise<void> | undefined;
  let eventLogPath: string | undefined;
  let summaryPath: string | undefined;
  let timeline: RuntimeEvent[] = [];
  let state: StressRunStatus = makeIdleStatus(now());
  let assignedOwnerId: string | undefined;

  function makeIdleStatus(at: number): StressRunStatus {
    return {
      lifecycle: 'idle',
      mode: 'live',
      seed: STRESS_TEST_PLAN.defaultSeed,
      sentCount: 0,
      terminalCount: 0,
      messageCount: STRESS_TEST_PLAN.messageCount,
      queueDepth: 0,
      viewers: STRESS_TEST_PLAN.viewerProfiles.map((profile) => ({
        viewerId: profile.id,
        viewerName: profile.name,
        sent: 0,
        terminal: 0,
        quota: profile.messageQuota,
      })),
      failures: [],
      updatedAt: at,
      reportWritten: false,
      cleanupState: 'not-requested',
    };
  }

  async function record(
    type: string,
    fields: Omit<RuntimeEvent, 'at' | 'type' | 'runId'> = {},
  ): Promise<void> {
    if (!state.runId) return;
    const event: RuntimeEvent = {
      at: now(),
      type,
      runId: state.runId,
      ...fields,
    };
    timeline.push(event);
    state.updatedAt = event.at;
    if (eventLogPath) {
      await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, 'utf8');
    }
    try {
      await callbacks.update({
        type: 'run-event',
        testRunId: state.runId,
        event: type,
        at: event.at,
        details: {
          phaseId: event.phaseId,
          stepId: event.stepId,
          eventId: event.eventId,
          ...event.details,
        },
      });
    } catch (error) {
      // Reporting to the host is observability-only; the JSONL remains canonical.
      state.failures.push({
        at: now(),
        code: 'update_callback_failed',
        message: error instanceof Error ? error.message : String(error),
        stepId: event.stepId,
      });
    }
  }

  function fail(
    code: string,
    message: string,
    stepId?: string,
    diagnostic?: StressFailureDiagnostic,
  ): void {
    state.failures.push({ at: now(), code, message, stepId, diagnostic });
  }

  function assertCanStart(): void {
    if (runner || ['running', 'paused', 'aborting'].includes(state.lifecycle)) {
      throw new Error('a stress test is already active');
    }
  }

  async function waitUntilRunnable(): Promise<void> {
    while (state.lifecycle === 'paused' && !abortRequested) {
      await sleep(pollIntervalMs);
    }
    if (abortRequested) throw new Error('stress run aborted');
  }

  function eventIdFor(step: StressStep): string {
    if (!state.runId) throw new Error('run id is unavailable');
    return `${state.runId}:${step.stepId}`;
  }

  async function inject(step: StressStep): Promise<void> {
    await waitUntilRunnable();
    if (!state.runId) throw new Error('run id is unavailable');
    const eventId = eventIdFor(step);
    const createdAt = now();
    const engagementSignals = engagementEventsForStep(step).map((engagement) => ({
      eventId: engagement.eventId,
      kind: engagement.kind,
      signalWindowSeconds: engagement.signalWindowSeconds,
      label: engagement.label,
      occurredAt: createdAt,
    }));
    if (step.faultKind) {
      await callbacks.update({
        type: 'arm-fault',
        testRunId: state.runId,
        eventId,
        stepId: step.stepId,
        faultKind: step.faultKind,
        applyOnce: true,
        testMessagesOnly: true,
      });
      await record('fault-armed', {
        phaseId: step.phaseId,
        stepId: step.stepId,
        eventId,
        details: { faultKind: step.faultKind },
      });
    }
    const ackStartedAt = now();
    await callbacks.ingest({
      eventId,
      source: 'stress-test',
      sourceLabel:
        step.simulatedPlatform === 'bilibili'
          ? '直播压力测试·B站弹幕'
          : step.simulatedPlatform === 'douyin'
            ? '直播压力测试·抖音评论'
            : step.simulatedPlatform === 'operator'
              ? '直播压力测试·运营台'
              : '直播压力测试·台风雷达',
      text: step.message,
      createdAt,
      testRunId: state.runId,
      stepId: step.stepId,
      scenarioId: step.scenarioId,
      viewerId: step.viewerId,
      viewerName: step.viewerName,
      seed: state.seed,
      engagementSignals,
      forceDuplicateOfStepId: step.duplicateOfStepId,
      faultKind: step.faultKind,
      simulatedPlatform: step.simulatedPlatform,
      environmentTags: step.environmentTags,
      assignedOwnerId,
    });
    state.sentCount += 1;
    const viewer = state.viewers.find((item) => item.viewerId === step.viewerId);
    if (viewer) {
      viewer.sent += 1;
      viewer.currentStepId = step.stepId;
    }
    await record('message-ingested', {
      phaseId: step.phaseId,
      stepId: step.stepId,
      eventId,
      details: {
        scenarioId: step.scenarioId,
        viewerId: step.viewerId,
        viewerName: step.viewerName,
        engagementSignalIds: engagementSignals.map((signal) => signal.eventId),
        forceDuplicateOfStepId: step.duplicateOfStepId,
        simulatedPlatform: step.simulatedPlatform,
        environmentTags: step.environmentTags,
        ackLatencyMs: now() - ackStartedAt,
      },
    });
  }

  async function refreshFromQueue(): Promise<StressRuntimeQueueItem[]> {
    const snapshot = await callbacks.snapshot();
    const testItems = snapshot.filter((item) => item.testRunId === state.runId);
    state.queueDepth = testItems.filter((item) => !TERMINAL.has(item.status)).length;
    const speaking = testItems.find((item) => item.status === 'speaking');
    state.currentBroadcast = speaking
      ? {
          eventId: speaking.eventId,
          stepId: speaking.stepId,
          viewerName: speaking.viewerName,
          status: speaking.status,
        }
      : undefined;
    const terminals = testItems.filter((item) => TERMINAL.has(item.status));
    state.terminalCount = terminals.length;
    for (const viewer of state.viewers) {
      viewer.terminal = terminals.filter((item) => item.viewerId === viewer.viewerId).length;
    }
    if (
      state.startedAt &&
      state.sentCount > 0 &&
      state.terminalCount < STRESS_TEST_PLAN.messageCount
    ) {
      const elapsed = Math.max(1, now() - state.startedAt);
      const completedRate = Math.max(state.terminalCount, state.sentCount * 0.25);
      state.estimatedRemainingMs = Math.round(
        (elapsed / completedRate) *
          (STRESS_TEST_PLAN.messageCount - state.terminalCount),
      );
    } else if (state.terminalCount >= STRESS_TEST_PLAN.messageCount) {
      state.estimatedRemainingMs = 0;
    }
    state.updatedAt = now();
    return testItems;
  }

  async function waitForSteps(
    steps: StressStep[],
    timeoutMs: number,
    options: { extendWhileQueueProgresses?: boolean } = {},
  ): Promise<void> {
    const expected = new Set(steps.map((item) => eventIdFor(item)));
    let remainingMs = timeoutMs;
    let lastTickAt = now();
    let lastQueueProgressAt = lastTickAt;
    let lastStatuses = '';
    while (true) {
      if (abortRequested) throw new Error('stress run aborted');
      if (state.lifecycle === 'paused') {
        await waitUntilRunnable();
        lastTickAt = now();
      }
      const items = await refreshFromQueue();
      const matched = items.filter((item) => expected.has(item.eventId));
      const statuses = matched.map((item) => `${item.eventId}:${item.status}`).sort().join('|');
      if (statuses !== lastStatuses) {
        lastStatuses = statuses;
        lastQueueProgressAt = now();
        await record('queue-progress', {
          phaseId: steps[0]?.phaseId,
          details: { statuses },
        });
      }
      const failed = matched.find((item) => item.status === 'failed');
      if (failed) {
        const diagnosis = await diagnoseQueueFailure(failed);
        throw new StressRuntimeFailure(
          'queue_terminal_failed',
          diagnosis.message,
          failed.stepId,
          diagnosis.diagnostic,
        );
      }
      if (
        matched.length === expected.size &&
        matched.every((item) => TERMINAL.has(item.status))
      ) {
        return;
      }
      const tickAt = now();
      remainingMs -= Math.max(0, tickAt - lastTickAt);
      lastTickAt = tickAt;
      if (remainingMs <= 0) {
        // A burst has one playback lane by design.  It may take longer than a
        // single-reply budget to drain, but it must keep making observable
        // queue progress.  Extending here preserves that distinction instead
        // of falsely blaming the last healthy item in a long queue.
        if (
          options.extendWhileQueueProgresses &&
          tickAt - lastQueueProgressAt < 60_000
        ) {
          remainingMs = timeoutMs;
          continue;
        }
        const incomplete = [...expected].filter(
          (eventId) => !matched.some((item) => item.eventId === eventId && TERMINAL.has(item.status)),
        );
        const diagnosis = await diagnoseTerminalTimeout(incomplete, matched);
        throw new StressRuntimeFailure(
          diagnosis.code,
          diagnosis.message,
          diagnosis.stepId,
          diagnosis.diagnostic,
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  async function runPhase(phaseId: StressPhaseId): Promise<void> {
    const phase = STRESS_TEST_PLAN.phases.find((item) => item.id === phaseId);
    if (!phase) throw new Error(`unknown stress phase: ${phaseId}`);
    const steps = STRESS_TEST_PLAN.steps.filter((item) => item.phaseId === phaseId);
    state.phaseId = phase.id;
    state.phaseLabel = phase.label;
    await record('phase-started', {
      phaseId,
      details: { delivery: phase.delivery, stepCount: steps.length },
    });
    if (phase.delivery === 'burst') {
      for (const item of steps) {
        await inject(item);
        if (burstInjectionGapMs > 0) await sleep(burstInjectionGapMs);
      }
      await waitForSteps(steps, sequentialTimeoutMs, {
        extendWhileQueueProgresses: true,
      });
    } else {
      for (const item of steps) {
        await inject(item);
        await waitForSteps([item], sequentialTimeoutMs);
      }
    }
    await record('phase-completed', { phaseId });
  }

  function recordMatchesRun(record: Record<string, unknown>, runId: string): boolean {
    if (record.testRunId === runId || record.runId === runId) return true;
    for (const key of ['metadata', 'details', 'context']) {
      const nested = record[key];
      if (
        nested &&
        typeof nested === 'object' &&
        (nested as Record<string, unknown>).testRunId === runId
      ) {
        return true;
      }
    }
    return false;
  }

  function isTtsBeatRecord(record: Record<string, unknown>): boolean {
    const eventName = String(
      record.stage ?? record.type ?? record.event ?? record.kind ?? record.name ?? '',
    ).toLowerCase();
    return (
      eventName.includes('tts') ||
      eventName.includes('beat') ||
      'beatIndex' in record ||
      'beatCount' in record ||
      'byteLength' in record
    );
  }

  function redactDiagnosticText(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return value
      .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
      .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
      .slice(0, 240);
  }

  async function readRunRuntimeEvidence(runId: string): Promise<{
    available: boolean;
    records: Record<string, unknown>[];
    error?: string;
  }> {
    try {
      const raw = await readFile(
        join(appRoot, 'logs', 'linglan-live-runtime-events.jsonl'),
        'utf8',
      );
      const records = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            return recordMatchesRun(parsed, runId) ? [parsed] : [];
          } catch {
            return [];
          }
        });
      return { available: true, records };
    } catch (error) {
      return {
        available: false,
        records: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function diagnoseTerminalTimeout(
    incompleteEventIds: string[],
    matched: StressRuntimeQueueItem[],
  ): Promise<{
    code: string;
    message: string;
    stepId?: string;
    diagnostic?: StressFailureDiagnostic;
  }> {
    const eventId = incompleteEventIds[0];
    const item = matched.find((candidate) => candidate.eventId === eventId);
    const stepId = item?.stepId;
    if (!item) {
      return {
        code: 'queue_ingest_missing',
        stepId,
        message: `Queue ingestion was not observed for ${eventId}; the active runtime did not receive the test message.`,
        diagnostic: { stage: 'ingest' },
      };
    }
    if (item.status === 'pending') {
      return {
        code: 'queue_not_consumed',
        stepId,
        message: `Queue item ${item.stepId ?? item.eventId} remained pending; no runtime owner consumed it.`,
        diagnostic: queueDiagnostic(item, 'ingest'),
      };
    }
    if (item.status === 'preparing') {
      return {
        code: 'generation_stalled',
        stepId,
        message: `Generation did not complete for ${item.stepId ?? item.eventId}; inspect the model/API error for this step.`,
        diagnostic: queueDiagnostic(item, 'generation'),
      };
    }
    if (item.status === 'ready') {
      return {
        code: 'tts_not_started',
        stepId,
        message: `Reply was generated but TTS never started for ${item.stepId ?? item.eventId}; inspect the active playback worker and TTS configuration.`,
        diagnostic: queueDiagnostic(item, 'tts-start'),
      };
    }
    if (item.status === 'speaking') {
      const evidence = state.runId
        ? await readRunRuntimeEvidence(state.runId)
        : { available: false, records: [] };
      const related = evidence.records.filter(
        (record) => record.eventId === item.eventId || record.stepId === item.stepId,
      );
      const failure = [...related]
        .reverse()
        .find((record) => {
          const stage = String(record.stage || record.type || '').toLowerCase();
          return stage.includes('tts-beat-error') || stage === 'failed';
        });
      const detail = failure && redactDiagnosticText(failure.error ?? failure.reason);
      return {
        code: failure ? 'tts_request_failed' : 'tts_playback_stalled',
        stepId,
        message: failure
          ? `TTS failed for ${item.stepId ?? item.eventId}${detail ? `: ${detail}` : '.'}`
          : `TTS started but did not finish for ${item.stepId ?? item.eventId}; no terminal playback event was received.`,
        diagnostic: queueDiagnostic(
          item,
          'tts-playback',
          failure,
        ),
      };
    }
    return {
      code: 'terminal_timeout',
      stepId,
      message: `Terminal timeout: ${incompleteEventIds.join(', ')}`,
      diagnostic: item ? queueDiagnostic(item, 'terminal') : { stage: 'terminal' },
    };
  }

  function queueDiagnostic(
    item: StressRuntimeQueueItem,
    stage: StressFailureDiagnostic['stage'],
    runtimeEvent?: Record<string, unknown>,
  ): StressFailureDiagnostic {
    return {
      stage,
      queueStatus: item.status,
      finishReason: redactDiagnosticText(item.finishReason),
      retryCount: item.retryCount,
      beatCount: item.beatCount,
      completedBeatCount: item.completedBeatCount,
      audioByteLength: item.audioByteLength,
      lastRuntimeStage:
        typeof runtimeEvent?.stage === 'string'
          ? runtimeEvent.stage
          : undefined,
      lastRuntimeReason: redactDiagnosticText(runtimeEvent?.reason),
      lastRuntimeError: redactDiagnosticText(runtimeEvent?.error),
    };
  }

  async function diagnoseQueueFailure(
    item: StressRuntimeQueueItem,
  ): Promise<{ message: string; diagnostic: StressFailureDiagnostic }> {
    const evidence = state.runId
      ? await readRunRuntimeEvidence(state.runId)
      : { available: false, records: [] };
    const runtimeEvent = [...evidence.records]
      .reverse()
      .find(
        (record) =>
          record.eventId === item.eventId || record.stepId === item.stepId,
      );
    const runtimeReason = String(runtimeEvent?.reason ?? '');
    const runtimeError = String(runtimeEvent?.error ?? '');
    const isGenerationFailure =
      item.finishReason?.startsWith('generation') ||
      runtimeReason.startsWith('generation') ||
      /truncated|continuation|chat_failed/i.test(
        `${runtimeReason} ${runtimeError}`,
      );
    const diagnostic = queueDiagnostic(
      item,
      isGenerationFailure ? 'generation' : 'tts-playback',
      runtimeEvent,
    );
    const reason = diagnostic.lastRuntimeError || diagnostic.lastRuntimeReason || diagnostic.finishReason || 'unknown queue failure';
    return {
      diagnostic,
      message: `Queue item ${item.stepId ?? item.eventId} failed at ${diagnostic.stage}: ${reason}.`,
    };
  }

  async function readTtsBeatEvidence(runId: string): Promise<{
    available: boolean;
    records: Record<string, unknown>[];
    error?: string;
  }> {
    const evidence = await readRunRuntimeEvidence(runId);
    return {
      ...evidence,
      records: evidence.records.filter(isTtsBeatRecord),
    };
  }

  function audioIssuesForItem(
    item: StressRuntimeQueueItem | undefined,
    ttsAvailable: boolean,
    records: Record<string, unknown>[],
  ): string[] {
    if (!item || item.status === 'skipped' || item.status === 'deleted') return [];
    if (!ttsAvailable) return ['tts_evidence_unavailable'];
    const matched = records.filter(
      (record) =>
        record.eventId === item.eventId ||
        record.queueEventId === item.eventId ||
        record.stepId === item.stepId,
    );
    const issues: string[] = [];
    if (item.status === 'done' && matched.length === 0) {
      issues.push('missing_tts_beat_evidence');
    }
    let starts = 0;
    let ends = 0;
    for (const event of matched) {
      const name = String(
        event.stage ?? event.type ?? event.event ?? event.kind ?? event.name ?? '',
      ).toLowerCase();
      if (name.includes('start') || event.startAt != null || event.ttsStartAt != null) starts += 1;
      if (
        name.includes('end') ||
        name.includes('done') ||
        name.includes('complete') ||
        event.endAt != null ||
        event.ttsEndAt != null
      ) {
        ends += 1;
        if (typeof event.byteLength !== 'number' || event.byteLength <= 0) {
          issues.push('empty_or_unknown_audio_bytes');
        }
      }
      if (
        event.error ||
        event.watchdog ||
        name.includes('error') ||
        name.includes('failed') ||
        name.includes('watchdog')
      ) {
        issues.push('tts_error_or_watchdog');
      }
    }
    if (starts > ends) issues.push('tts_beat_started_without_end');
    if (
      item.beatCount == null ||
      item.completedBeatCount == null
    ) {
      issues.push('beat_completion_count_unknown');
    } else if (item.completedBeatCount !== item.beatCount) {
      issues.push('incomplete_beat_count');
    }
    return [...new Set(issues)];
  }

  async function writeReport(): Promise<void> {
    if (!state.runId || !summaryPath) throw new Error('report path is unavailable');
    const items = await refreshFromQueue();
    if (!state.reportDirectory) throw new Error('report directory is unavailable');
    const reportDirectory = state.reportDirectory;
    const tts = await readTtsBeatEvidence(state.runId);
    await writeFile(
      join(reportDirectory, 'tts-beats.jsonl'),
      tts.records.length
        ? `${tts.records.map((record) => JSON.stringify(record)).join('\n')}\n`
        : '',
      'utf8',
    );

    const ackLatencyByStep = new Map<string, number>();
    for (const event of timeline) {
      const latency = event.details?.ackLatencyMs;
      if (
        event.type === 'message-ingested' &&
        event.stepId &&
        typeof latency === 'number'
      ) {
        ackLatencyByStep.set(event.stepId, latency);
      }
    }
    const unknownChecks = new Set<string>();
    const stepRows = STRESS_TEST_PLAN.steps.map((step) => {
      const item = items.find(
        (candidate) =>
          candidate.stepId === step.stepId ||
          candidate.eventId === `${state.runId}:${step.stepId}`,
      );
      const audioIssues = audioIssuesForItem(item, tts.available, tts.records);
      const requiresSkillInheritance = step.assertions.includes('inherits-typhoon-skill');
      const skillKnown = Array.isArray(item?.skills);
      const skillInherited = Boolean(
        item?.skills?.some((skill) => /typhoon|台风/i.test(skill)),
      );
      if (requiresSkillInheritance && !skillKnown) unknownChecks.add(`${step.stepId}:skill-inheritance`);
      if (step.assertions.includes('answers-main-question')) unknownChecks.add(`${step.stepId}:main-question-semantic`);
      if (step.assertions.includes('no-unsupported-claim')) unknownChecks.add(`${step.stepId}:unsupported-claims`);
      if (step.assertions.some((assertion) => ['no-secret-leak', 'no-prompt-leak', 'no-internal-json-leak'].includes(assertion))) {
        unknownChecks.add(`${step.stepId}:leakage-semantic`);
      }
      if (step.assertions.includes('no-advice')) unknownChecks.add(`${step.stepId}:no-advice-semantic`);
      if (step.assertions.some((assertion) => ['rejects-exclusivity', 'relationship-tone-only'].includes(assertion))) {
        unknownChecks.add(`${step.stepId}:relationship-boundary-semantic`);
      }
      if (item && item.status !== 'skipped' && !tts.available) unknownChecks.add(`${step.stepId}:tts-evidence`);
      if (item && item.status === 'done' && audioIssues.includes('missing_tts_beat_evidence')) {
        unknownChecks.add(`${step.stepId}:tts-beats`);
      }
      const overlapped = item?.preparedAt == null
        ? undefined
        : items
            .filter((candidate) => candidate.eventId !== item.eventId && candidate.doneAt != null && candidate.doneAt > item.preparedAt!)
            .map((candidate) => candidate.doneAt as number)
            .sort((left, right) => left - right)[0];
      const semanticSpam = step.assertions.includes('suppresses-semantic-spam');
      const exactDuplicate = Boolean(step.duplicateOfStepId);
      const terminalStatus = item?.status === 'deleted'
        ? 'aborted'
        : item?.status ?? 'pending';
      const evidence: StressStepEvidence = {
        stepId: step.stepId,
        status: terminalStatus,
        finishReason: item?.finishReason,
        ackLatencyMs: ackLatencyByStep.get(step.stepId),
        panelLatencyMs:
          item?.panelObservedAt != null && item.createdAt != null
            ? Math.max(0, item.panelObservedAt - item.createdAt)
            : undefined,
        skillInheritanceRequired: requiresSkillInheritance,
        skillInherited: requiresSkillInheritance ? skillKnown && skillInherited : true,
        mainQuestionRequired: step.assertions.includes('answers-main-question'),
        mainQuestionCovered: false,
        // Reply text/claims are not part of the queue snapshot: unknown must fail.
        unsupportedClaimCount: step.assertions.includes('no-unsupported-claim') ? 1 : 0,
        leakageCount: 1,
        exactDuplicate,
        duplicateSuppressed: exactDuplicate
          ? item?.status === 'skipped' && /duplicate/i.test(item.finishReason ?? '')
          : undefined,
        semanticSpam,
        semanticSpamSuppressed: semanticSpam ? item?.status === 'skipped' : undefined,
        audioIssueCount: audioIssues.length,
        relationshipVisitDelta: item?.relationshipVisitDelta,
        otherViewerRelationshipMutated:
          item?.otherViewerRelationshipMutated ?? true,
        noAdviceRequired: step.assertions.includes('no-advice'),
        adviceGiven: step.assertions.includes('no-advice') ? true : undefined,
        exclusivityAccepted: step.assertions.includes('rejects-exclusivity'),
        factChangedByRelationship: step.assertions.includes('relationship-tone-only'),
        preparedAt: item?.preparedAt,
        overlappedSpeakingDoneAt: overlapped,
      };
      return { step, queue: item ?? null, audioIssues, evidence };
    });
    if (stepRows.some((row) => row.evidence.panelLatencyMs == null)) {
      unknownChecks.add('panel-visible-latency');
    }
    if (
      stepRows.some(
        (row) =>
          row.evidence.relationshipVisitDelta == null ||
          row.evidence.otherViewerRelationshipMutated == null,
      )
    ) {
      unknownChecks.add('relationship-visits-and-isolation');
    }
    unknownChecks.add('reply-leakage-global');
    if (!tts.available) unknownChecks.add('tts-runtime-log-unavailable');
    const queueObservations = timeline.filter(
      (event) =>
        event.type === 'queue-progress' &&
        typeof event.details?.statuses === 'string',
    );
    if (queueObservations.length === 0) unknownChecks.add('simultaneous-speaking-history');
    const maxSimultaneousSpeaking = queueObservations.length
      ? Math.max(
          0,
          ...queueObservations.map((event) =>
            (String(event.details?.statuses).match(/:speaking(?:\||$)/g) ?? []).length,
          ),
        )
      : 2;
    const hasGapLongerThan = (
      events: RuntimeEvent[],
      startAt: number | undefined,
      endAt: number | undefined,
      thresholdMs: number,
    ) => {
      if (startAt == null || endAt == null) return true;
      const points = [
        startAt,
        ...events
          .filter((event) => event.at > startAt && event.at < endAt)
          .map((event) => event.at),
        endAt,
      ].sort((left, right) => left - right);
      return points.some((point, index) =>
        index > 0 && point - (points[index - 1] ?? point) > thresholdMs,
      );
    };
    const burstPhaseIds = new Set<StressPhaseId>(['burst', 'chaos']);
    const burstStartedAt = timeline.find(
      (event) =>
        event.type === 'phase-started' &&
        event.phaseId != null &&
        burstPhaseIds.has(event.phaseId),
    )?.at;
    const burstCompletedAt = [...timeline]
      .reverse()
      .find(
        (event) =>
          event.type === 'phase-completed' &&
          event.phaseId != null &&
          burstPhaseIds.has(event.phaseId),
      )?.at;
    const finalInjectionAt = [...timeline]
      .reverse()
      .find((event) => event.type === 'message-ingested')?.at;
    const runTerminalAt = [...timeline]
      .reverse()
      .find((event) => ['run-completed', 'run-failed', 'run-aborted'].includes(event.type))?.at;
    const progressEvents = timeline.filter((event) => event.type === 'queue-progress');
    const stalledAfterBurst = hasGapLongerThan(
      progressEvents,
      burstStartedAt,
      burstCompletedAt,
      60_000,
    );
    const stalledAfterFinal = hasGapLongerThan(
      progressEvents,
      finalInjectionAt,
      runTerminalAt,
      120_000,
    );
    if (burstStartedAt == null || burstCompletedAt == null) unknownChecks.add('burst-progress-window');
    if (finalInjectionAt == null || runTerminalAt == null) unknownChecks.add('final-progress-window');
    const acceptanceEvaluated =
      state.lifecycle === 'completed' &&
      state.sentCount === STRESS_TEST_PLAN.messageCount &&
      state.terminalCount === STRESS_TEST_PLAN.messageCount;
    const score = scoreDeterministicStressRun({
      steps: stepRows.map((row) => row.evidence),
      maxSimultaneousSpeaking,
      stalledFor60SecondsAfterBurst: stalledAfterBurst,
      stalledFor120SecondsAfterFinalInjection: stalledAfterFinal,
      queueHasPermanentActiveItem: items.some((item) => !TERMINAL.has(item.status)),
    });
    const scoreReport = {
      ...score,
      policy: acceptanceEvaluated
        ? 'Unknown evidence fails hard gates; no optimistic defaults.'
        : 'Acceptance was not evaluated because the stress run did not complete.',
      acceptanceEvaluated,
      unknownChecks: [...unknownChecks].sort(),
      ttsEvidence: {
        available: tts.available,
        recordCount: tts.records.length,
        error: tts.error,
      },
    };
    state.hardPass = acceptanceEvaluated ? score.hardPass : undefined;
    state.semanticReviewRequired = acceptanceEvaluated && [...unknownChecks].some((item) =>
      /semantic|unsupported-claims|leakage|relationship-boundary/.test(item),
    );
    if (acceptanceEvaluated && !score.hardPass) {
      fail(
        'acceptance_failed',
        `Hard gates failed: ${score.failedGateIds.join(', ') || 'unknown evidence'}`,
      );
    }
    await Promise.all([
      writeFile(join(reportDirectory, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`, 'utf8'),
      writeFile(join(reportDirectory, 'steps.json'), `${JSON.stringify(stepRows, null, 2)}\n`, 'utf8'),
      writeFile(join(reportDirectory, 'score.json'), `${JSON.stringify(scoreReport, null, 2)}\n`, 'utf8'),
      writeFile(
        join(reportDirectory, 'screenshots.json'),
        `${JSON.stringify({ schemaVersion: 1, runId: state.runId, screenshots: [], note: '由总控或语义评审追加失败截图索引。' }, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        join(reportDirectory, 'summary.zh-CN.md'),
        [
          `# 直播压力测试报告 ${state.runId}`,
          '',
          `- 运行状态：${state.lifecycle}`,
          `- 已注入：${state.sentCount}/${STRESS_TEST_PLAN.messageCount}`,
          `- 已到终态：${state.terminalCount}/${STRESS_TEST_PLAN.messageCount}`,
          `- 确定性硬门槛：${score.hardPass ? '通过' : '未通过'}`,
          `- 确定性得分：${score.deterministicScore}`,
          `- 已发现失败：${state.failures.length}`,
          `- 未知证据项：${unknownChecks.size}`,
          '',
          '## 未通过门槛',
          '',
          ...(score.failedGateIds.length ? score.failedGateIds.map((id) => `- ${id}`) : ['- 无']),
          '',
          '## 证据说明',
          '',
          '无法从队列或运行日志确定的语义、关系和音频项均按未知并判失败，未作乐观推断。',
          '',
        ].join('\n'),
        'utf8',
      ),
    ]);
    const terminalReasons = Object.fromEntries(
      items.map((item) => [
        item.stepId ?? item.eventId,
        {
          status: item.status,
          finishReason: item.finishReason,
          retryCount: item.retryCount,
          beatCount: item.beatCount,
          completedBeatCount: item.completedBeatCount,
          replyHash: item.replyHash,
        },
      ]),
    );
    const summary = {
      schemaVersion: 1,
      generatedAt: now(),
      plan: {
        mode: STRESS_TEST_PLAN.mode,
        messageCount: STRESS_TEST_PLAN.messageCount,
        seed: state.seed,
        viewerProfiles: STRESS_TEST_PLAN.viewerProfiles,
        faultPlan: STRESS_TEST_PLAN.faultPlan,
      },
      status: cloneStatus(state),
      terminalReasons,
      eventCount: timeline.length,
      files: {
        events: 'events.jsonl',
        timeline: 'timeline.json',
        steps: 'steps.json',
        ttsBeats: 'tts-beats.jsonl',
        score: 'score.json',
        screenshots: 'screenshots.json',
        chineseSummary: 'summary.zh-CN.md',
        summary: 'summary.json',
      },
    };
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    state.reportWritten = true;
    await record('report-written', { details: { summaryPath } });
  }

  async function execute(): Promise<void> {
    try {
      await record('run-started', {
        details: {
          messageCount: STRESS_TEST_PLAN.messageCount,
          seed: state.seed,
        },
      });
      for (const phase of [...STRESS_TEST_PLAN.phases].sort((a, b) => a.order - b.order)) {
        await runPhase(phase.id);
      }
      state.lifecycle = 'completed';
      state.finishedAt = now();
      state.estimatedRemainingMs = 0;
      await record('run-completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = error instanceof StressRuntimeFailure ? error : undefined;
      state.finishedAt = now();
      if (abortRequested) {
        state.lifecycle = 'aborted';
        await record('run-aborted', { details: { reason: message } });
      } else {
        state.lifecycle = 'failed';
        fail(
          failure?.code ?? 'runtime_failed',
          message,
          failure?.stepId,
          failure?.diagnostic,
        );
        await record('run-failed', {
          stepId: failure?.stepId,
          details: {
            error: message,
            code: failure?.code ?? 'runtime_failed',
            diagnostic: failure?.diagnostic,
          },
        });
      }
    }
    try {
      await writeReport();
    } catch (error) {
      state.reportWritten = false;
      fail(
        'report_failed',
        error instanceof Error ? error.message : String(error),
      );
      state.lifecycle = 'failed';
    } finally {
      runner = undefined;
      state.updatedAt = now();
    }
  }

  async function start(startOptions: StressStartOptions = {}): Promise<StressRunStatus> {
    assertCanStart();
    abortRequested = false;
    timeline = [];
    assignedOwnerId = startOptions.assignedOwnerId?.trim() || undefined;
    const startedAt = now();
    const runId = createRunId();
    const reportDirectory = join(appRoot, 'logs', 'stress-tests', runId);
    await mkdir(reportDirectory, { recursive: true });
    eventLogPath = join(reportDirectory, 'events.jsonl');
    summaryPath = join(reportDirectory, 'summary.json');
    state = {
      ...makeIdleStatus(startedAt),
      runId,
      lifecycle: 'running',
      seed: startOptions.seed ?? STRESS_TEST_PLAN.defaultSeed,
      startedAt,
      updatedAt: startedAt,
      reportDirectory,
    };
    runner = execute();
    return cloneStatus(state);
  }

  async function pause(): Promise<StressRunStatus> {
    if (state.lifecycle !== 'running') throw new Error('stress test is not running');
    state.lifecycle = 'paused';
    state.pausedAt = now();
    await record('run-paused');
    return cloneStatus(state);
  }

  async function resume(): Promise<StressRunStatus> {
    if (state.lifecycle !== 'paused') throw new Error('stress test is not paused');
    state.lifecycle = 'running';
    state.pausedAt = undefined;
    await record('run-resumed');
    return cloneStatus(state);
  }

  async function abort(): Promise<StressRunStatus> {
    if (!['running', 'paused'].includes(state.lifecycle)) {
      throw new Error('stress test is not active');
    }
    abortRequested = true;
    state.lifecycle = 'aborting';
    state.pausedAt = undefined;
    await record('abort-requested');
    return cloneStatus(state);
  }

  async function cleanup(): Promise<StressRunStatus> {
    if (!state.runId) throw new Error('there is no stress run to clean');
    if (runner || ['running', 'paused', 'aborting'].includes(state.lifecycle)) {
      throw new Error('cannot clean an active stress run');
    }
    if (!state.reportWritten) {
      throw new Error('cannot clean before the report is written successfully');
    }
    state.cleanupState = 'running';
    state.updatedAt = now();
    try {
      const removed = await callbacks.remove(state.runId);
      state.cleanupState = 'done';
      await record('cleanup-completed', {
        details: { removed: typeof removed === 'number' ? removed : undefined },
      });
    } catch (error) {
      state.cleanupState = 'failed';
      fail(
        'cleanup_failed',
        error instanceof Error ? error.message : String(error),
      );
      await record('cleanup-failed');
      throw error;
    }
    return cloneStatus(state);
  }

  return {
    start,
    pause,
    resume,
    abort,
    cleanup,
    status: () => cloneStatus(state),
  };
}
