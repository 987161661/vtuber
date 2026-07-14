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
  sanitizedText: string;
  rewritten: boolean;
  reasons: string[];
  unsafeArtifacts: boolean;
}

const SAFE_FALLBACK = '这条回复出了点问题，稍后再说。';
const OFF_TOPIC_FALLBACK = '刚才答偏了，你可以再问我一次。';
const WEATHER_TOPIC = /台风|天气|雷达|风暴|飓风|热带气旋|风眼|登陆/;
const HOSTILE_PHRASES = [
  '说人话',
  '按脑子',
  '竖起耳朵',
  '别给自己加戏',
  '查户口',
];
const UNSUPPORTED_CERTAINTY = [
  /(?:一定|肯定|必然).{0,8}(?:登陆|经过|进入|影响)/,
  /(?:一定|肯定|必然).{0,8}(?:达到|增强|减弱|升级|成为)/,
  /必经之路/,
  /高危区/,
  /全省(?:都会|都将|都要)/,
];
const WEATHER_DEFERRAL =
  /(?:哪个|哪一个)台风|告诉我.*(?:台风|城市|时间)|(?:没法|无法)(?:查|判断)|先报(?:上|出).*(?:台风|城市)/;
const PROVINCE_NAMES = [
  '北京',
  '天津',
  '上海',
  '重庆',
  '河北',
  '山西',
  '内蒙古',
  '辽宁',
  '吉林',
  '黑龙江',
  '江苏',
  '浙江',
  '安徽',
  '福建',
  '江西',
  '山东',
  '河南',
  '湖北',
  '湖南',
  '广东',
  '广西',
  '海南',
  '四川',
  '贵州',
  '云南',
  '西藏',
  '陕西',
  '甘肃',
  '青海',
  '宁夏',
  '新疆',
  '台湾',
  '香港',
  '澳门',
];

type ResponseIntent =
  | 'history'
  | 'location'
  | 'forecast'
  | 'strength'
  | 'naming'
  | 'cause'
  | 'source';

const RESPONSE_INTENTS: Array<{
  intent: ResponseIntent;
  question: RegExp;
  answer: RegExp;
}> = [
  {
    intent: 'history',
    question: /近年|历史|过去|曾经|出现过|图鉴/,
    answer: /历史|过去|曾经|出现过|记录|登陆过|发生过/,
  },
  {
    intent: 'location',
    question: /在哪里|在哪儿|哪儿|哪里|到哪|中心位置|离.+多远/,
    answer: /经度|纬度|东经|北纬|境内|附近|海面|沿海|距离|公里|[省市县区岛]/,
  },
  {
    intent: 'forecast',
    question:
      /会达到|会到|会去|最终|未来|预计|预报|什么时候登陆|何时登陆|影响哪里/,
    answer: /预计|预报|可能|未来|接下来|将会|路径|移动|登陆/,
  },
  {
    intent: 'strength',
    question: /强度|几级|风速|气压|飓风|台风级|热带风暴/,
    answer: /强度|级|米每秒|百帕|热带风暴|台风|飓风/,
  },
  {
    intent: 'naming',
    question: /命名|名字|为什么叫|为何叫|怎么叫|名字.*编/,
    answer: /命名|名字|编号|名称|台风表|提供的名字|按顺序/,
  },
  {
    intent: 'cause',
    question: /为什么|为何|原因|怎么会|为啥/,
    answer: /因为|由于|原因|受到|受.+影响|导致|所以/,
  },
  {
    intent: 'source',
    question: /来源|哪里的信息|哪儿的信息|依据|靠不靠谱|谁报的/,
    answer: /来源|接口|官方|气象台|水利厅|JMA|JTWC|机构|发布/,
  },
];

const TECHNICAL_SUBJECT = /\b[A-Z]{2,}\d*\b|\b\d{2,}[A-Z]\b|巴威|海神|龙卷风/gi;

function detectedIntents(viewerText = ''): ResponseIntent[] {
  return RESPONSE_INTENTS.filter(({ question }) =>
    question.test(viewerText),
  ).map(({ intent }) => intent);
}

