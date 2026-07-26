import { buildSpeechPlanV2 } from '@aituber-onair/core';
import type { TurnFactSnapshot } from './turnEnvelope';

export type CityReportPayloadV2 = {
  version: 2;
  eventId: string;
  viewerId?: string;
  viewerName: string;
  city: string;
  queryTime?: string;
  factsText: string;
  sourceNames: string[];
  safetyText?: string;
  viewerQuestion?: string;
  socialIntent?: string;
  allowedNumbers: string[];
};

export type CityReportBindingValidation = {
  valid: boolean;
  reasons: string[];
};

export type CityReportGenerationAttempt =
  | { index: number; status: 'accepted' }
  | { index: number; status: 'rejected'; reasons: string[] }
  | { index: number; status: 'failed'; error: string };

export type PreparedIsolatedCityReport = {
  reply: string;
  speechPlan: ReturnType<typeof buildSpeechPlanV2>;
  usedDeterministicFallback: boolean;
  attempts: CityReportGenerationAttempt[];
};

const CITY_REPORT_TAG = '<city_report_engagement>';
const NUMBER_TOKEN = /\d+(?:\.\d+)?/gu;
const SOCIAL_INTENT =
  /(?:意义是什么|为什么要看|有什么用|陪伴|值不值得|你怎么看|你觉得呢|怎么办|害怕|担心)/u;
const TIME_OF_DAY_CLAIM =
  /(?:凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚|今早|今夜)/u;
const PRECIPITATION_EVIDENCE = /(?:雨|雪|降水|雷暴|冰雹)/u;
const PRECIPITATION_ADVICE = /(?:带(?:一把|把)?伞|雨伞|淋雨|防雨|避雨)/u;
const RANK_MARKER = /(?:排名|排第|排在|第[一二三四五六七八九十百零\d]+)/u;
const RANK_DIMENSIONS = ['体感温度', '降水', '湿度', '气温', '风速'] as const;

function field(text: string, label: string): string {
  return (
    text.match(new RegExp(`${label}：?\\s*([^；;\\r\\n<]{1,160})`, 'u'))?.[1] ??
    ''
  ).trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function isCityReportPayload(text: string, eventId = ''): boolean {
  return (
    text.includes(CITY_REPORT_TAG) || eventId.startsWith('city-engagement:')
  );
}

export function parseCityReportPayloadV2(input: {
  eventId: string;
  text: string;
  viewerId?: string;
  viewerName?: string;
}): CityReportPayloadV2 | null {
  if (!isCityReportPayload(input.text, input.eventId)) return null;
  const viewerName =
    field(input.text, '目标观众').replace(/^@+/u, '') || input.viewerName || '';
  const city = field(input.text, '查询城市') || field(input.text, '已展开城市');
  const factsText = field(input.text, '已核验天气事实');
  if (!viewerName || !city || !factsText) return null;
  const viewerQuestion = field(input.text, '观众原始问题');
  const queryTime = field(input.text, '数据时次') || undefined;
  const safetyText = field(input.text, '安全提示') || undefined;
  const sourceText = field(input.text, '数据来源');
  return {
    version: 2,
    eventId: input.eventId,
    viewerId: input.viewerId,
    viewerName,
    city,
    queryTime,
    factsText,
    sourceNames: sourceText
      ? sourceText.split(/[、,，]/u).map((item) => item.trim())
      : [],
    safetyText,
    viewerQuestion: viewerQuestion || undefined,
    socialIntent:
      viewerQuestion && SOCIAL_INTENT.test(viewerQuestion)
        ? viewerQuestion
        : undefined,
    allowedNumbers: unique(factsText.match(NUMBER_TOKEN) ?? []),
  };
}

export function cityReportFactSnapshot(
  payload: CityReportPayloadV2,
): TurnFactSnapshot {
  return {
    kind: 'city-report',
    city: payload.city,
    queryTime: payload.queryTime,
    allowedNumbers: payload.allowedNumbers,
    sourceNames: payload.sourceNames,
  };
}

export function buildIsolatedCityReportMessages(payload: CityReportPayloadV2) {
  return [
    {
      role: 'system' as const,
      content:
        '你是凌岚，一名有个性但事实严格的中文气象主播。只处理本条结构化城市播报，不使用任何历史对话。你的输出会不经解释直接送入中文TTS，因此必须输出1至2句自然、可直接朗读的纯口播，不输出JSON、标签或供机器读取的简写。必须称呼指定观众、说出指定城市；所有数字只能来自事实字段。没有数据时次就禁止添加早上好、晚上好、今晚、今夜等时间判断。只能播报事实字段明确给出的排名维度，禁止给其他指标补排名。只有事实或安全提示明确涉及降水时才能给出带伞、防雨等建议。事实中的斜杠排名不是分数：类似“全国排名湿度第1/354”“体感温度第10/354”的A/B表示当前名次A、参评城市总数B。必须把它改写为“全国三百五十四个城市中，湿度排名第一”“全国三百五十四个城市中，体感温度排名第十”这类自然中文；禁止原样输出斜杠排名，禁止说成“B分之一”。若有非天气意图，天气事实后必须自然回应该意图。',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        targetViewer: payload.viewerName,
        city: payload.city,
        queryTime: payload.queryTime,
        verifiedFacts: payload.factsText,
        safety: payload.safetyText,
        viewerQuestion: payload.viewerQuestion,
        socialIntent: payload.socialIntent,
      }),
    },
  ];
}

