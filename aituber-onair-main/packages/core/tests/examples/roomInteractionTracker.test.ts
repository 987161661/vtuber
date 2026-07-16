import { describe, expect, it } from 'vitest';
import { RoomInteractionTracker } from '../../examples/react-purupuru-app/src/lib/roomInteractionTracker';

function comment(id: string, viewer: string, name: string, text: string, at: number) {
  return {
    id,
    platform: 'web',
    text,
    timestamp: at,
    author: { id: viewer, name, displayName: name },
    metadata: { sourcePlatform: 'bilibili', eventType: 'comment' },
  } as any;
}

describe('RoomInteractionTracker', () => {
  it('does not turn one viewer insulting the host into a room conflict', () => {
    const now = 1_000_000;
    const tracker = new RoomInteractionTracker(() => now);
    tracker.observe([comment('1', 'a', '甲', '主播真垃圾', now)]);
    expect(tracker.snapshot().conflictLevel).toBe('calm');
  });

  it('detects directed two-viewer hostility across separate batches', () => {
    let now = 2_000_000;
    const tracker = new RoomInteractionTracker(() => now);
    tracker.observe([
      comment('1', 'a', '甲', '先打个招呼', now),
      comment('2', 'b', '乙', '@甲 你闭嘴', now + 1),
    ]);
    now += 2;
    tracker.observe([comment('3', 'a', '甲', '@乙 你才是垃圾', now)]);
    expect(tracker.snapshot().conflictLevel).toBe('escalating');
  });

  it('locally identifies only clear threat or privacy offenders', () => {
    const now = 3_000_000;
    const tracker = new RoomInteractionTracker(() => now);
    tracker.observe([
      comment('1', 'a', '甲', '@乙 你闭嘴', now),
      comment('2', 'b', '乙', '@甲 我要曝光你手机号', now + 1),
    ]);
    expect(tracker.snapshot().clearOffenderIds).toEqual(['b']);
  });

  it('caps retained evidence and batch samples', () => {
    const now = 4_000_000;
    const tracker = new RoomInteractionTracker(() => now);
    tracker.observe(
      Array.from({ length: 260 }, (_, index) =>
        comment(String(index), `v-${index}`, `观众${index}`, `消息${index}`, now),
      ),
    );
    expect(tracker.snapshot().samples).toHaveLength(12);
  });
});
