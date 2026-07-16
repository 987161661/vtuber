import { Screenplay } from '../types';

export const ALLOWED_EMOTIONS: ReadonlySet<string> = new Set([
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'relaxed',
  'bored',
  'impatient',
  'embarrassed',
  'awkward',
  'serious',
]);

export const ALLOWED_DELIVERIES: ReadonlySet<string> = new Set([
  'natural',
  'warm',
  'playful',
  'calm',
  'excited',
  'soft',
  'serious',
  'teasing',
]);

export const ALLOWED_VOCAL_TAGS: ReadonlySet<string> = new Set([
  'laughs',
  'chuckle',
  'coughs',
  'clear-throat',
  'groans',
  'breath',
  'pant',
  'inhale',
  'exhale',
  'gasps',
  'sniffs',
  'sighs',
  'snorts',
  'burps',
  'lip-smacking',
  'humming',
  'hissing',
  'emm',
  'sneezes',
]);

export const ALLOWED_MOTIONS: ReadonlySet<string> = new Set([
  'idle_cold',
  'side_glance',
  'lean_in',
  'smirk',
  'restrained_laugh',
  'serious_report',
  'thank_gift',
  'dismissive',
]);

export const ALLOWED_GAZES: ReadonlySet<string> = new Set([
  'camera',
  'left',
  'right',
  'down',
]);

export const ALLOWED_GESTURES: ReadonlySet<string> = new Set([
  'still',
  'subtle',
  'expressive',
]);

export const PROSODY_KEYS = [
  'pace',
  'pitch',
  'volume',
  'warmth',
  'tension',
  'energy',
  'assertiveness',
  'breathiness',
] as const;

export function clampFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeProsody(
  value: unknown,
): Screenplay['prosody'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalized: NonNullable<Screenplay['prosody']> = {};
  for (const key of PROSODY_KEYS) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      normalized[key] = Math.min(1, Math.max(-1, candidate));
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
}
