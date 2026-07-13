import {
  hasUnsafeSpeechArtifacts,
  sanitizeSpeechText,
} from '@aituber-onair/core';

export interface ResponseFactGuard {
  isWeather: boolean;
  viewerText?: string;
  requiredAnswer?: string;
  claims?: unknown[];
  placeResolution?: unknown;
  rawEvidence?: unknown;
  catchup?: boolean;
  /** The fact source was requested but unavailable, so never improvise. */
  forceFallback?: boolean;
}

export interface GuardedResponse {
  text: string;
  rewritten: boolean;
  reasons: string[];
  unsafeArtifacts: boolean;
}

const SAFE_FALLBACK = '这条回复出了点问题，稍后再说。';
const HOSTILE_PHRASES = [
  '说人话',
  '按脑子',
  '竖起耳朵',
  '别给自己加戏',
  '查户口',
];
const UNSUPPORTED_CERTAINTY = [
  /(?:一定|肯定|必然).{0,8}(?:登陆|经过|进入|影响)/,
  /必经之路/,
  /高危区/,
  /全省(?:都会|都将|都要)/,
];
const WEATHER_DEFERRAL =
  /(?:哪个|哪一个)台风|告诉我.*(?:台风|城市|时间)|(?:没法|无法)(?:查|判断)|先报(?:上|出).*(?:台风|城市)/;
const PROVINCE_NAMES = [
  '北京', '天津', '上海', '重庆', '河北', '山西', '内蒙古', '辽宁',
  '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东',
  '河南', '湖北', '湖南', '广东', '广西', '海南', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆', '台湾',
  '香港', '澳门',
];

function evidenceText(context?: ResponseFactGuard): string {
  return JSON.stringify({
    claims: context?.claims ?? [],
    placeResolution: context?.placeResolution ?? null,
    rawEvidence: context?.rawEvidence ?? null,
  });
}

function hasEvidenceFor(text: string, evidence: string): boolean {
  if (/风眼/.test(text) && !/风眼/.test(evidence)) return false;
  if (/登陆/.test(text) && !/登陆/.test(evidence)) return false;
  return true;
}

function hasUnsupportedNumber(text: string, evidence: string): boolean {
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.some((value) => !evidence.includes(value));
}

function hasUnsupportedPlace(text: string, evidence: string): boolean {
  return PROVINCE_NAMES.some(
    (place) => text.includes(place) && !evidence.includes(place),
  );
}

function deterministicRewrite(
  context: ResponseFactGuard | undefined,
): string {
  const candidate = sanitizeSpeechText(context?.requiredAnswer ?? '');
  if (candidate && !hasUnsafeSpeechArtifacts(candidate)) {
    return candidate;
  }
  return SAFE_FALLBACK;
}

/**
 * The only viewer-facing output gate. It cleans, validates, and performs one
 * deterministic rewrite before the text can reach history, memory, or TTS.
 */
export function guardViewerResponse(
  input: string,
  context?: ResponseFactGuard,
): GuardedResponse {
  const sanitized = sanitizeSpeechText(input);
  const unsafeArtifacts = hasUnsafeSpeechArtifacts(sanitized);
  const reasons: string[] = [];
  const evidence = evidenceText(context);

  if (context?.forceFallback) reasons.push('source_unavailable');
  if (!sanitized || unsafeArtifacts) reasons.push('unsafe_artifact');
  if (HOSTILE_PHRASES.some((phrase) => sanitized.includes(phrase))) {
    reasons.push('hostile_tone');
  }
  if (context?.isWeather) {
    if (WEATHER_DEFERRAL.test(sanitized)) reasons.push('weather_deferral');
    if (!hasEvidenceFor(sanitized, evidence)) reasons.push('missing_evidence');
    if (hasUnsupportedNumber(sanitized, evidence)) {
      reasons.push('unsupported_number');
    }
    if (hasUnsupportedPlace(sanitized, evidence)) {
      reasons.push('unsupported_place');
    }
    if (UNSUPPORTED_CERTAINTY.some((pattern) => pattern.test(sanitized))) {
      reasons.push('unsupported_certainty');
    }
  }

  if (reasons.length) {
    return {
      text: deterministicRewrite(context),
      rewritten: true,
      reasons,
      unsafeArtifacts,
    };
  }

  return {
    text: sanitized,
    rewritten: false,
    reasons,
    unsafeArtifacts,
  };
}
