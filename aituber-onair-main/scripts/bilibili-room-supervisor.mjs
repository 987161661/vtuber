import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, inflateSync } from 'node:zlib';

const HEADER_SIZE = 16;
const OP_HEARTBEAT = 2;
const OP_HEARTBEAT_REPLY = 3;
const OP_MESSAGE = 5;
const OP_AUTH = 7;
const OP_AUTH_REPLY = 8;
const DEFAULT_PORT = 8197;
const COMMENT_DEDUPLICATION_MS = 2 * 60_000;
const CROSS_SOURCE_TEXT_DEDUPLICATION_MS = 90_000;
const DEFAULT_DANMU_INTERVAL_MS = 1_600;
const DEFAULT_DANMU_MAX_LENGTH = 20;
const DEFAULT_AUTH_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.runtime',
  'bilibili-auth.json',
);
const SELF_UIDS = new Set(
  String(process.env.BILIBILI_SELF_UIDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36';
let anonymousDeviceCookie = '';
let wbiKeys;

function cookieValue(cookie, name) {
  const match = String(cookie || '').match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
  );
  return match?.[1]?.trim() || '';
}

function loadBilibiliAuth() {
  const authFile = process.env.BILIBILI_AUTH_FILE || DEFAULT_AUTH_FILE;
  try {
    const parsed = JSON.parse(readFileSync(authFile, 'utf8'));
    const cookie = String(parsed?.cookie || '').trim();
    const csrf = String(parsed?.csrf || cookieValue(cookie, 'bili_jct')).trim();
    return {
      cookie,
      csrf,
      configured: Boolean(
        cookieValue(cookie, 'SESSDATA') &&
          cookieValue(cookie, 'bili_jct') &&
          csrf,
      ),
    };
  } catch {
    return { cookie: '', csrf: '', configured: false };
  }
}

export function splitDanmuText(input, maxLength = DEFAULT_DANMU_MAX_LENGTH) {
  const normalized = String(input || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const limit = Math.max(1, Math.min(100, Number(maxLength) || 1));
  const remaining = Array.from(normalized);
  const chunks = [];
  const boundary = /[，。！？；、,.!?;：:\s]/;
  while (remaining.length > limit) {
    let end = limit;
    for (let index = limit - 1; index >= Math.floor(limit / 2); index -= 1) {
      if (boundary.test(remaining[index])) {
        end = index + 1;
        break;
      }
    }
    chunks.push(remaining.splice(0, end).join('').trim());
  }
  const tail = remaining.join('').trim();
  if (tail) chunks.push(tail);
  return chunks.filter(Boolean);
}

export class BilibiliDanmuSender {
  constructor({
    authProvider = loadBilibiliAuth,
    fetchImpl = fetch,
    intervalMs = Number(
      process.env.BILIBILI_DANMU_INTERVAL_MS || DEFAULT_DANMU_INTERVAL_MS,
    ),
    maxLength = Number(
      process.env.BILIBILI_DANMU_MAX_LENGTH || DEFAULT_DANMU_MAX_LENGTH,
    ),
  } = {}) {
    this.authProvider = authProvider;
    this.fetchImpl = fetchImpl;
    this.intervalMs = Math.max(0, intervalMs);
    this.maxLength = Math.max(1, Math.min(100, maxLength));
    this.idempotency = new Map();
    this.authFingerprint = '';
    this.userId = '';
    this.lastSentAt = 0;
    this.sentCount = 0;
    this.lastError = '';
  }

  currentAuth() {
    const auth = this.authProvider();
    const fingerprint = auth.configured
      ? createHash('sha256').update(auth.cookie).digest('hex')
      : '';
    if (fingerprint !== this.authFingerprint) {
      this.authFingerprint = fingerprint;
      this.userId = '';
    }
    return auth;
  }

  safeStatus() {
    const auth = this.currentAuth();
    return {
      configured: auth.configured,
      authenticated: Boolean(auth.configured && this.userId),
      accountUid: this.userId || undefined,
      maxLength: this.maxLength,
      minIntervalMs: this.intervalMs,
      sentCount: this.sentCount,
      lastSentAt: this.lastSentAt || null,
      lastError: this.lastError || undefined,
    };
  }

  async ensureAuthenticated(auth) {
    if (this.userId) return;
    const response = await this.fetchImpl(
      'https://api.bilibili.com/x/web-interface/nav',
      {
        headers: {
          Accept: 'application/json',
          Referer: 'https://www.bilibili.com/',
          'User-Agent': BROWSER_USER_AGENT,
          Cookie: auth.cookie,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`bilibili_auth_http_${response.status}`);
    }
    const payload = await response.json();
    if (
      payload.code !== 0 ||
      payload.data?.isLogin !== true ||
      !payload.data?.mid
    ) {
      throw new Error('bilibili_auth_invalid');
    }
    this.userId = String(payload.data.mid);
    SELF_UIDS.add(this.userId);
  }

  async waitForRateLimit() {
    const waitMs = this.lastSentAt + this.intervalMs - Date.now();
    if (waitMs > 0) {
      await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
    }
  }

  async send({ roomId, message, idempotencyKey }) {
    const auth = this.currentAuth();
    if (!auth.configured) throw new Error('bilibili_outbound_auth_missing');
    const key = String(idempotencyKey || '').trim();
    if (!key || key.length > 200) {
      throw new Error('bilibili_idempotency_key_invalid');
    }
    const chunks = splitDanmuText(message, this.maxLength);
    if (chunks.length === 0) throw new Error('bilibili_message_empty');
    if (chunks.length > 8) throw new Error('bilibili_message_too_long');

    let delivery = this.idempotency.get(key);
    if (delivery && delivery.message !== chunks.join('')) {
      throw new Error('bilibili_idempotency_key_conflict');
    }
    if (delivery?.completed) {
      return {
        ok: true,
        duplicate: true,
        chunksTotal: delivery.chunks.length,
        chunksSent: delivery.sent,
      };
    }
    if (!delivery) {
      delivery = {
        message: chunks.join(''),
        chunks,
        sent: 0,
        completed: false,
        createdAt: Date.now(),
      };
      this.idempotency.set(key, delivery);
    }

    if (delivery.inFlight) {
      const result = await delivery.inFlight;
      return { ...result, duplicate: true };
    }

    delivery.inFlight = (async () => {
      try {
        await this.ensureAuthenticated(auth);
        while (delivery.sent < delivery.chunks.length) {
          await this.waitForRateLimit();
          const chunk = delivery.chunks[delivery.sent];
          const response = await this.fetchImpl(
            'https://api.live.bilibili.com/msg/send',
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                Origin: 'https://live.bilibili.com',
                Referer: `https://live.bilibili.com/${roomId}`,
                'User-Agent': BROWSER_USER_AGENT,
                Cookie: auth.cookie,
              },
              body: new URLSearchParams({
                bubble: '0',
                msg: chunk,
                color: '16777215',
                mode: '1',
                fontsize: '25',
                rnd: String(Math.floor(Date.now() / 1000)),
                roomid: String(roomId),
                csrf: auth.csrf,
                csrf_token: auth.csrf,
              }),
            },
          );
          if (!response.ok) {
            throw new Error(`bilibili_send_http_${response.status}`);
          }
          const payload = await response.json();
          if (payload.code !== 0) {
            throw new Error(`bilibili_send_rejected_${payload.code}`);
          }
          delivery.sent += 1;
          this.sentCount += 1;
          this.lastSentAt = Date.now();
        }
        delivery.completed = true;
        this.lastError = '';
        while (this.idempotency.size > 1_000) {
          const oldest = this.idempotency.keys().next().value;
          if (oldest === undefined) break;
          this.idempotency.delete(oldest);
        }
        return {
          ok: true,
          duplicate: false,
          chunksTotal: delivery.chunks.length,
          chunksSent: delivery.sent,
        };
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    })();
    try {
      return await delivery.inFlight;
    } finally {
      delivery.inFlight = undefined;
    }
  }
}

function eventSource(event) {
  return String(event.metadata?.source || event.metadata?.command || 'unknown');
}

function isMaskedName(value) {
  return /\*|…/.test(String(value || ''));
}

function sameCrossSourceComment(left, right) {
  if (eventSource(left) === eventSource(right)) return false;
  if (Math.abs(Number(left.timestamp) - Number(right.timestamp)) > 10_000) {
    return false;
  }
  const leftId = String(left.author?.id || '');
  const rightId = String(right.author?.id || '');
  const leftName = String(left.author?.name || '');
  const rightName = String(right.author?.name || '');
  return (
    (leftId && leftId === rightId) ||
    (leftName && leftName === rightName) ||
    isMaskedName(leftName) ||
    isMaskedName(rightName)
  );
}
const WBI_MIXIN_INDEX = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

function log(level, message, details) {
  const entry = { at: new Date().toISOString(), level, message, ...details };
  console.log(JSON.stringify(entry));
}

export function encodePacket(operation, payload = '', version = 1) {
  const body = Buffer.from(payload);
  const packet = Buffer.alloc(HEADER_SIZE + body.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(HEADER_SIZE, 4);
  packet.writeUInt16BE(version, 6);
  packet.writeUInt32BE(operation, 8);
  packet.writeUInt32BE(1, 12);
  body.copy(packet, HEADER_SIZE);
  return packet;
}

export function decodePackets(input) {
  const source = Buffer.from(input);
  const decoded = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= source.length) {
    const packetLength = source.readUInt32BE(offset);
    const headerLength = source.readUInt16BE(offset + 4);
    const version = source.readUInt16BE(offset + 6);
    const operation = source.readUInt32BE(offset + 8);
    if (
      packetLength < headerLength ||
      headerLength < HEADER_SIZE ||
      offset + packetLength > source.length
    ) {
      break;
    }

    const body = source.subarray(offset + headerLength, offset + packetLength);
    if (operation === OP_MESSAGE && (version === 2 || version === 3)) {
      try {
        const expanded =
          version === 3 ? brotliDecompressSync(body) : inflateSync(body);
        decoded.push(...decodePackets(expanded));
      } catch (error) {
        decoded.push({ operation, version, error: String(error) });
      }
    } else {
      decoded.push({ operation, version, body });
    }
    offset += packetLength;
  }

  return decoded;
}

function parseJsonBody(packet) {
  try {
    return JSON.parse(packet.body.toString('utf8').replace(/\0+$/g, ''));
  } catch {
    return null;
  }
}

export function normalizeRoomEvent(payload) {
  const command = String(payload?.cmd || '').split(':')[0];
  const data = payload?.data || {};

  if (command === 'DANMU_MSG') {
    const info = payload.info || [];
    const user = info[2] || [];
    const badge = info[3] || [];
    const text = String(info[1] || '').trim();
    if (!text) return null;
    return {
      id: `danmu:${info[0]?.[4] || Date.now()}:${user[0] || user[1] || text}`,
      type: 'comment',
      text,
      timestamp: Number(info[0]?.[4] || Date.now()),
      author: {
        id: String(user[0] || user[1] || 'anonymous'),
        name: String(user[1] || '观众'),
      },
      metadata: { command, medal: badge[1] || undefined },
    };
  }

  if (
    command === 'SUPER_CHAT_MESSAGE' ||
    command === 'SUPER_CHAT_MESSAGE_JPN'
  ) {
    const text = String(data.message || '').trim();
    if (!text) return null;
    return {
      id: `superchat:${data.id || data.message_id || Date.now()}`,
      type: 'superchat',
      text: `醒目留言：${text}`,
      timestamp: Number(data.start_time || Date.now() / 1000) * 1000,
      author: {
        id: String(data.uid || data.user_info?.uname || 'anonymous'),
        name: String(data.user_info?.uname || '观众'),
        avatarUrl: data.user_info?.face || undefined,
      },
      metadata: { command, price: data.price },
    };
  }

  if (command === 'SEND_GIFT' && Number(data.total_coin || 0) > 0) {
    const count = Number(data.num || 1);
    return {
      id: `gift:${data.tid || data.timestamp || Date.now()}:${data.uid || data.uname}`,
      type: 'gift',
      text: `赠送了 ${count} 个${data.giftName || '礼物'}`,
      timestamp: Number(data.timestamp || Date.now() / 1000) * 1000,
      author: {
        id: String(data.uid || data.uname || 'anonymous'),
        name: String(data.uname || '观众'),
        avatarUrl: data.face || undefined,
      },
      metadata: { command, giftName: data.giftName, count },
    };
  }

  if (command === 'GUARD_BUY') {
    return {
      id: `guard:${data.uid || data.username}:${data.start_time || Date.now()}`,
      type: 'guard',
      text: `开通了${data.gift_name || '大航海'}`,
      timestamp: Number(data.start_time || Date.now() / 1000) * 1000,
      author: {
        id: String(data.uid || data.username || 'anonymous'),
        name: String(data.username || '观众'),
      },
      metadata: { command, level: data.guard_level },
    };
  }

  if (command === 'INTERACT_WORD' || command === 'INTERACT_WORD_V2') {
    const interaction = data.data || data;
    const uid = interaction.uid || interaction.uinfo?.uid;
    const name = interaction.uname || interaction.uinfo?.base?.name;
    if (!uid && !name) return null;
    return {
      id: `entry:${uid || name}:${interaction.timestamp || Date.now()}`,
      type: 'entry',
      text: '',
      timestamp: Number(interaction.timestamp || Date.now() / 1000) * 1000,
      author: {
        id: String(uid || name),
        name: String(name || '观众'),
        avatarUrl: interaction.uinfo?.base?.face || undefined,
      },
      metadata: { command },
    };
  }

  return null;
}

export function normalizeHistoryComment(comment) {
  const text = String(comment?.text || '').trim();
  if (!text) return null;
  const timeline = String(comment.timeline || '');
  const timestamp = timeline
    ? new Date(`${timeline.replace(' ', 'T')}+08:00`).getTime()
    : Date.now();
  return {
    id: `history:${comment.id_str || `${comment.uid}:${comment.rnd}:${timeline}`}`,
    type: 'comment',
    text,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    author: {
      id: String(comment.uid || comment.nickname || 'anonymous'),
      name: String(comment.nickname || '观众'),
      avatarUrl: comment.user?.base?.face || undefined,
    },
    metadata: { command: 'HISTORY_DANMU', source: 'history-poll' },
  };
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://live.bilibili.com/',
      'User-Agent': BROWSER_USER_AGENT,
      ...(anonymousDeviceCookie ? { Cookie: anonymousDeviceCookie } : {}),
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || `Bilibili API returned ${payload.code}`);
  }
  return payload.data;
}

