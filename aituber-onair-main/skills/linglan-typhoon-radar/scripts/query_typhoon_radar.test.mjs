import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLandfallStatus,
  buildRequiredAnswer,
  extractNamedTyphoonQuery,
  extractSpecificPlace,
  intentFor,
  isAllowedGeocodeCandidate,
  selectStormsForQuestion,
  stormLocationAnswer,
} from './query_typhoon_radar.mjs';

test('answers a historical named storm from its archived final classification', () => {
  const history = {
    id: '202609',
    nameZh: '巴威',
    nameEn: 'BAVI',
    aliases: ['巴威', 'BAVI'],
    status: 'ceased-numbering',
    finalStage: '热带风暴',
    lastObservedAt: '2026-07-14T11:00:00.000Z',
    endedAt: '2026-07-14T12:30:00.000Z',
    source: '浙江省水利厅台风路径公开接口',
  };
  const answer = buildRequiredAnswer('巴威怎么样了', 'storm', null, null, [], [], { records: [] }, null, history);
  assert.match(answer, /巴威不是凭空出现的/);
  assert.match(answer, /不是凭空出现的/);
  assert.match(answer, /2026年第9号台风/);
  assert.match(answer, /现在已经不再活动/);
  assert.match(answer, /减弱为热带风暴/);
  assert.match(answer, /不能再把它当作台风实况来称呼/);
  assert.equal(extractNamedTyphoonQuery('巴威怎么样了'), '巴威');
  assert.equal(extractNamedTyphoonQuery('海神哪来的？'), '海神');
});

test('ignores the live-chat delivery prefix when extracting a named storm', () => {
  assert.equal(
    extractNamedTyphoonQuery(
      '001号人类 的弹幕：海神是几号台风？它在2026年7月是否真实存在过？',
    ),
    '海神',
  );
  assert.equal(
    extractNamedTyphoonQuery(
      '001号人类 的弹幕：请直接回答：海神在2026年7月是第几号台风？',
    ),
    '海神',
  );
});

test('preserves recent historical identity instead of treating a named storm as invented', () => {
  const history = {
    id: '202611',
    nameZh: '海神',
    nameEn: 'HAISHEN',
    aliases: ['海神', 'HAISHEN'],
    status: 'ceased-numbering',
    finalStage: '热带低压',
    lastObservedAt: '2026-07-14T03:00:00.000Z',
  };
  const answer = buildRequiredAnswer(
    '海神哪来的？',
    'storm',
    null,
    null,
    [],
    [],
    { records: [] },
    null,
    history,
  );
  assert.match(answer, /2026年第11号台风/);
  assert.match(answer, /7月期间存在过/);
  assert.match(answer, /现在已经不再活动/);
});

test('reports an empty active list without erasing recent typhoon history', () => {
  const answer = buildRequiredAnswer(
    '现在一共有几个台风？分别叫什么？',
    'storm',
    null,
    null,
    [],
    [],
    { records: [] },
  );
  assert.match(answer, /当前活动台风列表是空的/);
  assert.match(answer, /不代表2026年7月没有出现过台风/);
});

test('answers a named storm that left the active feed as ended, not unavailable', () => {
  const lifecycle = {
    id: '202609',
    nameZh: '巴威',
    nameEn: 'BAVI',
    status: 'exited-live-track',
    lastObservedAt: '2026-07-14T11:00:00.000Z',
    exitedLiveTrackAt: '2026-07-14T12:30:00.000Z',
  };
  const answer = buildRequiredAnswer('巴威现在怎么样', 'storm', null, null, [], [], { records: [] }, lifecycle);
  assert.match(answer, /巴威已经从当前活动台风列表中退出/);
  assert.match(answer, /已经收尾/);
});

test('treats common where-is-it phrasings as location questions', () => {
  assert.equal(intentFor('巴威现在到哪了'), 'location');
  assert.equal(intentFor('巴威现在到哪里了'), 'location');
  assert.equal(intentFor('巴威现在到哪儿了'), 'location');
});

test('treats rain-disaster questions as hazards and refuses an unsupported all-clear', () => {
  const question = '\u6211\u5728\u60e0\u5dde\uff0c\u6709\u6ca1\u6709\u96e8\u707e';
  assert.equal(intentFor(question), 'hazard');
  const answer = buildRequiredAnswer(
    question,
    'hazard',
    { city: '\u60e0\u5dde\u5e02' },
    null,
    [],
    [],
    { records: [] },
  );
  assert.match(answer, /\u6ca1\u6709\u53d6\u5f97\u60e0\u5dde\u5e02\u53ef\u6838\u5b9e\u7684\u96e8\u707e/);
  assert.match(answer, /\u4e0d\u80fd\u5224\u65ad/);
});

test('keeps confirmed landfalls distinct from missing landfall data', () => {
  const storms = [{
    id: 'bavi',
    nameZh: '巴威',
    nameEn: 'BAVI',
    landfalls: [{
      time: '2026-07-11T16:00:00.000Z',
      place: '浙江省温州市乐清市清江镇沿海',
    }],
  }];
  const confirmed = buildLandfallStatus('巴威登陆了吗', storms);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.records[0].stormName, '巴威');

  const missing = buildLandfallStatus('海神登陆了吗', [{
    id: 'haishen', nameZh: '海神', nameEn: 'HAISHEN', landfalls: [],
  }]);
  assert.equal(missing.status, 'not_provided');
  assert.equal(missing.confirmed, null);
  assert.match(missing.message, /不等于确认未登陆/);
});

test('extracts 余姚 without swallowing the wind-eye question', () => {
  assert.equal(
    extractSpecificPlace('余姚现在风大吗，会不会进入风眼'),
    '余姚',
  );
  assert.equal(extractSpecificPlace('我在余姚感觉没啥风啊'), '余姚');
  assert.equal(extractSpecificPlace('会到衢州吗'), '衢州');
});

test('answers named storm locations directly from upstream descriptions', () => {
  const storms = [
    {
      id: 'bavi',
      nameZh: '巴威',
      nameEn: 'BAVI',
      locationDescription: '位于山东省日照市岚山区境内',
      position: { lat: 35.2, lon: 119.3 },
    },
    {
      id: 'haishen',
      nameZh: '海神',
      nameEn: 'HAISHEN',
      locationDescription: '距离美国关岛偏西方向约980公里',
      position: { lat: 11.7, lon: 135.9 },
    },
  ];

  const selected = selectStormsForQuestion('海神在哪里啊？', storms);
  assert.deepEqual(selected.map((storm) => storm.id), ['haishen']);
  assert.equal(
    stormLocationAnswer(selected[0]),
    '海神中心目前距离美国关岛偏西方向约980公里（北纬11.7、东经135.9）',
  );
});

test('does not invent a city when the upstream description is absent', () => {
  assert.equal(
    stormLocationAnswer({
      nameZh: '测试台风',
      position: { lat: 20.1, lon: 130.2 },
    }),
    '测试台风中心目前在北纬20.1、东经130.2；当前信源没有提供可核实的城市名称',
  );
});

test('accepts settlements and rejects business POIs', () => {
  assert.equal(
    isAllowedGeocodeCandidate(
      {
        display_name: '余姚市, 宁波市, 浙江省, 中国',
        addresstype: 'city',
        category: 'boundary',
      },
      '余姚',
      '浙江省',
    ),
    true,
  );
  assert.equal(
    isAllowedGeocodeCandidate(
      {
        display_name: '中国石化余姚加油站, 安徽省, 中国',
        addresstype: 'fuel',
        category: 'amenity',
      },
      '余姚',
      '浙江省',
    ),
    false,
  );
});
