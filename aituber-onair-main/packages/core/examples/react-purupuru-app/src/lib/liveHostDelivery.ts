import type { SpeechPlanV2BuilderHints } from '@aituber-onair/core';

type IncompleteDeliveryStatus = 'partial' | 'interrupted' | 'failed';

export type SpeechDeliveryEvidence = {
  beatCount: number;
  completedBeatCount: number;
  audioByteLength: number;
  playbackObserved: boolean;
};

type IncompleteDeliveryResolution = {
  status: IncompleteDeliveryStatus;
  deliveredFraction: number;
};

export type SpeechOutcomeSignal =
  | { type: 'completed'; operatorPlayback: boolean }
  | { type: 'interrupted'; scopeTransition: boolean }
  | {
      type: 'failed';
      reasonCode: string;
      partialReasonCode?: string;
    };

export type TerminalSpeechOutcomeDecision = {
  kind: 'terminal';
  soulStatus: 'spoken' | IncompleteDeliveryStatus;
  historyStatus: 'spoken' | IncompleteDeliveryStatus;
  turnStatus: 'spoken' | 'skipped' | 'failed';
  deliveredFraction: number;
  reasonCode: string;
};

export type SpeechOutcomeDecision =
  | { kind: 'deferred'; reasonCode: 'operator-audio-incomplete' }
  | TerminalSpeechOutcomeDecision;

/**
 * The coordinator is a production execution invariant, not an A/B feature.
 * Keeping this outside query/settings parsing prevents a URL from restoring a
 * second speech authority.
 */
export function isLiveHostCoordinatorRequired(): true {
  return true;
}

/**
 * Resolve a speech terminal signal from observable audio evidence. Callers
 * execute side effects only after this function returns a terminal decision.
 */
export function resolveSpeechOutcome(input: {
  signal: Exclude<SpeechOutcomeSignal, { type: 'completed' }>;
  evidence: SpeechDeliveryEvidence;
}): TerminalSpeechOutcomeDecision;
export function resolveSpeechOutcome(input: {
  signal: SpeechOutcomeSignal;
  evidence: SpeechDeliveryEvidence;
}): SpeechOutcomeDecision;
export function resolveSpeechOutcome(input: {
  signal: SpeechOutcomeSignal;
  evidence: SpeechDeliveryEvidence;
}): SpeechOutcomeDecision {
  if (input.signal.type === 'completed') {
    if (
      input.signal.operatorPlayback &&
      !hasCompleteDeliveryEvidence(input.evidence)
    ) {
      return { kind: 'deferred', reasonCode: 'operator-audio-incomplete' };
    }
    return {
      kind: 'terminal',
      soulStatus: 'spoken',
      historyStatus: 'spoken',
      turnStatus: 'spoken',
      deliveredFraction: 1,
      reasonCode: 'tts-playback-completed',
    };
  }

  const incomplete = resolveIncompleteDelivery(input.evidence);
  if (input.signal.type === 'interrupted') {
    return {
      kind: 'terminal',
      soulStatus: input.signal.scopeTransition
        ? incomplete.status
        : incomplete.deliveredFraction > 0
          ? 'partial'
          : 'interrupted',
      historyStatus: incomplete.status,
      turnStatus: 'skipped',
      deliveredFraction: incomplete.deliveredFraction,
      reasonCode: input.signal.scopeTransition
        ? 'scope-switch-interrupted-delivery'
        : 'interrupted-at-beat-boundary',
    };
  }

  return {
    kind: 'terminal',
    soulStatus: incomplete.status,
    historyStatus: incomplete.status,
    turnStatus: incomplete.status === 'failed' ? 'failed' : 'skipped',
    deliveredFraction: incomplete.deliveredFraction,
    reasonCode:
      incomplete.status === 'partial' && input.signal.partialReasonCode
        ? input.signal.partialReasonCode
        : input.signal.reasonCode,
  };
}

/**
 * Resolve an unfinished playback from observable delivery evidence only.
 * This intentionally does not infer a completed utterance from generated text.
 */
function resolveIncompleteDelivery(
  evidence: SpeechDeliveryEvidence,
): IncompleteDeliveryResolution {
  const beatCount = Math.max(0, Math.floor(evidence.beatCount));
  const completedBeatCount = Math.max(
    0,
    Math.min(beatCount, Math.floor(evidence.completedBeatCount)),
  );
  const hasAudio = evidence.audioByteLength > 0;
  const deliveredFraction =
    beatCount > 0 && hasAudio ? completedBeatCount / beatCount : 0;

  if (deliveredFraction > 0) {
    return { status: 'partial', deliveredFraction };
  }
  if (evidence.playbackObserved || hasAudio) {
    return { status: 'interrupted', deliveredFraction: 0 };
  }
  return { status: 'failed', deliveredFraction: 0 };
}

function hasCompleteDeliveryEvidence(
  evidence: Pick<
    SpeechDeliveryEvidence,
    'beatCount' | 'completedBeatCount' | 'audioByteLength'
  >,
): boolean {
  return (
    evidence.beatCount > 0 &&
    evidence.completedBeatCount >= evidence.beatCount &&
    evidence.audioByteLength > 0
  );
}

/**
 * Authoritative text and vocal urgency are separate concerns. Routine grounded
 * answers should keep the Soul decision's delivery; only genuinely urgent
 * routing receives the restrained alert cadence.
 */
export function resolveAuthoritativeSpeechHints(
  hints: SpeechPlanV2BuilderHints,
  urgent: boolean,
): SpeechPlanV2BuilderHints {
  if (!urgent) return hints;
  return {
    ...hints,
    emotion: 'neutral',
    delivery: 'serious',
    motion: 'serious_report',
  };
}