export function validateCityReportBinding(
  reply: string,
  payload: CityReportPayloadV2,
  context: { forbiddenViewerNames?: string[]; forbiddenCities?: string[] } = {},
): CityReportBindingValidation {
  const reasons: string[] = [];
  const normalized = reply.normalize('NFKC');
  if (!normalized.includes(payload.viewerName.normalize('NFKC'))) {
    reasons.push('target_viewer_missing');
  }
  if (!normalized.includes(payload.city.normalize('NFKC'))) {
    reasons.push('target_city_missing');
  }
  for (const token of normalized.match(NUMBER_TOKEN) ?? []) {
    if (!payload.allowedNumbers.includes(token)) {
      reasons.push(`unverified_number:${token}`);
    }
  }
  if (
    TIME_OF_DAY_CLAIM.test(normalized) &&
    !hasVerifiedTimeContext(normalized, payload)
  ) {
    reasons.push('unverified_time_context');
  }
  if (
    PRECIPITATION_ADVICE.test(normalized) &&
    !PRECIPITATION_EVIDENCE.test(
      `${payload.factsText} ${payload.safetyText ?? ''}`,
    )
  ) {
    reasons.push('unsupported_precipitation_advice');
  }
  const allowedRankDimensions = new Set(
    [...payload.factsText.matchAll(/全国排名([^第，。；]{1,12})第/gu)].map(
      (match) => match[1].trim(),
    ),
  );
  for (const clause of normalized.split(/[，。；！？!?]/u)) {
    if (!RANK_MARKER.test(clause)) continue;
    for (const dimension of RANK_DIMENSIONS) {
      if (clause.includes(dimension) && !allowedRankDimensions.has(dimension)) {
        reasons.push(`unverified_rank_dimension:${dimension}`);
      }
    }
  }
  for (const viewerName of context.forbiddenViewerNames ?? []) {
    if (
      viewerName &&
      viewerName !== payload.viewerName &&
      normalized.includes(viewerName)
    ) {
      reasons.push(`other_viewer:${viewerName}`);
    }
  }
  for (const city of context.forbiddenCities ?? []) {
    if (city && city !== payload.city && normalized.includes(city)) {
      reasons.push(`other_city:${city}`);
    }
  }
  return { valid: reasons.length === 0, reasons: unique(reasons) };
}

function hasVerifiedTimeContext(
  reply: string,
  payload: CityReportPayloadV2,
): boolean {
  const evidence = `${payload.factsText} ${payload.safetyText ?? ''} ${payload.viewerQuestion ?? ''}`;
  const claims = reply.match(TIME_OF_DAY_CLAIM)?.[0];
  if (claims && evidence.includes(claims)) return true;
  if (!payload.queryTime) return false;
  const hourText = payload.queryTime.match(/(?:T|\s)(\d{2}):\d{2}/u)?.[1];
  const hour = hourText === undefined ? Number.NaN : Number(hourText);
  if (!Number.isFinite(hour)) return false;
  if (/(?:凌晨)/u.test(reply)) return hour < 6;
  if (/(?:清晨|早上|早晨|上午|今早)/u.test(reply)) return hour >= 5 && hour < 12;
  if (/(?:中午)/u.test(reply)) return hour >= 11 && hour < 14;
  if (/(?:下午)/u.test(reply)) return hour >= 12 && hour < 19;
  if (/(?:傍晚)/u.test(reply)) return hour >= 17 && hour < 20;
  if (/(?:晚上|今晚|今夜)/u.test(reply)) return hour >= 18;
  return false;
}

