import { describe, expect, it } from 'vitest';
import { isRecentSemanticTopicRepeat } from '../../examples/react-purupuru-app/src/lib/personaTopicLedger';

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
});
