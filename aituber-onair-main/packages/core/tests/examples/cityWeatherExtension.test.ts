import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CITY_WEATHER_EXTENSION_ID,
  createCityWeatherExtension,
} from '../../examples/react-purupuru-app/src/host-extensions/cityWeather';

describe('city weather extension', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('only runs when explicitly selected and preserves factual payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requiredAnswer: '北京当前天气为晴，气温 28°C。',
          claims: [{ type: 'current_observation', text: '北京当前 28°C。' }],
          placeResolution: { status: 'resolved', canonicalName: '北京市' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const extension = createCityWeatherExtension();

    expect(
      await extension.enrich({ query: '北京', inheritedSkillIds: [] }),
    ).toBeNull();
    const result = await extension.enrich({
      query: '北京',
      inheritedSkillIds: [CITY_WEATHER_EXTENSION_ID],
    });

    expect(result).toMatchObject({
      skills: [CITY_WEATHER_EXTENSION_ID],
      isDomainSensitive: true,
      forceFallback: false,
      fallbackReply: '北京当前天气为晴，气温 28°C。',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fails closed without switching to a typhoon answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await createCityWeatherExtension().enrich({
      query: '北京',
      inheritedSkillIds: [CITY_WEATHER_EXTENSION_ID],
    });

    expect(result).toMatchObject({
      skills: [CITY_WEATHER_EXTENSION_ID],
      forceFallback: true,
    });
    expect(result?.fallbackReply).toContain('城市天气');
    expect(result?.fallbackReply).not.toContain('台风');
  });
});
