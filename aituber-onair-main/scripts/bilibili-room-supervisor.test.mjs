import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BilibiliDanmuSender,
  decodePackets,
  encodePacket,
  EventHub,
  normalizeHistoryComment,
  normalizeRoomEvent,
  splitDanmuText,
} from './bilibili-room-supervisor.mjs';

test('encodes and decodes protocol packets', () => {
  const [decoded] = decodePackets(
    encodePacket(5, JSON.stringify({ cmd: 'TEST' })),
  );
  assert.equal(decoded.operation, 5);
  assert.deepEqual(JSON.parse(decoded.body.toString()), { cmd: 'TEST' });
});

test('normalizes danmaku messages', () => {
  const event = normalizeRoomEvent({
    cmd: 'DANMU_MSG',
    info: [[0, 0, 0, 0, 123456789], '你好凌岚', [42, '测试观众'], []],
  });
  assert.equal(event.type, 'comment');
  assert.equal(event.text, '你好凌岚');
  assert.equal(event.author.name, '测试观众');
});

test('normalizes paid interactions and ignores unknown events', () => {
  const event = normalizeRoomEvent({
    cmd: 'SUPER_CHAT_MESSAGE',
    data: {
      id: 7,
      message: '加油',
      price: 30,
      uid: 42,
      user_info: { uname: '测试观众' },
    },
  });
  assert.equal(event.type, 'superchat');
  assert.match(event.text, /加油/);
  assert.equal(normalizeRoomEvent({ cmd: 'ONLINE_RANK_COUNT' }), null);
});

test('normalizes history polling comments with stable ids', () => {
  const event = normalizeHistoryComment({
    id_str: 'message-1',
    text: '说句话',
    timeline: '2026-07-11 19:02:17',
    uid: 42,
    nickname: '测试观众',
  });
  assert.equal(event.id, 'history:message-1');
  assert.equal(event.text, '说句话');
  assert.equal(event.author.name, '测试观众');
  assert.equal(event.metadata.source, 'history-poll');
});

test('normalizes viewer entry events', () => {
  const event = normalizeRoomEvent({
    cmd: 'INTERACT_WORD_V2',
    data: {
      data: { uid: 42, uname: 'viewer', timestamp: 1_700_000_000 },
    },
  });
  assert.equal(event.type, 'entry');
  assert.equal(event.author.id, '42');
  assert.equal(event.author.name, 'viewer');
  assert.equal(event.timestamp, 1_700_000_000_000);
});

test('deduplicates identical comment text across Bilibili sources', () => {
  const hub = new EventHub();
  const first = {
    id: 'ws:1',
    type: 'comment',
    text: '同一条弹幕',
    timestamp: Date.now(),
    author: { id: 'masked', name: '亥***' },
    metadata: { command: 'DANMU_MSG' },
  };
  const second = {
    ...first,
    id: 'history:1',
    author: { id: '42', name: '亥既珠' },
    metadata: { source: 'history-poll' },
  };
  assert.equal(hub.publishRoomEvent(first), true);
  assert.equal(hub.publishRoomEvent(second), false);
});

test('keeps identical text from different viewers as separate comments', () => {
  const hub = new EventHub();
  const timestamp = Date.now();
  const first = {
    id: 'ws:a',
    type: 'comment',
    text: '安徽怎么样',
    timestamp,
    author: { id: '100', name: '观众甲' },
    metadata: { command: 'DANMU_MSG' },
  };
  const second = {
    ...first,
    id: 'ws:b',
    author: { id: '200', name: '观众乙' },
  };
  assert.equal(hub.publishRoomEvent(first), true);
  assert.equal(hub.publishRoomEvent(second), true);
});

