import { describe, expect, it } from 'vitest';
import {
  hasCompleteDeliveryEvidence,
  isLiveHostCoordinatorRequired,
  resolveAuthoritativeSpeechHints,
  resolveIncompleteDelivery,
} from '../../examples/react-purupuru-app/src/lib/liveHostDelivery';

describe('live host delivery authority', () => {
  it('keeps the coordinator mandatory instead of exposing a query bypass', () => {
    expect(isLiveHostCoordinatorRequired()).toBe(true);
  });

  it('classifies heard beats as partial and never spoken', () => {
    expect(
      resolveIncompleteDelivery({
        beatCount: 4,
        completedBeatCount: 1,
        audioByteLength: 12_000,
        playbackObserved: true,
      }),
    ).toEqual({ status: 'partial', deliveredFraction: 0.25 });
  });

  it('distinguishes an interrupted playback from a pre-audio failure', () => {
    expect(
      resolveIncompleteDelivery({
        beatCount: 2,
        completedBeatCount: 0,
        audioByteLength: 400,
        playbackObserved: true,
      }).status,
    ).toBe('interrupted');
    expect(
      resolveIncompleteDelivery({
        beatCount: 2,
        completedBeatCount: 0,
        audioByteLength: 0,
        playbackObserved: false,
      }).status,
    ).toBe('failed');
  });

  it('requires every planned beat and non-empty audio before completion', () => {
    expect(
      hasCompleteDeliveryEvidence({
        beatCount: 3,
        completedBeatCount: 3,
        audioByteLength: 1,
      }),
    ).toBe(true);
    expect(
      hasCompleteDeliveryEvidence({
        beatCount: 3,
        completedBeatCount: 2,
        audioByteLength: 8_000,
      }),
    ).toBe(false);
  });

  it('does not turn every authoritative weather answer into an alert', () => {
    const soulHints = {
      emotion: 'happy',
      delivery: 'warm',
      motion: 'idle_cold',
    };

    expect(resolveAuthoritativeSpeechHints(soulHints, false)).toBe(soulHints);
    expect(resolveAuthoritativeSpeechHints(soulHints, true)).toEqual({
      emotion: 'neutral',
      delivery: 'serious',
      motion: 'serious_report',
    });
  });
});
