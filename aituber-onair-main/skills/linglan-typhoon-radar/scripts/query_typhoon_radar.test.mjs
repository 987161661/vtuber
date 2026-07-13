import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSpecificPlace,
  isAllowedGeocodeCandidate,
} from './query_typhoon_radar.mjs';

test('extracts 余姚 without swallowing the wind-eye question', () => {
  assert.equal(
    extractSpecificPlace('余姚现在风大吗，会不会进入风眼'),
    '余姚',
  );
  assert.equal(extractSpecificPlace('我在余姚感觉没啥风啊'), '余姚');
  assert.equal(extractSpecificPlace('会到衢州吗'), '衢州');
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
