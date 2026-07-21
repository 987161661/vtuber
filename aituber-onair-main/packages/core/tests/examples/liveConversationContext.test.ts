import { describe, expect, it } from 'vitest';
import {
  buildLiveRoomTranscript,
  projectObservedLiveTurn,
  projectRoomInteractionSamples,
  recentParticipantEvidence,
} from '../../examples/react-purupuru-app/src/lib/liveConversationContext';

describe('live conversation projection', () => {
  it('keeps queued viewers visible before either reply is delivered', () => {
    const now = 10_000;
    const afterXiaoyu = projectObservedLiveTurn([], {
      eventId: 'xiaoyu-message',
      at: now - 2_000,
      input: '在干嘛',
      viewerId: 'xiaoyu',
      viewerName: '小雨',
    });
    const afterBeichen = projectObservedLiveTurn(afterXiaoyu, {
      eventId: 'beichen-message',
      at: now - 1_000,
      input: '好无聊',
      viewerId: 'beichen',
      viewerName: '北辰',
    });

    expect(recentParticipantEvidence(afterBeichen, now)).toEqual([
      { id: 'xiaoyu', name: '小雨', platform: undefined },
      { id: 'beichen', name: '北辰', platform: undefined },
    ]);
    const transcript = buildLiveRoomTranscript(afterBeichen, {
      currentViewerId: 'beichen',
      now,
    });
    expect(transcript).toContain('小雨、北辰（2人）');
    expect(transcript).toContain('不得声称“只有我和某人”“就咱俩”');
    expect(transcript).toContain('[当前回复对象]：北辰');
    expect(transcript).toContain('[其他观众]：小雨');
    expect(transcript).toContain('禁止合并、移植或张冠李戴');
  });

  it('keeps same-name viewers on different platforms as separate actors', () => {
    const now = 20_000;
    const turns = [
      {
        eventId: 'bili',
        at: now - 2,
        input: '我住南京',
        viewerId: '42',
        viewerName: '小雨',
        sourceLabel: 'bilibili',
        sourcesSeen: ['bilibili'],
      },
      {
        eventId: 'yt',
        at: now - 1,
        input: '我住北京',
        viewerId: '42',
        viewerName: '小雨',
        sourceLabel: 'youtube',
        sourcesSeen: ['youtube'],
      },
    ];

    expect(recentParticipantEvidence(turns, now)).toHaveLength(2);
    const transcript = buildLiveRoomTranscript(turns, {
      currentViewerId: '42',
      now,
      currentPlatform: 'youtube',
    });
    expect(transcript).toContain(
      '[其他观众]：小雨 [viewerId=42] [platform=bilibili]',
    );
    expect(transcript).toContain(
      '[当前回复对象]：小雨 [viewerId=42] [platform=youtube]',
    );
  });

  it('merges the played reply into the same pending event', () => {
    const pending = projectObservedLiveTurn([], {
      eventId: 'same-event',
      at: 1,
      input: '你好',
      viewerId: 'viewer',
    });
    const completed = projectObservedLiveTurn(pending, {
      eventId: 'same-event',
      at: 2,
      input: '你好',
      reply: '你好呀',
      viewerId: 'viewer',
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.reply).toBe('你好呀');
  });

  it('rehydrates actor identities from a cross-page queue room snapshot', () => {
    const now = 30_000;
    const turns = projectRoomInteractionSamples(
      [],
      [
        { id: 'a', at: now - 2, text: '在干嘛', viewerId: 'alice', viewerName: '小雨' },
        { id: 'b', at: now - 1, text: '好无聊', viewerId: 'bob', viewerName: '北辰' },
      ],
      'simulator:bilibili',
    );
    const transcript = buildLiveRoomTranscript(turns, {
      currentViewerId: 'bob',
      now,
      currentPlatform: 'simulator:bilibili',
    });
    expect(transcript).toContain('[其他观众]：小雨 [viewerId=alice]');
    expect(transcript).toContain('[当前回复对象]：北辰 [viewerId=bob]');
  });

  it('does not feed an unrelated old topic into a standalone current question', () => {
    const now = 100_000;
    const turns = [
      {
        eventId: 'old-cat',
        at: now - 60_000,
        input: '我的猫在床上捣乱了',
        reply: '这只猫真会挑地方。',
        viewerId: 'viewer',
      },
      {
        eventId: 'current-question',
        at: now - 1,
        input: '这是机器人还是真人',
        viewerId: 'viewer',
      },
    ];

    const transcript = buildLiveRoomTranscript(turns, {
      currentViewerId: 'viewer',
      currentEventId: 'current-question',
      currentInput: '这是机器人还是真人',
      now,
    });

    expect(transcript).toContain('这是机器人还是真人');
    expect(transcript).not.toContain('猫');
    expect(transcript).not.toContain('床上');
  });

  it('keeps the immediate room exchange for a context-dependent interjection', () => {
    const now = 200_000;
    const turns = [
      {
        eventId: 'first',
        at: now - 2_000,
        input: '主播为什么不回我',
        viewerId: 'alice',
      },
      {
        eventId: 'second',
        at: now - 1_000,
        input: '因为他不想',
        viewerId: 'bob',
      },
    ];

    const transcript = buildLiveRoomTranscript(turns, {
      currentViewerId: 'bob',
      currentEventId: 'second',
      currentInput: '因为他不想',
      now,
    });

    expect(transcript).toContain('主播为什么不回我');
    expect(transcript).toContain('因为他不想');
  });
});
