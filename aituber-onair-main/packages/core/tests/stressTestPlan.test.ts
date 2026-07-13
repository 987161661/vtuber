import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  STRESS_TEST_PLAN,
  scoreDeterministicStressRun,
  validateStressTestPlan,
  type StressStepEvidence,
} from '../examples/react-purupuru-app/src/lib/stressTestPlan';
import {
  createStressTestController,
  type StressRuntimeQueueItem,
} from '../examples/react-purupuru-app/stressTestRuntime';

function passingEvidence(): StressStepEvidence[] {
  return STRESS_TEST_PLAN.steps.map((step, index) => ({
    stepId: step.stepId,
    status: step.duplicateOfStepId ? 'skipped' : 'done',
    finishReason: step.duplicateOfStepId ? 'duplicate_text' : 'played',
    ackLatencyMs: 20,
    panelLatencyMs: 100,
    skillInheritanceRequired: step.assertions.includes(
      'inherits-typhoon-skill',
    ),
    skillInherited: true,
    mainQuestionRequired: step.assertions.includes('answers-main-question'),
    mainQuestionCovered: true,
    unsupportedClaimCount: 0,
    leakageCount: 0,
    exactDuplicate: Boolean(step.duplicateOfStepId),
    duplicateSuppressed: step.duplicateOfStepId ? true : undefined,
    semanticSpam: step.assertions.includes('suppresses-semantic-spam'),
    semanticSpamSuppressed: step.assertions.includes('suppresses-semantic-spam')
      ? true
      : undefined,
    audioIssueCount: 0,
    relationshipVisitDelta: step.duplicateOfStepId ? 0 : 1,
    otherViewerRelationshipMutated: false,
    noAdviceRequired: step.assertions.includes('no-advice'),
    adviceGiven: false,
    exclusivityAccepted: false,
    factChangedByRelationship: false,
    preparedAt: index === 1 ? 1_000 : undefined,
    overlappedSpeakingDoneAt: index === 1 ? 2_000 : undefined,
  }));
}

describe('complex live stress plan', () => {
  it('is a valid 60-message composable plan', () => {
    expect(validateStressTestPlan(STRESS_TEST_PLAN)).toEqual([]);
    expect(STRESS_TEST_PLAN.steps).toHaveLength(60);
    expect(
      STRESS_TEST_PLAN.steps.filter((step) => step.delivery === 'burst'),
    ).toHaveLength(28);
    expect(
      STRESS_TEST_PLAN.steps.filter((step) => step.simulatedPlatform).length,
    ).toBeGreaterThanOrEqual(15);
    expect(
      STRESS_TEST_PLAN.steps.some(
        (step) => step.faultKind === 'prepare-lease-expiry',
      ),
    ).toBe(true);
  });

  it('can pass only when every hard-gate evidence field passes', () => {
    const score = scoreDeterministicStressRun({
      steps: passingEvidence(),
      maxSimultaneousSpeaking: 1,
      stalledFor60SecondsAfterBurst: false,
      stalledFor120SecondsAfterFinalInjection: false,
      queueHasPermanentActiveItem: false,
    });

    expect(score.hardPass).toBe(true);
    expect(score.failedGateIds).toEqual([]);
  });

  it('does not treat a failed terminal as a successful test completion', () => {
    const steps = passingEvidence();
    steps[0] = {
      ...steps[0],
      status: 'failed',
      finishReason: 'retry_limit_exceeded',
    };

    const score = scoreDeterministicStressRun({
      steps,
      maxSimultaneousSpeaking: 1,
      stalledFor60SecondsAfterBurst: false,
      stalledFor120SecondsAfterFinalInjection: false,
      queueHasPermanentActiveItem: false,
    });

    expect(score.hardPass).toBe(false);
    expect(score.failedGateIds).toContain('all-terminal');
  });

  it('writes a valid failure report instead of claiming missing evidence passed', async () => {
    const appRoot = await mkdtemp(join(tmpdir(), 'linglan-stress-'));
    const queue: StressRuntimeQueueItem[] = [];
    const controller = createStressTestController(
      {
        ingest(message) {
          queue.push({
            ...message,
            status: message.forceDuplicateOfStepId ? 'skipped' : 'done',
            finishReason: message.forceDuplicateOfStepId
              ? 'duplicate_text'
              : 'played',
            preparedAt: message.createdAt + 10,
            doneAt: message.createdAt + 20,
            retryCount: 0,
            beatCount: 1,
            completedBeatCount: 1,
            replyHash: message.stepId,
            skills: message.faultKind ? ['linglan-typhoon-radar'] : [],
          });
        },
        snapshot: () => queue,
        update: () => undefined,
        remove: () => 0,
      },
      {
        appRoot,
        pollIntervalMs: 50,
        burstInjectionGapMs: 0,
      },
    );

    const started = await controller.start({ seed: 7 });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const status = controller.status();
      if (
        status.reportWritten ||
        status.failures.some((failure) => failure.code === 'report_failed')
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const finished = controller.status();
    expect(finished.lifecycle).toBe('completed');
    expect(finished.sentCount).toBe(STRESS_TEST_PLAN.messageCount);
    expect(finished.reportWritten).toBe(true);

    const summary = JSON.parse(
      await readFile(join(started.reportDirectory!, 'summary.json'), 'utf8'),
    ) as { plan: { messageCount: number }; status: { lifecycle: string } };
    const score = JSON.parse(
      await readFile(join(started.reportDirectory!, 'score.json'), 'utf8'),
    ) as { hardPass: boolean; unknownChecks: string[] };
    expect(summary.plan.messageCount).toBe(60);
    expect(summary.status.lifecycle).toBe('completed');
    expect(score.hardPass).toBe(false);
    expect(score.unknownChecks.length).toBeGreaterThan(0);

    await rm(appRoot, { recursive: true, force: true });
  });
});
