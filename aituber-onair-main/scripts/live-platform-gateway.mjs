import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LiveEventHub, splitLiveChatText } from './live-platform-gateway-common.mjs';

const DEFAULT_PORT = 8197;
const DEFAULT_SEND_INTERVAL_MS = 1600;
const OUTBOUND_ECHO_TTL_MS = 30_000;
const RADAR_CITY_EVENT_URL =
  process.env.RADAR_CITY_EVENT_URL || 'http://127.0.0.1:3038/api/live-city-events';
const ORDINARYROAD_VERSION = '1.5.8';
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const workspaceRoot = resolve(appRoot, '..');
const runtimeRoot = resolve(workspaceRoot, '.runtime', 'live-connectors');
const configFile = resolve(runtimeRoot, 'ordinaryroad.json');
const credentialRoot = resolve(runtimeRoot, 'credentials', 'ordinaryroad');
const legacyAuthFile =
  process.env.BILIBILI_AUTH_FILE || resolve(workspaceRoot, '.runtime', 'bilibili-auth.json');
const legacyRoomFile = resolve(appRoot, 'config', 'bilibili-room.txt');
const bridgeJar =
  process.env.ORDINARYROAD_GATEWAY_JAR ||
  resolve(appRoot, 'tools', 'ordinaryroad-gateway', 'target', 'ordinaryroad-gateway.jar');
const runtimeAuditUrl =
  process.env.LINGLAN_RUNTIME_AUDIT_URL ||
  'http://127.0.0.1:5173/api/live-runtime-events';

