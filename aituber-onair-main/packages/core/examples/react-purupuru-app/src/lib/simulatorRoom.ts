import type {
  LiveRoomEvent,
  LiveRoomEventType,
} from '../services/live-platform/types';
import { ORDINARYROAD_PLATFORMS } from '../services/live-platform/connectors';

export type SimulatorInteractionType = Extract<
  LiveRoomEventType,
  'comment' | 'follow' | 'like' | 'gift' | 'entry' | 'superchat'
>;

export interface SimulatorGiftPreset {
  name: string;
  price: number;
}

export interface SimulatorPlatformProfile {
  id: string;
  label: string;
  shortLabel: string;
  connectorLabel: string;
  accent: string;
  outbound: boolean;
  events: SimulatorInteractionType[];
  giftPresets: SimulatorGiftPreset[];
  note?: string;
}

const simulatorEventTypes = new Set<SimulatorInteractionType>([
  'comment',
  'follow',
  'like',
  'gift',
  'entry',
  'superchat',
]);

const platformPresentation: Record<
  string,
  Pick<SimulatorPlatformProfile, 'shortLabel' | 'accent' | 'giftPresets'>
> = {
  bilibili: {
    shortLabel: 'B站',
    accent: '#67c7ed',
    giftPresets: [
      { name: '辣条', price: 0.1 },
      { name: '小花花', price: 1 },
      { name: '能量电池', price: 30 },
    ],
  },
  douyu: {
    shortLabel: '斗鱼',
    accent: '#ff7a32',
    giftPresets: [
      { name: '鱼丸', price: 0.1 },
      { name: '办卡', price: 6 },
      { name: '火箭', price: 500 },
    ],
  },
  huya: {
    shortLabel: '虎牙',
    accent: '#ffb547',
    giftPresets: [
      { name: '虎粮', price: 0.1 },
      { name: '藏宝图', price: 50 },
      { name: '超级火箭', price: 500 },
    ],
  },
  douyin: {
    shortLabel: '抖音',
    accent: '#ff537f',
    giftPresets: [
      { name: '小心心', price: 0.1 },
      { name: '热气球', price: 52 },
      { name: '嘉年华', price: 3000 },
    ],
  },
  kuaishou: {
    shortLabel: '快手',
    accent: '#ff6a3d',
    giftPresets: [
      { name: '小铃铛', price: 1 },
      { name: '浪漫烟花', price: 52 },
      { name: '穿云箭', price: 288.8 },
    ],
  },
};

const ordinaryRoadProfiles: SimulatorPlatformProfile[] =
  ORDINARYROAD_PLATFORMS.map((platform) => {
    const presentation = platformPresentation[platform.id];
    const events = platform.capabilities.events.flatMap((event) =>
      simulatorEventTypes.has(event as SimulatorInteractionType)
        ? [event as SimulatorInteractionType]
        : [],
    );
    return {
      id: platform.id,
      label: platform.label,
      shortLabel: presentation?.shortLabel ?? platform.label,
      connectorLabel: 'OrdinaryRoad',
      accent: presentation?.accent ?? '#65e6c1',
      outbound: platform.capabilities.outbound,
      events,
      giftPresets: presentation?.giftPresets ?? [
        { name: '测试礼物', price: 1 },
      ],
      note: platform.note,
    };
  });

export const SIMULATOR_PLATFORM_PROFILES: SimulatorPlatformProfile[] = [
  ...ordinaryRoadProfiles,
  {
    id: 'youtube',
    label: 'YouTube Live',
    shortLabel: 'YouTube',
    connectorLabel: '原生轮询',
    accent: '#ff5a5f',
    outbound: false,
    events: ['comment'],
    giftPresets: [],
    note: '当前原生接入只读取直播评论。',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    shortLabel: 'Twitch',
    connectorLabel: '原生 EventSub',
    accent: '#a970ff',
    outbound: false,
    events: ['comment'],
    giftPresets: [],
    note: '当前原生接入只读取频道聊天。',
  },
  {
    id: 'generic-live',
    label: '通用直播协议',
    shortLabel: '通用协议',
    connectorLabel: 'LiveRoomEvent',
    accent: '#65e6c1',
    outbound: false,
    events: ['comment', 'follow', 'like', 'gift', 'entry'],
    giftPresets: [
      { name: '荧光棒', price: 1 },
      { name: '能量电池', price: 30 },
      { name: '星河舰队', price: 100 },
    ],
    note: '用于测试标准事件能力，不代表任一真实平台已接入这些事件。',
  },
];

export interface SimulatorViewer {
  id: string;
  name: string;
  followed: boolean;
  likes: number;
  giftValue: number;
}

