import { describe, expect, it } from 'vitest';
import {
  EmptyRoomAwarenessPlanner,
  type EmptyRoomAwarenessContext,
  isQuietRoomInteraction,
} from '../../examples/react-purupuru-app/src/lib/emptyRoomAwareness';
import type { EmptyRoomAwarenessSettings } from '../../examples/react-purupuru-app/src/types/settings';

const settings: EmptyRoomAwarenessSettings = {
  enabled: true,
  audiencePolicy: 'any',
  scheduleEnabled: false,
  scheduleStartHour: 0,
  scheduleEndHour: 0,
  minIntervalMs: 120_000,
  maxIntervalMs: 120_000,
  proactiveCooldownMs: 120_000,
  maxProactiveTurns: 12,
  maxSentences: 2,
  behaviorStrategies: [
    { id: 'viewer', name: '向个人观众搭话', prompt: '向在场观众自然搭话，不催回复。', probability: 70, enabled: true },
    { id: 'thought', name: '当下独白', prompt: '说一句生活化的当下念头。', probability: 30, enabled: true },
  ],
  interfaceWeight: 0,
  memoryWeight: 0,
  inspirationWeight: 0,
  audienceWeight: 0,
};

const context: EmptyRoomAwarenessContext = {
  digitalHumanName: '测试主播',
  digitalHumanTitle: '夜间主持',
  isLive: true,
  audiencePresent: false,
  busy: false,
  interfaceContext: '直播界面处于安静待机状态。',
  memoryCues: [],
  audienceMembers: [],
  recentProactiveMemories: [],
};

describe('empty room awareness planner', () => {
  it('does not treat viewer presence as a chat interaction', () => {
    expect(isQuietRoomInteraction('entry')).toBe(false);
    expect(isQuietRoomInteraction('comment')).toBe(true);
  });

  it('schedules every pulse inside the configured random window', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0.5);
    planner.markActivity(settings, 1_000);
    expect(planner.getNextAt()).toBe(121_000);
  });

  it('selects an enabled behavior by probability and inserts it as a prompt module', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    planner.markActivity(settings, 0);
    const result = planner.poll(settings, context, 120_000);

    expect(result?.source).toBe('strategy');
    expect(result?.strategyId).toBe('viewer');
    expect(result?.strategyName).toBe('向个人观众搭话');
    expect(result?.prompt).toContain('<behavior_strategy id="viewer" name="向个人观众搭话">');
    expect(result?.prompt).toContain('向在场观众自然搭话，不催回复。');
    expect(result?.scheduledNextAt).toBe(240_000);
  });

  it('uses relative probabilities rather than the retired source weights', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0.9);
    const onlyThought = {
      ...settings,
      behaviorStrategies: [
        { ...settings.behaviorStrategies[0], probability: 0 },
        settings.behaviorStrategies[1],
      ],
      interfaceWeight: 100,
    };
    planner.markActivity(onlyThought, 0);
    expect(planner.poll(onlyThought, context, 120_000)?.strategyId).toBe('thought');
  });

  it('does not speak when all strategies are disabled or have zero probability', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    const disabled = {
      ...settings,
      behaviorStrategies: settings.behaviorStrategies.map((strategy) => ({ ...strategy, enabled: false })),
    };
    planner.markActivity(disabled, 0);
    expect(planner.poll(disabled, context, 120_000)).toBeNull();
  });

  it('keeps live audience and recent speech facts outside the replaceable strategy module', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    planner.markActivity(settings, 0);
    const result = planner.poll(settings, {
      ...context,
      audiencePresent: true,
      audienceMembers: [{ id: 'viewer-1', name: '小周', platform: 'bilibili', enteredAt: 500, lastSeenAt: 119_000, lastInteractionAt: 1_000, messageCount: 1 }],
      recentProactiveMemories: [{ at: 2_000, reply: '@小周，聊几句吗？' }],
    }, 120_000);

    expect(result?.prompt).toContain('<audience_presence>');
    expect(result?.prompt).toContain('@小周');
    expect(result?.prompt).toContain('<recent_proactive_memory>');
    expect(result?.prompt).toContain('@小周，聊几句吗？');
  });

  it('blocks turns outside the configured local-hour window or while busy', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    const daytime = { ...settings, scheduleEnabled: true, scheduleStartHour: 9, scheduleEndHour: 18 };
    const midnight = new Date(2026, 0, 1, 0, 0, 0).getTime();
    planner.markActivity(daytime, midnight);
    expect(planner.poll(daytime, context, midnight + 120_000)).toBeNull();

    planner.markActivity(settings, 0);
    expect(planner.poll(settings, { ...context, busy: true }, 120_000)).toBeNull();
  });
});