const PLATFORM_MANIFEST = [
  { id: 'bilibili', label: '哔哩哔哩', inbound: true, outbound: true, credential: true },
  { id: 'douyu', label: '斗鱼', inbound: true, outbound: true, credential: true },
  { id: 'huya', label: '虎牙', inbound: true, outbound: true, credential: true },
  {
    id: 'douyin',
    label: '抖音',
    inbound: true,
    outbound: false,
    credential: false,
    note: 'OrdinaryRoad 当前只保证接收，文字回写尚未稳定实现。',
  },
  { id: 'kuaishou', label: '快手', inbound: true, outbound: true, credential: true },
];
const PLATFORM_IDS = new Set(PLATFORM_MANIFEST.map((item) => item.id));
const SELF_VIEWER_IDS = new Set(
  String(process.env.BILIBILI_SELF_UIDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const RADAR_CITY_COMMAND = /^@\s*[\u3400-\u9fff]{2,16}[\s,，。！？!？、:：;；#]?$/u;

export function shouldSuppressConfiguredSelfEvent(
  event,
  selfViewerIds = SELF_VIEWER_IDS,
) {
  const viewerId = String(event?.author?.id || '').trim();
  if (!viewerId || !selfViewerIds.has(viewerId)) return false;
  if (
    event?.type === 'comment' &&
    RADAR_CITY_COMMAND.test(String(event.text || '').trim().normalize('NFKC'))
  ) {
    return false;
  }
  return true;
}

function log(level, message, details = {}) {
  process.stdout.write(`${JSON.stringify({ at: Date.now(), level, message, ...details })}\n`);
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error || 'unknown_error')
    .replace(
      /((?:SESSDATA|bili_jct|cookie|authorization|token|credential)\s*[:=]\s*)([^;\s,}]+)/gi,
      '$1[REDACTED]',
    )
    .slice(0, 1000);
}

export function isBilibiliRoomLive(payload) {
  return Number(payload?.data?.live_status) === 1;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function credentialPath(platformId) {
  return resolve(credentialRoot, `${platformId}.json`);
}

function loadCredential(platformId) {
  const parsed = readJson(credentialPath(platformId), {});
  return String(parsed?.cookie || '').trim();
}

function cookieValue(cookie, name) {
  return String(cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1]?.trim() || '';
}

function legacyRoomId() {
  try {
    return readFileSync(legacyRoomFile, 'utf8').trim();
  } catch {
    return String(process.env.BILIBILI_ROOM_ID || '').trim();
  }
}

function migrateLegacyState() {
  mkdirSync(credentialRoot, { recursive: true });
  const bilibiliCredential = credentialPath('bilibili');
  if (!existsSync(bilibiliCredential) && existsSync(legacyAuthFile)) {
    copyFileSync(legacyAuthFile, bilibiliCredential);
  }
  if (!existsSync(configFile)) {
    const roomId = legacyRoomId();
    writeJsonAtomic(configFile, {
      schemaVersion: 1,
      platforms: {
        bilibili: { enabled: Boolean(roomId), roomId },
      },
    });
  }
}

function loadConfig() {
  migrateLegacyState();
  const parsed = readJson(configFile, {});
  const platforms = {};
  for (const manifest of PLATFORM_MANIFEST) {
    const saved = parsed?.platforms?.[manifest.id] || {};
    platforms[manifest.id] = {
      enabled: saved.enabled === true,
      roomId: String(saved.roomId || '').trim(),
    };
  }
  return { schemaVersion: 1, platforms };
}

function emitAudit(event) {
  void fetch(runtimeAuditUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      at: Date.now(),
      actor: { type: 'system', id: 'ordinaryroad-live-connector' },
      source: 'live-platform-gateway',
      ...event,
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

class OrdinaryRoadProcess {
  constructor({ onMessage }) {
    this.onMessage = onMessage;
    this.pending = new Map();
    this.process = null;
    this.stopping = false;
    this.restartTimer = null;
  }

  start() {
    if (this.process || this.stopping) return;
    this.process = spawn('java', ['-jar', bridgeJar], {
      cwd: appRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const processId = this.process.pid;
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.kind === 'send-result' && message.commandId) {
        const pending = this.pending.get(message.commandId);
        if (pending) {
          this.pending.delete(message.commandId);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message);
          else pending.reject(new Error(message.error || 'ordinaryroad_send_failed'));
        }
      }
      this.onMessage(message);
    });
    this.process.stderr.on('data', (chunk) => {
      const detail = safeError(String(chunk).trim());
      if (detail) log('warn', 'OrdinaryRoad dependency log', { detail });
    });
    this.process.once('exit', (code) => {
      if (this.process?.pid !== processId) return;
      this.process = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('ordinaryroad_process_exited'));
      }
      this.pending.clear();
      this.onMessage({ kind: 'host-exit', code });
      if (!this.stopping) {
        this.restartTimer = setTimeout(() => this.start(), 3000);
      }
    });
  }

  command(payload) {
    if (!this.process?.stdin?.writable) throw new Error('ordinaryroad_not_ready');
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  connect(connectionId, platform, roomId, cookie) {
    this.command({ action: 'connect', connectionId, platform, roomId, cookie });
  }

  disconnect(connectionId) {
    if (this.process?.stdin?.writable) this.command({ action: 'disconnect', connectionId });
  }

  send(connectionId, message) {
    const commandId = randomUUID();
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        rejectSend(new Error('ordinaryroad_send_timeout'));
      }, 25_000);
      this.pending.set(commandId, { resolve: resolveSend, reject: rejectSend, timer });
      try {
        this.command({ action: 'send', commandId, connectionId, message });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(commandId);
        rejectSend(error);
      }
    });
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.process?.kill();
  }
}

class LivePlatformGateway {
  constructor(options = {}) {
    this.hub = new LiveEventHub();
    this.idempotency = new Map();
    this.pendingOutboundEchoes = new Map();
    this.config = loadConfig();
    if (options.platform && options.roomId) {
      this.config.platforms[options.platform] = {
        enabled: true,
        roomId: String(options.roomId),
      };
    }
    this.platforms = Object.fromEntries(
      PLATFORM_MANIFEST.map((manifest) => [
        manifest.id,
        {
          platformId: manifest.id,
          roomId: this.config.platforms[manifest.id]?.roomId || '',
          state: this.config.platforms[manifest.id]?.enabled ? 'starting' : 'disabled',
          credentialState: loadCredential(manifest.id) ? 'configured' : 'missing',
          inbound: manifest.inbound,
          outbound: manifest.outbound,
          normalizedEvents: 0,
          sentCount: 0,
          lastEventAt: null,
          lastSentAt: null,
          error: '',
        },
      ]),
    );
    this.bridge = new OrdinaryRoadProcess({ onMessage: (message) => this.handleBridgeMessage(message) });
  }

