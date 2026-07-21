import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveConnectorSettings } from '../../examples/react-purupuru-app/src/types/settings';
import {
  createPlatformConnection,
  platformOwner,
  resolveSpeechDeliveryTargets,
  transferPlatformOwnership,
} from '../../examples/react-purupuru-app/src/services/live-platform/connectors';
import {
  createOrdinaryRoadEventAdapter,
  fetchPlatformQrAuthStatus,
  saveOrdinaryRoadCredential,
  sendOrdinaryRoadReply,
  startPlatformQrAuth,
} from '../../examples/react-purupuru-app/src/services/live-platform/ordinaryRoad';

function settings(): LiveConnectorSettings {
  return {
    schemaVersion: 1,
    ordinaryRoad: {
      enabled: true,
      gatewayUrl: '/api/live-connectors/ordinaryroad',
      platforms: {
        bilibili: createPlatformConnection('21573209', true, {
          viewerReplies: true,
          proactiveSpeech: false,
          operatorBroadcasts: true,
        }),
        douyin: createPlatformConnection('100', true, {
          viewerReplies: true,
          proactiveSpeech: true,
          operatorBroadcasts: true,
        }),
      },
    },
    socialStreamNinja: {
      enabled: true,
      sessionId: 'session',
      serverUrl: 'wss://example.test',
      platforms: {
        twitch: createPlatformConnection('', true, {
          viewerReplies: true,
          proactiveSpeech: true,
          operatorBroadcasts: false,
        }),
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('multi-platform connector routing', () => {
  it('atomically transfers a platform between connectors', () => {
    const next = transferPlatformOwnership(
      settings(),
      'bilibili',
      'social-stream-ninja',
    );
    expect(next.ordinaryRoad.platforms.bilibili.enabled).toBe(false);
    expect(next.socialStreamNinja.platforms.bilibili.enabled).toBe(true);
    expect(platformOwner(next, 'bilibili')).toBe('social-stream-ninja');
  });

  it('sends viewer replies only to their source connector and platform', () => {
    expect(
      resolveSpeechDeliveryTargets(settings(), {
        eventId: 'event-1',
        kind: 'viewer-reply',
        sourceConnectorId: 'social-stream-ninja',
        sourcePlatformId: 'twitch',
      }),
    ).toEqual([
      {
        connectorId: 'social-stream-ninja',
        platformId: 'twitch',
        roomId: '',
      },
    ]);
  });

  it('routes a radar city report back to the original comment platform', () => {
    expect(
      resolveSpeechDeliveryTargets(settings(), {
        eventId: 'city-engagement:bilibili:request-1',
        kind: 'viewer-reply',
        sourcePlatformId: 'typhoon-radar',
      }),
    ).toEqual([
      {
        connectorId: 'ordinaryroad',
        platformId: 'bilibili',
        roomId: '21573209',
      },
    ]);
  });

  it('does not let a stale disabled reply preference block automated replies', () => {
    const current = settings();
    current.ordinaryRoad.platforms.bilibili.outbound.viewerReplies = false;

    expect(
      resolveSpeechDeliveryTargets(current, {
        eventId: 'city-engagement:bilibili:request-2',
        kind: 'viewer-reply',
        sourcePlatformId: 'typhoon-radar',
      }).map((target) => target.platformId),
    ).toEqual(['bilibili']);
  });

  it('never mirrors idle proactive speech into automated platform comments', () => {
    const current = settings();
    expect(
      resolveSpeechDeliveryTargets(current, {
        eventId: 'event-2',
        kind: 'proactive-speech',
      }).map((target) => target.platformId),
    ).toEqual([]);
  });

  it('keeps explicit operator broadcasts independently routable', () => {
    const current = settings();
    expect(
      resolveSpeechDeliveryTargets(current, {
        eventId: 'event-3',
        kind: 'operator-broadcast',
      }).map((target) => target.platformId),
    ).toEqual(['bilibili']);
  });

  it('does not route text to a receive-only OrdinaryRoad platform', () => {
    expect(
      resolveSpeechDeliveryTargets(settings(), {
        eventId: 'event-4',
        kind: 'proactive-speech',
      }).some((target) => target.platformId === 'douyin'),
    ).toBe(false);
  });
});

describe('OrdinaryRoad generic API', () => {
  it('builds a generic SSE URL', () => {
    const adapter = createOrdinaryRoadEventAdapter('/custom/ordinaryroad/');
    expect(adapter.createEventUrl('control', 'event-7')).toBe(
      '/custom/ordinaryroad/events?client=control&lastEventId=event-7',
    );
  });

  it('targets the selected platform when sending', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, state: 'delivered' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await sendOrdinaryRoadReply('/gateway', 'douyu', {
      message: '晚上好',
      idempotencyKey: 'speech:event-7:douyu',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/gateway/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          platformId: 'douyu',
          message: '晚上好',
          idempotencyKey: 'speech:event-7:douyu',
        }),
      }),
    );
  });

  it('never places a credential in a URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await saveOrdinaryRoadCredential('/gateway', 'bilibili', 'SESSDATA=secret');
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/gateway/platforms/bilibili/credential',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
  });

  it('starts platform QR authorization through the local companion', async () => {
    const session = {
      id: 'qr-session',
      state: 'waiting-scan',
      qrDataUrl: 'data:image/png;base64,qr',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => session,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startPlatformQrAuth('douyu')).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/live-connectors/platform-auth/platforms/douyu/start',
      expect.objectContaining({ method: 'POST', cache: 'no-store' }),
    );
  });

  it('polls the active platform QR authorization session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'qr-session', state: 'waiting-confirmation' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchPlatformQrAuthStatus('huya');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/live-connectors/platform-auth/platforms/huya/status',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
