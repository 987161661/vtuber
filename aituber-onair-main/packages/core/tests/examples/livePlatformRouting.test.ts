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
  saveOrdinaryRoadCredential,
  sendOrdinaryRoadReply,
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

  it('applies proactive and operator policies independently', () => {
    const current = settings();
    expect(
      resolveSpeechDeliveryTargets(current, {
        eventId: 'event-2',
        kind: 'proactive-speech',
      }).map((target) => target.platformId),
    ).toEqual(['twitch']);
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await saveOrdinaryRoadCredential('/gateway', 'bilibili', 'SESSDATA=secret');
    expect(fetchMock.mock.calls[0][0]).toBe('/gateway/platforms/bilibili/credential');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
  });
});
