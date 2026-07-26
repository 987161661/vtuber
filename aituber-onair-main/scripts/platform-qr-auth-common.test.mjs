import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseQrCandidate,
  hasPlatformLogin,
  platformAuthProvider,
  serializePlatformCookies,
} from './platform-qr-auth-common.mjs';

test('declares browser authorization providers for credentialed platforms', () => {
  assert.equal(platformAuthProvider('douyu')?.mode, 'browser');
  assert.equal(platformAuthProvider('huya')?.mode, 'browser');
  assert.equal(platformAuthProvider('kuaishou')?.mode, 'browser');
  assert.equal(platformAuthProvider('douyin'), null);
});

test('detects a platform login without accepting device-only cookies', () => {
  const provider = platformAuthProvider('kuaishou');
  assert.equal(hasPlatformLogin([{ name: 'did' }], provider), false);
  assert.equal(hasPlatformLogin([{ name: 'userId' }], provider), false);
  assert.equal(
    hasPlatformLogin(
      [{ name: 'userId' }, { name: 'kuaishou.live.web_st' }],
      provider,
    ),
    true,
  );
});

test('serializes only cookies owned by the selected platform', () => {
  const cookie = serializePlatformCookies(
    [
      { name: 'acf_uid', value: '42', domain: '.douyu.com' },
      { name: 'foreign', value: 'secret', domain: '.example.com' },
    ],
    platformAuthProvider('douyu'),
  );
  assert.equal(cookie, 'acf_uid=42');
});

test('prefers a square QR-hinted image over unrelated page artwork', () => {
  assert.equal(
    chooseQrCandidate([
      { x: 0, y: 0, width: 400, height: 200, visible: true, hint: 'banner' },
      { x: 20, y: 20, width: 220, height: 220, visible: true, hint: 'login-qrcode' },
    ])?.hint,
    'login-qrcode',
  );
  assert.equal(
    chooseQrCandidate([
      {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        visible: true,
        hint: 'anchor__QRCU6',
      },
    ]),
    null,
  );
  assert.equal(
    chooseQrCandidate([
      {
        x: 0,
        y: 0,
        width: 288,
        height: 162,
        visible: true,
        hint: 'kwai-player-blur',
        tagName: 'CANVAS',
      },
    ]),
    null,
  );
  assert.equal(
    chooseQrCandidate([
      {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        visible: true,
        hint: 'qr-area',
        tagName: 'DIV',
      },
      {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        visible: true,
        hint: 'qr-image',
        tagName: 'IMG',
      },
    ])?.tagName,
    'IMG',
  );
  assert.equal(
    chooseQrCandidate([
      {
        x: 0,
        y: 0,
        width: 130,
        height: 130,
        visible: true,
        hint: 'huya-app_qrcode huya-footer_prod',
        tagName: 'IMG',
      },
      {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        visible: true,
        hint: 'qr-image login-qr',
        tagName: 'IMG',
      },
    ])?.hint,
    'qr-image login-qr',
  );
});
