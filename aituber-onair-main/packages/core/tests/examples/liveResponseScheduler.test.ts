import { describe, expect, it } from 'vitest';
import {
  LiveResponseScheduler,
  type LiveLifecycleTransition,
} from '../../examples/react-purupuru-app/src/lib/liveResponseScheduler';

function comment(
  id: string,
  text: string,
  timestamp: number,
  authorId = id,
) {
  return {
    id,
    platform: 'web',
    text,
    timestamp,
    author: { id: authorId, name: authorId, displayName: authorId },
    metadata: { sourcePlatform: 'bilibili', eventType: 'comment' },
  } as any;
}

describe('LiveResponseScheduler', () => {
  it('selects the substantive earlier question before a later low-info ping', () => {
    let now = new Date('2026-07-12T01:13:28+08:00').getTime();
    const scheduler = new LiveResponseScheduler({
      now: () => now,
      settleWindowMs: 0,
    });
    scheduler.enqueue([
      comment(
        'kuaiyo',
        '我在余姚感觉没啥风啊',
        new Date('2026-07-12T01:13:25+08:00').getTime(),
        '42',
      ),
      comment(
        'ping',
        '主播？',
        new Date('2026-07-12T01:13:27+08:00').getTime(),
        '51',
      ),
    ]);

    const selected = scheduler.dequeue();
    expect(selected?.eventId).toBe('kuaiyo');
    expect(selected?.comment.text).toContain('余姚');
    expect(scheduler.size).toBe(0);
    now += 1;
  });

  it('deduplicates one viewer replay but not two viewers saying the same text', () => {
    const transitions: LiveLifecycleTransition[] = [];
    const now = 1_000_000;
    const scheduler = new LiveResponseScheduler({
      now: () => now,
      settleWindowMs: 0,
      onTransition: (value) => transitions.push(value),
    });
    scheduler.enqueue([
      comment('first', '安徽怎么样', now - 20, 'viewer-a'),
      comment('replay', '安徽怎么样', now - 10, 'viewer-a'),
      comment('other', '安徽怎么样', now, 'viewer-b'),
    ]);

    expect(
      transitions.filter(
        (item) => item.dropReason === 'duplicate_text',
      ).length,
    ).toBe(1);
    const selected = scheduler.dequeue();
    expect(selected?.mergedCount).toBe(2);
  });

  it('merges stale valid questions into one catch-up instead of reading old items', () => {
    let now = 2_000_000;
    const scheduler = new LiveResponseScheduler({ now: () => now });
    scheduler.enqueue([
      comment('a', '安徽风雨影响怎么样', now, 'a'),
      comment('b', '余姚会进入风眼吗', now + 1, 'b'),
      comment('c', '衢州会有大风吗', now + 2, 'c'),
    ]);
    now += 31_000;

    const selected = scheduler.dequeue();
    expect(selected?.catchup).toBe(true);
    expect(selected?.mergedCount).toBe(3);
    expect(scheduler.size).toBe(0);
  });

  it('caps a 20-message burst at 12 topic groups without silent loss', () => {
    const transitions: LiveLifecycleTransition[] = [];
    const now = 3_000_000;
    const scheduler = new LiveResponseScheduler({
      now: () => now,
      maxGroups: 12,
      onTransition: (value) => transitions.push(value),
    });
    const texts = [
      '安徽风力', '余姚风眼', '衢州暴雨', '宁波积水', '杭州停课',
      '上海阵风', '南京降温', '绍兴雷电', '温州浪高', '台州潮位',
      '嘉兴水库', '湖州航班', '金华铁路', '丽水山洪', '舟山轮渡',
      '合肥预警', '芜湖内涝', '黄山景区', '阜阳大棚', '安庆江水',
    ];
    scheduler.enqueue(
      texts.map((text, index) =>
        comment(`event-${index}`, text, now + index, `viewer-${index}`),
      ),
    );

    expect(scheduler.size).toBe(12);
    expect(
      transitions.filter((item) => item.dropReason === 'overflow_merged'),
    ).toHaveLength(9);
  });

  it('keeps a bounded room brief while preserving the aggregate count', () => {
    const now = 5_000_000;
    const scheduler = new LiveResponseScheduler({
      now: () => now,
      settleWindowMs: 0,
    });
    scheduler.enqueue(
      Array.from({ length: 100 }, (_, index) =>
        comment(
          `same-${index}`,
          '主播你觉得这件事怎么样',
          now + index,
          `viewer-${index}`,
        ),
      ),
    );
    const selected = scheduler.dequeue();
    expect(selected?.mergedCount).toBe(100);
    expect(selected?.roomBatch.totalCount).toBe(100);
    expect(selected?.roomBatch.samples.length).toBeLessThanOrEqual(12);
  });
});
