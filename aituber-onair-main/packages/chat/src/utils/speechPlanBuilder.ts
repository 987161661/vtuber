import { SpeechBeat, SpeechPlanV2 } from '../types';
import {
  ALLOWED_DELIVERIES,
  ALLOWED_EMOTIONS,
  ALLOWED_GAZES,
  ALLOWED_GESTURES,
  ALLOWED_MOTIONS,
  ALLOWED_VOCAL_TAGS,
  clampFiniteNumber,
  normalizeProsody,
} from './speechPlanConstraints';

const MAX_BEATS = 3;
const TARGET_CHARACTERS_PER_BEAT = 120;
const MAX_PLAN_CHARACTERS = MAX_BEATS * TARGET_CHARACTERS_PER_BEAT;
const EMPTY_SPEECH_FALLBACK = '…';

const PAIRED_TAG_BLOCK = /<([a-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_TAG_BLOCK = /<([a-z][\w:-]*)\b[^>]*>[\s\S]*$/i;
const ORPHAN_TAG = /<\/?[a-z][\w:-]*\b[^>]*>/gi;
const CODE_FENCE = /```(?:[a-z0-9_-]+)?/gi;
const LEAKED_TERMINAL_FRAGMENT = /\[e~\[/gi;
const TRAILING_CONTROL_GARBAGE =
  /(?:\s*\[(?:[a-z]+[~^`]*|[~^`]+[a-z]*)\[)+\s*$/i;
const STRUCTURED_JSON_FRAGMENT =
  /(?:^|[{,])\s*"(?:text|screenplay|beats|emotion|delivery|motion|gaze|gesture|vocal_tags|pause_after_ms)"\s*:/i;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const MARKDOWN_LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm;
const MARKDOWN_DECORATION = /\*\*|__|~~|`/g;

const STRONG_BOUNDARIES = new Set([
  '.',
  '!',
  '?',
  '。',
  '！',
  '？',
  '；',
  ';',
  '…',
]);
const SOFT_BOUNDARIES = new Set([' ', ',', '，', '、', ':', '：', '-', '—']);
const CLOSING_PUNCTUATION = new Set([
  '"',
  "'",
  '”',
  '’',
  ')',
  '）',
  ']',
  '】',
  '》',
  '」',
  '』',
]);

const EMOTION_TAG = new RegExp(
  `\\[(?:${[...ALLOWED_EMOTIONS].join('|')})\\]`,
  'gi',
);
const VOCAL_TAG = new RegExp(
  `\\((?:${[...ALLOWED_VOCAL_TAGS]
    .map((tag) => tag.replace('-', '\\-'))
    .join('|')})\\)`,
  'gi',
);

/**
 * Runtime hints are deliberately unknown-valued: callers may pass through
 * model or adapter data, but only allowlisted and clamped values reach a beat.
 */
export interface SpeechPlanV2BuilderHints {
  emotion?: unknown;
  delivery?: unknown;
  emotionIntensity?: unknown;
  prosody?: unknown;
  pauseAfterMs?: unknown;
  motion?: unknown;
  gaze?: unknown;
  gesture?: unknown;
}

function stripAnsiAndControlCharacters(input: string): string {
  let result = '';

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 0x1b) {
      const introducer = input[index + 1];
      if (introducer === '[') {
        index += 2;
        while (index < input.length) {
          const sequenceCode = input.charCodeAt(index);
          if (sequenceCode >= 0x40 && sequenceCode <= 0x7e) break;
          index += 1;
        }
      } else if (introducer === ']') {
        index += 2;
        while (index < input.length) {
          if (input.charCodeAt(index) === 0x07) break;
          if (input.charCodeAt(index) === 0x1b && input[index + 1] === '\\') {
            index += 1;
            break;
          }
          index += 1;
        }
      } else if (introducer !== undefined) {
        index += 1;
      }
      continue;
    }

    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (code === 0x7f || (code < 0x20 && !isAllowedWhitespace)) continue;
    result += input[index];
  }

  return result;
}

function sanitizeSpokenText(input: string): string {
  if (STRUCTURED_JSON_FRAGMENT.test(input)) return '';

  let text = input;
  let previous = '';

  while (text !== previous) {
    previous = text;
    text = text.replace(PAIRED_TAG_BLOCK, ' ');
  }

  text = text.replace(UNCLOSED_TAG_BLOCK, ' ');
  text = text.replace(ORPHAN_TAG, ' ');
  text = text.replace(CODE_FENCE, ' ');
  text = stripAnsiAndControlCharacters(text);
  text = text.replace(LEAKED_TERMINAL_FRAGMENT, ' ');

  do {
    previous = text;
    text = text.replace(TRAILING_CONTROL_GARBAGE, ' ');
  } while (text !== previous);

  text = text.replace(MARKDOWN_IMAGE, '$1');
  text = text.replace(MARKDOWN_LINK, '$1');
  text = text.replace(MARKDOWN_LINE_PREFIX, '');
  text = text.replace(MARKDOWN_DECORATION, '');
  text = text.replace(EMOTION_TAG, '');
  text = text.replace(VOCAL_TAG, '');

  return text.replace(/\s+/g, ' ').trim();
}

function truncatePlanText(text: string): string {
  const characters = [...text];
  if (characters.length <= MAX_PLAN_CHARACTERS) return text;

  const truncated = characters
    .slice(0, MAX_PLAN_CHARACTERS - 1)
    .join('')
    .trimEnd()
    .replace(/[\s,\uff0c\u3001:;\uff1a\uff1b-]+$/u, '');
  return `${truncated}${EMPTY_SPEECH_FALLBACK}`;
}