  connectionId(platformId) {
    return `ordinaryroad:${platformId}`;
  }

  outboundEchoKey(platformId, message) {
    return `${platformId}:${String(message || '').trim()}`;
  }

  reserveOutboundEcho(platformId, message, idempotencyKey) {
    const key = this.outboundEchoKey(platformId, message);
    const reservations = this.pendingOutboundEchoes.get(key) || [];
    const reservation = {
      id: randomUUID(),
      idempotencyKey,
      expiresAt: Date.now() + OUTBOUND_ECHO_TTL_MS,
    };
    reservations.push(reservation);
    this.pendingOutboundEchoes.set(key, reservations);
    return { key, id: reservation.id };
  }

  releaseOutboundEcho(reservation) {
    const reservations = this.pendingOutboundEchoes.get(reservation.key);
    if (!reservations) return;
    const remaining = reservations.filter((item) => item.id !== reservation.id);
    if (remaining.length) this.pendingOutboundEchoes.set(reservation.key, remaining);
    else this.pendingOutboundEchoes.delete(reservation.key);
  }

  consumeOutboundEcho(platformId, event) {
    if (event?.type !== 'comment') return false;
    const key = this.outboundEchoKey(platformId, event.text);
    const now = Date.now();
    const reservations = (this.pendingOutboundEchoes.get(key) || []).filter(
      (item) => item.expiresAt > now,
    );
    const reservation = reservations.shift();
    if (reservations.length) this.pendingOutboundEchoes.set(key, reservations);
    else this.pendingOutboundEchoes.delete(key);
    if (!reservation) return false;
    emitAudit({
      eventId: String(reservation.idempotencyKey || '').replace(/^speech:/, ''),
      stage: 'live_platform_outbound_echo_suppressed',
      connectorId: 'ordinaryroad',
      platformId,
      roomEventId: event.id,
    });
    return true;
  }

  suppressConfiguredSelfEvent(platformId, event) {
    const viewerId = String(event?.author?.id || '').trim();
    if (!shouldSuppressConfiguredSelfEvent(event)) return false;
    emitAudit({
      eventId: event.id,
      stage: 'live_platform_self_event_suppressed',
      connectorId: 'ordinaryroad',
      platformId,
      viewerId,
    });
    return true;
  }

  async start() {
    await this.refreshCredentialStates();
    await this.refreshBilibiliLiveStatus();
    this.bridge.start();
    this.authTimer = setInterval(() => void this.refreshCredentialStates(), 60_000);
    // OrdinaryRoad emits only live-status changes.  A gateway started after
    // the stream has begun would otherwise retain the initial false value and
    // suppress quiet-room dialogue for the entire session.
    this.liveStatusTimer = setInterval(
      () => void this.refreshBilibiliLiveStatus(),
      30_000,
    );
  }

  stop() {
    clearInterval(this.authTimer);
    clearInterval(this.liveStatusTimer);
    this.bridge.stop();
  }

