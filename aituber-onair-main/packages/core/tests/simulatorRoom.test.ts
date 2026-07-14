import { describe, expect, it } from 'vitest';
import {
  applySimulatorEventToViewer,
  createSimulatorRoomEvent,
  routeSimulatorEventForQueue,
  SIMULATOR_PLATFORM_PROFILES,
  summarizeSimulatorEvents,
  type SimulatorEventDraft,
  type SimulatorViewer,
} from '../examples/react-purupuru-app/src/lib/simulatorRoom';

const viewer: SimulatorViewer = {
  id: 'viewer-1',
  name: '小雨',
  followed: false,
  likes: 0,
  giftValue: 0,
};

function createDraft(
  update: Partial<SimulatorEventDraft>,
): SimulatorEventDraft {
  return {
    roomId: 'sim-room-001',
    platformId: 'generic-live',
    viewer,
    type: 'comment',
    commentText: '晚上好',
    likeCount: 1,
    giftName: '荧光棒',
    giftCount: 1,
    giftPrice: 1,
    superchatAmount: 30,
    ...update,
  };
}

function createEvent(update: Partial<SimulatorEventDraft>) {
  return createSimulatorRoomEvent(createDraft(update), {
    id: `simulator:${update.type ?? 'comment'}`,
    timestamp: 123,
  });
}

describe('simulator room events', () => {
  it('creates a normalized follow event and updates the viewer', () => {
    const event = createEvent({ type: 'follow' });

    expect(event).toMatchObject({
      type: 'follow',
      text: '关注了主播',
      author: { id: 'generic-live:viewer-1', name: '小雨' },
      metadata: {
        roomId: 'sim-room-001',
        platformId: 'generic-live',
        connectorId: 'simulator',
        suppressOutbound: true,
        followed: true,
      },
    });
    expect(applySimulatorEventToViewer(viewer, event).followed).toBe(true);
  });

  it('preserves a like burst and adds it to the viewer total', () => {
    const event = createEvent({ type: 'like', likeCount: 25 });

    expect(event.text).toBe('点赞 x25');
    expect(event.metadata?.clickCount).toBe(25);
    expect(applySimulatorEventToViewer(viewer, event).likes).toBe(25);
  });

  it('tracks gift quantity and value across the activity summary', () => {
    const gift = createEvent({
      type: 'gift',
      giftName: '能量电池',
      giftCount: 3,
      giftPrice: 30,
    });
    const like = createEvent({ type: 'like', likeCount: 10 });
    const follow = createEvent({ type: 'follow' });

    expect(gift).toMatchObject({
      text: '赠送 能量电池 x3',
      metadata: { giftName: '能量电池', giftCount: 3, giftPrice: 30 },
    });
    expect(applySimulatorEventToViewer(viewer, gift).giftValue).toBe(90);
    expect(summarizeSimulatorEvents([gift, like, follow])).toEqual({
      total: 3,
      follows: 1,
      likes: 10,
      gifts: 3,
      giftValue: 90,
    });
  });

  it('derives each real platform interaction set from its connector manifest', () => {
    const bilibili = SIMULATOR_PLATFORM_PROFILES.find(
      (profile) => profile.id === 'bilibili',
    );
    const huya = SIMULATOR_PLATFORM_PROFILES.find(
      (profile) => profile.id === 'huya',
    );

    expect(bilibili?.events).toEqual([
      'comment',
      'gift',
      'superchat',
      'entry',
      'like',
    ]);
    expect(bilibili?.events).not.toContain('follow');
    expect(huya?.events).toEqual(['comment', 'gift', 'entry']);
  });

  it('creates paid messages with the selected real platform identity', () => {
    const event = createEvent({
      platformId: 'bilibili',
      type: 'superchat',
      commentText: '主播看这里',
      superchatAmount: 50,
    });

    expect(event).toMatchObject({
      type: 'superchat',
      text: '醒目留言：主播看这里',
      author: { id: 'bilibili:viewer-1' },
      metadata: {
        platformId: 'bilibili',
        simulatedPlatformId: 'bilibili',
        price: 50,
        superChat: true,
      },
    });
  });

  it('keeps platform behavior but isolates simulator reply routing', () => {
    const event = createEvent({ platformId: 'bilibili', type: 'comment' });

    expect(routeSimulatorEventForQueue(event)).toMatchObject({
      metadata: {
        platformId: 'simulator:bilibili',
        sourcePlatform: 'bilibili',
        simulatedPlatformId: 'bilibili',
        suppressOutbound: true,
      },
    });
  });
});