function isStrongBoundary(characters: string[], index: number): boolean {
  const character = characters[index];
  if (!STRONG_BOUNDARIES.has(character)) return false;

  if (character !== '.') return true;
  const previous = characters[index - 1];
  const next = characters[index + 1];
  if (previous && next && /\d/u.test(previous) && /\d/u.test(next)) {
    return false;
  }
  return (
    next === undefined || /\s/u.test(next) || CLOSING_PUNCTUATION.has(next)
  );
}

function countSentences(text: string): number {
  const characters = [...text];
  let count = 0;
  let hasContentSinceBoundary = false;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (!/\s/u.test(character)) hasContentSinceBoundary = true;
    if (!hasContentSinceBoundary || !isStrongBoundary(characters, index)) {
      continue;
    }

    while (
      index + 1 < characters.length &&
      (STRONG_BOUNDARIES.has(characters[index + 1]) ||
        CLOSING_PUNCTUATION.has(characters[index + 1]))
    ) {
      index += 1;
    }
    count += 1;
    hasContentSinceBoundary = false;
  }

  if (hasContentSinceBoundary) count += 1;
  return Math.max(1, count);
}

function findNearestBoundary(
  characters: string[],
  target: number,
  remainingBeats: number,
): number {
  const maximum = characters.length - remainingBeats;
  const minimum = Math.max(1, Math.floor(target * 0.55));
  const upper = Math.min(maximum, Math.ceil(target * 1.75));

  const findClosest = (
    predicate: (character: string, index: number) => boolean,
  ): number | undefined => {
    let best: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let split = minimum; split <= upper; split += 1) {
      if (!predicate(characters[split - 1], split - 1)) continue;
      const distance = Math.abs(split - target);
      if (
        distance < bestDistance ||
        (distance === bestDistance && split < target)
      ) {
        best = split;
        bestDistance = distance;
      }
    }
    return best;
  };

  const strong = findClosest((_, index) => isStrongBoundary(characters, index));
  if (strong !== undefined) return strong;

  const soft = findClosest((character) => SOFT_BOUNDARIES.has(character));
  if (soft !== undefined) return soft;

  return Math.min(maximum, Math.max(1, target));
}

function splitIntoBeats(text: string): string[] {
  const characterCount = [...text].length;
  const lengthDrivenCount = Math.ceil(
    characterCount / TARGET_CHARACTERS_PER_BEAT,
  );
  const beatCount = Math.min(
    MAX_BEATS,
    Math.max(1, lengthDrivenCount, countSentences(text)),
  );

  if (beatCount === 1) return [text];

  const beats: string[] = [];
  let remaining = [...text];
  for (let index = 0; index < beatCount - 1; index += 1) {
    const remainingBeats = beatCount - index;
    const target = Math.ceil(remaining.length / remainingBeats);
    const split = findNearestBoundary(remaining, target, remainingBeats - 1);
    const beat = remaining.slice(0, split).join('').trim();
    if (beat) beats.push(beat);
    remaining = remaining.slice(split);
    while (remaining[0] && /\s/u.test(remaining[0])) remaining.shift();
  }

  const finalBeat = remaining.join('').trim();
  if (finalBeat) beats.push(finalBeat);
  return beats.length ? beats.slice(0, MAX_BEATS) : [EMPTY_SPEECH_FALLBACK];
}

function allowedOrFallback(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

/**
 * Build a deterministic V2 speech plan from viewer-safe spoken text.
 *
 * Structured model envelopes are rejected rather than parsed. Text is
 * defensively stripped of model/control markup, bounded to 360 Unicode code
 * points, and split into one to three punctuation-aware, interruptible beats.
 */
export function buildSpeechPlanV2(
  spokenText: string,
  hints: SpeechPlanV2BuilderHints = {},
): SpeechPlanV2 {
  const safeText =
    truncatePlanText(sanitizeSpokenText(spokenText)) || EMPTY_SPEECH_FALLBACK;
  const texts = splitIntoBeats(safeText);

  const emotion = allowedOrFallback(hints.emotion, ALLOWED_EMOTIONS, 'neutral');
  const delivery = allowedOrFallback(
    hints.delivery,
    ALLOWED_DELIVERIES,
    'natural',
  );
  const emotionIntensity = clampFiniteNumber(hints.emotionIntensity, 0, 1, 0.5);
  const prosody = normalizeProsody(hints.prosody);
  const requestedPause =
    typeof hints.pauseAfterMs === 'number' &&
    Number.isFinite(hints.pauseAfterMs)
      ? Math.round(clampFiniteNumber(hints.pauseAfterMs, 0, 2500, 0))
      : undefined;
  const motion = allowedOrFallback(
    hints.motion,
    ALLOWED_MOTIONS,
    'idle_cold',
  ) as SpeechBeat['motion'];
  const gaze = allowedOrFallback(
    hints.gaze,
    ALLOWED_GAZES,
    'camera',
  ) as SpeechBeat['gaze'];
  const gesture = allowedOrFallback(
    hints.gesture,
    ALLOWED_GESTURES,
    'subtle',
  ) as SpeechBeat['gesture'];

  const beats = texts.map(
    (text, index): SpeechBeat => ({
      text,
      ttsText: text,
      emotion,
      delivery,
      emotionIntensity,
      prosody,
      pauseAfterMs: requestedPause ?? (index < texts.length - 1 ? 180 : 0),
      motion,
      gaze,
      gesture,
      interruptibleAfter: true,
    }),
  );

  return { version: 2, beats };
}
