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
  engagementSignals?: Array<'follow' | 'like' | 'gift' | 'superchat' | 'guard'>;
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
const GIFT_BOUNDARY_FALLBACK = '心意我收到了，谢谢你；来去都由你，别有压力。';
const WEATHER_TOPIC =
  /台风|天气|雷达|风暴|飓风|热带气旋|风眼|登陆|气温|温度|体感|降水|下雨|晴|多云|阴天|摄氏度/;
const HOSTILE_PHRASES = [
  '说人话',
  '按脑子',
  '竖起耳朵',
  '别给自己加戏',
  '查户口',
];
const PAID_SUPPORT_LANGUAGE = /(?:礼物|辣条|打赏|投喂|上舰|舰长|充电|送了|刷了|收了)/u;
const RETENTION_PRESSURE =
  /(?:不许|不能|不准|必须|得).{0,8}(?:走|跑|离开|留下|陪)|(?:收了|送了|刷了).{0,10}(?:还(?:想|能)?跑|别跑|不能跑|得陪|留下)|(?:欠我|欠着).{0,8}(?:陪|关注|礼物)/u;
const SUPPORT_CTA = /(?:点个|记得|赶紧|必须|得).{0,6}(?:关注|点赞|投币|送礼|上舰)/u;
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
  | 'lifecycle'
  | 'hazard'
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
    intent: 'lifecycle',
    question:
      /哪来(?:的)?|从哪来|存在过|有过|是几号|几号台风|后来|现在怎么样|目前怎么样/,
    answer:
      /不是凭空|\d{4}年第\d+号台风|存在过|不再活动|停止编号|退出.{0,6}活动|最后可核验|减弱为/,
  },
  {
    intent: 'hazard',
    question:
      /\u96e8\u707e|\u6c34\u707e|\u6d2a\u6c34|\u5185\u6d9d|\u79ef\u6c34|\u5c71\u6d2a|\u6ce5\u77f3\u6d41|\u6df9\u6c34|\u5012\u704c/,
    answer:
      /\u96e8\u707e|\u6c34\u707e|\u6d2a\u6c34|\u5185\u6d9d|\u79ef\u6c34|\u5c71\u6d2a|\u6ce5\u77f3\u6d41|\u6df9\u6c34|\u5012\u704c|\u707e\u60c5|\u9884\u8b66/,
  },
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
  if (intents.includes('hazard')) {
    return '\u5f53\u524d\u8d44\u6599\u6ca1\u6709\u53ef\u6838\u5b9e\u7684\u707e\u60c5\u6216\u5b98\u65b9\u9884\u8b66\uff0c\u6211\u4e0d\u80fd\u636e\u6b64\u5224\u65ad\u5f53\u5730\u662f\u5426\u5b89\u5168\u3002';
  }
  if (intents.includes('history')) {
    return '当前实时资料不包含这项历史记录，我不能拿台风实况代替回答。';
  }
  if (intents.includes('lifecycle')) {
    return '当前资料不足以核实这个台风的历史身份和生命周期，我不把命名常识冒充成这次事件的记录。';
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
  const canUseVerifiedWeatherFallback = Boolean(
    context?.isWeather &&
      reasons.includes('unsafe_artifact') &&
      Array.isArray(context.claims) &&
      context.claims.length > 0,
  );
  if (
    reasons.includes('gift_retention_pressure') ||
    reasons.includes('paid_support_cta')
  ) {
    return GIFT_BOUNDARY_FALLBACK;
  }
  if (
    !reasons.includes('hostile_tone') &&
    (!reasons.includes('unsafe_artifact') || context?.isWeather === true) &&
    candidate &&
    !hasUnsafeSpeechArtifacts(candidate) &&
    (answersViewerIntent(viewerText, candidate) ||
      canUseVerifiedWeatherFallback)
  ) {
    return candidate;
  }
  if (reasons.includes('off_topic')) return OFF_TOPIC_FALLBACK;
  if (context?.isWeather && !reasons.includes('unsafe_artifact')) {
    return intentPreservingFallback(viewerText);
  }
  return SAFE_FALLBACK;
}

function unwrapStructuredSpeechPlan(text: string): string | null {
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(text) as {
      version?: unknown;
      beats?: Array<{ text?: unknown }>;
    };
    if (parsed.version !== 2 || !Array.isArray(parsed.beats)) return null;
    const spokenText = parsed.beats
      .slice(0, 3)
      .map((beat) =>
        typeof beat?.text === 'string' ? sanitizeSpeechText(beat.text) : '',
      )
      .filter(Boolean)
      .join(' ')
      .trim();
    return spokenText || null;
  } catch {
    return null;
  }
}

/**
 * The only viewer-facing output gate. It cleans, validates, and performs one
 * deterministic rewrite before the text can reach history, memory, or TTS.
 */
export function guardViewerResponse(
  input: string,
  context?: ResponseFactGuard,
): GuardedResponse {
  const initiallySanitized = sanitizeSpeechText(input);
  const recoveredStructuredText = unwrapStructuredSpeechPlan(
    initiallySanitized,
  );
  const sanitized = recoveredStructuredText ?? initiallySanitized;
  const unsafeArtifacts = hasUnsafeSpeechArtifacts(sanitized);
  const reasons: string[] = [];
  const evidence = evidenceText(context);

  if (context?.forceFallback) reasons.push('source_unavailable');
  if (!sanitized || unsafeArtifacts) reasons.push('unsafe_artifact');
  if (HOSTILE_PHRASES.some((phrase) => sanitized.includes(phrase))) {
    reasons.push('hostile_tone');
  }
  if (
    PAID_SUPPORT_LANGUAGE.test(sanitized) &&
    RETENTION_PRESSURE.test(sanitized)
  ) {
    reasons.push('gift_retention_pressure');
  }
  if (
    context?.engagementSignals?.some((signal) =>
      ['gift', 'superchat', 'guard'].includes(signal),
    ) &&
    SUPPORT_CTA.test(sanitized)
  ) {
    reasons.push('paid_support_cta');
  }
  if (context?.isWeather) {
    if (
      context.viewerText &&
      sanitized &&
      !answersViewerIntent(context.viewerText, sanitized)
    ) {
      reasons.push('unanswered_intent');
    }
    if (
      Array.isArray(context.claims) &&
      context.claims.length === 0 &&
      sanitizeSpeechText(context.requiredAnswer ?? '')
    ) {
      reasons.push('no_fact_claims');
    }
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
    rewritten: recoveredStructuredText !== null,
    reasons,
    unsafeArtifacts,
  };
}
