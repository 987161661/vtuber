import { describe, expect, it } from 'vitest';
import {
  buildIsolatedCityReportMessages,
  composeDeterministicCityReply,
  parseCityReportPayloadV2,
  prepareIsolatedCityReport,
  validateCityReportBinding,
} from '../../examples/react-purupuru-app/src/lib/cityReportIsolation';
import { vi } from 'vitest';

const text = `<city_report_engagement>
目标观众：@小雨；查询城市：北京
已核验天气事实：多云，气温25℃，体感26℃，湿度75%，风速3.1m/s
观众原始问题：北京今天热吗？
</city_report_engagement>`;

describe('isolated city report', () => {
  it('parses an immutable fact payload', () => {
    expect(
      parseCityReportPayloadV2({ eventId: 'city-engagement:1', text }),
    ).toMatchObject({
      viewerName: '小雨',
      city: '北京',
      allowedNumbers: ['25', '26', '75', '3.1'],
    });
  });

  it('tells the speech model how to verbalize rank-over-total notation', () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:ranking-prompt',
      text: `<city_report_engagement>
目标观众：@雷达操作台；查询城市：四平
已核验天气事实：湿度100%，全国排名湿度第1/354
</city_report_engagement>`,
    })!;
    const systemPrompt = buildIsolatedCityReportMessages(payload)[0].content;

    expect(systemPrompt).toContain('输出会不经解释直接送入中文TTS');
    expect(systemPrompt).toContain('A/B表示当前名次A、参评城市总数B');
    expect(systemPrompt).toContain(
      '全国三百五十四个城市中，湿度排名第一',
    );
    expect(systemPrompt).toContain('禁止原样输出斜杠排名');
    expect(systemPrompt).toContain('禁止说成“B分之一”');
  });

  it('rejects wrong viewers, cities and invented numbers', () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:1',
      text,
    })!;
    expect(
      validateCityReportBinding('阿明，南京现在30℃。', payload, {
        forbiddenViewerNames: ['阿明'],
        forbiddenCities: ['南京'],
      }),
    ).toEqual({
      valid: false,
      reasons: [
        'target_viewer_missing',
        'target_city_missing',
        'unverified_number:30',
        'other_viewer:阿明',
        'other_city:南京',
      ],
    });
  });

  it('rejects the real live replay that invented an evening time context', () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:bilibili:time-drift',
      text: `<city_report_engagement>
目标观众：@子安哥哥THU；查询城市：深圳
已核验天气事实：小雨，气温26℃，体感29℃，湿度93%，风速1.9m/s，降水3mm，全国排名降水第3/354
</city_report_engagement>`,
    })!;

    expect(
      validateCityReportBinding(
        '子安哥哥THU晚上好，深圳今晚有小雨，气温26℃，外出记得带把伞。',
        payload,
      ),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        reasons: expect.arrayContaining(['unverified_time_context']),
      }),
    );
  });

  it('rejects invented rank dimensions and unsupported rain advice', () => {
    const shanghai = parseCityReportPayloadV2({
      eventId: 'city-engagement:bilibili:rank-drift',
      text: `<city_report_engagement>
目标观众：@子安哥哥THU；查询城市：上海
已核验天气事实：阴，气温28℃，体感31℃，湿度88%，风速2.8m/s，全国排名体感温度第10/354
</city_report_engagement>`,
    })!;
    expect(
      validateCityReportBinding(
        '子安哥哥THU，上海阴，湿度88%在全国三百五十四个城市中排第一，体感温度排名第十。',
        shanghai,
      ).reasons,
    ).toContain('unverified_rank_dimension:湿度');

    const hengyang = parseCityReportPayloadV2({
      eventId: 'city-engagement:bilibili:umbrella-drift',
      text: `<city_report_engagement>
目标观众：@子安哥哥THU；查询城市：衡阳
已核验天气事实：阴，气温25℃，体感28℃，湿度100%，风速2.2m/s，全国排名湿度第1/354
</city_report_engagement>`,
    })!;
    expect(
      validateCityReportBinding(
        '子安哥哥THU，衡阳阴，湿度100%，出门记得带把伞。',
        hengyang,
      ).reasons,
    ).toContain('unsupported_precipitation_advice');
  });

  it('builds a bound fallback from the same facts', () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:1',
      text,
    })!;
    const reply = composeDeterministicCityReply(payload);
    expect(validateCityReportBinding(reply, payload).valid).toBe(true);
    expect(reply).toContain('小雨');
    expect(reply).toContain('北京');

    const rankedPayload = parseCityReportPayloadV2({
      eventId: 'city-engagement:ranking-fallback',
      text: text.replace(
        '多云，气温25℃，体感26℃，湿度75%，风速3.1m/s',
        '多云，湿度100%，全国排名湿度第1/354',
      ),
    })!;
    const rankedReply = composeDeterministicCityReply(rankedPayload);
    expect(rankedReply).toContain('全国三百五十四个城市中，湿度排名第一');
    expect(rankedReply).not.toContain('1/354');
  });

  it('preserves the non-weather half of a compound question', () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:2',
      text: text.replace(
        '北京今天热吗？',
        '青岛天天下雨，这个直播间存在的意义是什么？',
      ),
    })!;
    expect(payload.socialIntent).toContain('意义是什么');
    expect(composeDeterministicCityReply(payload)).toContain('直播间的意义');
  });

  it('accepts the first isolated reply and builds its speech plan', async () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:3',
      text,
    })!;
    const generate = vi.fn(async () => '小雨，北京现在多云，气温25℃。');

    const result = await prepareIsolatedCityReport({
      payload,
      recentTurns: [],
      generate,
    });

    expect(result.reply).toBe('小雨，北京现在多云，气温25℃。');
    expect(result.usedDeterministicFallback).toBe(false);
    expect(result.attempts).toEqual([{ index: 1, status: 'accepted' }]);
    expect(result.speechPlan).toMatchObject({
      version: 2,
      beats: [
        expect.objectContaining({
          emotion: 'relaxed',
          delivery: 'teasing',
          motion: 'idle_cold',
        }),
      ],
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('retries a cross-bound reply before accepting a valid result', async () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:4',
      text,
    })!;
    const generate = vi
      .fn()
      .mockResolvedValueOnce('阿明，南京现在30℃。')
      .mockResolvedValueOnce('小雨，北京现在多云，气温25℃。');

    const result = await prepareIsolatedCityReport({
      payload,
      recentTurns: [
        { viewerName: '阿明', input: '查询城市：南京', reply: '南京晴。' },
      ],
      generate,
    });

    expect(result.reply).toContain('小雨');
    expect(result.usedDeterministicFallback).toBe(false);
    expect(result.attempts).toEqual([
      {
        index: 1,
        status: 'rejected',
        reasons: expect.arrayContaining([
          'target_viewer_missing',
          'target_city_missing',
          'unverified_number:30',
          'other_viewer:阿明',
          'other_city:南京',
        ]),
      },
      { index: 2, status: 'accepted' },
    ]);
  });

  it('uses the fact-bound deterministic reply after generation failures', async () => {
    const payload = parseCityReportPayloadV2({
      eventId: 'city-engagement:5',
      text,
    })!;
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce('unbound answer 99');

    const result = await prepareIsolatedCityReport({
      payload,
      recentTurns: [],
      generate,
    });

    expect(result.usedDeterministicFallback).toBe(true);
    expect(validateCityReportBinding(result.reply, payload).valid).toBe(true);
    expect(result.attempts).toEqual([
      { index: 1, status: 'failed', error: 'provider unavailable' },
      {
        index: 2,
        status: 'rejected',
        reasons: expect.arrayContaining(['unverified_number:99']),
      },
    ]);
  });
});
