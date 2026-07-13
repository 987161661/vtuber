import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLandfallStatus,
  extractSpecificPlace,
  intentFor,
  isAllowedGeocodeCandidate,
  selectStormsForQuestion,
  stormLocationAnswer,
} from './query_typhoon_radar.mjs';

test('treats common where-is-it phrasings as location questions', () => {
  assert.equal(intentFor('巴威现在到哪了'), 'location');
  assert.equal(intentFor('巴威现在到哪里了'), 'location');
  assert.equal(intentFor('巴威现在到哪儿了'), 'location');
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
