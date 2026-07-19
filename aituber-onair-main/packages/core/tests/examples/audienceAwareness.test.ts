import { describe, expect, it } from 'vitest';
import { AudienceAwarenessLedger } from '../../examples/react-purupuru-app/src/lib/audienceAwareness';

const viewer = {
  id: '3546378005383257',
  name: '金羽_win',
  platform: 'bilibili',
};

describe('AudienceAwarenessLedger', () => {
  it('infers only a reversible resting belief from the real farewell sequence', () => {
    const ledger = new AudienceAwarenessLedger();
    const startedAt = new Date('2026-07-18T02:32:42+08:00').getTime();
    ledger.observeMessage(viewer, '我能在这挂机睡觉吗', startedAt);
    ledger.observeMessage(viewer, '你们也早点睡哈', startedAt + 73_000);
    ledger.observeMessage(viewer, '晚安', startedAt + 75_000);

    expect(
      ledger.snapshot({
        reportedAudienceCount: 1,
        activeMembers: [{ ...viewer, lastInteractionAt: startedAt + 75_000 }],
        at: startedAt + 3 * 60_000,
      }),
    ).toMatchObject({
      mode: 'likely-resting',
      activeAudienceCount: 1,
      engageableAudienceCount: 0,
      likelyRestingAudienceCount: 1,
    });
  });

  it('clears the rest belief immediately when the viewer speaks again', () => {
    const ledger = new AudienceAwarenessLedger();
    const startedAt = new Date('2026-07-18T02:32:42+08:00').getTime();
    ledger.observeMessage(viewer, '我能在这挂机睡觉吗', startedAt);
    ledger.observeMessage(viewer, '晚安', startedAt + 75_000);
    const resumedAt = startedAt + 178_000;
    ledger.observeMessage(viewer, '啊只能查国内啊', resumedAt);

    expect(
      ledger.snapshot({
        reportedAudienceCount: 1,
        activeMembers: [{ ...viewer, lastInteractionAt: resumedAt }],
        at: resumedAt + 10_000,
      }),
    ).toMatchObject({
      mode: 'active',
      activeAudienceCount: 1,
      engageableAudienceCount: 1,
      likelyRestingAudienceCount: 0,
    });
  });

  it('separates a platform online occupant from a recently active viewer', () => {
    const ledger = new AudienceAwarenessLedger();
    const lastMessageAt = new Date('2026-07-18T02:45:21+08:00').getTime();
    ledger.observeMessage(viewer, '普通弹幕', lastMessageAt);

    expect(
      ledger.snapshot({
        reportedAudienceCount: 1,
        activeMembers: [{ ...viewer, lastInteractionAt: lastMessageAt }],
        at: lastMessageAt + 6 * 60_000,
      }),
    ).toMatchObject({
      mode: 'passive',
      reportedAudienceCount: 1,
      activeAudienceCount: 0,
      engageableAudienceCount: 0,
      likelyRestingAudienceCount: 0,
    });
  });

  it('does not keep a resting viewer in the room after presence evidence is gone', () => {
    const ledger = new AudienceAwarenessLedger();
    const restAt = new Date('2026-07-18T02:32:42+08:00').getTime();
    ledger.observeMessage(viewer, '我在这挂机睡觉', restAt);

    expect(
      ledger.snapshot({
        reportedAudienceCount: 0,
        activeMembers: [],
        at: restAt + 6 * 60_000,
      }),
    ).toMatchObject({
      mode: 'empty',
      activeAudienceCount: 0,
      likelyRestingAudienceCount: 0,
    });
  });
});
