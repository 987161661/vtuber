import type { HostExtension } from './types';

export const CITY_WEATHER_EXTENSION_ID = 'city-weather';

type CityWeatherPayload = Record<string, unknown> & {
  error?: unknown;
  requiredAnswer?: unknown;
  claims?: unknown;
};

function cityWeatherBanterContract(payload: CityWeatherPayload): string {
  const hasComparisons =
    Array.isArray(payload.comparisons) && payload.comparisons.length > 0;
  return `\n互动表达协议：先用一句自然调侃接住观众和城市，再把关键实况说清。调侃只能来自 payload 中的 current、daily、claims${
    hasComparisons ? '、comparisons（含排名或同类比较）' : ''
  }；没有全国排名就绝不能说“全国最热/排名很高”。可根据已给出的高温、体感温差、降水概率、风、雾、雪等事实做拟人化联想，并允许凌岚笨拙露出气象 AI 马脚，例如顺口说“你们人类”“热宕机”，随后若无其事地掩饰。不得机械复述 requiredAnswer，不固定套用同一句梗。预警仍可轻度有趣，但必须先让风险和行动清楚；只有 payload 明确表明灾害已经发生、有人受困/受伤、正在撤离或救援时，完全停止调侃并严肃表达。`;
}

const CITY_WEATHER_UNAVAILABLE_REPLY =
  '城市天气数据这次没有回来，我先不拿旧印象猜。稍后再查一次。';

/** Built-in factual weather capability, deliberately separate from typhoons. */
export function createCityWeatherExtension(): HostExtension {
  return {
    id: CITY_WEATHER_EXTENSION_ID,
    async enrich(input) {
      // This envelope already contains the current city card's verified facts.
      if (input.query.includes('<city_report_engagement>')) return null;
      if (!input.inheritedSkillIds.includes(CITY_WEATHER_EXTENSION_ID)) {
        return null;
      }

      try {
        const response = await fetch(
          `/api/city-weather?location=${encodeURIComponent(input.query)}`,
          { cache: 'no-store' },
        );
        const payload = (await response.json()) as CityWeatherPayload;
        if (!response.ok || payload.error)
          throw new Error('city_weather_failed');
        const requiredAnswer =
          typeof payload.requiredAnswer === 'string'
            ? payload.requiredAnswer
            : CITY_WEATHER_UNAVAILABLE_REPLY;
        return {
          context: `\n\n<city_weather_skill>这是城市天气技能的已验证结果。只依据 claims 回答；current 是当前实况，daily 是模式预报，二者不得混写。不得改答台风状态，也不得补充 claims 中没有的数字。${cityWeatherBanterContract(payload)}\n${JSON.stringify(payload)}\n</city_weather_skill>`,
          skills: [CITY_WEATHER_EXTENSION_ID],
          isDomainSensitive: true,
          fallbackReply: requiredAnswer,
          forceFallback: false,
          payload,
        };
      } catch {
        return {
          context:
            '\n\n<city_weather_skill>城市天气数据当前不可用。明确说明没有查到，不得猜测。</city_weather_skill>',
          skills: [CITY_WEATHER_EXTENSION_ID],
          isDomainSensitive: true,
          fallbackReply: CITY_WEATHER_UNAVAILABLE_REPLY,
          forceFallback: true,
          payload: {
            claims: [],
            placeResolution: { status: 'unavailable', query: input.query },
          },
        };
      }
    },
  };
}
