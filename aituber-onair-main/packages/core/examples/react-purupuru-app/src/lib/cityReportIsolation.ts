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
        '你是凌岚，一名有个性但事实严格的中文气象主播。只处理本条结构化城市播报，不使用任何历史对话。你的输出会不经解释直接送入中文TTS，因此必须输出1至2句自然、可直接朗读的纯口播，不输出JSON、标签或供机器读取的简写。必须称呼指定观众、说出指定城市；所有数字只能来自事实字段。事实中的斜杠排名不是分数：类似“全国排名湿度第1/354”“体感温度第10/354”的A/B表示当前名次A、参评城市总数B。必须把它改写为“全国三百五十四个城市中，湿度排名第一”“全国三百五十四个城市中，体感温度排名第十”这类自然中文；禁止原样输出斜杠排名，禁止说成“B分之一”。若有非天气意图，天气事实后必须自然回应该意图。',
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

export function composeDeterministicCityReply(
  payload: CityReportPayloadV2,
): string {
  const factReply = `${payload.viewerName}，${payload.city}${payload.factsText.startsWith(payload.city) ? payload.factsText.slice(payload.city.length) : `：${payload.factsText}`}`;
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
