import { describe, expect, it } from 'vitest';
import {
  compactViewerResponse,
  guardViewerResponse,
} from '../../examples/react-purupuru-app/src/lib/responseGuard';

describe('guardViewerResponse', () => {
  it('removes repeated terminal fragments while preserving Bilibili emoji', () => {
    const result = guardViewerResponse(`${'[e~['.repeat(40)}收到[dog]`);
    expect(result.text).toBe('收到[dog]');
    expect(result.text).not.toContain('[e~[');
  });

  it('rewrites unsupported typhoon certainty to the evidence-backed answer', () => {
    const result = guardViewerResponse('余姚肯定会进入风眼，是必经之路。', {
      isWeather: true,
      requiredAnswer: '目前没有证据确认余姚市会进入风眼；模式预报仅供参考。',
      claims: [{ type: 'model_inference', text: '余姚市模式预报有东南风。' }],
      placeResolution: { query: '余姚', canonicalName: '余姚市' },
    });
    expect(result.rewritten).toBe(true);
    expect(result.text).toContain('没有证据');
    expect(result.text).not.toContain('必经之路');
  });

  it('rejects numbers and place names absent from claims', () => {
    const result = guardViewerResponse('安徽省将有18级风。', {
      isWeather: true,
      requiredAnswer: '目前资料不足，暂不下确定结论。',
      claims: [{ type: 'official_forecast', text: '浙江省有6级东南风。' }],
    });
    expect(result.reasons).toContain('unsupported_number');
    expect(result.reasons).toContain('unsupported_place');
    expect(result.text).toBe('目前资料不足，暂不下确定结论。');
  });

  it('blocks scolding language before speech', () => {
    const result = guardViewerResponse('竖起耳朵，我只说一次。', {
      isWeather: false,
    });
    expect(result.rewritten).toBe(true);
    expect(result.text).toBe('这条回复出了点问题，稍后再说。');
  });

  it('removes gift-based pressure to stay', () => {
    const result = guardViewerResponse('在呢，辣条都收了还能跑了你？', {
      isWeather: false,
    });
    expect(result.reasons).toContain('gift_retention_pressure');
    expect(result.text).toBe('心意我收到了，谢谢你；来去都由你，别有压力。');
  });

  it('does not turn paid support into a follow CTA', () => {
    const result = guardViewerResponse('谢谢礼物，赶紧点个关注吧。', {
      isWeather: false,
      engagementSignals: ['gift'],
    });
    expect(result.reasons).toContain('paid_support_cta');
    expect(result.text).not.toContain('关注');
  });

  it('fails closed on a malformed structured JSON fragment', () => {
    const result = guardViewerResponse('{"text":"会下雨","emotion":"neutral"');
    expect(result.unsafeArtifacts).toBe(true);
    expect(result.text).toBe('这条回复出了点问题，稍后再说。');
  });

  it('unwraps a fenced speech plan instead of speaking its JSON envelope', () => {
    const spoken = '\u5317\u4eac\u73b0\u5728\u662f\u4e8c\u7ea7\u897f\u5357\u98ce\u3002';
    const result = guardViewerResponse(
      `\`\`\`json\n${JSON.stringify({ version: 2, beats: [{ text: spoken }] })}\n\`\`\``,
    );

    expect(result.text).toBe(spoken);
    expect(result.rewritten).toBe(true);
    expect(result.unsafeArtifacts).toBe(false);
  });

  it('uses verified weather evidence when a structured envelope is malformed', () => {
    const requiredAnswer =
      '\u5317\u4eac\u5750\u6807\u7684\u6a21\u5f0f\u9884\u62a5\u7ea6\u4e09\u70b9\u4e09\u7c73\u6bcf\u79d2\u3002';
    const result = guardViewerResponse(
      '{"text":"\\u4f1a\\u4e0b\\u96e8","emotion":"neutral"',
      {
      isWeather: true,
      viewerText: '\u5317\u4eac\u5929\u6c14\u600e\u4e48\u6837',
      requiredAnswer,
      claims: [{ text: requiredAnswer }],
      },
    );

    expect(result.text).toBe(requiredAnswer);
    expect(result.reasons).toContain('unsafe_artifact');
  });

  it('does not allow historical improvisation when the weather source returned no claims', () => {
    const result = guardViewerResponse(
      '\u6d77\u795e\u662f\u51e0\u5e74\u524d\u7684\u53f0\u98ce\u4e86\u3002',
      {
        isWeather: true,
        viewerText: '\u6d77\u795e\u600e\u4e48\u6837\u4e86',
        requiredAnswer:
          '\u5f53\u524d\u67e5\u8be2\u6ca1\u6709\u53d6\u5f97\u8db3\u591f\u7684\u53f0\u98ce\u6216\u5f53\u5730\u98ce\u529b\u6570\u636e\uff0c\u4e0d\u80fd\u7ed9\u51fa\u5177\u4f53\u6570\u5b57\u3002',
        claims: [],
      },
    );

    expect(result.text).toBe(
      '\u5f53\u524d\u67e5\u8be2\u6ca1\u6709\u53d6\u5f97\u8db3\u591f\u7684\u53f0\u98ce\u6216\u5f53\u5730\u98ce\u529b\u6570\u636e\uff0c\u4e0d\u80fd\u7ed9\u51fa\u5177\u4f53\u6570\u5b57\u3002',
    );
    expect(result.reasons).toContain('no_fact_claims');
    expect(result.rewritten).toBe(true);
  });

  it('blocks an unsupported local all-clear for a rain-disaster question', () => {
    const result = guardViewerResponse(
      '\u60e0\u5dde\u4eca\u665a\u6ca1\u6709\u96e8\u707e\uff0c\u5c40\u90e8\u53ea\u4f1a\u6709\u9635\u96e8\u3002',
      {
        isWeather: true,
        viewerText: '\u6211\u5728\u60e0\u5dde\uff0c\u6709\u6ca1\u6709\u96e8\u707e',
        requiredAnswer:
          '\u5f53\u524d\u6280\u80fd\u6ca1\u6709\u53d6\u5f97\u60e0\u5dde\u5e02\u53ef\u6838\u5b9e\u7684\u96e8\u707e\u3001\u6d2a\u6c34\u3001\u5185\u6d9d\u6216\u5b98\u65b9\u9884\u8b66\u8d44\u6599\uff0c\u6240\u4ee5\u4e0d\u80fd\u5224\u65ad\u73b0\u5728\u6709\u6ca1\u6709\u96e8\u707e\u3002',
        claims: [],
      },
    );

    expect(result.text).toContain('\u4e0d\u80fd\u5224\u65ad');
    expect(result.text).not.toContain('\u60e0\u5dde\u4eca\u665a\u6ca1\u6709\u96e8\u707e');
    expect(result.reasons).toContain('no_fact_claims');
  });

  it('does not replace a location question with a strength bulletin', () => {
    const result = guardViewerResponse('巴威最新实况是8级、990百帕。', {
      isWeather: true,
      viewerText: '巴威现在到哪里了？',
      requiredAnswer: '巴威最新实况为热带风暴，中心风速18米每秒、8级。',
      claims: [],
    });

    expect(result.rewritten).toBe(true);
    expect(result.text).toBe('目前资料不足以确认它的具体位置。');
    expect(result.text).not.toContain('18米每秒');
  });

  it('preserves a naming question when evidence only contains strength', () => {
    const result = guardViewerResponse('海神现在是8级热带风暴。', {
      isWeather: true,
      viewerText: '为什么命名为海神？',
      requiredAnswer: '海神最新实况为8级热带风暴。',
      claims: [],
    });

    expect(result.text).toBe(
      '当前资料没有提供命名规则，我不能拿当前强度代替回答。',
    );
  });

  it('preserves a future-strength question instead of returning current strength', () => {
    const result = guardViewerResponse('它一定会达到五级飓风。', {
      isWeather: true,
      viewerText: '它会达到五级飓风强度吗？',
      requiredAnswer: '巴威最新实况为8级热带风暴。',
      claims: [],
    });

    expect(result.text).toBe('目前资料不足以判断它未来会达到什么强度。');
  });

  it('rejects a fallback about another technical subject', () => {
    const result = guardViewerResponse('JTWC认为97W发展概率很高。', {
      isWeather: true,
      viewerText: 'JTWC为什么给97W高发展概率？',
      requiredAnswer: '巴威最新实况为8级热带风暴。',
      claims: [],
    });

    expect(result.text).toBe(
      '当前资料不足以确认具体原因，我先不替机构下结论。',
    );
  });

  it('blocks a weather answer when the viewer asked an unrelated question', () => {
    const result = guardViewerResponse('巴威目前仍在海上移动。', {
      isWeather: true,
      viewerText: '主播今天心情怎么样？',
      requiredAnswer: '巴威最新实况为8级热带风暴。',
      claims: [],
    });

    expect(result.text).toBe('刚才答偏了，你可以再问我一次。');
    expect(result.reasons).toContain('off_topic');
  });

  it('accepts an evidence-backed city temperature answer as weather', () => {
    const result = guardViewerResponse(
      '南京现在30.8度，体感36度，晴间多云。今天预计28.3到34.4度，最高降水概率49%。',
      {
        isWeather: true,
        viewerText: '001号人类 的弹幕：南京气温',
        requiredAnswer:
          '南京当前气温30.8℃，体感36℃。今天预计28.3到34.4℃，最高降水概率49%。',
        claims: [
          { text: '南京当前气温30.8℃，体感36℃，晴间多云' },
          { text: '今天预计28.3到34.4℃，最高降水概率49%' },
        ],
      },
    );

    expect(result.rewritten).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.text).toContain('南京现在30.8度');
  });

  it('replaces unsupported naming lore when the viewer asked for a storm lifecycle', () => {
    const requiredAnswer =
      '海神不是凭空出现的。它是2026年第11号台风，确实在7月期间存在过；它只是现在已经不再活动。';
    const result = guardViewerResponse(
      '海神是台风命名表上的名字，由中国提交。',
      {
        isWeather: true,
        viewerText: '海神哪来的？',
        requiredAnswer,
        claims: [
          {
            type: 'official_observation',
            text: requiredAnswer,
          },
        ],
      },
    );

    expect(result.reasons).toContain('unanswered_intent');
    expect(result.text).toContain('2026年第11号台风');
    expect(result.text).not.toContain('命名表');
  });

  it('caps ordinary live replies without cutting in the middle of a later sentence', () => {
    const result = compactViewerResponse(
      '第一句先回答问题。第二句补充必要依据。第三句继续展开很多并不适合直播的细节。',
      20,
    );

    expect(result).toBe('第一句先回答问题。第二句补充必要依据。');
  });
});
