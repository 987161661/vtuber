import type {
  InteractionScene,
  PersonaInteractionPlanV1,
  PersonaProsodyTarget,
} from './personaInteractionPlanner';

export interface PersonaEmotionDimensions {
  valence: number;
  arousal: number;
  dominance: number;
  tension: number;
}

export interface PersonaEmotionSnapshot {
  mood: PersonaEmotionDimensions;
  activeAffect: {
    label: string;
    intensity: number;
    cause: string;
    target?: string;
    expiresAt: number;
  } | null;
  updatedAt: number;
}

export interface PersonaEmotionPreview {
  label: string;
  intensity: [number, number];
  cause: string;
  socialMask: 'open' | 'restrained' | 'teasing' | 'professional';
  prosody: PersonaProsodyTarget;
  next: PersonaEmotionSnapshot;
}

const BASELINE: PersonaEmotionDimensions = {
  valence: 0.04,
  arousal: 0.2,
  dominance: 0.58,
  tension: 0.16,
};

const SCENE_IMPULSES: Partial<
  Record<InteractionScene, Partial<PersonaEmotionDimensions>>
> = {
  banter: { valence: 0.28, arousal: 0.2, dominance: 0.08, tension: -0.08 },
  boredom: { valence: -0.12, arousal: -0.2, tension: -0.04 },
  praise: { valence: 0.24, arousal: 0.08, dominance: 0.03, tension: 0.1 },
  grief: { valence: -0.38, arousal: -0.12, dominance: -0.12, tension: 0.08 },
  distress: { valence: -0.22, arousal: -0.08, dominance: -0.08, tension: 0.12 },
  correction: { valence: -0.1, dominance: -0.08, tension: 0.16 },
  boundary: { valence: -0.22, arousal: 0.18, dominance: 0.24, tension: 0.28 },
  room_conflict: { valence: -0.3, arousal: 0.24, dominance: 0.28, tension: 0.38 },
  urgent: { arousal: 0.26, dominance: 0.22, tension: 0.34 },
  weather: { arousal: 0.06, dominance: 0.14, tension: 0.08 },
  idle: { arousal: -0.08, tension: -0.06 },
};

function clamp(value: number, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function decayDimension(value: number, baseline: number, factor: number) {
  return baseline + (value - baseline) * factor;
}

function mergeProsody(
  base: PersonaProsodyTarget,
  mood: PersonaEmotionDimensions,
): PersonaProsodyTarget {
  return {
    ...base,
    energy: clamp((base.energy ?? 0) + mood.arousal * 0.12),
    tension: clamp((base.tension ?? 0) + mood.tension * 0.16),
    assertiveness: clamp(
      (base.assertiveness ?? 0) + mood.dominance * 0.1,
    ),
    warmth: clamp((base.warmth ?? 0) + mood.valence * 0.08),
  };
}

function socialMaskFor(scene: InteractionScene): PersonaEmotionPreview['socialMask'] {
  if (scene === 'weather' || scene === 'urgent' || scene === 'room_conflict') {
    return 'professional';
  }
  if (scene === 'banter' || scene === 'boredom') return 'teasing';
  if (scene === 'grief' || scene === 'distress') return 'open';
  return 'restrained';
}

export class PersonaEmotionStateMachine {
  private state: PersonaEmotionSnapshot = {
    mood: { ...BASELINE },
    activeAffect: null,
    updatedAt: 0,
  };

  snapshot(at = Date.now()): PersonaEmotionSnapshot {
    const elapsed = Math.max(0, at - this.state.updatedAt);
    const factor = this.state.updatedAt ? Math.exp(-elapsed / (18 * 60_000)) : 0;
    const activeAffect =
      this.state.activeAffect && this.state.activeAffect.expiresAt > at
        ? { ...this.state.activeAffect }
        : null;
    return {
      mood: {
        valence: decayDimension(this.state.mood.valence, BASELINE.valence, factor),
        arousal: decayDimension(this.state.mood.arousal, BASELINE.arousal, factor),
        dominance: decayDimension(
          this.state.mood.dominance,
          BASELINE.dominance,
          factor,
        ),
        tension: decayDimension(this.state.mood.tension, BASELINE.tension, factor),
      },
      activeAffect,
      updatedAt: at,
    };
  }

  preview(
    plan: PersonaInteractionPlanV1,
    at = Date.now(),
    target?: string,
  ): PersonaEmotionPreview {
    const current = this.snapshot(at);
    const impulse = SCENE_IMPULSES[plan.scene] ?? {};
    const mood: PersonaEmotionDimensions = {
      valence: clamp(current.mood.valence + (impulse.valence ?? 0)),
      arousal: clamp(current.mood.arousal + (impulse.arousal ?? 0)),
      dominance: clamp(current.mood.dominance + (impulse.dominance ?? 0)),
      tension: clamp(current.mood.tension + (impulse.tension ?? 0)),
    };
    const intensity: [number, number] = [
      clamp(plan.deliveryTarget.intensity[0] + Math.abs(mood.arousal) * 0.04, 0, 1),
      clamp(plan.deliveryTarget.intensity[1] + mood.tension * 0.05, 0, 1),
    ];
    const cause = `scene:${plan.scene}`;
    return {
      label: plan.deliveryTarget.emotion,
      intensity,
      cause,
      socialMask: socialMaskFor(plan.scene),
      prosody: mergeProsody(plan.deliveryTarget.prosody, mood),
      next: {
        mood,
        activeAffect: {
          label: plan.deliveryTarget.emotion,
          intensity: intensity[1],
          cause,
          target,
          expiresAt: at + 8 * 60_000,
        },
        updatedAt: at,
      },
    };
  }

  commit(preview: PersonaEmotionPreview) {
    this.state = {
      mood: { ...preview.next.mood },
      activeAffect: preview.next.activeAffect
        ? { ...preview.next.activeAffect }
        : null,
      updatedAt: preview.next.updatedAt,
    };
  }
}
