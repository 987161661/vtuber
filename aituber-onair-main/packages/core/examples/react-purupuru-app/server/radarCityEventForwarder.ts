export type RadarCityEvent = {
  type: 'aituber:live-comment';
  version: 1;
  id: string;
  text: string;
  receivedAt: number;
  [key: string]: unknown;
};

export async function forwardRadarCityEvent(options: {
  baseUrl: string;
  event: RadarCityEvent;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `${options.baseUrl.replace(/\/$/, '')}/api/live-city-events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.event),
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
    },
  );
  if (!response.ok) {
    throw new Error(`radar_city_forward_${response.status}`);
  }
}
