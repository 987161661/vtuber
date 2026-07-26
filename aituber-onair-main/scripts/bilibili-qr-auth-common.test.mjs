import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bilibiliQrState,
  mergeBilibiliLoginCookie,
} from './bilibili-qr-auth-common.mjs';

test('maps Bilibili QR polling results to stable UI states', () => {
  assert.equal(bilibiliQrState(86101), 'waiting-scan');
  assert.equal(bilibiliQrState(86090), 'waiting-confirmation');
  assert.equal(bilibiliQrState(86038), 'expired');
  assert.equal(bilibiliQrState(0), 'authenticated');
  assert.equal(bilibiliQrState(-1), 'error');
});

test('merges QR login credentials without exposing redirect-only fields', () => {
  const cookie = mergeBilibiliLoginCookie({
    existingCookie: 'buvid3=device; SESSDATA=old',
    redirectUrl:
      'https://example.test/?DedeUserID=42&SESSDATA=new-session&bili_jct=csrf&gourl=ignored',
    setCookieHeaders: ['sid=login-sid; Path=/; HttpOnly'],
  });

  assert.match(cookie, /buvid3=device/);
  assert.match(cookie, /DedeUserID=42/);
  assert.match(cookie, /SESSDATA=new-session/);
  assert.match(cookie, /bili_jct=csrf/);
  assert.match(cookie, /sid=login-sid/);
  assert.doesNotMatch(cookie, /gourl/);
});

test('rejects an incomplete QR login result', () => {
  assert.throws(
    () =>
      mergeBilibiliLoginCookie({
        redirectUrl: 'https://example.test/?SESSDATA=only-session',
      }),
    /bilibili_qr_cookie_incomplete/,
  );
});
