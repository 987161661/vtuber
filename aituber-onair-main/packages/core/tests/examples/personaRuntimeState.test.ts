import { describe, expect, it } from 'vitest';
import type { EmptyRoomAwarenessContext } from '../../examples/react-purupuru-app/src/lib/emptyRoomAwareness';
import { PersonaRuntimeState } from '../../examples/react-purupuru-app/src/lib/personaRuntimeState';
import { LINGLAN_PERSONA_POLICY } from '../../examples/react-purupuru-app/src/lib/linglanPersonaPolicy';
import { planPersonaInteraction } from '../../examples/react-purupuru-app/src/lib/personaInteractionPlanner';

const context: EmptyRoomAwarenessContext = {
  digitalHumanName: '凌岚',
  digitalHumanTitle: '岚台主播',
  isLive: true,
  audiencePresent: true,
  participantCount: 1,
  activeAudienceCount: 1,
  engageableAudienceCount: 1,
  audienceActivityMode: 'active',
  likelyRestingMembers: [],
  busy: false,
  interfaceContext: '节目处于安静待机状态',
  memoryCues: [
    { id: 'cup', title: '掉漆的深蓝保温杯', content: '总放在控制台旁边。' },
    { id: 'music', title: '深夜歌单', content: '喜欢有空间感的音乐。' },
  ],
  audienceMembers: [],
};

describe('PersonaRuntimeState', () => {
  it('uses the full bounded memory window instead of repeating the first four cues', () => {
    const runtime = new PersonaRuntimeState();
    const memoryDetails = [
      ['深夜歌单', '一首有空间感的音乐'],
      ['悬疑故事', '一个没有解释完的结局'],
      ['咸味零食', '控制台旁的一包海苔'],
      ['老朋友', '一次很久以前的重逢'],
      ['节目开场', '想试一次更短的开场'],
      ['旧外套', '袖口已经磨得发白'],
      ['纸质地图', '折痕刚好穿过海岸线'],
      ['窗边植物', '新叶朝着灯光生长'],
    ] as const;
    const memoryRichContext: EmptyRoomAwarenessContext = {
      ...context,
      interfaceContext: '',
      engageableAudienceCount: 0,
      memoryCues: memoryDetails.map(([title, content], index) => ({
        id: `memory-${index + 1}`,
        title,
        content,
      })),
    };
    const selectedMemoryRefs = new Set<string>();

    for (let index = 0; index < 8; index += 1) {
      const plan = runtime.tryPlanProactive(
        memoryRichContext,
        'memory-association',
        1_000 + index * 1_000,
      );
      expect(plan).not.toBeNull();
      if (!plan) break;
      if (plan.source === 'memory' && plan.sourceRef) {
        selectedMemoryRefs.add(plan.sourceRef);
      }
      runtime.commitProactive(plan, 1_000 + index * 1_000);
    }

    expect(
      [...selectedMemoryRefs].some((sourceRef) =>
        sourceRef.includes('节目开场'),
      ),
    ).toBe(true);
  });

  it('stays silent after all safe topics are cooling', () => {
    const runtime = new PersonaRuntimeState();
    const sparseContext: EmptyRoomAwarenessContext = {
      ...context,
      audiencePresent: false,
      participantCount: 0,
      activeAudienceCount: 0,
      engageableAudienceCount: 0,
      interfaceContext: '',
      memoryCues: [],
    };
    let spokenTurns = 0;

    while (spokenTurns < 20) {
      const at = 1_000 + spokenTurns * 1_000;
      const plan = runtime.tryPlanProactive(
        sparseContext,
        'present-thought',
        at,
      );
      if (!plan) break;
      runtime.commitProactive(plan, at);
      spokenTurns += 1;
    }

    expect(spokenTurns).toBeGreaterThan(1);
    expect(spokenTurns).toBeLessThan(20);
    expect(
      runtime.tryPlanProactive(sparseContext, 'present-thought', 30_000),
    ).toBeNull();
  });

  it('restores recent topic cooling after the runtime is rebuilt', () => {
    const firstRuntime = new PersonaRuntimeState();
    const first = firstRuntime.tryPlanProactive(
      context,
      'memory-association',
      1_000,
    );
    expect(first).not.toBeNull();
    if (!first) return;
    firstRuntime.commitProactive(first, 1_000);

    const restored = new PersonaRuntimeState({
      topics: firstRuntime.snapshot(2_000).topics,
    });
    const next = restored.tryPlanProactive(
      context,
      'memory-association',
      2_000,
    );

    expect(next?.topicFamily).not.toBe(first.topicFamily);
    expect(next?.mustAvoidTopics).toContain(first.topicFamily);
  });

  it('uses one bounded source and cools a semantic topic after a spoken turn', () => {
    const runtime = new PersonaRuntimeState();
    const first = runtime.planProactive(context, 'memory-association', 1_000);
    expect(first.source).toBe('memory');
    runtime.commitProactive(first, 1_000);

    const second = runtime.planProactive(context, 'memory-association', 2_000);
    expect(second.topicFamily).not.toBe(first.topicFamily);
    expect(second.mustAvoidTopics).toContain(first.topicFamily);
  });

  it('rotates persistent drives only after a proactive turn was actually committed', () => {
    const runtime = new PersonaRuntimeState();
    const first = runtime.planProactive(context, 'present-thought', 1_000);
    const stillFirst = runtime.planProactive(context, 'present-thought', 2_000);
    expect(stillFirst.drive).toBe(first.drive);

    runtime.commitProactive(first, 2_000);
    const next = runtime.planProactive(context, 'present-thought', 3_000);
    expect(next.drive).not.toBe(first.drive);
  });

  it('rotates proactive sources instead of turning every drive into self-analysis', () => {
    const runtime = new PersonaRuntimeState();
    const plans = Array.from({ length: 5 }, (_, index) => {
      const at = 1_000 + index * 1_000;
      const plan = runtime.planProactive(context, 'present-thought', at);
      runtime.commitProactive(plan, at);
      return plan;
    });

    expect(plans.filter((plan) => plan.source === 'self_goal')).toHaveLength(1);
    expect(new Set(plans.map((plan) => plan.source)).size).toBeGreaterThan(2);
    expect(new Set(plans.map((plan) => plan.expressionMode)).size).toBe(5);
    expect(plans.every((plan) => plan.expressionInstruction.length > 10)).toBe(
      true,
    );
  });

  it('keeps emotion state separate from the expressed TTS label and commits explicitly', () => {
    const runtime = new PersonaRuntimeState();
    const input = {
      eventId: 'boundary-1',
      text: '现在立刻照我说的做',
      routing: {
        inheritTyphoon: false,
        reason: 'test',
        mode: 'companion' as const,
        intent: 'casual',
        direction: '自然回应',
        shouldSpeak: true,
        moderation: 'none' as const,
      },
      recentTurns: [],
    };
    const plan = planPersonaInteraction(input, LINGLAN_PERSONA_POLICY);
    const prepared = runtime.prepareInteraction(plan, 1_000, 'viewer-a');

    expect(prepared.plan.deliveryTarget.emotion).toBe('impatient');
    expect(runtime.snapshot(1_000).emotion.activeAffect).toBeNull();
    runtime.commitInteraction(prepared.transition);
    expect(runtime.snapshot(1_000).emotion.activeAffect?.label).toBe(
      'impatient',
    );
    expect(runtime.snapshot(1_000).emotion.mood.tension).toBeGreaterThan(0.16);
  });
});
