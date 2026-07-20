import { describe, expect, it } from 'vitest';
import { normalizeCityReportEngagementPayload } from '../../examples/react-purupuru-app/src/lib/cityReportEngagementPolicy';

describe('city report engagement policy', () => {
  const stalePayload = {
    eventId: 'city-engagement:old-1',
    text: `<city_report_engagement>
目标观众：@小雨
已展开城市：伊宁
请自然引导关注。
</city_report_engagement>`,
    directReply:
      '@小雨，伊宁的战报已经展开了。觉得有用就点个关注，之后想看哪个城市，继续 @ 我就行。',
    viewerName: '小雨',
  };

  it.each(['legacy', 'shadow', 'canary', 'primary'] as const)(
    'removes stale city-triggered CTA copy and canned speech in %s mode',
    (mode) => {
      const normalized = normalizeCityReportEngagementPayload(
        stalePayload,
        mode,
      );

      expect(normalized.isCityReportResult).toBe(true);
      expect(normalized.legacySupportRequestRemoved).toBe(true);
      expect(normalized.directReply).toBeUndefined();
      expect(normalized.text).not.toContain('请自然引导关注');
    },
  );

  it('preserves verified weather facts while removing the direct-reply bypass', () => {
    const normalized = normalizeCityReportEngagementPayload(
      {
        eventId: 'city-engagement:new-weather-1',
        text: `<city_report_engagement>
目标观众：@小雨；查询城市：上海
已核验天气事实：气温36℃，体感42℃，全国城市体感温度第2/300
表达规则：普通天气，幽默毒舌地根据事实调侃。
</city_report_engagement>`,
        directReply: '上海的战报已经展开了。',
      },
      'primary',
    );

    expect(normalized.directReply).toBeUndefined();
    expect(normalized.text).toContain('气温36℃');
    expect(normalized.text).toContain('体感温度第2/300');
    expect(normalized.text).toContain('幽默毒舌');
    expect(normalized.text).not.toContain('战报已经展开');
    expect(normalized.text).toContain('不得索取关注、点赞、礼物');
  });

  it('does not report a current non-authorizing envelope as stale coupling', () => {
    const normalized = normalizeCityReportEngagementPayload(
      {
        eventId: 'city-engagement:new-1',
        text: `<city_report_engagement>
目标观众：@小雨
已展开城市：伊宁
这是结果事件，不携带关注状态，也不授权索取关注、点赞或礼物。
</city_report_engagement>`,
        directReply: undefined,
      },
      'shadow',
    );

    expect(normalized.legacySupportRequestRemoved).toBe(false);
  });

  it('does not rewrite ordinary messages', () => {
    const ordinary = {
      eventId: 'viewer-message:1',
      text: '这段讲得不错',
      directReply: '谢谢。',
    };
    expect(normalizeCityReportEngagementPayload(ordinary, 'primary')).toEqual({
      ...ordinary,
      isCityReportResult: false,
      legacySupportRequestRemoved: false,
    });
  });
});
