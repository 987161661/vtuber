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

  it('fails closed on a malformed structured JSON fragment', () => {
    const result = guardViewerResponse('{"text":"会下雨","emotion":"neutral"');
    expect(result.unsafeArtifacts).toBe(true);
    expect(result.text).toBe('这条回复出了点问题，稍后再说。');
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

  it('caps ordinary live replies without cutting in the middle of a later sentence', () => {
    const result = compactViewerResponse(
      '第一句先回答问题。第二句补充必要依据。第三句继续展开很多并不适合直播的细节。',
      20,
    );

    expect(result).toBe('第一句先回答问题。第二句补充必要依据。');
  });
});
