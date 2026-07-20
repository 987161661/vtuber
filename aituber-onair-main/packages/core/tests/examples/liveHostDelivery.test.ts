import { describe, expect, it } from 'vitest';
import {
  isLiveHostCoordinatorRequired,
  resolveAuthoritativeSpeechHints,
  resolveSpeechOutcome,
} from '../../examples/react-purupuru-app/src/lib/liveHostDelivery';

const noDelivery = {
  beatCount: 2,
  completedBeatCount: 0,
  audioByteLength: 0,
  playbackObserved: false,
};

describe('live host delivery authority', () => {
  it('keeps the coordinator mandatory instead of exposing a query bypass', () => {
    expect(isLiveHostCoordinatorRequired()).toBe(true);
  });

  it('defers an operator completion signal until every audio beat exists', () => {
    expect(
      resolveSpeechOutcome({
        signal: { type: 'completed', operatorPlayback: true },
        evidence: { ...noDelivery, beatCount: 3, completedBeatCount: 2 },
      }),
    ).toEqual({ kind: 'deferred', reasonCode: 'operator-audio-incomplete' });

    expect(
      resolveSpeechOutcome({
        signal: { type: 'completed', operatorPlayback: true },
        evidence: {
          ...noDelivery,
          beatCount: 3,
          completedBeatCount: 3,
          audioByteLength: 1,
        },
      }),
    ).toEqual({
      kind: 'terminal',
      soulStatus: 'spoken',
      historyStatus: 'spoken',
      turnStatus: 'spoken',
      deliveredFraction: 1,
      reasonCode: 'tts-playback-completed',
    });
  });

  it('allows non-operator completion without queue beat evidence', () => {
    expect(
      resolveSpeechOutcome({
        signal: { type: 'completed', operatorPlayback: false },
        evidence: noDelivery,
      }),
    ).toMatchObject({ kind: 'terminal', soulStatus: 'spoken' });
  });

  it('keeps ordinary interruption and scope-transition semantics explicit', () => {
    expect(
      resolveSpeechOutcome({
        signal: { type: 'interrupted', scopeTransition: false },
        evidence: noDelivery,
      }),
    ).toMatchObject({
      kind: 'terminal',
      soulStatus: 'interrupted',
      historyStatus: 'failed',
      turnStatus: 'skipped',
      deliveredFraction: 0,
      reasonCode: 'interrupted-at-beat-boundary',
    });
    expect(
      resolveSpeechOutcome({
        signal: { type: 'interrupted', scopeTransition: true },
        evidence: noDelivery,
      }),
    ).toMatchObject({
      soulStatus: 'failed',
      historyStatus: 'failed',
      reasonCode: 'scope-switch-interrupted-delivery',
    });
  });

  it('classifies heard beats as partial for interruption and failure', () => {
    const evidence = {
      beatCount: 4,
      completedBeatCount: 1,
      audioByteLength: 12_000,
      playbackObserved: true,
    };
    expect(
      resolveSpeechOutcome({
        signal: { type: 'interrupted', scopeTransition: false },
        evidence,
      }),
    ).toMatchObject({
      soulStatus: 'partial',
      historyStatus: 'partial',
      deliveredFraction: 0.25,
    });
    expect(
      resolveSpeechOutcome({
        signal: {
          type: 'failed',
          reasonCode: 'tts-playback-failed',
          partialReasonCode: 'tts-playback-failed-after-partial-delivery',
        },
        evidence,
      }),
    ).toMatchObject({
      soulStatus: 'partial',
      historyStatus: 'partial',
      turnStatus: 'skipped',
      reasonCode: 'tts-playback-failed-after-partial-delivery',
    });
    expect(
      resolveSpeechOutcome({
        signal: { type: 'failed', reasonCode: 'tts-progress-timeout' },
        evidence: noDelivery,
      }),
    ).toMatchObject({
      soulStatus: 'failed',
      historyStatus: 'failed',
      turnStatus: 'failed',
      deliveredFraction: 0,
      reasonCode: 'tts-progress-timeout',
    });
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
