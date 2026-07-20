type RadarCityBriefing = {
  status?: unknown;
  city?: {
    name?: unknown;
    province?: unknown;
    administrativePath?: { city?: unknown };
  };
  current?: {
    evidenceLevel?: unknown;
    observedAt?: unknown;
    temperatureC?: unknown;
    apparentTemperatureC?: unknown;
    precipitationMm?: unknown;
    weatherText?: unknown;
  };
  minutelyRain?: {
    available?: unknown;
    summary?: unknown;
  };
  sources?: Array<{
    id?: unknown;
    label?: unknown;
    limitation?: unknown;
  }>;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export async function fetchRadarCityWeather(options: {
  baseUrl: string;
  location: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/api/city-briefing?city=${encodeURIComponent(options.location)}`;
  const response = await fetcher(endpoint, {
    cache: 'no-store',
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
  });
  const payload = (await response.json()) as RadarCityBriefing;
  const current = payload.current;
  const cityName =
    text(payload.city?.administrativePath?.city) ?? text(payload.city?.name);
  const province = text(payload.city?.province);
  if (!response.ok || payload.status !== 'available' || !current || !cityName) {
    throw new Error('radar_city_weather_unavailable');
  }

  const canonicalName = [cityName, province].filter(Boolean).join('\uff0c');
  const temperatureC = finite(current.temperatureC);
  const apparentTemperatureC = finite(current.apparentTemperatureC);
  const precipitationMm = finite(current.precipitationMm);
  const weatherText =
    text(current.weatherText) ?? '\u5929\u6c14\u72b6\u51b5\u672a\u5206\u7c7b';
  const currentParts = [
    `${canonicalName}\u57ce\u5e02\u4ee3\u8868\u70b9\u5f53\u524d${weatherText}`,
    temperatureC === undefined ? '' : `\u6c14\u6e29 ${temperatureC}\u2103`,
    apparentTemperatureC === undefined
      ? ''
      : `\u4f53\u611f ${apparentTemperatureC}\u2103`,
    precipitationMm === undefined
      ? ''
      : `\u5f53\u524d\u964d\u6c34 ${precipitationMm} \u6beb\u7c73`,
  ].filter(Boolean);
  const minutelySummary =
    payload.minutelyRain?.available === true
      ? text(payload.minutelyRain.summary)
      : undefined;
  const limitation =
    payload.sources
      ?.map((source) => text(source.limitation))
      .find((value) => value?.includes('\u4e0d\u4ee3\u8868')) ??
    '\u57ce\u5e02\u4ee3\u8868\u70b9\u8d44\u6599\u4e0d\u4ee3\u8868\u5168\u5e02\u6bcf\u4e2a\u4f4d\u7f6e\u3002';
  const normalizedLimitation = limitation.includes(
    '\u5168\u5e02\u6bcf\u4e2a\u4f4d\u7f6e',
  )
    ? limitation
    : '\u57ce\u5e02\u4ee3\u8868\u70b9\u8d44\u6599\u4e0d\u4ee3\u8868\u5168\u5e02\u6bcf\u4e2a\u4f4d\u7f6e\u3002';
  const requiredAnswer = `${currentParts.join('\uff0c')}\u3002${
    minutelySummary ? `${minutelySummary}\u3002` : ''
  }${normalizedLimitation}`;

  return {
    provider: 'typhoon-boss-radar',
    queriedAt: Date.now(),
    placeResolution: {
      status: 'resolved',
      query: options.location,
      canonicalName,
    },
    current,
    minutelyRain: payload.minutelyRain,
    sources: payload.sources,
    claims: [
      {
        type: 'representative_point_observation',
        evidenceLevel: text(current.evidenceLevel) ?? 'observed',
        observedAt: text(current.observedAt),
        text: currentParts.join('\uff0c'),
      },
      ...(minutelySummary
        ? [
            {
              type: 'minutely_forecast',
              evidenceLevel: 'model',
              text: minutelySummary,
            },
          ]
        : []),
    ],
    requiredAnswer,
  };
}
