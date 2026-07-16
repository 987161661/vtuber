import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  VIEWER_FOLLOW_STORAGE_KEY,
  createLiveCommentEvent,
  createViewerFollowRegistry,
  createViewerRelationEvent,
  viewerFollowIdentityKey,
} from '../../examples/react-purupuru-app/src/lib/viewerFollowRegistry';
import {
  isRadarCityCommand,
  isRadarCityCommentEvent,
} from '../../examples/react-purupuru-app/src/lib/radarCityBridge';

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(VIEWER_FOLLOW_STORAGE_KEY, initial);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

describe('viewer follow registry', () => {
  it('uses normalized platform and exact viewer id without nickname fallback', () => {
    expect(
      viewerFollowIdentityKey({ platform: ' BiliBili ', viewerId: ' U-42 ' }),
    ).toBe('bilibili:U-42');
    expect(
      viewerFollowIdentityKey({ platform: 'bilibili', viewerId: 'u-42' }),
    ).toBe('bilibili:u-42');
    expect(
      viewerFollowIdentityKey({ platform: 'bilibili', viewerId: '   ' }),
    ).toBeUndefined();
  });

  it('persists observations and restores them in a new registry', () => {
    const storage = createStorage();
    const first = createViewerFollowRegistry(storage);
    first.record({ platform: 'BILIBILI', viewerId: ' 1001 ' }, 123_456);
    expect(
      first.record({ platform: 'bilibili', viewerId: '   ' }, 999),
    ).toBeUndefined();

    const restored = createViewerFollowRegistry(storage);
    expect(
      restored.observedAt({ platform: 'bilibili', viewerId: '1001' }),
    ).toBe(123_456);
  });

  it('isolates the same viewer id across platforms', () => {
    const registry = createViewerFollowRegistry(createStorage());
    registry.record({ platform: 'bilibili', viewerId: '1001' }, 111);

    expect(
      registry.observedAt({ platform: 'bilibili', viewerId: '1001' }),
    ).toBe(111);
    expect(
      registry.observedAt({ platform: 'douyin', viewerId: '1001' }),
    ).toBeUndefined();
  });

  it('creates the verified parent relation event contract', () => {
    expect(
      createViewerRelationEvent({
        id: 'follow-1',
        viewerId: ' 1001 ',
        viewerName: '同名观众',
        platform: ' BILIBILI ',
        observedAt: 456,
      }),
    ).toEqual({
      type: 'aituber:viewer-relation',
      version: 1,
      id: 'follow-1',
      relation: 'follow',
      state: 'verified',
      viewerId: '1001',
      viewerName: '同名观众',
      platform: 'bilibili',
      observedAt: 456,
    });
  });

  it('annotates comments with observed or unknown follow evidence', () => {
    const base = {
      id: 'comment-1',
      text: '@乌鲁木齐',
      viewerId: ' 1001 ',
      viewerName: '观众',
      platform: 'bilibili',
      receivedAt: 789,
    };

    expect(createLiveCommentEvent(base)).toMatchObject({
      viewerId: '1001',
      followEvidence: 'unknown',
    });
    expect(createLiveCommentEvent(base)).not.toHaveProperty('followObservedAt');
    expect(
      createLiveCommentEvent({ ...base, followObservedAt: 123 }),
    ).toMatchObject({
      followEvidence: 'observed',
      followObservedAt: 123,
    });
  });

  it('accepts only complete city-comment broadcasts for the radar overlay', () => {
    const event = createLiveCommentEvent({
      id: 'city-1',
      text: '@上海',
      viewerId: '1001',
      viewerName: '观众',
      platform: 'bilibili',
      receivedAt: 789,
    });
    expect(isRadarCityCommentEvent(event)).toBe(true);
    expect(isRadarCityCommentEvent({ ...event, receivedAt: undefined })).toBe(false);
    expect(isRadarCityCommand('@上海')).toBe(true);
    expect(isRadarCityCommand('@Auckland')).toBe(false);
  });

  it('keeps real and simulator events on the shared live-room bridge path', () => {
    const appSource = readFileSync(
      new URL('../../examples/react-purupuru-app/src/App.tsx', import.meta.url),
      'utf8',
    );

    expect(appSource).toContain("comment.type === 'follow'");
    expect(appSource).toContain('viewerFollowRegistry.record(');
    expect(appSource).toContain('createViewerRelationEvent({');
    expect(appSource).toContain('createLiveCommentEvent({');
    expect(appSource).toContain('receivedAt: comment.timestamp || Date.now()');
    expect(appSource).toContain("comment.metadata?.source !== 'history-poll'");
    expect(appSource).toContain('liveDirector.updateRoomState({ isLive: true });');
    expect(appSource).toContain('new BroadcastChannel(RADAR_CITY_EVENT_CHANNEL)');
    expect(appSource).toContain('readRelayedRadarCityComments(after)');
    expect(appSource).toContain('relayRadarCityComment(radarCityComment)');
    expect(appSource).toContain('if (isCityCommand) {');
    expect(appSource).toContain('handleLiveRoomEvent(event);');
    expect(appSource).toContain('viewerId: comment.author.id');
    expect(appSource).not.toContain('viewerId: comment.author.name');
  });
});
