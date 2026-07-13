export interface ScreenplayLike {
  emotion?: string;
  text?: string;
  emotionIntensity?: number;
  motion?: string;
  gaze?: string;
  gesture?: string;
}

export interface PuruPuruReactionDraft {
  impulse?: {
    bounce?: number;
    tilt?: number;
    shake?: number;
    scalePop?: number;
  };
  sustain?: {
    offsetY?: number;
    tilt?: number;
    idleScale?: number;
    idleSpeedScale?: number;
  };
  fadeMs?: number;
}

export type PuruPuruReaction = PuruPuruReactionDraft & { id: number };

export function createPuruPuruReactionFromScreenplay(
  screenplay: unknown,
): PuruPuruReactionDraft | null {
  if (!screenplay || typeof screenplay !== 'object') return null;

  const source = screenplay as ScreenplayLike;
  const emotion =
    typeof source.emotion === 'string'
      ? source.emotion.toLowerCase().trim()
      : '';
  const intensity =
    typeof source.emotionIntensity === 'number'
      ? Math.min(1, Math.max(0.2, source.emotionIntensity))
      : 0.6;

  const motion = typeof source.motion === 'string' ? source.motion : '';
  if (motion === 'side_glance' || motion === 'smirk') {
    return {
      impulse: { tilt: 0.34 * intensity },
      sustain: { tilt: 0.022 * intensity, idleSpeedScale: 0.86 },
      fadeMs: 380,
    };
  }
  if (motion === 'lean_in') {
    return {
      impulse: { scalePop: 0.38 * intensity, bounce: 0.14 * intensity },
      sustain: { offsetY: -4 * intensity, idleScale: 1 + 0.1 * intensity },
      fadeMs: 360,
    };
  }
  if (motion === 'restrained_laugh') {
    return {
      impulse: { bounce: 0.78 * intensity, tilt: -0.2 * intensity },
      sustain: { idleSpeedScale: 1.18, idleScale: 1 + 0.05 * intensity },
      fadeMs: 320,
    };
  }
  if (motion === 'serious_report') {
    return {
      sustain: { idleSpeedScale: 0.68, idleScale: 0.98, offsetY: 1 },
      fadeMs: 460,
    };
  }
  if (motion === 'thank_gift') {
    return {
      impulse: { bounce: 0.28 * intensity },
      sustain: { offsetY: 7 * intensity, idleSpeedScale: 0.82 },
      fadeMs: 520,
    };
  }
  if (motion === 'dismissive') {
    return {
      impulse: { tilt: 0.46 * intensity, shake: 0.2 * intensity },
      sustain: { tilt: 0.028 * intensity, idleSpeedScale: 0.82 },
      fadeMs: 360,
    };
  }

  if (emotion === 'happy') {
    return {
      impulse: { bounce: 1 * intensity, scalePop: 0.34 * intensity },
      sustain: { offsetY: -5 * intensity, idleScale: 1 + 0.08 * intensity, idleSpeedScale: 1 + 0.08 * intensity },
      fadeMs: 340,
    };
  }

  if (emotion === 'surprised') {
    return {
      impulse: { bounce: 0.8 * intensity, tilt: -0.65 * intensity, scalePop: 0.48 * intensity },
      sustain: { offsetY: -2 * intensity, tilt: -0.025 * intensity, idleScale: 1 + 0.12 * intensity },
      fadeMs: 320,
    };
  }

  if (emotion === 'sad') {
    return {
      sustain: {
        offsetY: 10 * intensity,
        tilt: 0.025 * intensity,
        idleScale: 1 - 0.5 * intensity,
        idleSpeedScale: 1 - 0.28 * intensity,
      },
      fadeMs: 420,
    };
  }

  if (emotion === 'angry') {
    return {
      impulse: { bounce: 0.45 * intensity, tilt: 0.42 * intensity, shake: 0.8 * intensity },
      sustain: { tilt: -0.012 * intensity, idleScale: 1 - 0.1 * intensity, idleSpeedScale: 1 + 0.28 * intensity },
      fadeMs: 280,
    };
  }

  if (emotion === 'relaxed') {
    return {
      impulse: { bounce: 0.18 * intensity },
      sustain: { offsetY: 2 * intensity, idleScale: 1 - 0.38 * intensity, idleSpeedScale: 1 - 0.32 * intensity },
      fadeMs: 460,
    };
  }

  if (emotion === 'neutral') {
    return null;
  }

  return null;
}

export function withReactionId(
  draft: PuruPuruReactionDraft,
  id: number,
): PuruPuruReaction {
  return { ...draft, id };
}
