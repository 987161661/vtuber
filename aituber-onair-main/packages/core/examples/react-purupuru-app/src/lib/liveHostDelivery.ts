import type { SpeechPlanV2BuilderHints } from '@aituber-onair/core';

export type IncompleteDeliveryStatus = 'partial' | 'interrupted' | 'failed';

export type IncompleteDeliveryEvidence = {
  beatCount: number;
  completedBeatCount: number;
  audioByteLength: number;
  playbackObserved: boolean;
};

export type IncompleteDeliveryResolution = {
  status: IncompleteDeliveryStatus;
  deliveredFraction: number;
};

/**
 * The coordinator is a production execution invariant, not an A/B feature.
 * Keeping this outside query/settings parsing prevents a URL from restoring a
 * second speech authority.
 */
export function isLiveHostCoordinatorRequired(): true {
  return true;
}

/**
 * Resolve an unfinished playback from observable delivery evidence only.
 * This intentionally does not infer a completed utterance from generated text.
 */
export function resolveIncompleteDelivery(
  evidence: IncompleteDeliveryEvidence,
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

export function hasCompleteDeliveryEvidence(
  evidence: Pick<
    IncompleteDeliveryEvidence,
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
