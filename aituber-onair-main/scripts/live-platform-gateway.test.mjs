import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LiveEventHub,
  splitLiveChatText,
} from './live-platform-gateway-common.mjs';
import {
  effectivePlatformStatus,
  forwardCityCommentToRadar,
  forwardLiveCommentToHost,
  isBilibiliRoomLive,
  normalizeBilibiliHistoryComment,
  safeError,
  selectNewBilibiliHistoryEvents,
  shouldRetryFailedPlatformConnection,
  shouldRetryStartupConnections,
  shouldSuppressConfiguredSelfEvent,
} from './live-platform-gateway.mjs';

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

test('Bilibili room snapshot identifies an already-started stream', () => {
  assert.equal(isBilibiliRoomLive({ data: { live_status: 1 } }), true);
  assert.equal(isBilibiliRoomLive({ data: { live_status: 0 } }), false);
  assert.equal(isBilibiliRoomLive({}), false);
});

test('Bilibili history polling seeds existing comments and emits only later messages', () => {
  const seenIds = new Set();
  const existing = normalizeBilibiliHistoryComment({
    id_str: 'existing-1',
    text: '开播前消息',
    uid: 10,
    nickname: '观众甲',
    timeline: '2026-07-26 10:30:00',
  });
  const later = normalizeBilibiliHistoryComment({
    id_str: 'later-1',
    text: '@广州',
    uid: 20,
    nickname: '观众乙',
    timeline: '2026-07-26 10:31:00',
  });

  assert.deepEqual(
    selectNewBilibiliHistoryEvents([existing], seenIds, true),
    [],
  );
  assert.deepEqual(
    selectNewBilibiliHistoryEvents([existing, later], seenIds, false),
    [later],
  );
  assert.equal(later.id, 'history:later-1');
  assert.equal(later.author.name, '观众乙');
  assert.equal(later.metadata.platformId, 'bilibili');
});

test('startup recovery does not destroy a connection that is still connecting', () => {
  const config = {
    platforms: {
      bilibili: { enabled: true },
    },
  };
  assert.equal(
    shouldRetryStartupConnections(config, {
      bilibili: { state: 'connecting' },
    }),
    false,
  );
  assert.equal(
    shouldRetryStartupConnections(config, {
      bilibili: { state: 'disabled' },
    }),
    true,
  );
});

test('failed or unexpectedly disabled enabled-platform connections are retried', () => {
  assert.equal(
    shouldRetryFailedPlatformConnection(
      { enabled: true },
      { state: 'error' },
    ),
    true,
  );
  assert.equal(
    shouldRetryFailedPlatformConnection(
      { enabled: false },
      { state: 'error' },
    ),
    false,
  );
  assert.equal(
    shouldRetryFailedPlatformConnection(
      { enabled: true },
      { state: 'connecting' },
    ),
    false,
  );
  assert.equal(
    shouldRetryFailedPlatformConnection(
      { enabled: true },
      { state: 'disabled' },
    ),
    true,
  );
});

test('healthy Bilibili history ingestion keeps the host online during transport reconnects', () => {
  const now = 1_785_041_900_000;
  const status = effectivePlatformStatus(
    {
      platformId: 'bilibili',
      state: 'disabled',
      lastHistoryPollAt: now - 1_000,
    },
    { enabled: true },
    now,
  );

  assert.equal(status.state, 'online');
  assert.equal(status.transportState, 'disabled');
  assert.equal(status.fallbackHealthy, true);
  assert.equal(status.degraded, true);
  assert.equal(status.ingestMode, 'history-poll');
});

test('stale Bilibili history ingestion does not hide a disconnected transport', () => {
  const now = 1_785_041_900_000;
  const status = effectivePlatformStatus(
    {
      platformId: 'bilibili',
      state: 'disabled',
      lastHistoryPollAt: now - 60_000,
    },
    { enabled: true },
    now,
  );

  assert.equal(status.state, 'disabled');
  assert.equal(status.fallbackHealthy, false);
  assert.equal(status.degraded, false);
  assert.equal(status.ingestMode, 'none');
});

test('self-authored radar city commands bypass generic echo suppression', () => {
  const selfViewerIds = new Set(['21216205']);
  const event = (text) => ({
    type: 'comment',
    text,
    author: { id: '21216205', name: '主播' },
  });

  assert.equal(
    shouldSuppressConfiguredSelfEvent(event('普通主播回写'), selfViewerIds),
    true,
  );
  assert.equal(
    shouldSuppressConfiguredSelfEvent(event('@上海'), selfViewerIds),
    false,
  );
  assert.equal(
    shouldSuppressConfiguredSelfEvent(event('＠ 广东省广州市'), selfViewerIds),
    false,
  );
  assert.equal(
    shouldSuppressConfiguredSelfEvent(event('@观众 你好'), selfViewerIds),
    true,
  );
});

test('radar city forwarding retries a transient timeout without changing the event id', async () => {
  const requests = [];
  const fetcher = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) throw new DOMException('timed out', 'TimeoutError');
    return new Response('{}', { status: 200 });
  };
  const event = {
    id: 'bilibili-city-shenzhen',
    type: 'comment',
    text: '@深圳',
    author: { id: 'viewer-1', name: '观众' },
    timestamp: 1_785_021_786_217,
    metadata: {},
  };

  assert.equal(
    await forwardCityCommentToRadar(event, 'bilibili', {
      fetcher,
      retryDelaysMs: [0],
      timeoutMs: 10,
    }),
    true,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].id, event.id);
  assert.equal(requests[1].id, event.id);
});

test('live comments reach the host bridge even when no SSE client is connected', async () => {
  const requests = [];
  const event = {
    id: 'history:viewer-question-1',
    type: 'comment',
    text: '主播能看到吗',
    author: { id: 'viewer-1', name: '观众' },
    timestamp: 1_785_034_500_000,
    metadata: { platformId: 'bilibili', source: 'history-poll' },
  };

  assert.equal(
    await forwardLiveCommentToHost(event, 'bilibili', {
      fetcher: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return new Response('{}', { status: 202 });
      },
      retryDelaysMs: [],
    }),
    true,
  );
  assert.deepEqual(requests, [{
    requestId: event.id,
    text: event.text,
    viewerId: event.author.id,
    viewerName: event.author.name,
    requestedAt: event.timestamp,
  }]);
});