async function refreshAnonymousDeviceCookie() {
  const response = await fetch(
    'https://api.bilibili.com/x/frontend/finger/spi',
    {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.bilibili.com/',
        'User-Agent': BROWSER_USER_AGENT,
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `Bilibili fingerprint API returned HTTP ${response.status}`,
    );
  const payload = await response.json();
  if (payload.code !== 0 || !payload.data?.b_3) {
    throw new Error(`Bilibili fingerprint API returned ${payload.code}`);
  }
  anonymousDeviceCookie = [
    `buvid3=${payload.data.b_3}`,
    payload.data.b_4 ? `buvid4=${payload.data.b_4}` : '',
    'CURRENT_FNVAL=4048',
  ]
    .filter(Boolean)
    .join('; ');
}

async function getWbiKeys() {
  if (wbiKeys) return wbiKeys;
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      Accept: 'application/json',
      Referer: 'https://www.bilibili.com/',
      'User-Agent': BROWSER_USER_AGENT,
      Cookie: anonymousDeviceCookie,
    },
  });
  if (!response.ok)
    throw new Error(`Bilibili nav API returned HTTP ${response.status}`);
  const payload = await response.json();
  const nav = payload.data || {};
  const imageKey = nav.wbi_img?.img_url?.split('/').pop()?.split('.')[0];
  const subKey = nav.wbi_img?.sub_url?.split('/').pop()?.split('.')[0];
  if (!imageKey || !subKey)
    throw new Error('Bilibili WBI keys are unavailable');
  const source = imageKey + subKey;
  const mixinKey = WBI_MIXIN_INDEX.map((index) => source[index] || '')
    .join('')
    .slice(0, 32);
  wbiKeys = { mixinKey, fetchedAt: Date.now() };
  return wbiKeys;
}

