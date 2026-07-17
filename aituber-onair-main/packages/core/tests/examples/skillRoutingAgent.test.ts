import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractWeatherLocation,
  getWeatherLocationClarification,
  isDedicatedTyphoonRoomStatusQuestion,
  routeSoulSkillDeterministically,
  routeTyphoonSkillWithAgent,
} from '../../examples/react-purupuru-app/src/lib/skillRoutingAgent';

describe('routeSoulSkillDeterministically', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps ordinary chat on the companion fast path without a routing-agent call', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = routeSoulSkillDeterministically({
      text: '\u4f60\u4eca\u5929\u5fc3\u60c5\u600e\u4e48\u6837\uff1f',
      turns: [],
    });

    expect(decision).toMatchObject({
      reason: 'deterministic_companion_fast_path',
      mode: 'companion',
      intent: 'casual',
      inheritTyphoon: false,
      shouldSpeak: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps quiet-room thoughts in companion mode even when their context mentions typhoons', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = routeSoulSkillDeterministically({
      text: '<empty_room_awareness>\u6211\u521a\u624d\u770b\u5230\u53f0\u98ce\u96f7\u8fbe\uff0c\u60f3\u81ea\u7136\u804a\u804a\u3002</empty_room_awareness>',
      sourceLabel: 'quiet-room-awareness',
      turns: [],
    });

    expect(decision).toMatchObject({
      reason: 'quiet_room_companion_fast_path',
      mode: 'companion',
      inheritTyphoon: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['\u559c\u6b22\u7684\u8bdd\u53ef\u4ee5\u5173\u6ce8\u4e00\u4e0b', '\u5173\u6ce8'],
    ['\u4f60\u8fd9\u4e2a\u5de5\u5177\u4eba\uff0c\u95ed\u5634', '\u8fb9\u754c'],
  ])(
    'keeps %s in companion mode for the single Soul model to appraise (%s)',
    (text) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const decision = routeSoulSkillDeterministically({ text, turns: [] });

      expect(decision).toMatchObject({
        reason: 'soul_single_model_companion_route',
        mode: 'companion',
        inheritTyphoon: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('asks for a location locally when a weather question has none', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = routeSoulSkillDeterministically({
      text: '\u4eca\u5929\u5929\u6c14\u600e\u4e48\u6837\uff1f',
      turns: [],
    });

    expect(decision).toMatchObject({
      reason: 'weather_location_clarification_fast_path',
      mode: 'weather',
      intent: 'clarify_location',
      inheritTyphoon: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes weather-disaster questions to the urgent factual path', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = routeSoulSkillDeterministically({
      text: '\u6211\u5728\u60e0\u5dde\uff0c\u73b0\u5728\u6709\u6ca1\u6709\u5185\u6d9d\u5371\u9669\uff1f',
      sourceLabel: '\u666e\u901a\u76f4\u64ad\u95f4',
      turns: [],
    });

    expect(decision).toMatchObject({
      reason: 'weather_hazard_fact_route',
      mode: 'urgent',
      intent: 'weather_hazard_query',
      inheritTyphoon: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a named-system status question from the dedicated typhoon room', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = routeSoulSkillDeterministically({
      text: '\u6d77\u795e\u73b0\u5728\u5230\u54ea\u91cc\u4e86\uff1f',
      sourceLabel: '\u53f0\u98ce\u96f7\u8fbe\u5bf9\u8bdd',
      turns: [],
    });

    expect(decision).toMatchObject({
      reason: 'dedicated_typhoon_room_entity_status',
      mode: 'weather',
      intent: 'typhoon_status_query',
      inheritTyphoon: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('routeTyphoonSkillWithAgent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not spend a second LLM request on ordinary conversation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeTyphoonSkillWithAgent({
      text: '你好，今天过得怎么样？',
      turns: [],
    });

    expect(decision.reason).toBe('deterministic_companion_fast_path');
    expect(decision.mode).toBe('companion');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps quiet-room audience talk out of the weather router', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeTyphoonSkillWithAgent({
      text: '<empty_room_awareness>界面里刚出现过台风资料，请自然搭话。</empty_room_awareness>',
      sourceLabel: 'quiet-room-awareness',
      turns: [],
    });

    expect(decision.reason).toBe('quiet_room_companion_fast_path');
    expect(decision.mode).toBe('companion');
    expect(decision.inheritTyphoon).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps city-report engagement in companion mode without replaying weather facts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeTyphoonSkillWithAgent({
      text: '<city_report_engagement>目标观众：@小雨；已展开城市：伊宁；请自然引导关注。</city_report_engagement>',
      sourceLabel: '台风雷达对话',
      turns: [],
    });

    expect(decision.reason).toBe('city_report_engagement_companion_fast_path');
    expect(decision.mode).toBe('companion');
    expect(decision.inheritTyphoon).toBe(false);
    expect(decision.direction).toContain('指定观众');
    expect(decision.direction).toContain('不得追加关注、点赞、送礼');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks city-report results as non-CTA evidence on the Soul route', () => {
    const decision = routeSoulSkillDeterministically({
      text: '<city_report_engagement>已展开城市：伊宁</city_report_engagement>',
      sourceLabel: '台风雷达对话',
      turns: [],
    });

    expect(decision.reason).toBe('city_report_result_soul_route');
    expect(decision.inheritTyphoon).toBe(false);
    expect(decision.direction).toContain('不是关注、点赞或送礼触发器');
  });

  it('routes small-room entry welcomes as happy companion speech', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeTyphoonSkillWithAgent({
      text: '<viewer_entry_welcome>目标观众：@小雨；请高兴地欢迎。</viewer_entry_welcome>',
      sourceLabel: '少人直播间进场欢迎',
      turns: [],
    });

    expect(decision.reason).toBe('viewer_entry_welcome_companion_fast_path');
    expect(decision.mode).toBe('companion');
    expect(decision.inheritTyphoon).toBe(false);
    expect(decision.direction).toContain('高兴');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps specialist routing for explicit weather questions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: 'weather',
          intent: 'weather_query',
          direction: '查询天气事实',
          reason: 'explicit_weather',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeTyphoonSkillWithAgent({
      text: '今天台风到哪里了？',
      turns: [],
    });

    expect(decision.mode).toBe('weather');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('clarifies a weather question without a location without calling the router', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const text = '\u4eca\u5929\u5929\u6c14\u600e\u4e48\u6837';

    const decision = await routeTyphoonSkillWithAgent({ text, turns: [] });

    expect(getWeatherLocationClarification(text)).toContain('\u57ce\u5e02');
    expect(decision.reason).toBe('weather_location_clarification_fast_path');
    expect(decision.mode).toBe('weather');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mistake a city-qualified weather question for missing context', () => {
    expect(
      getWeatherLocationClarification(
        '\u676d\u5dde\u4eca\u5929\u5929\u6c14\u600e\u4e48\u6837',
      ),
    ).toBeNull();
  });

  it('routes a city-qualified weather question to city weather, never typhoon', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(extractWeatherLocation('北京天气怎么样')).toBe('北京');
    const decision = await routeTyphoonSkillWithAgent({
      text: '北京天气怎么样',
      sourceLabel: '台风雷达对话',
      turns: [],
    });

    expect(decision).toMatchObject({
      reason: 'city_weather_fact_route',
      mode: 'weather',
      intent: 'city_weather_query',
      inheritTyphoon: false,
      skillIds: ['city-weather'],
      skillQuery: '北京',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts the city from the durable live-room viewer envelope', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wrapped =
      '\u0030\u0030\u0031\u53f7\u4eba\u7c7b \u7684\u5f39\u5e55\uff1a\u5317\u4eac\u5929\u6c14\u600e\u4e48\u6837';

    expect(extractWeatherLocation(wrapped)).toBe('\u5317\u4eac');
    await expect(
      routeTyphoonSkillWithAgent({
        text: wrapped,
        sourceLabel: '\u53f0\u98ce Boss \u96f7\u8fbe',
        turns: [],
      }),
    ).resolves.toMatchObject({
      reason: 'city_weather_fact_route',
      skillIds: ['city-weather'],
      skillQuery: '\u5317\u4eac',
      inheritTyphoon: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a terse city temperature message to verified city weather', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wrapped = '001号人类 的弹幕：南京气温';

    expect(extractWeatherLocation(wrapped)).toBe('南京');
    await expect(
      routeTyphoonSkillWithAgent({
        text: wrapped,
        sourceLabel: '直播弹幕 · typhoon-radar',
        turns: [],
      }),
    ).resolves.toMatchObject({
      reason: 'city_weather_fact_route',
      mode: 'weather',
      intent: 'city_weather_query',
      skillIds: ['city-weather'],
      skillQuery: '南京',
      inheritTyphoon: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a weather-host identity challenge in companion conversation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const text = '\u4f60\u4e0d\u662f\u5929\u6c14\u4e3b\u64ad\u5417';

    expect(extractWeatherLocation(text)).toBeNull();
    await expect(
      routeTyphoonSkillWithAgent({
        text: `001\u53f7\u4eba\u7c7b \u7684\u5f39\u5e55\uff1a${text}`,
        sourceLabel: '\u53f0\u98ce Boss \u96f7\u8fbe',
        turns: [],
      }),
    ).resolves.toMatchObject({
      reason: 'weather_role_identity_companion_fast_path',
      mode: 'companion',
      intent: 'identity_role_question',
      inheritTyphoon: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a named system status question from the dedicated radar room without another LLM call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const text = '\u6d77\u795e\u600e\u4e48\u6837\u4e86';

    expect(
      isDedicatedTyphoonRoomStatusQuestion(
        text,
        '\u53f0\u98ce\u96f7\u8fbe\u5bf9\u8bdd',
      ),
    ).toBe(true);

    const decision = await routeTyphoonSkillWithAgent({
      text,
      sourceLabel: '\u53f0\u98ce\u96f7\u8fbe\u5bf9\u8bdd',
      turns: [],
    });

    expect(decision.reason).toBe('dedicated_typhoon_room_entity_status');
    expect(decision.mode).toBe('weather');
    expect(decision.inheritTyphoon).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not route an ordinary personal check-in from the radar room', () => {
    expect(
      isDedicatedTyphoonRoomStatusQuestion(
        '\u4f60\u600e\u4e48\u6837\u4e86',
        '\u53f0\u98ce\u96f7\u8fbe\u5bf9\u8bdd',
      ),
    ).toBe(false);
  });

  it('routes a local rain-disaster question to facts without another LLM call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeTyphoonSkillWithAgent({
      text: '\u6211\u5728\u60e0\u5dde\uff0c\u6709\u6ca1\u6709\u96e8\u707e',
      sourceLabel: '\u53f0\u98ce\u96f7\u8fbe\u5bf9\u8bdd',
      turns: [],
    });

    expect(decision.reason).toBe('weather_hazard_fact_route');
    expect(decision.mode).toBe('urgent');
    expect(decision.inheritTyphoon).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
