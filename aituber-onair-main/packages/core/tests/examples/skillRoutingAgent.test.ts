import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getWeatherLocationClarification,
  isDedicatedTyphoonRoomStatusQuestion,
  routeTyphoonSkillWithAgent,
} from '../../examples/react-purupuru-app/src/lib/skillRoutingAgent';

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
    expect(fetchMock).not.toHaveBeenCalled();
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
