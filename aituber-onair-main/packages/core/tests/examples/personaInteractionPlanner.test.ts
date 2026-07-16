import { describe, expect, it } from 'vitest';
import { LINGLAN_PERSONA_POLICY } from '../../examples/react-purupuru-app/src/lib/linglanPersonaPolicy';
import {
  applyAgentPersonaDecision,
  formatPersonaInteractionPlan,
  planPersonaInteraction,
  shouldRequestPersonaAgent,
  type PersonaPlannerInput,
} from '../../examples/react-purupuru-app/src/lib/personaInteractionPlanner';

function input(
  text: string,
  overrides: Partial<PersonaPlannerInput> = {},
): PersonaPlannerInput {
  return {
    eventId: 'event-1',
    text,
    routing: {
      inheritTyphoon: false,
      reason: 'test',
      mode: 'companion',
      intent: 'casual',
      direction: '自然回应',
      shouldSpeak: true,
      moderation: 'none',
    },
    recentTurns: [],
    ...overrides,
  };
}

describe('PersonaInteractionPlanner', () => {
  it.each([
    ['好无聊啊', 'boredom', 'bored'],
    ['我家小猫昨天去世了', 'grief', 'sad'],
    ['你好棒，声音真好听', 'praise', 'embarrassed'],
    ['你刚才说错了', 'correction', 'embarrassed'],
    ['不要给我建议，我只想让你听我说', 'advice_rejection', 'relaxed'],
    ['现在立刻照我说的做', 'boundary', 'impatient'],
  ])('maps %s to %s with its voice target', (text, scene, emotion) => {
    const plan = planPersonaInteraction(input(text), LINGLAN_PERSONA_POLICY);
    expect(plan.scene).toBe(scene);
    expect(plan.deliveryTarget.emotion).toBe(emotion);
  });

  it('keeps a grief follow-up on the same topic without cause questions or advice', () => {
    const plan = planPersonaInteraction(
      input('我还是好难受', {
        recentTurns: [
          {
            eventId: 'previous',
            at: Date.now() - 2_000,
            input: '我的小猫死了',
            reply: '我听见了。',
            viewerId: 'viewer-a',
          },
        ],
      }),
      LINGLAN_PERSONA_POLICY,
    );
    expect(plan.scene).toBe('grief');
    expect(plan.mustAvoid.join(' ')).toContain('死因');
    expect(plan.mustAvoid.join(' ')).toContain('清单');
  });

  it('does not call the agent for clear scenes and bounds the dynamic block', () => {
    const clear = planPersonaInteraction(input('好无聊'), LINGLAN_PERSONA_POLICY);
    expect(shouldRequestPersonaAgent(clear)).toBe(false);
    expect(formatPersonaInteractionPlan(clear).length).toBeLessThanOrEqual(702);
  });

  it('keeps viewer claims attributed even for a close relationship', () => {
    const plan = planPersonaInteraction(
      input('你觉得我女朋友怎么样', {
        relationship: { stage: 'close', affinity: 92 },
        memorySignals: [
          {
            topic: '观众说女朋友是宇航员',
            confidence: 0.62,
            sourceKind: 'viewer_claim',
          },
        ],
      }),
      LINGLAN_PERSONA_POLICY,
    );
    expect(plan.mustDo.join(' ')).toContain('你之前提过');
    expect(plan.mustAvoid.join(' ')).toContain('关系亲近不得提高事实置信度');
  });

  it('keeps local planning comfortably below the 20ms p95 budget', () => {
    const timings = Array.from({ length: 500 }, (_, index) => {
      const startedAt = performance.now();
      planPersonaInteraction(
        input(index % 2 ? '好无聊' : '我还是有点难受'),
        LINGLAN_PERSONA_POLICY,
      );
      return performance.now() - startedAt;
    }).sort((left, right) => left - right);
    expect(timings[Math.floor(timings.length * 0.95)]).toBeLessThan(20);
  });

  it('lets the agent refine enums but never grant local mute authority', () => {
    const local = planPersonaInteraction(input('滚啦哈哈'), LINGLAN_PERSONA_POLICY);
    expect(shouldRequestPersonaAgent(local)).toBe(true);
    const refined = applyAgentPersonaDecision(local, {
      scene: 'boundary',
      stance: 'protective_boundary',
      primaryMove: 'set_boundary',
      roomAction: 'local_mute',
      confidence: 0.9,
    }, input('滚啦哈哈'), LINGLAN_PERSONA_POLICY);
    expect(refined?.source).toBe('agent');
    expect(refined?.roomAction).toBe('none');
    expect(refined?.localMuteViewerIds).toEqual([]);
    expect(refined?.deliveryTarget.emotion).toBe('impatient');
  });
});
