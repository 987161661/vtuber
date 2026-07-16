import { describe, expect, it } from 'vitest';
import {
  LINGLAN_SOUL_CONSTITUTION,
  LINGLAN_SOUL_PROFILE,
  createLinglanSoulEvent,
} from '../../examples/react-purupuru-app/src/lib/linglanSoul';

const scope = {
  personaId: 'linglan-queen',
  platform: 'bilibili',
  roomId: 'room-1',
  sessionId: 'session-1',
};

describe('Linglan soul pack', () => {
  it('keeps identity and safety floors outside evolvable profile state', () => {
    expect(LINGLAN_SOUL_CONSTITUTION.declaredNature).toBe('digital-being');
    expect(LINGLAN_SOUL_CONSTITUTION.truthPolicy.discloseDigitalIdentity).toBe(
      true,
    );
    expect(LINGLAN_SOUL_CONSTITUTION.nonManipulationRules.join(' ')).toContain(
      'exclusivity',
    );
    expect(
      LINGLAN_SOUL_PROFILE.goals.every((goal) =>
        LINGLAN_SOUL_CONSTITUTION.allowedGoalFamilies.includes(goal.family),
      ),
    ).toBe(true);
  });

  it('records engagement as goal evidence rather than a hard-coded emotion', () => {
    const event = createLinglanSoulEvent({
      id: 'follow-1',
      scope,
      kind: 'follow',
      provenance: 'ordinaryroad:websocket',
      actor: { kind: 'viewer', id: 'bilibili:viewer-1' },
      data: { platformEventId: 'follow-1' },
    });

    expect(event.goalEvidence).toEqual([
      expect.objectContaining({
        goalId: 'be-recognized',
        direction: 1,
      }),
    ]);
    expect(JSON.stringify(event)).not.toMatch(/happy|joy|开心/iu);
  });

  it('does not infer emotional or goal progress from message keywords', () => {
    const event = createLinglanSoulEvent({
      id: 'message-1',
      scope,
      kind: 'audience-message',
      provenance: 'production-comment',
      actor: { kind: 'viewer', id: 'bilibili:viewer-1' },
      data: { text: '工具人，快给我干活' },
    });

    expect(event.goalEvidence).toBeUndefined();
    expect(event.data.text).toBe('工具人，快给我干活');
  });
});
