import { describe, expect, it, vi } from 'vitest';
import { forwardRadarCityEvent } from '../../examples/react-purupuru-app/server/radarCityEventForwarder';

describe('radar city event forwarder', () => {
  it('forwards the digital-host city event into the radar live-event API', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    const event = {
      type: 'aituber:live-comment' as const,
      version: 1 as const,
      id: 'city-guangzhou',
      text: '@\u5e7f\u5dde',
      receivedAt: 1_784_500_000_000,
    };

    await forwardRadarCityEvent({
      baseUrl: 'http://127.0.0.1:3038/',
      event,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3038/api/live-city-events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(event),
      }),
    );
  });

  it('surfaces a rejected radar relay without changing the event', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(
      forwardRadarCityEvent({
        baseUrl: 'http://127.0.0.1:3038',
        event: {
          type: 'aituber:live-comment',
          version: 1,
          id: 'city-siping',
          text: '@\u56db\u5e73',
          receivedAt: 1_784_500_000_001,
        },
        fetcher,
      }),
    ).rejects.toThrow('radar_city_forward_503');
  });
});