function sharesTechnicalSubject(viewerText: string, answer: string): boolean {
  const subjects = viewerText.match(TECHNICAL_SUBJECT) ?? [];
  if (!subjects.length) return true;
  const normalizedAnswer = answer.toUpperCase();
  return subjects.some((subject) =>
    normalizedAnswer.includes(subject.toUpperCase()),
  );
}

function hasWeatherSubject(viewerText: string): boolean {
  return (
    WEATHER_TOPIC.test(viewerText) ||
    (viewerText.match(TECHNICAL_SUBJECT) ?? []).length > 0
  );
}

function answersViewerIntent(viewerText: string, answer: string): boolean {
  if (!viewerText) return true;
  const intents = detectedIntents(viewerText);
  if (!intents.length) {
    return hasWeatherSubject(viewerText) && WEATHER_TOPIC.test(answer);
  }
  return (
    intents.every((intent) =>
      RESPONSE_INTENTS.find((entry) => entry.intent === intent)?.answer.test(
        answer,
      ),
    ) && sharesTechnicalSubject(viewerText, answer)
  );
}

function intentPreservingFallback(viewerText = ''): string {
  const intents = detectedIntents(viewerText);
  if (intents.includes('history')) {
    return '当前实时资料不包含这项历史记录，我不能拿台风实况代替回答。';
  }
  if (intents.includes('naming')) {
    return '当前资料没有提供命名规则，我不能拿当前强度代替回答。';
  }
  if (intents.includes('cause')) {
    return '当前资料不足以确认具体原因，我先不替机构下结论。';
  }
  if (intents.includes('source')) {
    return '当前记录没有足够的来源信息，我先不替这条说法背书。';
  }
  if (intents.includes('forecast') && intents.includes('strength')) {
    return '目前资料不足以判断它未来会达到什么强度。';
  }
  if (intents.includes('forecast')) {
    return '目前资料不足以确认后续路径或影响范围。';
  }
  if (intents.includes('location')) {
    return '目前资料不足以确认它的具体位置。';
  }
  if (intents.includes('strength')) {
    return '目前资料不足以确认它的强度。';
  }
  return '目前资料不足，暂不下确定结论。';
}

function truncateByCodePoints(text: string, maxChars: number): string {
  const characters = Array.from(text);
  if (characters.length <= maxChars) return text;
  const prefix = characters.slice(0, maxChars).join('');
  const boundary = Math.max(
    prefix.lastIndexOf('。'),
    prefix.lastIndexOf('！'),
    prefix.lastIndexOf('？'),
  );
  if (boundary >= Math.floor(maxChars * 0.55)) {
    return prefix.slice(0, boundary + 1);
  }
  return `${characters
    .slice(0, maxChars - 1)
    .join('')
    .replace(/[，、；：\s]+$/u, '')}。`;
}

export function compactViewerResponse(text: string, maxChars = 90): string {
  return truncateByCodePoints(text.trim(), maxChars);
}

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
  reasons: string[],
): string {
  const candidate = sanitizeSpeechText(context?.requiredAnswer ?? '');
  const viewerText = context?.viewerText ?? '';
  if (
    !reasons.includes('unsafe_artifact') &&
    !reasons.includes('hostile_tone') &&
    candidate &&
    !hasUnsafeSpeechArtifacts(candidate) &&
    answersViewerIntent(viewerText, candidate)
  ) {
    return candidate;
  }
  if (reasons.includes('off_topic')) return OFF_TOPIC_FALLBACK;
  if (context?.isWeather && !reasons.includes('unsafe_artifact')) {
    return intentPreservingFallback(viewerText);
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
    if (
      context.viewerText &&
      !detectedIntents(context.viewerText).length &&
      !hasWeatherSubject(context.viewerText)
    ) {
      reasons.push('off_topic');
    }
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
      text: compactViewerResponse(
        deterministicRewrite(context, reasons),
        context?.catchup ? 140 : 90,
      ),
      sanitizedText: sanitized,
      rewritten: true,
      reasons,
      unsafeArtifacts,
    };
  }

  return {
    text: compactViewerResponse(sanitized, context?.catchup ? 140 : 90),
    sanitizedText: sanitized,
    rewritten: false,
    reasons,
    unsafeArtifacts,
  };
}
