import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINGLAN_PERSONA_POLICY } from '../../examples/react-purupuru-app/src/lib/linglanPersonaPolicy';
import { planPersonaInteraction, type PersonaPlannerInput } from '../../examples/react-purupuru-app/src/lib/personaInteractionPlanner';
import {
  refinePersonaPlanWithAgent,
  resetPersonaPlanningAgentState,
} from '../../examples/react-purupuru-app/src/lib/personaPlanningAgent';

function input(eventId: string, text: string): PersonaPlannerInput {
  return {
    eventId,
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
  };
}

afterEach(() => {
  resetPersonaPlanningAgentState();
  vi.restoreAllMocks();
});

describe('persona planning agent', () => {
  it('does not issue a request for a high-confidence local scene', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const value = input('clear', '好无聊啊');
    const local = planPersonaInteraction(value, LINGLAN_PERSONA_POLICY);
    const result = await refinePersonaPlanWithAgent(
      value,
      local,
      LINGLAN_PERSONA_POLICY,
    );
    expect(result.source).toBe('rules');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplicates one ambiguous event and applies one validated decision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          scene: 'boundary',
          stance: 'protective_boundary',
          primaryMove: 'set_boundary',
          roomAction: 'none',
          confidence: 0.88,
          reasonCode: '更像边界',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const value = input('ambiguous', '滚啦哈哈');
    const local = planPersonaInteraction(value, LINGLAN_PERSONA_POLICY);
    const [first, second] = await Promise.all([
      refinePersonaPlanWithAgent(value, local, LINGLAN_PERSONA_POLICY),
      refinePersonaPlanWithAgent(value, local, LINGLAN_PERSONA_POLICY),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.scene).toBe('boundary');
    expect(first.deliveryTarget.emotion).toBe('impatient');
    expect(second).toEqual(first);
  });

  it('falls back locally on invalid agent JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ scene: 'not_allowed' }), { status: 200 }),
      ),
    );
    const value = input('invalid', '滚啦哈哈');
    const local = planPersonaInteraction(value, LINGLAN_PERSONA_POLICY);
    const result = await refinePersonaPlanWithAgent(
      value,
      local,
      LINGLAN_PERSONA_POLICY,
    );
    expect(result.source).toBe('fallback');
    expect(result.reasonCode).toBe('agent_invalid_json');
    expect(result.scene).toBe(local.scene);
  });
});