async function createWbiQuery(params) {
  const { mixinKey } = await getWbiKeys();
  const values = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(values)
    .sort()
    .map((key) => {
      const value = String(values[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const signature = createHash('md5')
    .update(query + mixinKey)
    .digest('hex');
  return `${query}&w_rid=${signature}`;
}

async function fetchHistoryComments(roomId) {
  const response = await fetch(
    'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `https://live.bilibili.com/${roomId}`,
        'User-Agent': BROWSER_USER_AGENT,
        ...(anonymousDeviceCookie ? { Cookie: anonymousDeviceCookie } : {}),
      },
      body: new URLSearchParams({ roomid: String(roomId) }),
    },
  );
  if (!response.ok) {
    throw new Error(`Bilibili history API returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(
      payload.message || `Bilibili history API returned ${payload.code}`,
    );
  }
  return (payload.data?.room || [])
    .map(normalizeHistoryComment)
    .filter(Boolean);
}

async function fetchOnlineAudience(roomId, ownerUid) {
  const data = await getJson(
    `https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank?roomId=${encodeURIComponent(roomId)}&ruid=${encodeURIComponent(ownerUid)}&page=1&pageSize=50`,
  );
  return Array.isArray(data?.OnlineRankItem) ? data.OnlineRankItem : [];
}

export async function resolveRoom(roomId) {
  if (!anonymousDeviceCookie) await refreshAnonymousDeviceCookie();
  const room = await getJson(
    `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
  );
  if (!room?.room_id) throw new Error('直播间不存在或无法访问');
  const wbiQuery = await createWbiQuery({ id: room.room_id, type: 0 });
  const server = await getJson(
    `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${wbiQuery}`,
  );
  const hosts = Array.isArray(server?.host_list) ? server.host_list : [];
  if (!server?.token || hosts.length === 0) {
    throw new Error('未获取到弹幕服务器信息');
  }
  return {
    roomId: Number(room.room_id),
    ownerUid: String(room.uid || ''),
    token: server.token,
    hosts,
    isLive: Number(room.live_status) === 1,
  };
}

export class EventHub {
  clients = new Set();
  clientsByKey = new Map();
  clientKeys = new Map();
  deliveredIdsByKey = new Map();
  recentIds = new Map();
  recentFingerprints = new Map();
  recentTextEvents = new Map();
  recentEvents = [];

  add(response, lastEventId = '', clientKey = '', currentStatus = {}) {
    if (clientKey) {
      const previous = this.clientsByKey.get(clientKey);
      if (previous && previous !== response) {
        this.clients.delete(previous);
        previous.end();
      }
      this.clientsByKey.set(clientKey, response);
      this.clientKeys.set(response, clientKey);
    }
    this.clients.add(response);
    response.write(`event: status\ndata: ${JSON.stringify(currentStatus)}\n\n`);
    const lastIndex = lastEventId
      ? this.recentEvents.findIndex((item) => item.event.id === lastEventId)
      : -1;
    // Replay normally from a known cursor. After a supervisor restart the
    // browser still has its old cursor, while this fresh process cannot find
    // it. In that case replay only events received during the last two minutes
    // so a short restart does not silently drop live comments. A fresh tab with
    // no cursor still receives no backlog.
    const delivered = clientKey
      ? this.deliveredIdsByKey.get(clientKey) || new Set()
      : new Set();
    if (clientKey) this.deliveredIdsByKey.set(clientKey, delivered);
    const replayCandidates =
      lastIndex >= 0
        ? this.recentEvents.slice(lastIndex + 1)
        : lastEventId && clientKey
          ? this.recentEvents.filter(
              (item) => Date.now() - item.receivedAt <= 2 * 60_000,
            )
          : [];
    const replay = replayCandidates.filter(
      (item) => !delivered.has(item.event.id),
    );
    for (const item of replay) {
      response.write(this.serialize('room-event', item.event, item.event.id));
      delivered.add(item.event.id);
    }
  }

  remove(response) {
    this.clients.delete(response);
    this.clientKeys.delete(response);
    for (const [key, client] of this.clientsByKey) {
      if (client === response) this.clientsByKey.delete(key);
    }
  }

  serialize(event, data, id = '') {
    const safeId = String(id).replace(/[\r\n]/g, '');
    return `${safeId ? `id: ${safeId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  publish(event, data, id = '') {
    const serialized = this.serialize(event, data, id);
    for (const client of this.clients) client.write(serialized);
  }

  fingerprint(event) {
    const authorId = String(
      event.author?.id || event.author?.name || 'anonymous',
    );
    const text = String(event.text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    return `${event.type || 'event'}:${authorId}:${text}`;
  }

  publishRoomEvent(event) {
    const now = Date.now();
    const fingerprint = this.fingerprint(event);
    const textFingerprint = String(event.text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const fingerprintSeenAt = this.recentFingerprints.get(fingerprint) || 0;
    const textEvents = this.recentTextEvents.get(textFingerprint) || [];
    const crossSourceDuplicate = textEvents.some(({ event: previous }) =>
      sameCrossSourceComment(previous, event),
    );
    if (
      this.recentIds.has(event.id) ||
      (fingerprintSeenAt > 0 &&
        now - fingerprintSeenAt < COMMENT_DEDUPLICATION_MS) ||
      (event.type === 'comment' && textFingerprint && crossSourceDuplicate)
    ) {
      return false;
    }
    event.metadata = {
      ...event.metadata,
      receivedAt: Number(event.metadata?.receivedAt) || now,
    };
    this.recentIds.set(event.id, now);
    this.recentFingerprints.set(fingerprint, now);
    if (textFingerprint) {
      const recent = textEvents
        .filter(
          (item) => now - item.seenAt < CROSS_SOURCE_TEXT_DEDUPLICATION_MS,
        )
        .concat({ event, seenAt: now })
        .slice(-20);
      this.recentTextEvents.set(textFingerprint, recent);
    }
    this.recentEvents.push({ event, receivedAt: now });
    if (this.recentEvents.length > 200) this.recentEvents.shift();
    if (this.recentIds.size > 2000) {
      for (const [id, seenAt] of this.recentIds) {
        if (now - seenAt > 10 * 60_000) this.recentIds.delete(id);
      }
      for (const [key, seenAt] of this.recentFingerprints) {
        if (now - seenAt > 10 * 60_000) this.recentFingerprints.delete(key);
      }
    }
    const serialized = this.serialize('room-event', event, event.id);
    for (const client of this.clients) {
      client.write(serialized);
      const clientKey = this.clientKeys.get(client);
      if (!clientKey) continue;
      const delivered = this.deliveredIdsByKey.get(clientKey) || new Set();
      delivered.add(event.id);
      while (delivered.size > 2000) {
        const oldest = delivered.values().next().value;
        if (oldest === undefined) break;
        delivered.delete(oldest);
      }
      this.deliveredIdsByKey.set(clientKey, delivered);
    }
    return true;
  }

  seedRoomEvent(event) {
    const now = Date.now();
    const fingerprint = this.fingerprint(event);
    const fingerprintSeenAt = this.recentFingerprints.get(fingerprint) || 0;
    const textFingerprint = String(event.text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const textEvents = this.recentTextEvents.get(textFingerprint) || [];
    const crossSourceDuplicate = textEvents.some(({ event: previous }) =>
      sameCrossSourceComment(previous, event),
    );
    if (
      this.recentIds.has(event.id) ||
      (fingerprintSeenAt > 0 &&
        now - fingerprintSeenAt < COMMENT_DEDUPLICATION_MS) ||
      (event.type === 'comment' && textFingerprint && crossSourceDuplicate)
    ) {
      return;
    }
    this.recentIds.set(event.id, now);
    this.recentFingerprints.set(fingerprint, now);
    if (textFingerprint) {
      this.recentTextEvents.set(
        textFingerprint,
        textEvents
          .filter(
            (item) => now - item.seenAt < CROSS_SOURCE_TEXT_DEDUPLICATION_MS,
          )
          .concat({ event, seenAt: now })
          .slice(-20),
      );
    }
    this.recentEvents.push({ event, receivedAt: now });
    if (this.recentEvents.length > 200) this.recentEvents.shift();
  }
}

export class BilibiliRoomSupervisor {
  constructor({
    roomId,
    hub = new EventHub(),
    sender = new BilibiliDanmuSender(),
  }) {
    this.requestedRoomId = roomId;
    this.hub = hub;
    this.sender = sender;
    this.stopped = false;
    this.ignoredSelfEventIds = new Set();
    this.audiencePresences = new Map();
    this.metrics = {
      wsPackets: 0,
      normalizedEvents: 0,
      historyEvents: 0,
      lastEventAt: null,
    };
    this.status = {
      state: 'starting',
      requestedRoomId: roomId,
      configuredSelfUidCount: SELF_UIDS.size,
      outbound: this.sender.safeStatus(),
      ...this.metrics,
    };
  }

  setStatus(state, details = {}) {
    this.status = {
      ...this.status,
      ...this.metrics,
      state,
      at: Date.now(),
      ...details,
      configuredSelfUidCount: SELF_UIDS.size,
      outbound: this.sender.safeStatus(),
    };
    this.hub.publish('status', this.status);
    log(
      state === 'error' ? 'error' : 'info',
      `Bilibili supervisor: ${state}`,
      details,
    );
  }

  async sendDanmu(message, idempotencyKey) {
    const result = await this.sender.send({
      roomId: this.connection?.roomId || this.requestedRoomId,
      message,
      idempotencyKey,
    });
    this.status = {
      ...this.status,
      configuredSelfUidCount: SELF_UIDS.size,
      outbound: this.sender.safeStatus(),
      at: Date.now(),
    };
    return result;
  }

  async run() {
    let attempt = 0;
    while (!this.stopped) {
      try {
        const connection = await resolveRoom(this.requestedRoomId);
        this.connection = connection;
        await this.ensureHistoryPolling(connection.roomId);
        this.ensureAudiencePolling(connection.roomId, connection.ownerUid);
        this.ensureRoomStatePolling(connection.roomId);
        await this.connectOnce(connection);
        attempt = 0;
      } catch (error) {
        if (this.stopped) break;
        attempt += 1;
        // Live operation favours quick recovery. Cap the transport reconnect
        // delay at five seconds; history polling covers the short gap.
        const retryMs = Math.min(5_000, 1_000 * 2 ** Math.min(attempt, 3));
        this.setStatus('error', { error: String(error), retryMs });
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  }

  ensureRoomStatePolling(roomId) {
    if (this.roomStateTimer) return;
    const refresh = async () => {
      try {
        const payload = await getJson(
          `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
        );
        const nextIsLive = Number(payload?.live_status) === 1;
        if (this.status.isLive !== nextIsLive) {
          this.status = { ...this.status, isLive: nextIsLive, at: Date.now() };
          this.hub.publish('status', this.status);
          log('info', 'Bilibili room live state changed', {
            roomId,
            isLive: nextIsLive,
          });
        }
      } catch (error) {
        log('warn', 'Bilibili room state polling failed', {
          error: String(error),
        });
      }
    };
    void refresh();
    this.roomStateTimer = setInterval(refresh, 10_000);
  }

  ensureAudiencePolling(roomId, ownerUid) {
    if (this.audienceTimer || !ownerUid) return;
    const refresh = async () => {
      try {
        const now = Date.now();
        const items = await fetchOnlineAudience(roomId, ownerUid);
        const onlineIds = new Set();
        for (const item of items) {
          const uid = String(item?.uid || item?.uinfo?.uid || '');
          if (!uid || SELF_UIDS.has(uid)) continue;
          onlineIds.add(uid);
          const previous = this.audiencePresences.get(uid);
          const presence = {
            uid,
            name: String(item?.name || item?.uinfo?.base?.name || '观众'),
            avatarUrl: item?.face || item?.uinfo?.base?.face || undefined,
            firstSeenAt: previous?.firstSeenAt || now,
            lastSeenAt: now,
            emitted: previous?.emitted || false,
          };
          this.audiencePresences.set(uid, presence);
          if (!presence.emitted && now - presence.firstSeenAt >= 30_000) {
            presence.emitted = true;
            this.hub.publishRoomEvent({
              id: `presence:${uid}:${presence.firstSeenAt}`,
              type: 'entry',
              text: '',
              timestamp: presence.firstSeenAt,
              author: {
                id: uid,
                name: presence.name,
                avatarUrl: presence.avatarUrl,
              },
              metadata: {
                command: 'ONLINE_GOLD_RANK',
                firstSeenAt: presence.firstSeenAt,
              },
            });
          }
        }

        // Anonymous sessions do not consistently expose INTERACT_WORD events or
        // ranked viewer identities. When the room count proves that somebody is
        // present, keep one room-level candidate so the director can still open
        // a conversation without inventing a name. This stays a single
        // candidate regardless of audience size, avoiding one-by-one greetings
        // when many viewers arrive together.
        const anonymousUid = '__anonymous_room_presence__';
        const reportedOnlineCount = Math.max(
          0,
          Number(this.status.onlineCount || 0),
        );
        if (items.length === 0 && reportedOnlineCount > 0) {
          onlineIds.add(anonymousUid);
          const previous = this.audiencePresences.get(anonymousUid);
          const presence = {
            uid: anonymousUid,
            name: '刚进来的朋友',
            firstSeenAt: previous?.firstSeenAt || now,
            lastSeenAt: now,
            emitted: previous?.emitted || false,
          };
          this.audiencePresences.set(anonymousUid, presence);
          if (!presence.emitted && now - presence.firstSeenAt >= 30_000) {
            presence.emitted = true;
            this.hub.publishRoomEvent({
              id: `presence:${anonymousUid}:${presence.firstSeenAt}`,
              type: 'entry',
              text: '',
              timestamp: presence.firstSeenAt,
              author: {
                id: anonymousUid,
                name: presence.name,
              },
              metadata: {
                command: 'ONLINE_RANK_COUNT_FALLBACK',
                firstSeenAt: presence.firstSeenAt,
                anonymous: true,
              },
            });
          }
        }
        for (const [uid, presence] of this.audiencePresences) {
          if (!onlineIds.has(uid) && now - presence.lastSeenAt > 20_000) {
            this.audiencePresences.delete(uid);
          }
        }
        this.status = {
          ...this.status,
          audienceCandidates: this.audiencePresences.size,
          at: now,
        };
      } catch (error) {
        log('warn', 'Bilibili audience polling failed', {
          error: String(error),
        });
      }
    };
    void refresh();
    this.audienceTimer = setInterval(refresh, 10_000);
  }

  async ensureHistoryPolling(roomId) {
    if (this.historyTimer) return;
    const initial = await fetchHistoryComments(roomId);
    for (const event of initial) {
      if (SELF_UIDS.has(String(event.author?.id || ''))) {
        this.ignoredSelfEventIds.add(event.id);
      } else {
        this.hub.seedRoomEvent(event);
      }
    }
    this.historyTimer = setInterval(async () => {
      try {
        const comments = await fetchHistoryComments(roomId);
        for (const event of comments) {
          if (SELF_UIDS.has(String(event.author?.id || ''))) {
            if (!this.ignoredSelfEventIds.has(event.id)) {
              this.ignoredSelfEventIds.add(event.id);
              log('info', 'Ignored self-authored Bilibili comment', {
                eventId: event.id,
                author: event.author.name,
              });
            }
            continue;
          }
          if (this.hub.publishRoomEvent(event)) {
            this.metrics.historyEvents += 1;
            this.metrics.normalizedEvents += 1;
            this.metrics.lastEventAt = Date.now();
            this.status = { ...this.status, ...this.metrics, at: Date.now() };
            log('info', 'Bilibili history comment received', {
              eventId: event.id,
              author: event.author.name,
            });
          }
        }
      } catch (error) {
        log('warn', 'Bilibili history polling failed', {
          error: String(error),
        });
      }
    }, 2_000);
  }

  connectOnce({ roomId, token, hosts, isLive }) {
    return new Promise((resolve, reject) => {
      const host = hosts[0];
      const url = `wss://${host.host}:${host.wss_port || 443}/sub`;
      const socket = new WebSocket(url);
      this.socket = socket;
      let authenticated = false;
      let settled = false;
      let heartbeat;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        if (error) reject(error);
        else resolve();
      };

      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => {
        socket.send(
          encodePacket(
            OP_AUTH,
            JSON.stringify({
              uid: 0,
              roomid: roomId,
              protover: 3,
              platform: 'web',
              type: 2,
              key: token,
            }),
          ),
        );
      });
      socket.addEventListener('message', (message) => {
        for (const packet of decodePackets(message.data)) {
          if (packet.error) {
            log('warn', 'Failed to decompress a Bilibili packet', {
              error: packet.error,
            });
            continue;
          }
          if (packet.operation === OP_AUTH_REPLY) {
            const auth = parseJsonBody(packet);
            if (auth?.code !== 0) {
              socket.close();
              finish(
                new Error(`Bilibili WebSocket auth failed: ${auth?.code}`),
              );
              return;
            }
            authenticated = true;
            this.setStatus('online', { roomId, isLive, websocket: url });
            socket.send(encodePacket(OP_HEARTBEAT, '[object Object]'));
            heartbeat = setInterval(() => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(encodePacket(OP_HEARTBEAT, '[object Object]'));
              }
            }, 30_000);
          } else if (packet.operation === OP_MESSAGE) {
            this.metrics.wsPackets += 1;
            const payload = parseJsonBody(packet);
            const command = String(payload?.cmd || '').split(':')[0];
            if (command === 'LIVE') {
              this.status = { ...this.status, isLive: true, at: Date.now() };
              this.hub.publish('status', this.status);
            } else if (command === 'PREPARING') {
              this.status = { ...this.status, isLive: false, at: Date.now() };
              this.hub.publish('status', this.status);
            } else if (command === 'ONLINE_RANK_COUNT') {
              this.status = {
                ...this.status,
                onlineCount: Math.max(0, Number(payload?.data?.count || 0)),
                at: Date.now(),
              };
              this.hub.publish('status', this.status);
            }
            const event = normalizeRoomEvent(payload);
            if (event && SELF_UIDS.has(String(event.author?.id || ''))) {
              if (!this.ignoredSelfEventIds.has(event.id)) {
                this.ignoredSelfEventIds.add(event.id);
                log('info', 'Ignored self-authored Bilibili event', {
                  eventId: event.id,
                  eventType: event.type,
                  author: event.author.name,
                });
              }
            }
            if (
              event &&
              !SELF_UIDS.has(String(event.author?.id || '')) &&
              this.hub.publishRoomEvent(event)
            ) {
              this.metrics.normalizedEvents += 1;
              this.metrics.lastEventAt = Date.now();
              log('info', 'Bilibili WebSocket event received', {
                eventId: event.id,
                eventType: event.type,
                author: event.author.name,
              });
            }
            this.status = { ...this.status, ...this.metrics, at: Date.now() };
          } else if (
            packet.operation === OP_HEARTBEAT_REPLY &&
            packet.body.length >= 4
          ) {
            this.status = {
              ...this.status,
              popularity: packet.body.readUInt32BE(0),
              at: Date.now(),
            };
          }
        }
      });
      socket.addEventListener('error', () => {
        finish(new Error(`Bilibili WebSocket error at ${url}`));
      });
      socket.addEventListener('close', (event) => {
        if (this.stopped) finish();
        else
          finish(
            new Error(
              `Bilibili WebSocket closed (${event.code}${authenticated ? '' : ', before auth'})`,
            ),
          );
      });
    });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.historyTimer);
    clearInterval(this.roomStateTimer);
    clearInterval(this.audienceTimer);
    this.historyTimer = undefined;
    this.roomStateTimer = undefined;
    this.audienceTimer = undefined;
    this.socket?.close(1000, 'shutdown');
    this.setStatus('stopped');
  }
}

export function createLocalServer(supervisor, port = DEFAULT_PORT) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const allowedOrigin =
      process.env.BILIBILI_SUPERVISOR_ALLOWED_ORIGIN || 'http://127.0.0.1:5173';
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (requestUrl.pathname === '/health') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          ...supervisor.status,
          configuredSelfUidCount: SELF_UIDS.size,
          outbound: supervisor.sender.safeStatus(),
          connectedClients: supervisor.hub.clients.size,
        }),
      );
      return;
    }
    if (requestUrl.pathname === '/send') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      const origin = String(request.headers.origin || '');
      if (origin && origin !== allowedOrigin) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: 'origin_not_allowed' }));
        return;
      }
      if (
        !String(request.headers['content-type'] || '').startsWith(
          'application/json',
        )
      ) {
        response.statusCode = 415;
        response.end(JSON.stringify({ error: 'json_required' }));
        return;
      }
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 4_096) chunks.push(chunk);
      });
      request.on('end', () => {
        void (async () => {
          try {
            if (size > 4_096) throw new Error('request_too_large');
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const result = await supervisor.sendDanmu(
              String(payload?.message || ''),
              String(payload?.idempotencyKey || ''),
            );
            response.statusCode = 200;
            response.end(JSON.stringify(result));
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : 'bilibili_send_failed';
            const statusCode =
              reason === 'bilibili_outbound_auth_missing'
                ? 503
                : reason === 'bilibili_auth_invalid'
                  ? 401
                  : reason.startsWith('bilibili_send_rejected_')
                    ? 502
                    : 400;
            response.statusCode = statusCode;
            response.end(JSON.stringify({ error: reason }));
          }
        })();
      });
      return;
    }
    if (requestUrl.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      supervisor.hub.add(
        response,
        String(
          request.headers['last-event-id'] ||
            requestUrl.searchParams.get('lastEventId') ||
            '',
        ),
        String(requestUrl.searchParams.get('client') || ''),
        supervisor.status,
      );
      const keepAlive = setInterval(
        () => response.write(': keepalive\n\n'),
        15_000,
      );
      request.on('close', () => {
        clearInterval(keepAlive);
        supervisor.hub.remove(response);
      });
      return;
    }
    response.statusCode = 404;
    response.end('Not found');
  });
  server.listen(port, '127.0.0.1', () =>
    log('info', 'Local event bridge listening', { port }),
  );
  return server;
}

async function main() {
  const roomId = process.env.BILIBILI_ROOM_ID || process.argv[2];
  const port = Number(process.env.BILIBILI_SUPERVISOR_PORT || DEFAULT_PORT);
  if (!roomId) {
    throw new Error(
      'Set BILIBILI_ROOM_ID or pass the public live room number as the first argument.',
    );
  }
  const supervisor = new BilibiliRoomSupervisor({ roomId });
  const server = createLocalServer(supervisor, port);
  const shutdown = () => {
    supervisor.stop();
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await supervisor.run();
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href
) {
  main().catch((error) => {
    log('error', 'Supervisor stopped', { error: String(error) });
    process.exitCode = 1;
  });
}
