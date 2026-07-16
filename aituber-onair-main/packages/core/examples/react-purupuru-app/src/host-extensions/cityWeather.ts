import type { HostExtension } from './types';

export const CITY_WEATHER_EXTENSION_ID = 'city-weather';

type CityWeatherPayload = Record<string, unknown> & {
  error?: unknown;
  requiredAnswer?: unknown;
  claims?: unknown;
};

const CITY_WEATHER_UNAVAILABLE_REPLY =
  '城市天气数据这次没有回来，我先不拿旧印象猜。稍后再查一次。';

/** Built-in factual weather capability, deliberately separate from typhoons. */
export function createCityWeatherExtension(): HostExtension {
  return {
    id: CITY_WEATHER_EXTENSION_ID,
    async enrich(input) {
      if (!input.inheritedSkillIds.includes(CITY_WEATHER_EXTENSION_ID)) {
        return null;
      }

      try {
        const response = await fetch(
          `/api/city-weather?location=${encodeURIComponent(input.query)}`,
          { cache: 'no-store' },
        );
        const payload = (await response.json()) as CityWeatherPayload;
        if (!response.ok || payload.error) throw new Error('city_weather_failed');
        const requiredAnswer =
          typeof payload.requiredAnswer === 'string'
            ? payload.requiredAnswer
            : CITY_WEATHER_UNAVAILABLE_REPLY;
        return {
          context: `\n\n<city_weather_skill>这是城市天气技能的已验证结果。只依据 claims 回答；current 是当前实况，daily 是模式预报，二者不得混写。不得改答台风状态，也不得补充 claims 中没有的数字。\n${JSON.stringify(payload)}\n</city_weather_skill>`,
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
