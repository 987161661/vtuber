import { describe, expect, it } from 'vitest';
import { guardViewerResponse } from '../../examples/react-purupuru-app/src/lib/responseGuard';

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
    const result = guardViewerResponse(
      '{"text":"会下雨","emotion":"neutral"',
    );
    expect(result.unsafeArtifacts).toBe(true);
    expect(result.text).toBe('这条回复出了点问题，稍后再说。');
  });
});
