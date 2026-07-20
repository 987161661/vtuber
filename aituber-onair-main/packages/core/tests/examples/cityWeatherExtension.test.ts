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
    expect(result?.context).toContain('先用一句自然调侃接住观众和城市');
    expect(result?.context).toContain('没有全国排名就绝不能说');
    expect(result?.context).toContain('只有 payload 明确表明灾害已经发生');
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

  it('retries once in the current turn before using the unavailable fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            requiredAnswer:
              '\u56db\u5e73\u5e02\u57ce\u5e02\u4ee3\u8868\u70b9\u5f53\u524d\u4e3a\u96fe\u3002',
            claims: [
              {
                type: 'representative_point_observation',
                text: '\u56db\u5e73\u5e02\u5f53\u524d 20\u2103\u3002',
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createCityWeatherExtension().enrich({
      query: '\u5409\u6797\u56db\u5e73\u5e02',
      inheritedSkillIds: [CITY_WEATHER_EXTENSION_ID],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      forceFallback: false,
      fallbackReply:
        '\u56db\u5e73\u5e02\u57ce\u5e02\u4ee3\u8868\u70b9\u5f53\u524d\u4e3a\u96fe\u3002',
    });
  });

  it('does not replace a radar city-result envelope that already carries verified facts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await createCityWeatherExtension().enrich({
      query:
        '<city_report_engagement>已核验天气事实：上海气温37℃</city_report_engagement>',
      inheritedSkillIds: [CITY_WEATHER_EXTENSION_ID],
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
