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
  busy: false,
  interfaceContext: '节目处于安静待机状态',
  memoryCues: [
    { id: 'cup', title: '掉漆的深蓝保温杯', content: '总放在控制台旁边。' },
    { id: 'music', title: '深夜歌单', content: '喜欢有空间感的音乐。' },
  ],
  audienceMembers: [],
};

describe('PersonaRuntimeState', () => {
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
    expect(runtime.snapshot(1_000).emotion.activeAffect?.label).toBe('impatient');
    expect(runtime.snapshot(1_000).emotion.mood.tension).toBeGreaterThan(0.16);
  });
});