function integerToSpokenChinese(value: number): string {
  const digits = '零一二三四五六七八九';
  if (!Number.isSafeInteger(value) || value < 0 || value > 9999) {
    return String(value);
  }
  if (value < 10) return digits[value];
  const units = ['', '十', '百', '千'];
  const chars = String(value).split('').map(Number);
  let result = '';
  let pendingZero = false;
  chars.forEach((digit, index) => {
    const unitIndex = chars.length - index - 1;
    if (digit === 0) {
      pendingZero = result.length > 0 && chars.slice(index + 1).some(Boolean);
      return;
    }
    if (pendingZero) result += '零';
    if (!(digit === 1 && unitIndex === 1 && result === '')) result += digits[digit];
    result += units[unitIndex];
    pendingZero = false;
  });
  return result;
}

function verbalizeRankFacts(factsText: string): string {
  return factsText.replace(
    /全国排名([^第，。；]{1,12})第(\d+)\/(\d+)/gu,
    (_match, dimension: string, rank: string, total: string) =>
      `全国${integerToSpokenChinese(Number(total))}个城市中，${dimension}排名第${integerToSpokenChinese(Number(rank))}`,
  );
}

export function composeDeterministicCityReply(
  payload: CityReportPayloadV2,
): string {
  const spokenFacts = verbalizeRankFacts(payload.factsText);
  const factReply = `${payload.viewerName}，${payload.city}${spokenFacts.startsWith(payload.city) ? spokenFacts.slice(payload.city.length) : `：${spokenFacts}`}`;
  const safety = payload.safetyText ? ` ${payload.safetyText}` : '';
  const social = payload.socialIntent
    ? ' 至于这个直播间的意义，就是把能确认的信息讲清楚，也在这种天气里陪你一起盯着变化。'
    : '';
  return `${factReply.replace(/[。！？!?]*$/u, '。')}${safety}${social}`.trim();
}

export async function prepareIsolatedCityReport(input: {
  payload: CityReportPayloadV2;
  recentTurns: readonly {
    viewerName?: string;
    input: string;
    reply?: string;
  }[];
  generate: (
    messages: ReturnType<typeof buildIsolatedCityReportMessages>,
    options: { timeoutMs: number; maxTokens: number },
  ) => Promise<string>;
}): Promise<PreparedIsolatedCityReport> {
  const forbiddenViewerNames = input.recentTurns
    .map((turn) => turn.viewerName || '')
    .filter(Boolean);
  const forbiddenCities = input.recentTurns
    .flatMap((turn) => [turn.input, turn.reply || ''])
    .flatMap((value) =>
      [
        ...value.matchAll(/(?:查询城市：|已展开城市：)([^；;\r\n<]+)/gu),
      ].map((match) => match[1].trim()),
    );
  const attempts: CityReportGenerationAttempt[] = [];
  let reply = '';

  for (let index = 1; index <= 2; index += 1) {
    try {
      const candidate = await input.generate(
        buildIsolatedCityReportMessages(input.payload),
        { timeoutMs: 12_000, maxTokens: 180 },
      );
      const validation = validateCityReportBinding(candidate, input.payload, {
        forbiddenViewerNames,
        forbiddenCities,
      });
      if (validation.valid) {
        attempts.push({ index, status: 'accepted' });
        reply = candidate;
        break;
      }
      attempts.push({
        index,
        status: 'rejected',
        reasons: validation.reasons,
      });
    } catch (error) {
      attempts.push({
        index,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const usedDeterministicFallback = !reply;
  if (!reply) reply = composeDeterministicCityReply(input.payload);
  return {
    reply,
    usedDeterministicFallback,
    attempts,
    speechPlan: buildSpeechPlanV2(reply, {
      emotion: input.payload.safetyText ? 'serious' : 'relaxed',
      delivery: input.payload.safetyText ? 'clear' : 'teasing',
      emotionIntensity: input.payload.safetyText ? 0.62 : 0.48,
      motion: input.payload.safetyText ? 'serious_report' : 'idle_cold',
    }),
  };
}
