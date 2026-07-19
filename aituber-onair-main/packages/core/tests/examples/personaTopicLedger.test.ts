import { describe, expect, it } from 'vitest';
import {
  isRecentSemanticTopicRepeat,
  isSingleUseEngagementEcho,
} from '../../examples/react-purupuru-app/src/lib/personaTopicLedger';

describe('proactive semantic topic guard', () => {
  it('blocks a paraphrase of the weather topic that just finished', () => {
    expect(
      isRecentSemanticTopicRepeat('刚才那场洪灾，最重要的还是先看官方预警。', [
        '当前资料没有可核实的洪水灾情或官方预警，我不能判断当地是否安全。',
      ]),
    ).toBe(true);
  });

  it('allows a genuinely different proactive topic', () => {
    expect(
      isRecentSemanticTopicRepeat('我忽然想聊聊一首适合深夜听的歌。', [
        '上海当前气温偏高，外出注意补水。',
      ]),
    ).toBe(false);
  });

  it('blocks support acknowledgements from becoming proactive monologues', () => {
    expect(isSingleUseEngagementEcho('赞收好，岚台又亮了一格。')).toBe(true);
    expect(
      isRecentSemanticTopicRepeat('今晚岚台的灯全靠你们点亮了。', [
        '小雨 的弹幕：点赞',
        '谢谢小雨，点赞收到。',
      ]),
    ).toBe(true);
  });

  it('treats repeated time-and-mood hooks as one topic family', () => {
    expect(
      isRecentSemanticTopicRepeat('周五下午还挂在这里，是不是在摸鱼？', [
        '下班没处去，还是想找个地方躲清静？',
      ]),
    ).toBe(true);
  });
});