export interface SimulatorEventDraft {
  roomId: string;
  platformId: string;
  viewer: SimulatorViewer;
  type: SimulatorInteractionType;
  commentText: string;
  likeCount: number;
  giftName: string;
  giftCount: number;
  giftPrice: number;
  superchatAmount: number;
}

interface SimulatorEventIdentity {
  id: string;
  timestamp: number;
}

function positiveInteger(value: number, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

function positiveNumber(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 100) / 100);
}

export function createSimulatorRoomEvent(
  draft: SimulatorEventDraft,
  identity: SimulatorEventIdentity,
): LiveRoomEvent {
  const roomId = draft.roomId.trim() || 'sim-room-001';
  const likeCount = positiveInteger(draft.likeCount);
  const giftCount = positiveInteger(draft.giftCount);
  const giftPrice = positiveNumber(draft.giftPrice);
  const giftName = draft.giftName.trim() || '荧光棒';
  const superchatAmount = positiveNumber(draft.superchatAmount);
  const platformId = draft.platformId.trim() || 'generic-live';

  const textByType: Partial<Record<LiveRoomEventType, string>> = {
    comment: draft.commentText.trim(),
    entry: '进入了直播间',
    follow: '关注了主播',
    like: `点赞 x${likeCount}`,
    gift: `赠送 ${giftName} x${giftCount}`,
    superchat: `醒目留言：${draft.commentText.trim()}`,
  };

  return {
    id: identity.id,
    type: draft.type,
    text: textByType[draft.type] ?? '',
    timestamp: identity.timestamp,
    author: {
      id: `${platformId}:${draft.viewer.id}`,
      name: draft.viewer.name,
    },
    metadata: {
      connectorId: 'simulator',
      platformId,
      sourcePlatform: platformId,
      simulatedPlatformId: platformId,
      simulatorViewerId: draft.viewer.id,
      roomId,
      simulator: true,
      suppressOutbound: true,
      ...(draft.type === 'follow' ? { followed: true } : {}),
      ...(draft.type === 'like' ? { clickCount: likeCount } : {}),
      ...(draft.type === 'gift' ? { giftName, giftCount, giftPrice } : {}),
      ...(draft.type === 'superchat'
        ? { price: superchatAmount, superChat: true }
        : {}),
    },
  };
}

/**
 * Keep simulated platform behavior while routing replies to a deliberately
 * ownerless source. This prevents a Bilibili simulation from writing into a
 * real Bilibili room that happens to be connected at the same time.
 */
export function routeSimulatorEventForQueue(
  event: LiveRoomEvent,
): LiveRoomEvent {
  if (event.metadata?.simulator !== true) return event;
  const platformId = String(
    event.metadata.simulatedPlatformId ||
      event.metadata.platformId ||
      'generic-live',
  );
  return {
    ...event,
    metadata: {
      ...event.metadata,
      platformId: `simulator:${platformId}`,
      sourcePlatform: platformId,
      simulatedPlatformId: platformId,
      suppressOutbound: true,
    },
  };
}

export function applySimulatorEventToViewer(
  viewer: SimulatorViewer,
  event: LiveRoomEvent,
): SimulatorViewer {
  const simulatorViewerId = String(event.metadata?.simulatorViewerId || '');
  if (simulatorViewerId !== viewer.id && event.author.id !== viewer.id) {
    return viewer;
  }

  if (event.type === 'follow') {
    return { ...viewer, followed: true };
  }

  if (event.type === 'like') {
    const clickCount = Number(event.metadata?.clickCount ?? 1);
    return {
      ...viewer,
      likes: viewer.likes + positiveInteger(clickCount),
    };
  }

  if (event.type === 'gift') {
    const giftCount = positiveInteger(Number(event.metadata?.giftCount ?? 1));
    const giftPrice = positiveNumber(Number(event.metadata?.giftPrice ?? 0));
    return {
      ...viewer,
      giftValue:
        Math.round((viewer.giftValue + giftCount * giftPrice) * 100) / 100,
    };
  }

  return viewer;
}

export function summarizeSimulatorEvents(events: LiveRoomEvent[]) {
  return events.reduce(
    (summary, event) => {
      summary.total += 1;
      if (event.type === 'follow') summary.follows += 1;
      if (event.type === 'like') {
        summary.likes += positiveInteger(
          Number(event.metadata?.clickCount ?? 1),
        );
      }
      if (event.type === 'gift') {
        const count = positiveInteger(Number(event.metadata?.giftCount ?? 1));
        const price = positiveNumber(Number(event.metadata?.giftPrice ?? 0));
        summary.gifts += count;
        summary.giftValue =
          Math.round((summary.giftValue + count * price) * 100) / 100;
      }
      return summary;
    },
    { total: 0, follows: 0, likes: 0, gifts: 0, giftValue: 0 },
  );
}
