import { describe, expect, it } from 'vitest';
import {
  EmptyRoomAwarenessPlanner,
  type EmptyRoomAwarenessContext,
  isQuietRoomInteraction,
} from '../../examples/react-purupuru-app/src/lib/emptyRoomAwareness';
import type { EmptyRoomAwarenessSettings } from '../../examples/react-purupuru-app/src/types/settings';

const settings: EmptyRoomAwarenessSettings = {
  enabled: true,
  minIntervalMs: 120_000,
  maxIntervalMs: 600_000,
  interfaceWeight: 100,
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
  interfaceContext: '当前是深夜，头像处于安静待机状态',
  memoryCues: [],
};

describe('empty room awareness planner', () => {
  it('does not treat viewer presence as a chat interaction', () => {
    expect(isQuietRoomInteraction('entry')).toBe(false);
    expect(isQuietRoomInteraction('comment')).toBe(true);
    expect(isQuietRoomInteraction('gift')).toBe(true);
  });

  it('schedules every pulse inside the configured random window', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0.5);
    planner.markActivity(settings, 1_000);

    expect(planner.getNextAt()).toBe(361_000);
  });

  it('does not trigger before the random deadline and reschedules after firing', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    planner.markActivity(settings, 0);

    expect(planner.poll(settings, context, 119_999)).toBeNull();
    const result = planner.poll(settings, context, 120_000);

    expect(result?.source).toBe('interface');
    expect(result?.prompt).toContain('当前主播：测试主播（夜间主持）');
    expect(result?.prompt).toContain('禁止固定台词轮播');
    expect(result?.scheduledNextAt).toBe(240_000);
  });

  it('can speak after two quiet minutes even while viewers are present', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    planner.markActivity(settings, 0);

    const result = planner.poll(
      settings,
      { ...context, audiencePresent: true },
      120_000,
    );
    expect(result?.source).toBe('interface');
    expect(planner.getNextAt()).toBe(240_000);
  });

  it('never speaks while the broadcast chain is busy', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    planner.markActivity(settings, 0);
    expect(
      planner.poll(settings, { ...context, busy: true }, 120_000),
    ).toBeNull();
    expect(planner.getNextAt()).toBe(240_000);
  });

  it('adds audience small talk only when viewers are present', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    const audienceSettings = {
      ...settings,
      interfaceWeight: 0,
      audienceWeight: 100,
    };
    planner.markActivity(audienceSettings, 0);
    const result = planner.poll(
      audienceSettings,
      { ...context, audiencePresent: true },
      120_000,
    );

    expect(result?.source).toBe('audience');
    expect(result?.prompt).toContain('不要假装认识某个具体观众');
  });

  it('can recall a sleep memory without instructing the avatar to recite it', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    const memorySettings = {
      ...settings,
      interfaceWeight: 0,
      memoryWeight: 100,
    };
    planner.markActivity(memorySettings, 0);
    const result = planner.poll(
      memorySettings,
      {
        ...context,
        memoryCues: [
          {
            id: 'memory-1',
            title: '一段守夜回忆',
            content: '那晚房间很安静，但有人一直听到最后。',
          },
        ],
      },
      120_000,
    );

    expect(result?.source).toBe('memory');
    expect(result?.cueId).toBe('memory-1');
    expect(result?.prompt).toContain('只借它产生当下联想，不要照读档案');
  });

  it('falls back to an open-ended inspiration seed when no other source exists', () => {
    const planner = new EmptyRoomAwarenessPlanner(() => 0);
    const noAvailableSource = {
      ...settings,
      interfaceWeight: 0,
      memoryWeight: 100,
      inspirationWeight: 0,
    };
    planner.markActivity(noAvailableSource, 0);
    const result = planner.poll(noAvailableSource, context, 120_000);

    expect(result?.source).toBe('inspiration');
    expect(result?.prompt).toContain('独立人设临场生成');
  });
});
