import { describe, expect, it, vi } from 'vitest';
import { fetchRadarCityWeather } from '../../examples/react-purupuru-app/server/cityWeatherRadarAdapter';

describe('city weather radar adapter', () => {
  it('uses the radar city resolver and preserves representative-point limits', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'available',
          city: {
            name: '\u56db\u5e73',
            province: '\u5409\u6797\u7701',
            administrativePath: { city: '\u56db\u5e73\u5e02' },
          },
          current: {
            evidenceLevel: 'observed',
            observedAt: '2026-07-20T05:58+08:00',
            temperatureC: 20,
            apparentTemperatureC: 22,
            precipitationMm: 0,
            weatherText: '\u96fe',
          },
          minutelyRain: {
            available: true,
            summary: '\u672a\u6765\u4e24\u5c0f\u65f6\u65e0\u964d\u6c34',
          },
          sources: [
            {
              id: 'qweather-now',
              label:
                '\u548c\u98ce\u5929\u6c14\u57ce\u5e02\u4ee3\u8868\u70b9\u8fd1\u5b9e\u65f6\u5929\u6c14',
              limitation:
                '\u4e0d\u4ee3\u8868\u6574\u5ea7\u57ce\u5e02\u6bcf\u4e2a\u4f4d\u7f6e\u3002',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchRadarCityWeather({
      baseUrl: 'http://127.0.0.1:3038',
      location: '\u5409\u6797\u56db\u5e73\u5e02',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3038/api/city-briefing?city=%E5%90%89%E6%9E%97%E5%9B%9B%E5%B9%B3%E5%B8%82',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(result).toMatchObject({
      provider: 'typhoon-boss-radar',
      placeResolution: {
        status: 'resolved',
        query: '\u5409\u6797\u56db\u5e73\u5e02',
        canonicalName: '\u56db\u5e73\u5e02\uff0c\u5409\u6797\u7701',
      },
    });
    expect(result.requiredAnswer).toContain('\u57ce\u5e02\u4ee3\u8868\u70b9');
    expect(result.requiredAnswer).toContain(
      '\u4e0d\u4ee3\u8868\u5168\u5e02\u6bcf\u4e2a\u4f4d\u7f6e',
    );
    expect(result.claims).toHaveLength(2);
  });

  it('rejects unavailable radar payloads so the caller can use its fallback', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'unavailable' }), {
          status: 200,
        }),
      );

    await expect(
      fetchRadarCityWeather({
        baseUrl: 'http://127.0.0.1:3038',
        location: '\u56db\u5e73\u5e02',
        fetcher,
      }),
    ).rejects.toThrow('radar_city_weather_unavailable');
  });
});