test('does not replay an event already delivered to the same client key', () => {
  const hub = new EventHub();
  const writes = [];
  const firstClient = { write: (value) => writes.push(value), end() {} };
  hub.add(firstClient, '', 'browser-runtime', { state: 'online' });
  const firstEvent = {
    id: 'event:1',
    type: 'comment',
    text: '第一条',
    timestamp: Date.now(),
    author: { id: '1', name: '观众一' },
  };
  const secondEvent = {
    ...firstEvent,
    id: 'event:2',
    text: '第二条',
  };
  hub.publishRoomEvent(firstEvent);
  hub.publishRoomEvent(secondEvent);
  hub.remove(firstClient);

  const replayWrites = [];
  const secondClient = {
    write: (value) => replayWrites.push(value),
    end() {},
  };
  hub.add(secondClient, firstEvent.id, 'browser-runtime', { state: 'online' });
  assert.equal(
    replayWrites.some((value) => value.includes(secondEvent.id)),
    false,
  );
});

test('replays recent restart-gap events when a returning client has an old cursor', () => {
  const hub = new EventHub();
  const event = {
    id: 'event:after-restart',
    type: 'comment',
    text: '重启期间的弹幕',
    timestamp: Date.now(),
    author: { id: '2', name: '观众二' },
  };
  hub.publishRoomEvent(event);

  const writes = [];
  const returningClient = {
    write: (value) => writes.push(value),
    end() {},
  };
  hub.add(returningClient, 'cursor:from-old-process', 'browser-runtime', {
    state: 'online',
  });

  assert.equal(
    writes.some((value) => value.includes(event.id)),
    true,
  );
});

test('splits outbound danmu on Unicode code points and punctuation', () => {
  assert.deepEqual(splitDanmuText('第一句话，第二句话。', 6), [
    '第一句话，',
    '第二句话。',
  ]);
  assert.deepEqual(splitDanmuText('😀😀😀', 2), ['😀😀', '😀']);
});

test('sends authenticated danmu once for an idempotency key', async () => {
  const requests = [];
  const sender = new BilibiliDanmuSender({
    intervalMs: 0,
    maxLength: 20,
    authProvider: () => ({
      configured: true,
      cookie: 'SESSDATA=session; bili_jct=csrf-value',
      csrf: 'csrf-value',
    }),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes('/x/web-interface/nav')) {
        return new Response(
          JSON.stringify({ code: 0, data: { isLogin: true, mid: 123 } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ code: 0, data: {} }), {
        status: 200,
      });
    },
  });

  const first = await sender.send({
    roomId: 456,
    message: '测试自动回复',
    idempotencyKey: 'event-1',
  });
  const second = await sender.send({
    roomId: 456,
    message: '测试自动回复',
    idempotencyKey: 'event-1',
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(
    requests.filter(({ url }) => url.endsWith('/msg/send')).length,
    1,
  );
  const sendRequest = requests.find(({ url }) => url.endsWith('/msg/send'));
  assert.equal(sendRequest.options.body.get('roomid'), '456');
  assert.equal(sendRequest.options.body.get('csrf'), 'csrf-value');
  assert.equal(sendRequest.options.body.get('msg'), '测试自动回复');
  assert.equal(sendRequest.options.headers.Cookie.includes('SESSDATA='), true);
});

test('rejects outbound danmu when local authentication is missing', async () => {
  const sender = new BilibiliDanmuSender({
    authProvider: () => ({ configured: false, cookie: '', csrf: '' }),
  });
  await assert.rejects(
    sender.send({ roomId: 1, message: 'test', idempotencyKey: 'event-2' }),
    /bilibili_outbound_auth_missing/,
  );
});

test('coalesces concurrent sends with the same idempotency key', async () => {
  let sendRequests = 0;
  const sender = new BilibiliDanmuSender({
    intervalMs: 0,
    authProvider: () => ({
      configured: true,
      cookie: 'SESSDATA=session; bili_jct=csrf-value',
      csrf: 'csrf-value',
    }),
    fetchImpl: async (url) => {
      if (url.includes('/x/web-interface/nav')) {
        return new Response(
          JSON.stringify({ code: 0, data: { isLogin: true, mid: 123 } }),
          { status: 200 },
        );
      }
      sendRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ code: 0, data: {} }), {
        status: 200,
      });
    },
  });

  const [first, second] = await Promise.all([
    sender.send({ roomId: 456, message: '同一条回复', idempotencyKey: 'same' }),
    sender.send({ roomId: 456, message: '同一条回复', idempotencyKey: 'same' }),
  ]);

  assert.equal(sendRequests, 1);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
});
