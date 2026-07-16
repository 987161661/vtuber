import {
  ChatScreenplay,
  SpeechBeat,
  SpeechPlanV2,
  VoiceProsody,
} from '../types/chat';
import { EmotionParser } from './emotionParser';

const ALLOWED_EMOTIONS = new Set([
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
const ALLOWED_DELIVERIES = new Set([
  'natural',
  'warm',
  'playful',
  'calm',
  'excited',
  'soft',
  'serious',
  'teasing',
]);
const ALLOWED_VOCAL_TAGS = new Set([
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
const ALLOWED_MOTIONS = new Set([
  'idle_cold',
  'side_glance',
  'lean_in',
  'smirk',
  'restrained_laugh',
  'serious_report',
  'thank_gift',
  'dismissive',
]);
const ALLOWED_GAZES = new Set(['camera', 'left', 'right', 'down']);
const ALLOWED_GESTURES = new Set(['still', 'subtle', 'expressive']);

type StructuredScreenplay = {
  text?: unknown;
  emotion?: unknown;
  delivery?: unknown;
  emotion_intensity?: unknown;
  prosody?: unknown;
  vocal_tags?: unknown;
  pause_after_ms?: unknown;
  motion?: unknown;
  gaze?: unknown;
  gesture?: unknown;
  interruptible_after?: unknown;
};

function normalizeProsody(value: unknown): VoiceProsody | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const allowedKeys = [
    'pace',
    'pitch',
    'volume',
    'warmth',
    'tension',
    'energy',
    'assertiveness',
    'breathiness',
  ] as const;
  const result: VoiceProsody = {};
  for (const key of allowedKeys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      result[key] = Math.min(1, Math.max(-1, candidate));
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function extractStructuredJson(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
  const start = trimmed.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }

  return null;
}

function normalizeStructuredScreenplay(
  value: StructuredScreenplay,
): ChatScreenplay | null {
  if (typeof value.text !== 'string' || !value.text.trim()) return null;

  const text = value.text.trim();
  const emotion =
    typeof value.emotion === 'string' && ALLOWED_EMOTIONS.has(value.emotion)
      ? value.emotion
      : 'neutral';
  const delivery =
    typeof value.delivery === 'string' && ALLOWED_DELIVERIES.has(value.delivery)
      ? value.delivery
      : 'natural';
  const emotionIntensity =
    typeof value.emotion_intensity === 'number'
      ? Math.min(1, Math.max(0, value.emotion_intensity))
      : 0.5;
  const prosody = normalizeProsody(value.prosody);
  const pauseAfterMs =
    typeof value.pause_after_ms === 'number'
      ? Math.min(2500, Math.max(0, Math.round(value.pause_after_ms)))
      : undefined;
  const vocalTags = Array.isArray(value.vocal_tags)
    ? value.vocal_tags
        .filter((tag): tag is string => typeof tag === 'string')
        .filter((tag) => ALLOWED_VOCAL_TAGS.has(tag))
        .slice(0, 2)
    : [];
  const ttsText = vocalTags.length
    ? `${text} ${vocalTags.map((tag) => `(${tag})`).join(' ')}`
    : text;
  const motion =
    typeof value.motion === 'string' && ALLOWED_MOTIONS.has(value.motion)
      ? (value.motion as ChatScreenplay['motion'])
      : 'idle_cold';
  const gaze =
    typeof value.gaze === 'string' && ALLOWED_GAZES.has(value.gaze)
      ? (value.gaze as ChatScreenplay['gaze'])
      : 'camera';
  const gesture =
    typeof value.gesture === 'string' && ALLOWED_GESTURES.has(value.gesture)
      ? (value.gesture as ChatScreenplay['gesture'])
      : 'subtle';

  return {
    text,
    ttsText,
    emotion,
    delivery,
    emotionIntensity,
    prosody,
    pauseAfterMs,
    motion,
    gaze,
    gesture,
  };
}

function parseStructuredScreenplay(input: string): ChatScreenplay | null {
  const structuredJson = extractStructuredJson(input);
  if (!structuredJson) return null;

  try {
    const value = JSON.parse(structuredJson) as StructuredScreenplay;
    return normalizeStructuredScreenplay(value);
  } catch {
    return null;
  }
}

function parseStructuredSpeechPlan(input: string): SpeechPlanV2 | null {
  const structuredJson = extractStructuredJson(input);
  if (!structuredJson) return null;
  try {
    const value = JSON.parse(structuredJson) as {
      version?: unknown;
      beats?: unknown;
    };
    if (value.version !== 2 || !Array.isArray(value.beats)) return null;
    if (value.beats.length < 1 || value.beats.length > 3) return null;
    const beats = value.beats.map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null;
      const source = candidate as StructuredScreenplay;
      const screenplay = normalizeStructuredScreenplay(source);
      if (!screenplay) return null;
      return {
        ...screenplay,
        interruptibleAfter: source.interruptible_after !== false,
      } satisfies SpeechBeat;
    });
    if (beats.some((beat) => beat === null)) return null;
    return { version: 2, beats: beats as SpeechBeat[] };
  } catch {
    return null;
  }
}

/**
 * Convert text to screenplay (text with emotion)
 * @param text Original text (may contain emotion expressions like [happy])
 * @returns Screenplay object with emotion and text separated
 */
export function textToScreenplay(text: string): ChatScreenplay {
  const structured = parseStructuredScreenplay(text);
  if (structured) return structured;

  const { emotion, cleanText } = EmotionParser.extractEmotion(text);

  if (emotion) {
    return {
      emotion,
      text: cleanText,
    };
  }

  return { text: cleanText };
}

export function textToSpeechPlan(text: string): SpeechPlanV2 {
  const structured = parseStructuredSpeechPlan(text);
  if (structured) return structured;
  return {
    version: 2,
    beats: [{ ...textToScreenplay(text), interruptibleAfter: true }],
  };
}

export function speechPlanToScreenplay(plan: SpeechPlanV2): ChatScreenplay {
  const first = plan.beats[0] ?? { text: '', interruptibleAfter: true };
  return {
    ...first,
    text: plan.beats
      .map((beat) => beat.text.trim())
      .filter(Boolean)
      .join(' '),
    ttsText: plan.beats
      .map((beat) => (beat.ttsText || beat.text).trim())
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * Convert multiple texts to screenplay array
 * @param texts Text array
 * @returns Array of screenplay objects
 */
export function textsToScreenplay(texts: string[]): ChatScreenplay[] {
  return texts.map((text) => textToScreenplay(text));
}

/**
 * Convert screenplay to text with emotion
 * @param screenplay Screenplay object
 * @returns Text with emotion (e.g. [happy] Hello)
 */
export function screenplayToText(screenplay: ChatScreenplay): string {
  if (screenplay.emotion) {
    return EmotionParser.addEmotionTag(screenplay.emotion, screenplay.text);
  }
  return screenplay.text;
}