  async refreshBilibiliLiveStatus() {
    const status = this.platforms.bilibili;
    const roomId = String(this.config.platforms.bilibili?.roomId || '').trim();
    if (!this.config.platforms.bilibili?.enabled || !roomId) return;
    try {
      const response = await fetch(
        `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 Chrome/136 Safari/537.36' },
          signal: AbortSignal.timeout(8_000),
        },
      );
      const payload = await response.json();
      if (!response.ok || payload?.code !== 0) return;
      const isLive = isBilibiliRoomLive(payload);
      if (status.isLive === isLive) return;
      status.isLive = isLive;
      this.hub.publish('status', this.safeStatus());
    } catch {
      // Do not overwrite a known state with a transient public API failure.
    }
  }

  syncConnections() {
    for (const manifest of PLATFORM_MANIFEST) {
      const config = this.config.platforms[manifest.id];
      const status = this.platforms[manifest.id];
      if (!config?.enabled || !config.roomId) {
        this.bridge.disconnect(this.connectionId(manifest.id));
        status.state = 'disabled';
        continue;
      }
      status.roomId = config.roomId;
      status.state = 'connecting';
      status.error = '';
      this.bridge.connect(
        this.connectionId(manifest.id),
        manifest.id,
        config.roomId,
        loadCredential(manifest.id),
      );
    }
    this.hub.publish('status', this.safeStatus());
  }

  safeStatus() {
    const enabled = Object.values(this.platforms).filter((item) => item.state !== 'disabled');
    const bilibili = this.platforms.bilibili;
    const state = enabled.some((item) => item.state === 'online')
      ? 'online'
      : enabled.some((item) => item.state === 'error')
        ? 'error'
        : enabled.length
          ? 'connecting'
          : 'disabled';
    return {
      state,
      connectorId: 'ordinaryroad',
      bridgeEngine: 'ordinaryroad-live-chat-client',
      ordinaryroadVersion: ORDINARYROAD_VERSION,
      platforms: structuredClone(this.platforms),
      connectedClients: this.hub.clients.size,
      at: Date.now(),
      // One-release compatibility fields for the existing supervisor skill.
      platform: 'bilibili',
      requestedRoomId: bilibili.roomId,
      roomId: Number(bilibili.roomId) || undefined,
      error: enabled.find((item) => item.error)?.error || '',
      outbound: {
        configured: bilibili.credentialState !== 'missing',
        authenticated: bilibili.credentialState === 'valid',
        sentCount: bilibili.sentCount,
        lastSentAt: bilibili.lastSentAt,
      },
    };
  }

  async refreshCredentialStates() {
    for (const manifest of PLATFORM_MANIFEST) {
      const cookie = loadCredential(manifest.id);
      this.platforms[manifest.id].credentialState = cookie ? 'configured' : 'missing';
    }
    const cookie = loadCredential('bilibili');
    if (!cookie) return;
    try {
      const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          Cookie: cookie,
          Referer: 'https://www.bilibili.com/',
          'User-Agent': 'Mozilla/5.0 Chrome/136 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json();
      this.platforms.bilibili.credentialState =
        response.ok && payload?.code === 0 && payload?.data?.isLogin ? 'valid' : 'invalid';
    } catch {
      this.platforms.bilibili.credentialState = 'unknown';
    }
  }

  handleBridgeMessage(message) {
    if (message.kind === 'bridge-ready') {
      this.syncConnections();
      return;
    }
    if (message.kind === 'host-exit') {
      for (const item of Object.values(this.platforms)) {
        if (item.state !== 'disabled') item.state = 'reconnecting';
      }
      this.hub.publish('status', this.safeStatus());
      return;
    }
    const platformId = String(
      message.platform || message.event?.metadata?.platformId || '',
    );
    const status = this.platforms[platformId];
    if (!status) return;
    if (message.kind === 'room-event' && message.event) {
      if (this.consumeOutboundEcho(platformId, message.event)) return;
      if (this.suppressConfiguredSelfEvent(platformId, message.event)) return;
      if (this.hub.publishRoomEvent(message.event)) {
        status.normalizedEvents += 1;
        status.lastEventAt = Date.now();
        void forwardCityCommentToRadar(message.event, platformId);
      }
      return;
    }
    if (message.kind === 'connection') {
      status.state = message.state || 'error';
      status.error = message.error || '';
    } else if (message.kind === 'room-stats') {
      status.onlineCount = Number(message.onlineCount || 0);
    } else if (message.kind === 'live-status') {
      status.isLive = Boolean(message.isLive);
    } else {
      return;
    }
    this.hub.publish('status', this.safeStatus());
  }

  updatePlatform(platformId, update) {
    if (!PLATFORM_IDS.has(platformId)) throw new Error('ordinaryroad_platform_unsupported');
    const roomId = String(update.roomId ?? this.config.platforms[platformId].roomId).trim();
    const enabled = update.enabled === true;
    if (enabled && !roomId) throw new Error('live_room_id_required');
    this.config.platforms[platformId] = { enabled, roomId };
    writeJsonAtomic(configFile, this.config);
    this.syncConnections();
    emitAudit({
      stage: 'live_connector_platform_configured',
      connectorId: 'ordinaryroad',
      platformId,
      roomId,
      enabled,
    });
    return this.safeStatus();
  }

  async updateCredential(platformId, cookie) {
    if (!PLATFORM_IDS.has(platformId)) throw new Error('ordinaryroad_platform_unsupported');
    const value = String(cookie || '').trim();
    if (!value) throw new Error('credential_empty');
    writeJsonAtomic(credentialPath(platformId), { cookie: value, updatedAt: Date.now() });
    await this.refreshCredentialStates();
    if (this.config.platforms[platformId]?.enabled) this.syncConnections();
    emitAudit({
      stage: 'live_connector_credential_updated',
      connectorId: 'ordinaryroad',
      platformId,
      credentialConfigured: true,
    });
  }

  clearCredential(platformId) {
    if (!PLATFORM_IDS.has(platformId)) throw new Error('ordinaryroad_platform_unsupported');
    writeJsonAtomic(credentialPath(platformId), { cookie: '', updatedAt: Date.now() });
    this.platforms[platformId].credentialState = 'missing';
    if (this.config.platforms[platformId]?.enabled) this.syncConnections();
  }

  async sendDanmu(platformId, message, idempotencyKey) {
    const manifest = PLATFORM_MANIFEST.find((item) => item.id === platformId);
    if (!manifest) throw new Error('ordinaryroad_platform_unsupported');
    if (!manifest.outbound) throw new Error('ordinaryroad_platform_receive_only');
    const config = this.config.platforms[platformId];
    if (!config?.enabled || !config.roomId) throw new Error('ordinaryroad_platform_not_enabled');
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error('ordinaryroad_idempotency_key_invalid');
    const chunks = splitLiveChatText(message, platformId === 'bilibili' ? 20 : 50);
    if (!chunks.length) throw new Error('ordinaryroad_message_empty');
    if (chunks.length > 8) throw new Error('ordinaryroad_message_too_long');
    const compoundKey = `${platformId}:${key}`;
    const fingerprint = createHash('sha256').update(chunks.join('\n')).digest('hex');
    const existing = this.idempotency.get(compoundKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('ordinaryroad_idempotency_key_conflict');
      if (existing.result) return { ...existing.result, duplicate: true };
      return existing.promise;
    }
    if (manifest.credential && !loadCredential(platformId)) {
      throw new Error('ordinaryroad_outbound_auth_missing');
    }
    const operation = (async () => {
      let chunksSent = 0;
      for (const chunk of chunks) {
        if (chunksSent) await new Promise((resolveDelay) => setTimeout(resolveDelay, DEFAULT_SEND_INTERVAL_MS));
        const echoReservation = this.reserveOutboundEcho(platformId, chunk, key);
        try {
          await this.bridge.send(this.connectionId(platformId), chunk);
        } catch (error) {
          this.releaseOutboundEcho(echoReservation);
          throw error;
        }
        chunksSent += 1;
        this.platforms[platformId].sentCount += 1;
        this.platforms[platformId].lastSentAt = Date.now();
      }
      const result = {
        ok: true,
        duplicate: false,
        chunksTotal: chunks.length,
        chunksSent,
        state: 'delivered',
      };
      const stored = this.idempotency.get(compoundKey);
      if (stored) stored.result = result;
      return result;
    })();
    this.idempotency.set(compoundKey, { fingerprint, promise: operation, result: null });
    return operation;
  }
}

async function forwardCityCommentToRadar(event, platform) {
  if (event?.type !== 'comment' || !String(event.text || '').trim()) return;
  try {
    const response = await fetch(RADAR_CITY_EVENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'aituber:live-comment',
        version: 1,
        id: String(event.id || ''),
        text: String(event.text).trim(),
        viewerId: String(event.author?.id || ''),
        viewerName: String(event.author?.name || ''),
        platform: String(platform || event.metadata?.platformId || 'live'),
        followEvidence: 'unknown',
        receivedAt: Number(event.metadata?.receivedAt) || Number(event.timestamp) || Date.now(),
      }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      log('warn', 'Radar city event forwarding rejected', {
        status: response.status,
        platform,
      });
    }
  } catch (error) {
    log('warn', 'Radar city event forwarding failed', { error: safeError(error) });
  }
}

function readRequestJson(request, maxSize = 16_384) {
  return new Promise((resolveBody, rejectBody) => {
    const body = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxSize) body.push(chunk);
    });
    request.on('end', () => {
      try {
        if (size > maxSize) throw new Error('request_too_large');
        resolveBody(JSON.parse(Buffer.concat(body).toString('utf8') || '{}'));
      } catch (error) {
        rejectBody(error);
      }
    });
  });
}

function createGatewayServer(gateway, port) {
  const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const origin = String(request.headers.origin || '');
    if (origin && !allowedOrigins.has(origin)) {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: 'origin_not_allowed' }));
      return;
    }
    if (requestUrl.pathname === '/manifest' && request.method === 'GET') {
      response.end(JSON.stringify({ id: 'ordinaryroad', label: 'OrdinaryRoad', platforms: PLATFORM_MANIFEST }));
      return;
    }
    if ((requestUrl.pathname === '/status' || requestUrl.pathname === '/health') && request.method === 'GET') {
      response.end(JSON.stringify(gateway.safeStatus()));
      return;
    }
    if (requestUrl.pathname === '/events' && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      gateway.hub.add(
        response,
        String(request.headers['last-event-id'] || requestUrl.searchParams.get('lastEventId') || ''),
        String(requestUrl.searchParams.get('client') || ''),
        gateway.safeStatus(),
      );
      const keepAlive = setInterval(() => response.write(': keepalive\n\n'), 15_000);
      request.on('close', () => {
        clearInterval(keepAlive);
        gateway.hub.remove(response);
      });
      return;
    }
    const platformRoute = requestUrl.pathname.match(/^\/platforms\/([^/]+)\/(config|credential)$/);
    if (platformRoute) {
      const platformId = decodeURIComponent(platformRoute[1]);
      const resource = platformRoute[2];
      void (async () => {
        try {
          if (resource === 'config' && request.method === 'PUT') {
            response.end(JSON.stringify(gateway.updatePlatform(platformId, await readRequestJson(request))));
            return;
          }
          if (resource === 'credential' && request.method === 'PUT') {
            const body = await readRequestJson(request);
            await gateway.updateCredential(platformId, body.cookie);
            response.end(JSON.stringify({ ok: true, configured: true }));
            return;
          }
          if (resource === 'credential' && request.method === 'DELETE') {
            gateway.clearCredential(platformId);
            response.end(JSON.stringify({ ok: true, configured: false }));
            return;
          }
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'method_not_allowed' }));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: safeError(error) }));
        }
      })();
      return;
    }
    if (requestUrl.pathname === '/send' && request.method === 'POST') {
      void (async () => {
        let payload = {};
        try {
          payload = await readRequestJson(request);
          const platformId = String(payload.platformId || 'bilibili');
          const result = await gateway.sendDanmu(platformId, payload.message, payload.idempotencyKey);
          emitAudit({
            eventId: String(payload.idempotencyKey || '').replace(/^speech:/, ''),
            stage: 'live_platform_delivery_succeeded',
            connectorId: 'ordinaryroad',
            platformId,
            message: String(payload.message || ''),
            result,
          });
          response.end(JSON.stringify(result));
        } catch (error) {
          const reason = safeError(error);
          emitAudit({
            stage: 'live_platform_delivery_failed',
            connectorId: 'ordinaryroad',
            platformId: String(payload.platformId || ''),
            error: reason,
          });
          response.statusCode = reason.includes('auth') ? 503 : 400;
          response.end(JSON.stringify({ error: reason }));
        }
      })();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  server.listen(port, '127.0.0.1', () =>
    log('info', 'OrdinaryRoad multi-platform gateway listening', { port }),
  );
  return server;
}

async function main() {
  const port = Number(process.env.BILIBILI_SUPERVISOR_PORT || DEFAULT_PORT);
  const gateway = new LivePlatformGateway();
  await gateway.start();
  const server = createGatewayServer(gateway, port);
  const shutdown = () => {
    gateway.stop();
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    log('error', 'Live-platform gateway failed', { error: safeError(error) });
    process.exitCode = 1;
  });
}

export {
  LivePlatformGateway,
  OrdinaryRoadProcess,
  PLATFORM_MANIFEST,
  createGatewayServer,
  safeError,
};
