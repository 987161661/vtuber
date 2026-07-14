import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LiveEventHub,
  splitLiveChatText,
} from './live-platform-gateway-common.mjs';
import { safeError } from './live-platform-gateway.mjs';

class FakeResponse {
  chunks = [];
  ended = false;

  write(chunk) {
    this.chunks.push(String(chunk));
  }

  end() {
    this.ended = true;
  }
}

test('splitLiveChatText preserves Unicode code points and punctuation', () => {
  assert.deepEqual(splitLiveChatText('台风已经远离，大家今晚安心休息。', 8), [
    '台风已经远离，',
    '大家今晚安心休息',
    '。',
  ]);
  assert.deepEqual(splitLiveChatText('🙂🙂🙂', 2), ['🙂🙂', '🙂']);
});

test('LiveEventHub de-duplicates repeated platform events', () => {
  const hub = new LiveEventHub();
  const event = {
    id: 'comment-1',
    type: 'comment',
    text: '你好',
    author: { id: 'viewer-1', name: '观众' },
    metadata: {},
  };

  assert.equal(hub.publishRoomEvent(event), true);
  assert.equal(hub.publishRoomEvent({ ...event }), false);
  assert.equal(hub.recentEvents.length, 1);
});

test('LiveEventHub resumes after the last delivered event', () => {
  const hub = new LiveEventHub();
  for (const id of ['event-1', 'event-2']) {
    hub.publishRoomEvent({
      id,
      type: 'comment',
      text: id,
      author: { id: id, name: id },
      metadata: {},
    });
  }

  const response = new FakeResponse();
  hub.add(response, 'event-1', 'browser-1', { state: 'online' });
  const output = response.chunks.join('');

  assert.match(output, /event: status/);
  assert.doesNotMatch(output, /id: event-1/);
  assert.match(output, /id: event-2/);
});

test('safeError redacts authentication material from dependency logs', () => {
  const sanitized = safeError(
    'Cookie: secret; SESSDATA=one; bili_jct: two',
  );
  assert.equal(sanitized.includes('secret'), false);
  assert.equal(sanitized.includes('one'), false);
  assert.equal(sanitized.includes('two'), false);
  assert.match(sanitized, /\[REDACTED\]/);
});
