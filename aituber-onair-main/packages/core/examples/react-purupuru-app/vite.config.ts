import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  createStressTestController,
  type StressIngestMessage,
} from './stressTestRuntime';
import {
  hasUnsafeSpeechArtifacts,
  sanitizeSpeechText,
} from '../../../voice/src/utils/sanitizeSpeechText';
import {
  LiveSafetyGateway,
  type SafetyDecisionInput,
} from './src/lib/liveSafetyGateway';

let runtimeSettings: string | null = null;
let runtimeSettingsRevision = 0;
let runtimeSettingsPublishedAt = 0;
const runtimeSettingsSubscribers = new Set<ServerResponse>();

function runtimeSettingsEnvelope() {
  if (!runtimeSettings) return null;
  return JSON.stringify({
    version: 1,
    revision: runtimeSettingsRevision,
    publishedAt: runtimeSettingsPublishedAt,
    settings: JSON.parse(runtimeSettings),
  });
}

function publishRuntimeSettings() {
  const envelope = runtimeSettingsEnvelope();
  if (!envelope) return;
  for (const subscriber of runtimeSettingsSubscribers) {
    try {
      subscriber.write(`event: settings\ndata: ${envelope}\nid: ${runtimeSettingsRevision}\n\n`);
    } catch {
      runtimeSettingsSubscribers.delete(subscriber);
    }
  }
}
// This is the only supported runtime tree. Do not derive it from a copied
// checkout: D:\vtuber is retained solely as a historical archive.
const APP_ROOT =
  process.env.AITUBER_RUNTIME_ROOT ||
  'D:/LocalToolset/vtuber/aituber-onair-main';
const WORKSPACE_ROOT = dirname(APP_ROOT);
const CONVERSATION_LOG_PATH = join(
  APP_ROOT,
  'logs',
  'linglan-conversation-history.jsonl',
);
const LIVE_RUNTIME_LOG_PATH = join(
  APP_ROOT,
  'logs',
  'linglan-live-runtime-events.jsonl',
);
const AUDIT_TRAIL_PATH = join(APP_ROOT, 'logs', 'linglan-audit-trail.jsonl');
const OPERATOR_QUEUE_PATH = join(
  APP_ROOT,
  'logs',
  'linglan-operator-queue.json',
);
const ACCEPTANCE_LEDGER_PATH = join(
  APP_ROOT,
  '.runtime',
  'acceptance-ledger.json',
);
const REPLY_LATENCY_LOG_PATH = join(
  WORKSPACE_ROOT,
  '.runtime',
  'reply-latency.jsonl',
);
const DIGITAL_HOST_EVENT_SINK_URL =
  process.env.LINGLAN_EVENT_SINK_URL ||
  'http://127.0.0.1:3038/api/digital-host/events';
const pendingTtsUpdates = new Map<
  string,
  { ttsStartAt?: number; ttsEndAt?: number }
>();
let historyMutationQueue: Promise<void> = Promise.resolve();
let auditMutationQueue: Promise<void> = Promise.resolve();
let auditSequence = 0;
let auditPreviousHash = 'GENESIS';
let auditStateLoaded = false;
let radarCityEventSequence = 0;
const radarCityEvents: Array<{ sequence: number; event: unknown }> = [];

const SENSITIVE_AUDIT_KEY =
  /(?:api[-_]?key|authorization|cookie|sessdata|bili_jct|csrf|token|secret|password|credential)/i;
const SENSITIVE_INLINE_VALUE =
  /((?:api[-_]?key|authorization|cookie|sessdata|bili_jct|csrf|token|secret|password|credential)\s*[:=]\s*)([^\s,;]+)/gi;

function redactAuditValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_AUDIT_KEY.test(key)) {
    const present =
      typeof value === 'string' ? Boolean(value.trim()) : value != null;
    return present ? '[REDACTED]' : value;
  }
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_INLINE_VALUE, '$1[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAuditValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([entryKey, entry]) => [entryKey, redactAuditValue(entry, entryKey)],
      ),
    );
  }
  return value;
}

async function loadAuditState() {
  if (auditStateLoaded) return;
  auditStateLoaded = true;
  try {
    const raw = await readFile(AUDIT_TRAIL_PATH, 'utf8');
    const lastLine = raw.split(/\r?\n/).filter(Boolean).at(-1);
    if (!lastLine) return;
    const last = JSON.parse(lastLine) as {
      sequence?: unknown;
      entryHash?: unknown;
    };
    auditSequence = Math.max(0, Number(last.sequence) || 0);
    auditPreviousHash =
      typeof last.entryHash === 'string' && last.entryHash
        ? last.entryHash
        : 'GENESIS';
  } catch {
    // The first audit entry creates the file and starts a new hash chain.
  }
}

function appendAuditEntry(event: Record<string, unknown>): Promise<void> {
  auditMutationQueue = auditMutationQueue.then(async () => {
    await loadAuditState();
    const receivedAt = Date.now();
    const sequence = ++auditSequence;
    const safeEvent = redactAuditValue(event) as Record<string, unknown>;
    const entryWithoutHash = {
      ...safeEvent,
      schemaVersion: 1,
      auditId: `audit-${receivedAt}-${sequence}`,
      sequence,
      occurredAt: finiteTimestamp(safeEvent.occurredAt) ?? receivedAt,
      receivedAt,
      previousHash: auditPreviousHash,
    };
    const entryHash = createHash('sha256')
      .update(JSON.stringify(entryWithoutHash))
      .digest('hex');
    const entry = { ...entryWithoutHash, entryHash };
    await mkdir(join(AUDIT_TRAIL_PATH, '..'), { recursive: true });
    await appendFile(AUDIT_TRAIL_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    auditPreviousHash = entryHash;
  });
  return auditMutationQueue;
}

function verifyAuditEntries(entries: Record<string, unknown>[]) {
  let previousHash = 'GENESIS';
  for (const entry of entries) {
    const { entryHash, ...entryWithoutHash } = entry;
    const calculated = createHash('sha256')
      .update(JSON.stringify(entryWithoutHash))
      .digest('hex');
    if (
      entry.previousHash !== previousHash ||
      typeof entryHash !== 'string' ||
      entryHash !== calculated
    ) {
      return {
        valid: false,
        checkedEntries: entries.indexOf(entry),
        firstInvalidSequence: entry.sequence ?? null,
      };
    }
    previousHash = entryHash;
  }
  return {
    valid: true,
    checkedEntries: entries.length,
    firstInvalidSequence: null,
  };
}
const externalChatQueue = new Map<
  string,
  {
    requestId: string;
    text: string;
    directReply?: string;
    requestedAt: number;
    viewerId?: string;
    viewerName?: string;
  }
>();

type OperatorQueueStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'deleted';
type OperatorQueueItem = {
  eventId: string;
  text: string;
  prompt?: string;
  source: string;
  sourceLabel?: string;
  viewerId?: string;
  viewerName?: string;
  sourcesSeen: string[];
  createdAt: number;
  updatedAt: number;
  order: number;
  status: OperatorQueueStatus;
  preparedReply?: string;
  preparedAt?: number;
  doneAt?: number;
  skipReason?: string;
  skills: string[];
  testRunId?: string;
  stepId?: string;
  scenarioId?: string;
  finishReason?: string;
  retryCount?: number;
  beatCount?: number;
  completedBeatCount?: number;
  replyHash?: string;
  faultKind?:
    | 'typhoon-skill-timeout'
    | 'model-truncation'
    | 'tts-first-beat-failure'
    | 'prepare-lease-expiry';
  faultConsumed?: boolean;
  interactionObservedAt?: number;
  presenceOnly?: boolean;
  engagementAppliedAt?: number;
  engagementSignals?: Array<'follow' | 'like' | 'gift' | 'superchat' | 'guard'>;
  leaseOwnerId?: string;
  leaseExpiresAt?: number;
  audioByteLength?: number;
  panelObservedAt?: number;
  relationshipVisitDelta?: number;
  otherViewerRelationshipMutated?: boolean;
  assignedOwnerId?: string;
};
// The control-room tab and the overlay iframe do not share React state. This
// small in-process queue is their explicit, authoritative control protocol.
const operatorQueue = new Map<string, OperatorQueueItem>();
const PREPARE_LEASE_MS = 120_000;
// A verified MiniMax response can legitimately play for more than one minute.
// This lease must outlive the client-side no-progress watchdog; otherwise a
// healthy playback is requeued and can be announced twice.
const SPEAK_LEASE_MS = 60_000;
// A core recovery rebuilds React state asynchronously.  Allow the recovered
// owner to become ready before treating a no-draft completion as terminal.
// This remains bounded so a genuine provider failure is still observable.
const MAX_QUEUE_RETRIES = 4;
const RUNTIME_OWNER_HEARTBEAT_TTL_MS = 15_000;
const RUNTIME_OWNER_LEASE_MS = 10_000;
let runtimeOwnerLease: { ownerId: string; expiresAt: number } | undefined;
type LiveProgramMode = 'companion' | 'weather' | 'urgent' | 'variety';
const liveProgramState: {
  mode: LiveProgramMode;
  locked: boolean;
  updatedAt: number;
} = { mode: 'companion', locked: false, updatedAt: Date.now() };
const liveSafetyGateway = new LiveSafetyGateway();
const runtimeOwnerHeartbeats = new Map<
  string,
  { seenAt: number; availableForStress: boolean; ttsConfigured: boolean }
>();

type StressDiagnosticLevel = 'pass' | 'warning' | 'error';
type StressDiagnosticCheck = {
  id: string;
  level: StressDiagnosticLevel;
  code: string;
  summary: string;
  detail?: string;
};
type StressDiagnosticSnapshot = {
  checkedAt: number;
  ready: boolean;
  checks: StressDiagnosticCheck[];
};

let lastStressDiagnostics: StressDiagnosticSnapshot | undefined;

function runtimeOwnerAvailability(now = Date.now()): {
  active: boolean;
  available: boolean;
  ttsConfigured: boolean;
} {
  for (const [ownerId, heartbeat] of runtimeOwnerHeartbeats) {
    if (now - heartbeat.seenAt > RUNTIME_OWNER_HEARTBEAT_TTL_MS) {
      runtimeOwnerHeartbeats.delete(ownerId);
    }
  }
  return {
    active: runtimeOwnerHeartbeats.size > 0,
    available: [...runtimeOwnerHeartbeats.values()].some(
      (heartbeat) => heartbeat.availableForStress,
    ),
    ttsConfigured: [...runtimeOwnerHeartbeats.values()].some(
      (heartbeat) => heartbeat.ttsConfigured,
    ),
  };
}

function runtimeOwnerLeasePlugin(): Plugin {
  return {
    name: 'runtime-owner-lease',
    configureServer(server) {
      server.middlewares.use('/api/live-runtime-owner', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (!['POST', 'DELETE'].includes(req.method || '')) {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = JSON.parse(
              Buffer.concat(chunks).toString('utf8') || '{}',
            ) as { ownerId?: unknown };
            const ownerId = String(body.ownerId || '').trim();
            if (!ownerId) throw new Error('owner id is required');
            const now = Date.now();
            if (
              runtimeOwnerLease &&
              runtimeOwnerLease.expiresAt <= now
            ) {
              runtimeOwnerLease = undefined;
            }
            if (req.method === 'DELETE') {
              if (runtimeOwnerLease?.ownerId === ownerId) {
                runtimeOwnerLease = undefined;
              }
              res.end(JSON.stringify({ owns: false }));
              return;
            }
            if (!runtimeOwnerLease || runtimeOwnerLease.ownerId === ownerId) {
              runtimeOwnerLease = {
                ownerId,
                expiresAt: now + RUNTIME_OWNER_LEASE_MS,
              };
              res.end(JSON.stringify({ owns: true }));
              return;
            }
            res.end(JSON.stringify({ owns: false }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid runtime owner request' }));
          }
        });
      });
    },
  };
}

function liveProgramPlugin(): Plugin {
  return {
    name: 'live-program-state',
    configureServer(server) {
      server.middlewares.use('/api/live-program', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          res.end(JSON.stringify(liveProgramState));
          return;
        }
        if (req.method !== 'PATCH') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              mode?: unknown; locked?: unknown;
            };
            if (['companion', 'weather', 'urgent', 'variety'].includes(String(body.mode))) {
              liveProgramState.mode = body.mode as LiveProgramMode;
            }
            if (typeof body.locked === 'boolean') liveProgramState.locked = body.locked;
            liveProgramState.updatedAt = Date.now();
            res.end(JSON.stringify(liveProgramState));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid live program update' }));
          }
        });
      });
    },
  };
}

function radarCityRelayPlugin(): Plugin {
  return {
    name: 'radar-city-relay',
    configureServer(server) {
      server.middlewares.use('/api/radar-city-events', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          const requestedAfter = new URL(req.url || '', 'http://localhost').searchParams.get('after');
          const events = requestedAfter === 'latest'
            ? []
            : radarCityEvents.filter((item) => item.sequence > (Number(requestedAfter) || 0));
          res.end(JSON.stringify({ events, latestSequence: radarCityEventSequence }));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const event = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              type?: unknown; version?: unknown; id?: unknown; text?: unknown; receivedAt?: unknown;
            };
            if (
              event.type !== 'aituber:live-comment' || event.version !== 1 ||
              typeof event.id !== 'string' || typeof event.text !== 'string' ||
              typeof event.receivedAt !== 'number' || !Number.isFinite(event.receivedAt)
            ) throw new Error('invalid radar city event');
            radarCityEvents.push({ sequence: ++radarCityEventSequence, event });
            if (radarCityEvents.length > 200) radarCityEvents.splice(0, radarCityEvents.length - 200);
            res.end(JSON.stringify({ ok: true, sequence: radarCityEventSequence }));
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid radar city event' }));
          }
        });
      });
    },
  };
}

function liveSafetyGatewayPlugin(): Plugin {
  return {
    name: 'live-safety-gateway',
    configureServer(server) {
      server.middlewares.use('/api/live-safety', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          res.end(JSON.stringify(liveSafetyGateway.snapshot()));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as
              SafetyDecisionInput & { action?: unknown };
            if (body.action === 'release') {
              const viewerId = String(body.viewerId || '').trim();
              if (!viewerId) throw new Error('viewer id is required');
              const event = liveSafetyGateway.release(viewerId);
              res.end(JSON.stringify({ event, ...liveSafetyGateway.snapshot() }));
              return;
            }
            const moderation = body.moderation;
            if (!['none', 'boundary', 'local_mute'].includes(String(moderation))) {
              throw new Error('invalid moderation');
            }
            const event = liveSafetyGateway.evaluate({
              eventId: typeof body.eventId === 'string' ? body.eventId : undefined,
              viewerId: typeof body.viewerId === 'string' ? body.viewerId : undefined,
              viewerName: typeof body.viewerName === 'string' ? body.viewerName : undefined,
              sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel : undefined,
              moderation,
              reason: typeof body.reason === 'string' ? body.reason : undefined,
            });
            void appendAuditEntry({
              category: 'safety_gateway', action: `viewer_${event.action}`,
              actor: { type: 'system', id: 'live-safety-gateway' }, occurredAt: event.at,
              status: 'succeeded', request: body, result: event,
            });
            res.end(JSON.stringify({ event, ...liveSafetyGateway.snapshot() }));
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid safety request' }));
          }
        });
      });
    },
  };
}

function parseRuntimeTtsSettings(): {
  engine: string;
  hasMiniMaxKey: boolean;
  speaker: string;
} {
  try {
    const parsed = JSON.parse(runtimeSettings || '{}') as {
      tts?: { engine?: unknown; minimaxApiKey?: unknown; speaker?: unknown };
    };
    return {
      engine: typeof parsed.tts?.engine === 'string' ? parsed.tts.engine : '',
      hasMiniMaxKey:
        typeof parsed.tts?.minimaxApiKey === 'string' &&
        parsed.tts.minimaxApiKey.trim().length > 0,
      speaker:
        typeof parsed.tts?.speaker === 'string' && parsed.tts.speaker.trim()
          ? parsed.tts.speaker.trim()
          : 'Chinese (Mandarin)_Wise_Women',
    };
  } catch {
    return { engine: '', hasMiniMaxKey: false, speaker: '' };
  }
}

function diagnosticErrorSummary(snapshot: StressDiagnosticSnapshot): string {
  return snapshot.checks
    .filter((check) => check.level === 'error')
    .map((check) => `${check.code}: ${check.summary}`)
    .join(' | ');
}

/**
 * A stress run is only meaningful when the exact live owner and its provider
 * are reachable. Keep these checks provider-neutral except for MiniMax, whose
 * smallest authenticated endpoint lets us distinguish a missing/expired key
 * from a later browser playback failure without exposing the credential.
 */
async function collectStressDiagnostics(): Promise<StressDiagnosticSnapshot> {
  const checks: StressDiagnosticCheck[] = [];
  const owner = runtimeOwnerAvailability();
  const tts = parseRuntimeTtsSettings();
  if (!owner.active) {
    checks.push({
      id: 'runtime-owner',
      level: 'error',
      code: 'runtime_owner_missing',
      summary: 'No live runtime owner heartbeat was received.',
      detail:
        'Open or refresh the overlay/runtime page that actually plays audio, then retry.',
    });
  } else if (!owner.available) {
    checks.push({
      id: 'runtime-owner',
      level: 'error',
      code: 'runtime_owner_busy',
      summary: 'The live runtime owner is busy or recovering.',
      detail: 'Wait until generation and playback are idle, then retry.',
    });
  } else {
    checks.push({
      id: 'runtime-owner',
      level: 'pass',
      code: 'runtime_owner_ready',
      summary: 'A ready live runtime owner is connected.',
    });
  }

  if (tts.engine !== 'minimax') {
    checks.push({
      id: 'tts-provider',
      level: 'warning',
      code: 'tts_provider_not_probed',
      summary: `TTS engine is ${tts.engine || 'unset'}; MiniMax credential probing was skipped.`,
    });
  } else if (!tts.hasMiniMaxKey) {
    checks.push({
      id: 'tts-provider',
      level: 'error',
      code: 'minimax_key_missing',
      summary:
        'MiniMax is selected but no API key is present in runtime settings.',
      detail:
        'Enter the key in the Settings UI used by the active runtime owner.',
    });
  } else if (owner.active && !owner.ttsConfigured) {
    checks.push({
      id: 'tts-provider',
      level: 'error',
      code: 'owner_tts_config_mismatch',
      summary:
        'The server has a MiniMax key, but the active runtime owner reports TTS unconfigured.',
      detail:
        'Refresh the audio-playing runtime page so it synchronizes its local settings.',
    });
  } else {
    try {
      const parsed = JSON.parse(runtimeSettings || '{}') as {
        tts?: { minimaxApiKey?: unknown };
      };
      const key =
        typeof parsed.tts?.minimaxApiKey === 'string'
          ? parsed.tts.minimaxApiKey.trim()
          : '';
      const response = await fetch('https://api.minimaxi.com/v1/get_voice', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ voice_type: 'system' }),
        signal: AbortSignal.timeout(8_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        base_resp?: { status_code?: unknown; status_msg?: unknown };
      };
      const providerStatus = Number(payload.base_resp?.status_code ?? 0);
      if (response.ok && providerStatus === 0) {
        checks.push({
          id: 'tts-provider',
          level: 'pass',
          code: 'minimax_auth_verified',
          summary: 'MiniMax credential was accepted by the voice API.',
        });
        // Auth alone cannot prove that the configured voice can synthesize.
        // Make one tiny, non-playing request through the exact T2A endpoint so
        // a revoked entitlement, bad voice id, or endpoint mismatch is shown
        // before a long stress run turns it into a generic playback timeout.
        try {
          const synthesis = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'speech-2.8-turbo',
              text: '语音链路诊断。',
              stream: false,
              voice_setting: {
                voice_id: tts.speaker,
                speed: 1,
                vol: 1,
                pitch: 0,
                emotion: 'neutral',
              },
              audio_setting: {
                sample_rate: 44100,
                bitrate: 128000,
                format: 'mp3',
                channel: 1,
              },
              language_boost: 'Chinese',
            }),
            signal: AbortSignal.timeout(12_000),
          });
          const synthesisPayload = (await synthesis
            .json()
            .catch(() => ({}))) as {
            base_resp?: { status_code?: unknown; status_msg?: unknown };
            data?: { audio?: unknown };
          };
          const synthesisStatus = Number(
            synthesisPayload.base_resp?.status_code ?? 0,
          );
          const audio = synthesisPayload.data?.audio;
          if (
            synthesis.ok &&
            synthesisStatus === 0 &&
            typeof audio === 'string' &&
            audio.length > 0
          ) {
            checks.push({
              id: 'tts-synthesis',
              level: 'pass',
              code: 'minimax_tts_smoke_passed',
              summary:
                'Configured MiniMax voice synthesized a non-empty MP3 response.',
            });
          } else {
            checks.push({
              id: 'tts-synthesis',
              level: 'error',
              code:
                synthesis.status === 429
                  ? 'minimax_tts_rate_limited'
                  : 'minimax_tts_smoke_failed',
              summary: `MiniMax accepted the key but the configured voice could not synthesize (HTTP ${synthesis.status}).`,
              detail:
                typeof synthesisPayload.base_resp?.status_msg === 'string'
                  ? synthesisPayload.base_resp.status_msg.slice(0, 180)
                  : 'The response did not contain audio data.',
            });
          }
        } catch (error) {
          checks.push({
            id: 'tts-synthesis',
            level: 'error',
            code: 'minimax_tts_smoke_unreachable',
            summary:
              'MiniMax authentication succeeded but the TTS synthesis probe could not complete.',
            detail:
              error instanceof Error ? error.message.slice(0, 180) : undefined,
          });
        }
      } else {
        const code =
          response.status === 401 || response.status === 403
            ? 'minimax_auth_rejected'
            : response.status === 429
              ? 'minimax_rate_limited'
              : 'minimax_provider_rejected';
        checks.push({
          id: 'tts-provider',
          level: 'error',
          code,
          summary: `MiniMax voice API rejected the credential/request (HTTP ${response.status}).`,
          detail:
            typeof payload.base_resp?.status_msg === 'string'
              ? payload.base_resp.status_msg.slice(0, 180)
              : undefined,
        });
      }
    } catch (error) {
      checks.push({
        id: 'tts-provider',
        level: 'error',
        code: 'minimax_probe_unreachable',
        summary: 'MiniMax credential probe could not reach the provider.',
        detail:
          error instanceof Error ? error.message.slice(0, 180) : undefined,
      });
    }
  }

  const activeQueueCount = operatorQueueSnapshot().filter((item) =>
    ['pending', 'preparing', 'ready', 'speaking'].includes(item.status),
  ).length;
  checks.push({
    id: 'operator-queue',
    level: activeQueueCount ? 'warning' : 'pass',
    code: activeQueueCount ? 'operator_queue_not_empty' : 'operator_queue_idle',
    summary: activeQueueCount
      ? `${activeQueueCount} existing queue item(s) will run before the stress test.`
      : 'Operator queue is idle.',
  });
  return {
    checkedAt: Date.now(),
    ready: !checks.some((check) => check.level === 'error'),
    checks,
  };
}

function releaseExpiredOperatorLeases(now = Date.now()): boolean {
  let changed = false;
  for (const item of operatorQueue.values()) {
    if (
      !['preparing', 'speaking'].includes(item.status) ||
      !item.leaseExpiresAt ||
      item.leaseExpiresAt > now
    ) {
      continue;
    }
    item.status = item.preparedReply ? 'ready' : 'pending';
    item.finishReason = 'lease_expired_requeued';
    item.leaseOwnerId = undefined;
    item.leaseExpiresAt = undefined;
    item.updatedAt = now;
    changed = true;
  }
  if (changed) void persistOperatorQueue();
  return changed;
}

async function restoreOperatorQueue() {
  try {
    const saved = JSON.parse(
      await readFile(OPERATOR_QUEUE_PATH, 'utf8'),
    ) as OperatorQueueItem[];
    if (!Array.isArray(saved)) return;
    for (const item of saved) {
      if (!item?.eventId || item.status === 'deleted') continue;
      // Browser audio cannot survive a local Vite restart. Requeue any
      // in-flight work instead of leaving the scheduler permanently locked.
      if (item.status === 'speaking')
        item.status = item.preparedReply ? 'ready' : 'pending';
      if (item.status === 'preparing') item.status = 'pending';
      operatorQueue.set(item.eventId, item);
    }
    normalizeOperatorQueueOrder();
  } catch {
    // The first run has no saved operator queue yet.
  }
}

async function persistOperatorQueue() {
  await mkdir(dirname(OPERATOR_QUEUE_PATH), { recursive: true });
  await writeFile(
    OPERATOR_QUEUE_PATH,
    JSON.stringify(operatorQueueSnapshot()),
    'utf8',
  );
}

function operatorQueueSnapshot() {
  releaseExpiredOperatorLeases();
  return [...operatorQueue.values()]
    .filter((item) => item.status !== 'deleted')
    .sort(
      (left, right) =>
        left.order - right.order || left.createdAt - right.createdAt,
    );
}

function normalizeOperatorQueueOrder() {
  operatorQueueSnapshot().forEach((item, index) => {
    item.order = index;
  });
}

function ingestStressQueueItem(message: StressIngestMessage) {
  const now = Date.now();
  if (operatorQueue.has(message.eventId)) return;
  operatorQueue.set(message.eventId, {
    ...message,
    sourcesSeen: ['stress-test'],
    updatedAt: now,
    order: operatorQueueSnapshot().length,
    status: message.forceDuplicateOfStepId ? 'skipped' : 'pending',
    skipReason: message.forceDuplicateOfStepId ? 'duplicate_text' : undefined,
    finishReason: message.forceDuplicateOfStepId ? 'duplicate_text' : undefined,
    skills: [],
    retryCount: 0,
    beatCount: 0,
    completedBeatCount: 0,
    engagementSignals: message.engagementSignals?.map((signal) => signal.kind),
    assignedOwnerId: message.assignedOwnerId,
  });
  void persistOperatorQueue();
}

const stressTestController = createStressTestController(
  {
    ingest: (message) => ingestStressQueueItem(message),
    snapshot: () => operatorQueueSnapshot(),
    update: () => undefined,
    remove: async (testRunId) => {
      let removed = 0;
      for (const [eventId, item] of operatorQueue) {
        if (item.testRunId !== testRunId) continue;
        operatorQueue.delete(eventId);
        removed += 1;
      }
      await persistOperatorQueue();
      await withHistoryMutation(async () => {
        try {
          const raw = await readFile(CONVERSATION_LOG_PATH, 'utf8');
          const kept = raw
            .split(/\r?\n/)
            .filter(Boolean)
            .filter((line) => {
              try {
                return (
                  (JSON.parse(line) as { testRunId?: string }).testRunId !==
                  testRunId
                );
              } catch {
                return true;
              }
            });
          await writeFile(
            CONVERSATION_LOG_PATH,
            kept.length ? `${kept.join('\n')}\n` : '',
            'utf8',
          );
        } catch {
          // No production history exists yet.
        }
      });
      return removed;
    },
  },
  { appRoot: APP_ROOT },
);

async function withHistoryMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = historyMutationQueue.then(task, task);
  historyMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const liveRuntimeState = {
  queued: new Map<string, number>(),
  duplicateDrops: 0,
  sanitizerFailures: 0,
  ttsRateLimitTimes: [] as number[],
  lastSpeechAt: 0,
  lastGeneratedAt: 0,
  lastEventAt: 0,
  reportedQueueDepth: 0,
  reportedOldestQueueAgeMs: 0,
  isSpeaking: false,
  hostTelemetry: {} as Record<string, unknown>,
  lastFaults: {} as Partial<
    Record<
      'model' | 'skill' | 'tts' | 'flashhead' | 'platform',
      {
        at: number;
        stage: string;
        reason?: string;
      }
    >
  >,
};

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

async function recentAcceptanceMetrics(now: number) {
  try {
    const raw = await readFile(CONVERSATION_LOG_PATH, 'utf8');
    const records = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter(
        (record) =>
          record.source === 'live' &&
          !record.testRunId &&
          (finiteTimestamp(record.replyAt) ??
            finiteTimestamp(record.at) ??
            0) >=
            now - 30 * 60_000,
      );
    const duration = (start: unknown, end: unknown) => {
      const from = finiteTimestamp(start);
      const to = finiteTimestamp(end);
      return from && to ? Math.max(0, to - from) : null;
    };
    const capture = records
      .map((record) => duration(record.commentAt, record.receivedAt))
      .filter((value): value is number => value !== null);
    const queue = records
      .map((record) =>
        duration(record.queuedAt ?? record.receivedAt, record.selectedAt),
      )
      .filter((value): value is number => value !== null);
    const generation = records
      .map((record) => duration(record.llmStartAt, record.llmEndAt))
      .filter((value): value is number => value !== null);
    const endToEnd = records
      .map((record) =>
        duration(record.commentAt, record.ttsStartAt ?? record.replyAt),
      )
      .filter((value): value is number => value !== null);
    const unsafeCount = records.filter((record) =>
      hasUnsafeSpeechArtifacts(
        `${String(record.input || '')} ${String(record.reply || '')}`,
      ),
    ).length;
    const selfReplyCount = records.filter(
      (record) => record.viewerName === '智人售后服务员',
    ).length;
    const replyFingerprints = new Set<string>();
    let duplicateReplyCount = 0;
    for (const record of records) {
      const fingerprint = `${String(record.viewerName || '')}:${String(record.input || '')}:${String(record.reply || '')}`;
      if (replyFingerprints.has(fingerprint)) duplicateReplyCount += 1;
      else replyFingerprints.add(fingerprint);
    }
    return {
      windowMinutes: 30,
      samples: records.length,
      captureP95Ms: percentile(capture, 0.95),
      queueP95Ms: percentile(queue, 0.95),
      generationP95Ms: percentile(generation, 0.95),
      playableP95Ms: percentile(endToEnd, 0.95),
      over30sCount: endToEnd.filter((value) => value > 30_000).length,
      unsafeCount,
      selfReplyCount,
      duplicateReplyCount,
      targetsMet:
        records.length > 0 &&
        (percentile(capture, 0.95) ?? Number.POSITIVE_INFINITY) <= 3_000 &&
        (percentile(queue, 0.95) ?? Number.POSITIVE_INFINITY) <= 8_000 &&
        (percentile(endToEnd, 0.95) ?? Number.POSITIVE_INFINITY) <= 15_000 &&
        endToEnd.every((value) => value <= 30_000) &&
        unsafeCount === 0 &&
        selfReplyCount === 0 &&
        duplicateReplyCount === 0,
    };
  } catch {
    return {
      windowMinutes: 30,
      samples: 0,
      targetsMet: false,
      unavailable: true,
    };
  }
}

async function sanitizeConversationHistory(): Promise<void> {
  try {
    const raw = await readFile(CONVERSATION_LOG_PATH, 'utf8');
    let changed = false;
    const cleanedLines = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const record = JSON.parse(line) as Record<string, unknown>;
        const input = sanitizeSpeechText(String(record.input || ''));
        const reply = sanitizeSpeechText(String(record.reply || ''));
        if (input !== record.input || reply !== record.reply) changed = true;
        return JSON.stringify({
          ...record,
          input,
          reply,
          ...(input !== record.input || reply !== record.reply
            ? { sanitizedAt: Date.now(), sanitizerVersion: 2 }
            : {}),
        });
      });
    if (changed) {
      await writeFile(
        CONVERSATION_LOG_PATH,
        `${cleanedLines.join('\n')}\n`,
        'utf8',
      );
    }
  } catch {
    // A missing or partially written history must not prevent the dev server.
  }
}

function conversationHistoryPlugin(): Plugin {
  return {
    name: 'local-conversation-history',
    configureServer(server) {
      void sanitizeConversationHistory();
      server.middlewares.use('/api/conversation-history', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          void readFile(CONVERSATION_LOG_PATH, 'utf8')
            .then((raw) => {
              const records = raw
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-1000)
                .map((line) => JSON.parse(line));
              const requestUrl = new URL(req.url || '', 'http://localhost');
              if (requestUrl.searchParams.get('shortTerm') === '1') {
                // The queue is a scheduler, not memory. Feeding its terminal
                // history back into every turn caused stale typhoon replies
                // to become the room's permanent topic.
                const cutoff = Number(requestUrl.searchParams.get('before'));
                const liveSession = records
                  .filter(
                    (item) =>
                      !Number.isFinite(cutoff) ||
                      (typeof item.at === 'number' && item.at <= cutoff),
                  )
                  .slice(-24);
                res.end(JSON.stringify({ records: liveSession }));
                return;
              }
              res.end(JSON.stringify({ records }));
            })
            .catch(() => res.end(JSON.stringify({ records: [] })));
          return;
        }
        if (req.method === 'PATCH') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', async () => {
            try {
              const update = JSON.parse(
                Buffer.concat(chunks).toString('utf8'),
              ) as {
                eventId?: unknown;
                ttsStartAt?: unknown;
                ttsEndAt?: unknown;
              };
              if (typeof update.eventId !== 'string') {
                throw new Error('eventId is required');
              }
              const matched = await withHistoryMutation(async () => {
                const raw = await readFile(CONVERSATION_LOG_PATH, 'utf8');
                let found = false;
                const lines = raw
                  .split(/\r?\n/)
                  .filter(Boolean)
                  .map((line) => {
                    const record = JSON.parse(line) as Record<string, unknown>;
                    if (record.eventId !== update.eventId) return line;
                    found = true;
                    return JSON.stringify({
                      ...record,
                      ttsStartAt:
                        finiteTimestamp(update.ttsStartAt) ?? record.ttsStartAt,
                      ttsEndAt:
                        finiteTimestamp(update.ttsEndAt) ?? record.ttsEndAt,
                    });
                  });
                if (found) {
                  await writeFile(
                    CONVERSATION_LOG_PATH,
                    `${lines.join('\n')}\n`,
                    'utf8',
                  );
                }
                return found;
              });
              if (!matched) {
                pendingTtsUpdates.set(update.eventId, {
                  ttsStartAt: finiteTimestamp(update.ttsStartAt),
                  ttsEndAt: finiteTimestamp(update.ttsEndAt),
                });
                res.statusCode = 202;
                res.end(JSON.stringify({ pending: true }));
                return;
              }
              res.statusCode = 204;
              res.end();
            } catch {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'record not found' }));
            }
          });
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 64 * 1024) chunks.push(chunk);
        });
        req.on('end', async () => {
          try {
            if (size > 64 * 1024) throw new Error('record too large');
            const value = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as {
              input?: unknown;
              reply?: unknown;
              viewerName?: unknown;
              source?: unknown;
              eventId?: unknown;
              commentAt?: unknown;
              receivedAt?: unknown;
              queuedAt?: unknown;
              selectedAt?: unknown;
              processingAt?: unknown;
              llmStartAt?: unknown;
              llmEndAt?: unknown;
              ttsStartAt?: unknown;
              ttsEndAt?: unknown;
              dropReason?: unknown;
              sourcesSeen?: unknown;
              replyAt?: unknown;
              testRunId?: unknown;
              stepId?: unknown;
              scenarioId?: unknown;
            };
            if (
              typeof value.input !== 'string' ||
              typeof value.reply !== 'string'
            ) {
              throw new Error('invalid record');
            }
            const cleanInput = sanitizeSpeechText(value.input);
            const cleanReply = sanitizeSpeechText(value.reply);
            if (
              !cleanInput ||
              !cleanReply ||
              hasUnsafeSpeechArtifacts(cleanInput) ||
              hasUnsafeSpeechArtifacts(cleanReply)
            ) {
              throw new Error('unsafe record');
            }
            const pendingTts =
              typeof value.eventId === 'string'
                ? pendingTtsUpdates.get(value.eventId)
                : undefined;
            const record = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              at: Date.now(),
              input: cleanInput.slice(0, 4000),
              reply: cleanReply.slice(0, 8000),
              viewerName:
                typeof value.viewerName === 'string'
                  ? value.viewerName.slice(0, 200)
                  : '',
              source: typeof value.source === 'string' ? value.source : 'chat',
              eventId:
                typeof value.eventId === 'string'
                  ? value.eventId.slice(0, 500)
                  : undefined,
              commentAt: finiteTimestamp(value.commentAt),
              receivedAt: finiteTimestamp(value.receivedAt),
              queuedAt: finiteTimestamp(value.queuedAt),
              selectedAt: finiteTimestamp(value.selectedAt),
              processingAt: finiteTimestamp(value.processingAt),
              llmStartAt: finiteTimestamp(value.llmStartAt),
              llmEndAt: finiteTimestamp(value.llmEndAt),
              ttsStartAt:
                finiteTimestamp(value.ttsStartAt) ?? pendingTts?.ttsStartAt,
              ttsEndAt: finiteTimestamp(value.ttsEndAt) ?? pendingTts?.ttsEndAt,
              dropReason:
                typeof value.dropReason === 'string'
                  ? value.dropReason.slice(0, 100)
                  : undefined,
              sourcesSeen: Array.isArray(value.sourcesSeen)
                ? value.sourcesSeen
                    .filter((item): item is string => typeof item === 'string')
                    .slice(0, 10)
                : [],
              replyAt: finiteTimestamp(value.replyAt) ?? Date.now(),
              testRunId:
                typeof value.testRunId === 'string'
                  ? value.testRunId.slice(0, 200)
                  : undefined,
              stepId:
                typeof value.stepId === 'string'
                  ? value.stepId.slice(0, 100)
                  : undefined,
              scenarioId:
                typeof value.scenarioId === 'string'
                  ? value.scenarioId.slice(0, 200)
                  : undefined,
            };
            await mkdir(join(CONVERSATION_LOG_PATH, '..'), { recursive: true });
            await withHistoryMutation(() =>
              appendFile(
                CONVERSATION_LOG_PATH,
                `${JSON.stringify(record)}\n`,
                'utf8',
              ),
            );
            if (typeof value.eventId === 'string') {
              pendingTtsUpdates.delete(value.eventId);
            }
            res.statusCode = 201;
            res.end(JSON.stringify(record));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid record' }));
          }
        });
      });
    },
  };
}

function runtimeSettingsPlugin(): Plugin {
  return {
    name: 'local-runtime-settings',
    configureServer(server) {
      server.middlewares.use('/api/runtime-settings', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.url?.startsWith('/events')) {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end();
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write('retry: 1000\n\n');
          runtimeSettingsSubscribers.add(res);
          const snapshot = runtimeSettingsEnvelope();
          if (snapshot) {
            res.write(`event: settings\ndata: ${snapshot}\nid: ${runtimeSettingsRevision}\n\n`);
          }
          req.on('close', () => runtimeSettingsSubscribers.delete(res));
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (req.method === 'GET') {
          const snapshot = runtimeSettingsEnvelope();
          if (!snapshot) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'settings not available' }));
            return;
          }
          res.statusCode = 200;
          res.end(snapshot);
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        if (req.headers['x-runtime-settings-role'] !== 'producer') {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: 'producer_role_required' }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 1024 * 1024) chunks.push(chunk);
        });
        req.on('end', async () => {
          if (size > 1024 * 1024) {
            res.statusCode = 413;
            res.end(JSON.stringify({ error: 'settings too large' }));
            return;
          }
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const previousSettings = runtimeSettings
              ? (JSON.parse(runtimeSettings) as Record<string, unknown>)
              : null;
            const next = JSON.parse(raw) as {
              tts?: {
                speaker?: unknown;
                minimaxApiKey?: unknown;
                minimaxGroupId?: unknown;
              };
              digitalHumans?: {
                activeId?: unknown;
                profiles?: Array<{ id?: unknown; voiceSpeaker?: unknown }>;
              };
            };
            // A runtime page can start before its local credential store has
            // finished syncing.  Its empty values must not erase a verified
            // TTS credential already held by the local coordinator.
            if (runtimeSettings && next.tts) {
              try {
                const previous = JSON.parse(runtimeSettings) as {
                  tts?: { minimaxApiKey?: unknown; minimaxGroupId?: unknown };
                };
                if (
                  typeof previous.tts?.minimaxApiKey === 'string' &&
                  previous.tts.minimaxApiKey.trim() &&
                  (typeof next.tts.minimaxApiKey !== 'string' ||
                    !next.tts.minimaxApiKey.trim())
                ) {
                  next.tts.minimaxApiKey = previous.tts.minimaxApiKey;
                }
                if (
                  typeof previous.tts?.minimaxGroupId === 'string' &&
                  previous.tts.minimaxGroupId.trim() &&
                  (typeof next.tts.minimaxGroupId !== 'string' ||
                    !next.tts.minimaxGroupId.trim())
                ) {
                  next.tts.minimaxGroupId = previous.tts.minimaxGroupId;
                }
              } catch {
                // Ignore a stale in-memory snapshot and accept the valid new
                // settings payload below.
              }
            }
            const activeId =
              typeof next.digitalHumans?.activeId === 'string'
                ? next.digitalHumans.activeId
                : '';
            const activeProfile = next.digitalHumans?.profiles?.find(
              (profile) => profile.id === activeId,
            );
            if (
              next.tts &&
              typeof activeProfile?.voiceSpeaker === 'string' &&
              activeProfile.voiceSpeaker.trim()
            ) {
              next.tts.speaker = activeProfile.voiceSpeaker;
            }
            runtimeSettings = JSON.stringify(next);
            runtimeSettingsRevision += 1;
            runtimeSettingsPublishedAt = Date.now();
            publishRuntimeSettings();
            await appendAuditEntry({
              category: 'configuration',
              action: 'runtime_settings_saved',
              actor: { type: 'operator', id: 'control-room' },
              occurredAt: Date.now(),
              status: 'succeeded',
              before: previousSettings,
              after: next,
            });
            res.statusCode = 204;
            res.setHeader('X-Runtime-Settings-Revision', String(runtimeSettingsRevision));
            res.end();
          } catch (error) {
            // Settings payloads may contain credentials.  Keep the diagnostic
            // actionable without ever reflecting the payload or a key.
            const reason =
              error instanceof Error && error.message
                ? error.message.slice(0, 160)
                : 'unknown_settings_error';
            void appendAuditEntry({
              category: 'configuration',
              action: 'runtime_settings_saved',
              actor: { type: 'operator', id: 'control-room' },
              occurredAt: Date.now(),
              status: 'failed',
              error: reason,
            }).catch(() => undefined);
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error: 'invalid_settings',
                stage: 'runtime_settings_parse_or_normalize',
                reason,
              }),
            );
          }
        });
      });
    },
  };
}

/**
 * Browser-safe MiniMax playback bridge.  The generic provider endpoint returns
 * a large JSON/hex body which can remain open in Chromium even after the
 * upstream synth has completed.  Consume and validate it locally, then send a
 * finite MP3 response with Content-Length to the actual playback runtime.
 */
function minimaxAudioBridgePlugin(): Plugin {
  return {
    name: 'minimax-audio-bridge',
    configureServer(server) {
      server.middlewares.use('/api/minimax-audio', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 64 * 1024) chunks.push(chunk);
        });
        req.on('end', async () => {
          let auditText = '';
          const requestedAt = Date.now();
          try {
            if (size > 64 * 1024) throw new Error('tts_request_too_large');
            const request = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as {
              text?: unknown;
            };
            const text =
              typeof request.text === 'string' ? request.text.trim() : '';
            if (!text) throw new Error('tts_text_missing');
            auditText = text;
            const settings = JSON.parse(runtimeSettings || '{}') as {
              tts?: { minimaxApiKey?: unknown; speaker?: unknown };
            };
            const apiKey =
              typeof settings.tts?.minimaxApiKey === 'string'
                ? settings.tts.minimaxApiKey.trim()
                : '';
            const speaker =
              typeof settings.tts?.speaker === 'string' &&
              settings.tts.speaker.trim()
                ? settings.tts.speaker.trim()
                : 'Chinese (Mandarin)_Wise_Women';
            if (!apiKey) throw new Error('minimax_key_missing');
            const upstream = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: 'speech-2.8-turbo',
                text,
                stream: false,
                voice_setting: {
                  voice_id: speaker,
                  speed: 1,
                  vol: 1,
                  pitch: 0,
                  emotion: 'neutral',
                },
                audio_setting: {
                  sample_rate: 44100,
                  bitrate: 128000,
                  format: 'mp3',
                  channel: 1,
                },
                language_boost: 'Chinese',
              }),
            });
            const payload = (await upstream.json()) as {
              base_resp?: { status_code?: number; status_msg?: string };
              data?: { audio?: string };
            };
            if (
              !upstream.ok ||
              payload.base_resp?.status_code ||
              !payload.data?.audio
            ) {
              throw new Error(
                `minimax_synthesis_failed:${payload.base_resp?.status_code ?? upstream.status}`,
              );
            }
            const audio = Buffer.from(payload.data.audio, 'hex');
            if (audio.length < 16) throw new Error('minimax_audio_empty');
            await appendAuditEntry({
              category: 'tts',
              action: 'minimax_synthesis',
              actor: { type: 'system', id: 'minimax-audio-bridge' },
              correlationId: `tts:${createHash('sha256')
                .update(text)
                .digest('hex')
                .slice(0, 16)}:${requestedAt}`,
              occurredAt: requestedAt,
              status: 'succeeded',
              request: { text, speaker, model: 'speech-2.8-turbo' },
              result: {
                httpStatus: upstream.status,
                providerStatus: payload.base_resp?.status_code ?? 0,
                audioByteLength: audio.length,
              },
            });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Length', String(audio.length));
            res.end(audio);
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message.slice(0, 160)
                : 'minimax_audio_bridge_failed';
            void appendAuditEntry({
              category: 'tts',
              action: 'minimax_synthesis',
              actor: { type: 'system', id: 'minimax-audio-bridge' },
              correlationId: `tts:${createHash('sha256')
                .update(auditText)
                .digest('hex')
                .slice(0, 16)}:${requestedAt}`,
              occurredAt: requestedAt,
              status: 'failed',
              request: { text: auditText },
              error: reason,
            }).catch(() => undefined);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: reason,
              }),
            );
          }
        });
      });
    },
  };
}

/** A small semantic routing turn keeps domain tools out of ordinary chat. */
function skillRoutingAgentPlugin(): Plugin {
  return {
    name: 'skill-routing-agent',
    configureServer(server) {
      server.middlewares.use('/api/skill-route', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              text?: unknown; speaker?: unknown; turns?: unknown;
            };
            const settings = JSON.parse(runtimeSettings || '{}') as {
              llm?: { provider?: unknown; model?: unknown; endpoint?: unknown; apiKeys?: Record<string, unknown> };
            };
            const endpoint = typeof settings.llm?.endpoint === 'string' ? settings.llm.endpoint.trim() : '';
            const key = typeof settings.llm?.apiKeys?.['openai-compatible'] === 'string'
              ? settings.llm.apiKeys['openai-compatible'].trim() : '';
            if (!endpoint || !key || settings.llm?.provider !== 'openai-compatible') {
              throw new Error('semantic_router_not_configured');
            }
            const request = {
                model: typeof settings.llm.model === 'string' ? settings.llm.model : 'MiniMax-M3',
                temperature: 0,
                // MiniMax-M3 reasons by default. The director needs the final
                // schema, not a partial chain-of-thought consuming its short
                // routing budget, so use the provider's documented switch.
                thinking: { type: 'disabled' },
                max_completion_tokens: 260,
                response_format: { type: 'json_object' },
                messages: [{
                  role: 'system',
                  content: '你是直播间互动决策智能体，不负责写主播台词。根据当前发言者、来源和短期转写输出严格 JSON：{"mode":"companion|weather|urgent|variety","intent":"不超过20字","direction":"不超过45字的节目导演指令","inheritTyphoon":boolean,"shouldSpeak":boolean,"moderation":"none|boundary|local_mute","reason":"不超过25字"}。默认 mode=companion、moderation=none。只有明确问台风、天气、雷达，或同一观众紧接着追问上一条台风事实时，mode=weather 且 inheritTyphoon=true。预警、避险、求助为 urgent。唱歌、故事、游戏、共创等为 variety，要求有条件接住、给替代互动，不能冷拒绝；不得承诺完整演唱或自己不具备的能力，点歌时可引导歌单、哼一句、氛围选择或共同创作。问候、无聊、情绪、玩笑、关系、日常即使历史中有台风也必须是 companion，禁止主动提及台风。你必须结合整段互动判断风险，而不是只靠单个词：轻微玩笑用 moderation=none；开始升级的攻击用 boundary，shouldSpeak=true，direction 必须是一句降温边界且不反讽、不挑战、不约架、不追问；明确威胁、持续辱骂或反复越界用 local_mute，shouldSpeak=false。'
                }, {
                  role: 'system',
                  content: 'Hard constraint: a direct threat of physical harm or death is always moderation=local_mute and shouldSpeak=false. boundary is only for non-threatening insults or escalating hostility. Return the final JSON object only.',
                }, { role: 'user', content: JSON.stringify(body) }],
              };
            // Some compatible gateways occasionally close a successful-looking
            // response before emitting its JSON body. Retry that transport
            // failure once; do not invent a rule-based moderation verdict.
            let decision: { inheritTyphoon?: unknown; reason?: unknown; mode?: unknown; intent?: unknown; direction?: unknown; shouldSpeak?: unknown; moderation?: unknown } | undefined;
            let upstreamOk = false;
            for (let attempt = 0; attempt < 2 && !decision; attempt += 1) {
              try {
                const upstream = await fetch(endpoint, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify(request),
                  signal: AbortSignal.timeout(8_000),
                });
                upstreamOk = upstream.ok;
                const upstreamText = await upstream.text();
                if (!upstream.ok || !upstreamText.trim()) {
                  throw new Error('semantic_router_failed');
                }
                const payload = JSON.parse(upstreamText) as { choices?: Array<{ message?: { content?: unknown } }> };
                const raw = payload.choices?.[0]?.message?.content;
                if (typeof raw !== 'string') throw new Error('semantic_router_missing_decision');
                const cleaned = raw.replace(/^<think>[\s\S]*?<\/think>\s*/i, '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
                const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
                decision = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as typeof decision;
              } catch {
                if (attempt === 0) continue;
                throw new Error('semantic_router_failed');
              }
            }
            if (!decision || !upstreamOk) throw new Error('semantic_router_failed');
            const routedMode = ['companion', 'weather', 'urgent', 'variety'].includes(String(decision.mode))
              ? (decision.mode as LiveProgramMode)
              : 'companion';
            const mode = liveProgramState.locked ? liveProgramState.mode : routedMode;
            res.end(JSON.stringify({
              inheritTyphoon: mode === 'weather' && (liveProgramState.locked || decision.inheritTyphoon === true),
              reason: liveProgramState.locked
                ? `operator_locked_${mode}`
                : (typeof decision.reason === 'string' ? decision.reason.slice(0, 100) : 'agent_route'),
              mode,
              intent: typeof decision.intent === 'string' ? decision.intent.slice(0, 60) : 'casual',
              direction: typeof decision.direction === 'string' ? decision.direction.slice(0, 140) : '自然接住当前话题，不提及台风。',
              // This is an execution invariant, not a second safety classifier:
              // a muted viewer never triggers a spoken reply.
              shouldSpeak: decision.moderation === 'local_mute'
                ? false
                : decision.shouldSpeak !== false,
              moderation: decision.moderation === 'boundary' || decision.moderation === 'local_mute'
                ? decision.moderation
                : 'none',
            }));
          } catch (error) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'semantic_router_failed' }));
          }
        });
      });
    },
  };
}

function stressTestPlugin(): Plugin {
  return {
    name: 'live-stress-test',
    configureServer(server) {
      server.middlewares.use('/api/stress-test', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          res.end(
            JSON.stringify({
              ...stressTestController.status(),
              diagnostics: lastStressDiagnostics,
            }),
          );
          return;
        }
        if (!['POST', 'PATCH'].includes(req.method || '')) {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          let auditAction = 'start';
          let auditRequest: Record<string, unknown> = {};
          try {
            const body = chunks.length
              ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
                  string,
                  unknown
                >)
              : {};
            const action = String(body.action || 'start');
            auditAction = action;
            auditRequest = body;
            let ownerAvailability = runtimeOwnerAvailability();
            let claimedRuntimeOwner = false;
            const provisionalOwnerId = String(
              body.provisionalOwnerId || '',
            ).trim();
            if (
              action === 'start' &&
              !ownerAvailability.active &&
              provisionalOwnerId
            ) {
              runtimeOwnerHeartbeats.set(provisionalOwnerId, {
                seenAt: Date.now(),
                availableForStress: true,
                ttsConfigured: body.ttsConfigured === true,
              });
              claimedRuntimeOwner = true;
              ownerAvailability = runtimeOwnerAvailability();
            }
            if (action === 'start' || action === 'diagnose') {
              lastStressDiagnostics = await collectStressDiagnostics();
              if (action === 'diagnose') {
                await appendAuditEntry({
                  category: 'operator_control',
                  action: 'stress_test_diagnose',
                  actor: { type: 'operator', id: 'control-room' },
                  occurredAt: Date.now(),
                  status: 'succeeded',
                  request: body,
                  result: lastStressDiagnostics,
                });
                res.end(JSON.stringify({ diagnostics: lastStressDiagnostics }));
                return;
              }
              if (!lastStressDiagnostics.ready) {
                await appendAuditEntry({
                  category: 'operator_control',
                  action: `stress_test_${action}`,
                  actor: { type: 'operator', id: 'control-room' },
                  occurredAt: Date.now(),
                  status: 'rejected',
                  request: body,
                  result: lastStressDiagnostics,
                });
                res.statusCode = 422;
                res.end(
                  JSON.stringify({
                    error: diagnosticErrorSummary(lastStressDiagnostics),
                    diagnostics: lastStressDiagnostics,
                  }),
                );
                return;
              }
            }
            if (action === 'start' && !ownerAvailability.active) {
              await appendAuditEntry({
                category: 'operator_control',
                action: 'stress_test_start',
                actor: { type: 'operator', id: 'control-room' },
                occurredAt: Date.now(),
                status: 'rejected',
                request: body,
                error: 'no_active_runtime_owner',
              });
              res.statusCode = 409;
              res.end(
                JSON.stringify({
                  error:
                    'No active live runtime owner. Open the overlay or a ?listener=1 runtime tab before starting the stress test.',
                }),
              );
              return;
            }
            if (action === 'start' && !ownerAvailability.available) {
              await appendAuditEntry({
                category: 'operator_control',
                action: 'stress_test_start',
                actor: { type: 'operator', id: 'control-room' },
                occurredAt: Date.now(),
                status: 'rejected',
                request: body,
                error: 'runtime_owner_busy',
              });
              res.statusCode = 409;
              res.end(
                JSON.stringify({
                  error:
                    'The live runtime is busy or recovering from a previous task. Wait until playback is idle before starting the stress test.',
                }),
              );
              return;
            }
            const result =
              action === 'start'
                ? await stressTestController.start({
                    seed: Number(body.seed) || undefined,
                    assignedOwnerId: provisionalOwnerId || undefined,
                  })
                : action === 'pause'
                  ? await stressTestController.pause()
                  : action === 'resume'
                    ? await stressTestController.resume()
                    : action === 'abort'
                      ? await stressTestController.abort()
                      : action === 'cleanup'
                        ? await stressTestController.cleanup()
                        : (() => {
                            throw new Error('invalid stress action');
                          })();
            await appendAuditEntry({
              category: 'operator_control',
              action: `stress_test_${action}`,
              actor: { type: 'operator', id: 'control-room' },
              occurredAt: Date.now(),
              status: 'succeeded',
              request: body,
              result,
            });
            res.end(JSON.stringify({ ...result, claimedRuntimeOwner }));
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : 'stress action failed';
            void appendAuditEntry({
              category: 'operator_control',
              action: `stress_test_${auditAction}`,
              actor: { type: 'operator', id: 'control-room' },
              occurredAt: Date.now(),
              status: 'failed',
              request: auditRequest,
              error: reason,
            }).catch(() => undefined);
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error: reason,
              }),
            );
          }
        });
      });
    },
  };
}

function acceptanceLedgerPlugin(): Plugin {
  return {
    name: 'acceptance-ledger',
    configureServer(server) {
      server.middlewares.use('/api/acceptance-ledger', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          void readFile(ACCEPTANCE_LEDGER_PATH, 'utf8')
            .then((value) => res.end(value))
            .catch(() =>
              res.end(
                JSON.stringify({ schemaVersion: 1, updatedAt: 0, results: {} }),
              ),
            );
          return;
        }
        if (req.method !== 'POST' && req.method !== 'PATCH') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const result = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as Record<string, unknown>;
            const scenarioId = String(result.scenarioId || '').trim();
            const status = String(result.status || '');
            const reasonCode = String(result.reasonCode || '').trim();
            if (
              !scenarioId ||
              !reasonCode ||
              !['passed', 'failed', 'skipped'].includes(status)
            ) {
              throw new Error('invalid_acceptance_result');
            }
            let current: {
              schemaVersion: 1;
              updatedAt: number;
              results: Record<string, unknown>;
            } = { schemaVersion: 1, updatedAt: 0, results: {} };
            try {
              current = JSON.parse(
                await readFile(ACCEPTANCE_LEDGER_PATH, 'utf8'),
              ) as typeof current;
            } catch {
              // First acceptance result creates the ignored runtime ledger.
            }
            const completedAt = Number(result.completedAt) || Date.now();
            current.updatedAt = completedAt;
            current.results[scenarioId] = {
              ...result,
              scenarioId,
              status,
              reasonCode,
              completedAt,
            };
            await mkdir(dirname(ACCEPTANCE_LEDGER_PATH), { recursive: true });
            await writeFile(
              ACCEPTANCE_LEDGER_PATH,
              `${JSON.stringify(current, null, 2)}\n`,
              'utf8',
            );
            res.end(JSON.stringify(current));
          } catch (error) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : 'invalid_body',
              }),
            );
          }
        });
      });
    },
  };
}

function liveRuntimeMonitorPlugin(): Plugin {
  return {
    name: 'live-runtime-monitor',
    configureServer(server) {
      void restoreOperatorQueue();
      const sendHealth = async (res: ServerResponse) => {
        const now = Date.now();
        liveRuntimeState.ttsRateLimitTimes =
          liveRuntimeState.ttsRateLimitTimes.filter(
            (value) => now - value <= 60_000,
          );
        const oldestQueuedAt = Math.min(
          ...liveRuntimeState.queued.values(),
          Number.POSITIVE_INFINITY,
        );
        const supervisor = (await fetch('http://127.0.0.1:8197/health', {
          cache: 'no-store',
          signal: AbortSignal.timeout(1_500),
        })
          .then((response) => response.json())
          .catch(() => ({ state: 'offline', connectedClients: 0 }))) as {
          state?: string;
          isLive?: boolean;
          connectedClients?: number;
          [key: string]: unknown;
        };
        const measuredOldestAge = Number.isFinite(oldestQueuedAt)
          ? Math.max(0, now - oldestQueuedAt)
          : 0;
        const authoritativeQueue = operatorQueueSnapshot().filter((item) =>
          ['pending', 'preparing', 'ready', 'speaking'].includes(item.status),
        );
        const authoritativeOldestAge = authoritativeQueue.length
          ? Math.max(
              0,
              now -
                Math.min(...authoritativeQueue.map((item) => item.createdAt)),
            )
          : 0;
        const oldestQueueAgeMs = Math.max(
          measuredOldestAge,
          liveRuntimeState.reportedOldestQueueAgeMs,
          authoritativeOldestAge,
        );
        const queueDepth = Math.max(
          liveRuntimeState.queued.size + externalChatQueue.size,
          liveRuntimeState.reportedQueueDepth,
          authoritativeQueue.length,
        );
        const alerts = [
          ...(runtimeOwnerAvailability(now).active
            ? []
            : ['runtime_owner_missing']),
          ...(oldestQueueAgeMs > 15_000 ? ['queue_wait_over_15s'] : []),
          ...(authoritativeQueue.some(
            (item) =>
              item.status === 'preparing' &&
              now - item.updatedAt > PREPARE_LEASE_MS,
          )
            ? ['preparing_lease_stale']
            : []),
          ...(supervisor.isLive === true &&
          Number(supervisor.connectedClients || 0) === 0
            ? ['bilibili_listener_disconnected']
            : []),
          ...(liveRuntimeState.ttsRateLimitTimes.length >= 3
            ? ['tts_rate_limit']
            : []),
          ...(liveRuntimeState.sanitizerFailures > 0
            ? ['sanitizer_failure']
            : []),
        ];
        const acceptance30m = await recentAcceptanceMetrics(now);
        res.end(
          JSON.stringify({
            queueDepth,
            oldestQueueAgeMs,
            duplicateDrops: liveRuntimeState.duplicateDrops,
            sanitizerFailures: liveRuntimeState.sanitizerFailures,
            ttsRateLimitCount: liveRuntimeState.ttsRateLimitTimes.length,
            lastSpeechAt: liveRuntimeState.lastSpeechAt || null,
            lastGeneratedAt: liveRuntimeState.lastGeneratedAt || null,
            lastEventAt: liveRuntimeState.lastEventAt || null,
            isSpeaking: liveRuntimeState.isSpeaking,
            runtimeOwner: runtimeOwnerAvailability(now),
            host: liveRuntimeState.hostTelemetry,
            lastFaults: liveRuntimeState.lastFaults,
            recoveryCount:
              Number(liveRuntimeState.hostTelemetry.recoveryCount) || 0,
            unsupportedAvatarActionCount:
              Number(
                liveRuntimeState.hostTelemetry.unsupportedAvatarActionCount,
              ) || 0,
            repeatedReplyCount: liveRuntimeState.duplicateDrops,
            supervisor,
            alerts,
            acceptance30m,
          }),
        );
      };
      server.middlewares.use('/api/live-runtime-health', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        void sendHealth(res);
      });
      server.middlewares.use('/api/external-chat', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          const next = externalChatQueue.values().next().value;
          if (!next) {
            res.statusCode = 204;
            res.end();
            return;
          }
          externalChatQueue.delete(next.requestId);
          res.end(JSON.stringify(next));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const value = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as {
              requestId?: unknown;
              text?: unknown;
              directReply?: unknown;
              requestedAt?: unknown;
              viewerId?: unknown;
              viewerName?: unknown;
            };
            const requestId = String(value.requestId || '').trim();
            const text =
              typeof value.text === 'string' ? value.text.trim() : '';
            if (!requestId || !text || text.length > 500)
              throw new Error('invalid chat');
            if (!externalChatQueue.has(requestId)) {
              externalChatQueue.set(requestId, {
                requestId,
                text,
                directReply:
                  typeof value.directReply === 'string'
                    ? value.directReply.trim()
                    : undefined,
                requestedAt: finiteTimestamp(value.requestedAt) ?? Date.now(),
                viewerId:
                  typeof value.viewerId === 'string'
                    ? value.viewerId
                    : undefined,
                viewerName:
                  typeof value.viewerName === 'string'
                    ? value.viewerName
                    : undefined,
              });
            }
            res.statusCode = 202;
            res.end(JSON.stringify({ accepted: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid chat request' }));
          }
        });
      });
      server.middlewares.use('/api/operator-queue', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          const requestUrl = new URL(req.url || '/', 'http://localhost');
          if (requestUrl.searchParams.get('observer') === 'control-panel') {
            const observedAt = Date.now();
            for (const item of operatorQueue.values()) {
              if (item.testRunId && !item.panelObservedAt) {
                item.panelObservedAt = observedAt;
              }
            }
          }
          res.end(JSON.stringify({ items: operatorQueueSnapshot() }));
          return;
        }
        if (!['POST', 'PATCH'].includes(req.method || '')) {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          let auditBody: Record<string, unknown> = {};
          let auditAction = req.method === 'POST' ? 'ingest' : 'unknown';
          let auditBefore: OperatorQueueItem | null = null;
          try {
            const body = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as Record<string, unknown>;
            const action = String(
              body.action || (req.method === 'POST' ? 'ingest' : ''),
            ).trim();
            auditBody = body;
            auditAction = action;
            const auditEventId = String(body.eventId || '').trim();
            auditBefore = auditEventId
              ? structuredClone(operatorQueue.get(auditEventId) ?? null)
              : null;
            const now = Date.now();
            if (action === 'ingest' || action === 'manual-broadcast') {
              const eventId = String(body.eventId || '').trim();
              const text =
                typeof body.text === 'string' ? body.text.trim() : '';
              if (!eventId || !text || text.length > 1000)
                throw new Error('invalid queue item');
              const prompt =
                action === 'ingest' && typeof body.prompt === 'string'
                  ? body.prompt.trim()
                  : '';
              // `text` is the short operator-facing queue label. A system
              // prompt carries bounded internal context for the model and is
              // never accepted from ordinary viewer-message sources.
              if (
                prompt &&
                (String(body.source || '') !== 'quiet-room-awareness' ||
                  prompt.length > 12_000)
              ) {
                throw new Error('invalid queue prompt');
              }
              const manualReply =
                action === 'manual-broadcast' && typeof body.reply === 'string'
                  ? body.reply.trim()
                  : '';
              const directReply =
                action === 'ingest' && typeof body.directReply === 'string'
                  ? body.directReply.trim()
                  : '';
              if (directReply.length > 500) throw new Error('invalid direct reply');
              if (action === 'manual-broadcast' && !manualReply) {
                throw new Error('manual broadcast text is required');
              }
              const existing = operatorQueue.get(eventId);
              if (!existing) {
                const viewerId =
                  typeof body.viewerId === 'string' ? body.viewerId : undefined;
                const normalizedText = text
                  .normalize('NFKC')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .toLowerCase();
                const repeatedByViewer = Boolean(
                  viewerId &&
                    operatorQueueSnapshot().some(
                      (item) =>
                        item.viewerId === viewerId &&
                        now - item.createdAt <= 15_000 &&
                        item.text
                          .normalize('NFKC')
                          .replace(/\s+/g, ' ')
                          .trim()
                          .toLowerCase() === normalizedText,
                    ),
                );
                operatorQueue.set(eventId, {
                  eventId,
                  text,
                  prompt: prompt || undefined,
                  source: String(body.source || 'external-chat'),
                  sourceLabel:
                    typeof body.sourceLabel === 'string'
                      ? body.sourceLabel
                      : undefined,
                  viewerId,
                  viewerName:
                    typeof body.viewerName === 'string'
                      ? body.viewerName
                      : undefined,
                  sourcesSeen: Array.isArray(body.sourcesSeen)
                    ? body.sourcesSeen.filter(
                        (item): item is string => typeof item === 'string',
                      )
                    : [],
                  createdAt: finiteTimestamp(body.createdAt) ?? now,
                  updatedAt: now,
                  // Delivery-critical acknowledgements may wait behind normal
                  // chat, but never behind stale queued work. They do not
                  // interrupt an active voice turn; they simply become next.
                  order: directReply
                    ? Math.min(0, ...operatorQueueSnapshot().map((item) => item.order)) - 1
                    : operatorQueueSnapshot().length,
                  // Exact repeat from the same viewer is an emphasis candidate,
                  // not a second answer. Keep it visible in grey for the
                  // operator and leave semantic non-repeats to LLM judgment.
                  status: manualReply || directReply
                    ? 'ready'
                    : repeatedByViewer
                      ? 'skipped'
                      : 'pending',
                  skipReason: repeatedByViewer ? 'duplicate_text' : undefined,
                  preparedReply: manualReply || directReply || undefined,
                  preparedAt: manualReply || directReply ? now : undefined,
                  skills: [],
                  testRunId:
                    typeof body.testRunId === 'string'
                      ? body.testRunId
                      : undefined,
                  stepId:
                    typeof body.stepId === 'string' ? body.stepId : undefined,
                  scenarioId:
                    typeof body.scenarioId === 'string'
                      ? body.scenarioId
                      : undefined,
                  retryCount: 0,
                  beatCount: manualReply || directReply
                    ? Math.max(
                        1,
                        (manualReply || directReply)
                          .split(/(?<=[。！？!?])/u)
                          .filter((part) => part.trim()).length,
                      )
                    : 0,
                  completedBeatCount: 0,
                  replyHash: manualReply || directReply
                    ? createHash('sha256')
                        .update(manualReply || directReply)
                        .digest('hex')
                        .slice(0, 16)
                    : undefined,
                  faultKind:
                    body.testRunId &&
                    [
                      'typhoon-skill-timeout',
                      'model-truncation',
                      'tts-first-beat-failure',
                      'prepare-lease-expiry',
                    ].includes(String(body.faultKind))
                      ? (body.faultKind as OperatorQueueItem['faultKind'])
                      : undefined,
                  presenceOnly: body.presenceOnly === true,
                  engagementSignals: Array.isArray(body.engagementSignals)
                    ? body.engagementSignals.filter(
                        (
                          signal,
                        ): signal is NonNullable<
                          OperatorQueueItem['engagementSignals']
                        >[number] =>
                          [
                            'follow',
                            'like',
                            'gift',
                            'superchat',
                            'guard',
                          ].includes(String(signal)),
                      )
                    : undefined,
                });
              }
            } else {
              const eventId = String(body.eventId || '').trim();
              const item = operatorQueue.get(eventId);
              if (!item) throw new Error('queue item not found');
              if (action === 'delete') {
                item.status = 'deleted';
              } else if (action === 'move') {
                const target = Number(body.order);
                const visible = operatorQueueSnapshot().filter(
                  (entry) => entry.eventId !== eventId,
                );
                visible.splice(
                  Math.max(
                    0,
                    Math.min(
                      visible.length,
                      Number.isFinite(target) ? target : visible.length,
                    ),
                  ),
                  0,
                  item,
                );
                visible.forEach((entry, index) => {
                  entry.order = index;
                });
              } else if (action === 'edit-reply') {
                const reply =
                  typeof body.reply === 'string' ? body.reply.trim() : '';
                if (!reply || reply.length > 3000)
                  throw new Error('invalid prepared reply');
                item.preparedReply = reply;
                item.status = 'ready';
              } else if (action === 'skip') {
                item.status = 'skipped';
                item.skipReason =
                  typeof body.reason === 'string' && body.reason.trim()
                    ? body.reason.trim()
                    : 'llm_no_reply';
                item.finishReason = item.skipReason;
              } else if (action === 'fail') {
                item.status = 'failed';
                item.finishReason =
                  typeof body.reason === 'string' && body.reason.trim()
                    ? body.reason.trim()
                    : 'runtime_failed';
                item.leaseOwnerId = undefined;
                item.leaseExpiresAt = undefined;
              } else if (action === 'retry') {
                item.retryCount = (item.retryCount || 0) + 1;
                item.leaseOwnerId = undefined;
                item.leaseExpiresAt = undefined;
                if (
                  item.status === 'speaking' &&
                  (item.completedBeatCount || 0) > 0
                ) {
                  item.status = 'failed';
                  item.finishReason = 'partial_playback_not_retried';
                } else if ((item.retryCount || 0) > MAX_QUEUE_RETRIES) {
                  item.status = 'failed';
                  item.finishReason =
                    typeof body.reason === 'string'
                      ? body.reason
                      : 'retry_limit_exceeded';
                } else if (
                  ['preparing', 'speaking', 'ready'].includes(item.status)
                ) {
                  item.status = item.preparedReply ? 'ready' : 'pending';
                }
              } else if (action === 'mark-observed') {
                item.interactionObservedAt = now;
                item.relationshipVisitDelta =
                  Number(body.relationshipVisitDelta) || 0;
                item.otherViewerRelationshipMutated = Boolean(
                  body.otherViewerRelationshipMutated,
                );
              } else if (action === 'mark-engagement') {
                item.engagementAppliedAt = now;
              } else if (action === 'consume-fault') {
                if (!item.testRunId) throw new Error('faults are test-only');
                item.faultConsumed = true;
              } else if (action === 'beat-progress') {
                const replaceBeatPlan = body.replaceBeatPlan === true;
                const reportedBeatCount = Math.max(
                  1,
                  Number(body.beatCount) || 0,
                );
                const reportedCompletedBeats = Math.max(
                  0,
                  Number(body.completedBeatCount) || 0,
                );
                item.beatCount = replaceBeatPlan
                  ? reportedBeatCount
                  : Math.max(item.beatCount || 0, reportedBeatCount);
                item.completedBeatCount = replaceBeatPlan
                  ? Math.min(reportedCompletedBeats, item.beatCount)
                  : Math.max(
                      item.completedBeatCount || 0,
                      reportedCompletedBeats,
                    );
                item.audioByteLength =
                  (item.audioByteLength || 0) +
                  Math.max(0, Number(body.byteLength) || 0);
              } else if (action === 'claim-prepare') {
                releaseExpiredOperatorLeases(now);
                if (item.status !== 'pending')
                  throw new Error('queue item is not pending');
                const ownerId = String(body.ownerId || '').trim();
                if (!ownerId) throw new Error('queue lease owner is required');
                if (item.assignedOwnerId && item.assignedOwnerId !== ownerId) {
                  throw new Error(
                    'queue item is assigned to another runtime owner',
                  );
                }
                item.status = 'preparing';
                item.leaseOwnerId = ownerId;
                item.leaseExpiresAt = now + PREPARE_LEASE_MS;
              } else if (action === 'renew-lease') {
                const ownerId = String(body.ownerId || '').trim();
                if (!ownerId || item.leaseOwnerId !== ownerId) {
                  throw new Error('queue lease owner mismatch');
                }
                if (!['preparing', 'speaking'].includes(item.status)) {
                  throw new Error('queue item has no renewable lease');
                }
                item.leaseExpiresAt =
                  now +
                  (item.status === 'speaking'
                    ? SPEAK_LEASE_MS
                    : PREPARE_LEASE_MS);
              } else if (action === 'ready') {
                item.preparedReply =
                  typeof body.reply === 'string'
                    ? body.reply.trim()
                    : item.preparedReply;
                item.skills = Array.isArray(body.skills)
                  ? body.skills.filter(
                      (skill): skill is string => typeof skill === 'string',
                    )
                  : item.skills;
                // A late LLM callback may arrive after this item has already
                // begun playback. Never regress a live or completed item back
                // into the ready queue.
                if (!['speaking', 'done'].includes(item.status)) {
                  item.status = item.preparedReply ? 'ready' : 'pending';
                }
                if (item.preparedReply) item.preparedAt = now;
                item.leaseOwnerId = undefined;
                item.leaseExpiresAt = undefined;
                if (item.preparedReply) {
                  item.beatCount = Math.max(
                    1,
                    item.preparedReply
                      .split(/(?<=[。！？!?])/u)
                      .filter((part) => part.trim()).length,
                  );
                  item.completedBeatCount = 0;
                  item.audioByteLength = 0;
                  item.replyHash = createHash('sha256')
                    .update(item.preparedReply)
                    .digest('hex')
                    .slice(0, 16);
                }
              } else if (action === 'claim-speak') {
                releaseExpiredOperatorLeases(now);
                if (item.status !== 'ready' || !item.preparedReply)
                  throw new Error('queue item is not ready');
                const ownerId = String(body.ownerId || '').trim();
                if (!ownerId) throw new Error('queue lease owner is required');
                if (item.assignedOwnerId && item.assignedOwnerId !== ownerId) {
                  throw new Error(
                    'queue item is assigned to another runtime owner',
                  );
                }
                if (
                  operatorQueueSnapshot().some(
                    (entry) =>
                      entry.eventId !== eventId && entry.status === 'speaking',
                  )
                ) {
                  throw new Error('another queue item is already speaking');
                }
                item.status = 'speaking';
                item.leaseOwnerId = ownerId;
                item.leaseExpiresAt = now + SPEAK_LEASE_MS;
              } else if (action === 'done') {
                const ownerId = String(body.ownerId || '').trim();
                if (item.leaseOwnerId && item.leaseOwnerId !== ownerId) {
                  throw new Error('queue lease owner mismatch');
                }
                item.beatCount = Math.max(
                  item.beatCount || 0,
                  Number(body.beatCount) || 0,
                );
                item.completedBeatCount = Math.max(
                  item.completedBeatCount || 0,
                  Number(body.completedBeatCount) || 0,
                );
                item.audioByteLength = Math.max(
                  item.audioByteLength || 0,
                  Number(body.audioByteLength) || 0,
                );
                if (
                  (item.beatCount || 0) <= 0 ||
                  (item.completedBeatCount || 0) < (item.beatCount || 0) ||
                  (item.audioByteLength || 0) <= 0
                ) {
                  throw new Error(
                    'cannot finish without complete audio evidence',
                  );
                }
                item.status = 'done';
                item.doneAt = now;
                item.finishReason =
                  typeof body.reason === 'string' ? body.reason : 'played';
                item.leaseOwnerId = undefined;
                item.leaseExpiresAt = undefined;
              } else {
                throw new Error('invalid queue action');
              }
              item.updatedAt = now;
              normalizeOperatorQueueOrder();
            }
            await persistOperatorQueue();
            const eventId = String(body.eventId || '').trim();
            const actorId =
              typeof body.auditActor === 'string' && body.auditActor.trim()
                ? body.auditActor.trim()
                : ['manual-broadcast', 'delete', 'move', 'edit-reply'].includes(
                      action,
                    )
                  ? 'control-room'
                  : body.testRunId
                    ? 'stress-test'
                    : 'runtime';
            await appendAuditEntry({
              category: 'operator_queue',
              action,
              actor: {
                type:
                  actorId === 'control-room'
                    ? 'operator'
                    : actorId === 'stress-test'
                      ? 'test'
                      : 'system',
                id: actorId,
              },
              correlationId: eventId || undefined,
              eventId: eventId || undefined,
              occurredAt: now,
              status: 'succeeded',
              request: body,
              before: auditBefore,
              after: eventId
                ? structuredClone(operatorQueue.get(eventId) ?? null)
                : null,
            });
            res.end(
              JSON.stringify({
                item: operatorQueue.get(String(body.eventId || '')),
                items: operatorQueueSnapshot(),
              }),
            );
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : 'invalid queue request';
            void appendAuditEntry({
              category: 'operator_queue',
              action: auditAction,
              actor: {
                type: 'operator',
                id:
                  typeof auditBody.auditActor === 'string'
                    ? auditBody.auditActor
                    : 'unknown-client',
              },
              correlationId:
                typeof auditBody.eventId === 'string'
                  ? auditBody.eventId
                  : undefined,
              eventId:
                typeof auditBody.eventId === 'string'
                  ? auditBody.eventId
                  : undefined,
              occurredAt: Date.now(),
              status: 'failed',
              request: auditBody,
              before: auditBefore,
              error: reason,
            }).catch(() => undefined);
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error: reason,
              }),
            );
          }
        });
      });
      server.middlewares.use('/api/audit-trail', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const correlationId = requestUrl.searchParams.get('correlationId');
        const requestedLimit = Number(requestUrl.searchParams.get('limit'));
        const limit = Math.max(
          1,
          Math.min(
            5000,
            Number.isFinite(requestedLimit) ? requestedLimit : 500,
          ),
        );
        void readFile(AUDIT_TRAIL_PATH, 'utf8')
          .then((raw) => {
            const allEntries = raw
              .split(/\r?\n/)
              .filter(Boolean)
              .map((line) => JSON.parse(line) as Record<string, unknown>);
            const integrity = verifyAuditEntries(allEntries);
            const entries = allEntries
              .filter(
                (entry) =>
                  !correlationId ||
                  entry.correlationId === correlationId ||
                  entry.eventId === correlationId,
              )
              .slice(-limit);
            res.end(JSON.stringify({ entries, integrity }));
          })
          .catch(() =>
            res.end(
              JSON.stringify({
                entries: [],
                integrity: {
                  valid: true,
                  checkedEntries: 0,
                  firstInvalidSequence: null,
                },
              }),
            ),
          );
      });
      server.middlewares.use('/api/live-runtime-events', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          const requestUrl = new URL(req.url || '/', 'http://localhost');
          if (requestUrl.searchParams.get('history') === '1') {
            const limit = Math.min(
              2000,
              Math.max(1, Number(requestUrl.searchParams.get('limit')) || 2000),
            );
            void readFile(LIVE_RUNTIME_LOG_PATH, 'utf8')
              .then((raw) => {
                const events = raw
                  .split(/\r?\n/)
                  .filter(Boolean)
                  .slice(-limit)
                  .map((line) => JSON.parse(line));
                res.end(JSON.stringify({ events }));
              })
              .catch(() => res.end(JSON.stringify({ events: [] })));
            return;
          }
          void sendHealth(res);
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const event = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as Record<string, unknown>;
            const now = finiteTimestamp(event.at) ?? Date.now();
            const eventId = String(event.eventId || event.id || 'runtime');
            const stage = String(event.stage || event.kind || 'event');
            liveRuntimeState.lastEventAt = now;
            if (stage === 'runtime-owner-heartbeat') {
              const ownerId = String(event.ownerId || '').trim();
              if (ownerId) {
                runtimeOwnerHeartbeats.set(ownerId, {
                  seenAt: now,
                  availableForStress: event.availableForStress === true,
                  ttsConfigured: event.ttsConfigured === true,
                });
              }
              liveRuntimeState.hostTelemetry = {
                hostPhase: event.hostPhase,
                activeTurnId: event.activeTurnId,
                targetViewerId: event.targetViewerId,
                lastDecisionReason: event.lastDecisionReason,
                proactiveRemaining: event.proactiveRemaining,
                nextProactiveAt: event.nextProactiveAt,
                currentBeatIndex: event.currentBeatIndex,
                currentBeatInterruptible: event.currentBeatInterruptible,
                recoveryCount: event.recoveryCount,
                unsupportedAvatarActionCount:
                  event.unsupportedAvatarActionCount,
              };
            }
            if (typeof event.queueDepth === 'number') {
              liveRuntimeState.reportedQueueDepth = Math.max(
                0,
                event.queueDepth,
              );
            }
            if (typeof event.oldestQueueAgeMs === 'number') {
              liveRuntimeState.reportedOldestQueueAgeMs = Math.max(
                0,
                event.oldestQueueAgeMs,
              );
            }
            if (stage === 'queued') {
              liveRuntimeState.queued.set(
                eventId,
                finiteTimestamp(event.queuedAt) ?? now,
              );
            } else if (
              [
                'selected',
                'dropped',
                'deduplicated',
                'done',
                'failed',
              ].includes(stage)
            ) {
              liveRuntimeState.queued.delete(eventId);
            }
            if (
              stage === 'deduplicated' &&
              String(event.dropReason || '').startsWith('duplicate')
            ) {
              liveRuntimeState.duplicateDrops += 1;
            }
            if (stage === 'generated') liveRuntimeState.lastGeneratedAt = now;
            if (stage === 'speaking') {
              liveRuntimeState.lastSpeechAt = now;
              liveRuntimeState.isSpeaking = true;
            }
            if (
              ['done', 'tts_rate_limit', 'failed', 'dropped'].includes(stage)
            ) {
              liveRuntimeState.isSpeaking = false;
            }
            if (stage === 'sanitizer_failure') {
              liveRuntimeState.sanitizerFailures += 1;
            }
            if (stage === 'tts_rate_limit') {
              liveRuntimeState.ttsRateLimitTimes.push(now);
            }
            const reason =
              typeof event.reason === 'string'
                ? event.reason
                : typeof event.error === 'string'
                  ? event.error
                  : undefined;
            if (
              stage === 'model-truncated' ||
              (stage === 'failed' &&
                /generation|model|chat/i.test(reason || ''))
            ) {
              liveRuntimeState.lastFaults.model = { at: now, stage, reason };
            }
            if (stage.includes('skill') && /fail|timeout|error/.test(stage)) {
              liveRuntimeState.lastFaults.skill = { at: now, stage, reason };
            }
            if (
              stage.startsWith('tts-') &&
              /error|failed|timeout|rate/.test(stage)
            ) {
              liveRuntimeState.lastFaults.tts = { at: now, stage, reason };
            }
            if (
              stage.includes('flashhead') &&
              /error|failed|timeout/.test(stage)
            ) {
              liveRuntimeState.lastFaults.flashhead = {
                at: now,
                stage,
                reason,
              };
            }
            if (stage === 'live_platform_delivery_failed') {
              liveRuntimeState.lastFaults.platform = { at: now, stage, reason };
            }
            await mkdir(join(LIVE_RUNTIME_LOG_PATH, '..'), {
              recursive: true,
            });
            await appendFile(
              LIVE_RUNTIME_LOG_PATH,
              `${JSON.stringify({ ...event, at: now })}\n`,
              'utf8',
            );
            await appendAuditEntry({
              category: 'runtime',
              action: stage,
              actor: redactAuditValue(
                event.actor ?? {
                  type: stage.startsWith('operator_') ? 'operator' : 'system',
                  id: stage.startsWith('operator_')
                    ? 'control-room'
                    : 'runtime',
                },
              ),
              correlationId: eventId === 'runtime' ? undefined : eventId,
              eventId: eventId === 'runtime' ? undefined : eventId,
              occurredAt: now,
              status: 'succeeded',
              payload: event,
            });
            if (
              [
                'fact_validation_rewrite',
                'sanitizer_failure',
                'tts_rate_limit',
              ].includes(stage)
            ) {
              void fetch(DIGITAL_HOST_EVENT_SINK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event: stage,
                  channel: 'virtual-runtime',
                  requestId: eventId === 'runtime' ? undefined : eventId,
                  at: now,
                  reasons: Array.isArray(event.reasons)
                    ? event.reasons
                    : undefined,
                  error:
                    typeof event.error === 'string' ? event.error : undefined,
                }),
              }).catch(() => undefined);
            }
            res.statusCode = 201;
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid event' }));
          }
        });
      });
    },
  };
}

// Optional content-skill wiring. These defaults preserve the existing Linglan
// demo, while a different deployment can install another content provider
// without editing the application source.
const TYPHOON_CONTEXT_PATH =
  process.env.TYPHOON_CONTEXT_PATH ||
  'D:/typhoon boss radar/台风实时演进分析.md';
const TYPHOON_BOSS_GUIDE_PATH =
  process.env.TYPHOON_BOSS_GUIDE_PATH ||
  'D:/typhoon boss radar/boss雷达说明.md';
const LIVE_RADAR_BASE_URL =
  process.env.TYPHOON_RADAR_BASE_URL || 'http://127.0.0.1:3038';
const CHROME_HEADLESS_PATH =
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LIVE_RADAR_SNAPSHOT_DIR = join(
  WORKSPACE_ROOT,
  '.runtime',
  'typhoon-live-snapshots',
);
const LIVE_RADAR_DECK_PATHS = {
  situation: '/live/situation',
  pro: '/live/pro',
} as const;
const ENABLE_LIVE_RADAR_SCREENSHOTS =
  process.env.COPYME_ENABLE_LIVE_RADAR_SCREENSHOTS === '1';
const liveRadarSnapshots = new Map<
  keyof typeof LIVE_RADAR_DECK_PATHS,
  { imageDataUrl: string; capturedAt: number }
>();
let liveRadarRefreshRunning = false;

async function captureLiveRadarDeck(
  deck: keyof typeof LIVE_RADAR_DECK_PATHS,
): Promise<string> {
  const outputPath = join(LIVE_RADAR_SNAPSHOT_DIR, `${deck}.png`);
  await mkdir(LIVE_RADAR_SNAPSHOT_DIR, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    execFile(
      CHROME_HEADLESS_PATH,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--window-size=1440,900',
        '--virtual-time-budget=2500',
        `--screenshot=${outputPath}`,
        `${LIVE_RADAR_BASE_URL}${LIVE_RADAR_DECK_PATHS[deck]}`,
      ],
      { timeout: 40_000, windowsHide: true },
      async () => {
        try {
          const image = await readFile(outputPath);
          if (image.byteLength < 1_024)
            throw new Error('empty live radar image');
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
  });
  const image = await readFile(outputPath);
  return `data:image/png;base64,${image.toString('base64')}`;
}

async function refreshLiveRadarSnapshots(): Promise<void> {
  if (liveRadarRefreshRunning) return;
  liveRadarRefreshRunning = true;
  try {
    const entries = await Promise.all(
      (
        Object.keys(LIVE_RADAR_DECK_PATHS) as Array<
          keyof typeof LIVE_RADAR_DECK_PATHS
        >
      ).map(async (deck) => [deck, await captureLiveRadarDeck(deck)] as const),
    );
    const capturedAt = Date.now();
    for (const [deck, imageDataUrl] of entries) {
      liveRadarSnapshots.set(deck, { imageDataUrl, capturedAt });
    }
  } catch {
    // Keep the last successful snapshots. A missing visual input must never
    // delay or block the text and structured-data answer path.
  } finally {
    liveRadarRefreshRunning = false;
  }
}
const TYPHOON_QUERY_SCRIPT =
  process.env.TYPHOON_QUERY_SCRIPT ||
  join(
    APP_ROOT,
    'skills',
    'linglan-typhoon-radar',
    'scripts',
    'query_typhoon_radar.mjs',
  );

function runTyphoonQuery(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [TYPHOON_QUERY_SCRIPT, '--question', question],
      { timeout: 8_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

function typhoonContextPlugin(): Plugin {
  return {
    name: 'local-typhoon-context',
    configureServer(server) {
      server.middlewares.use('/api/typhoon-query', async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const question = String(
            url.searchParams.get('question') || '',
          ).trim();
          if (!question) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'question is required' }));
            return;
          }
          const output = await runTyphoonQuery(question);
          JSON.parse(output);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(output);
        } catch {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'typhoon query unavailable' }));
        }
      });
      server.middlewares.use('/api/typhoon-live-snapshot', async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const deck = url.searchParams.get('deck');
        if (req.method !== 'GET' || (deck !== 'situation' && deck !== 'pro')) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'deck must be situation or pro' }));
          return;
        }
        try {
          if (!ENABLE_LIVE_RADAR_SCREENSHOTS) {
            throw new Error('live radar screenshots are disabled');
          }
          if (!liveRadarSnapshots.size) await refreshLiveRadarSnapshots();
          const snapshot = liveRadarSnapshots.get(deck);
          if (!snapshot) throw new Error('live radar snapshot warming up');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(
            JSON.stringify({
              deck,
              capturedAt: snapshot.capturedAt,
              sourceUrl: `${LIVE_RADAR_BASE_URL}${LIVE_RADAR_DECK_PATHS[deck]}`,
              imageDataUrl: snapshot.imageDataUrl,
            }),
          );
        } catch {
          res.statusCode = 503;
          res.end(
            JSON.stringify({ error: 'live radar screenshot unavailable' }),
          );
        }
      });
      server.middlewares.use('/api/typhoon-context', async (_req, res) => {
        try {
          const [analysis, analysisMetadata, bossGuide] = await Promise.all([
            readFile(TYPHOON_CONTEXT_PATH, 'utf8'),
            stat(TYPHOON_CONTEXT_PATH),
            readFile(TYPHOON_BOSS_GUIDE_PATH, 'utf8'),
          ]);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(
            JSON.stringify({
              content: `# Typhoon Boss Radar Guide\n${bossGuide}\n\n# Latest Analysis\n${analysis}`,
              updatedAt: analysisMetadata.mtimeMs,
            }),
          );
        } catch {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '台风实时演进分析暂不可读取。' }));
        }
      });
    },
  };
}

const TTS_CAPTURE_DIR = 'D:/LocalToolset/vtuber/.runtime/tts-captured';

function detectAudioExtension(buffer: Buffer): string {
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') return 'wav';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }
  return 'bin';
}

function localTtsCapturePlugin(): Plugin {
  return {
    name: 'local-tts-capture',
    configureServer(server) {
      server.middlewares.use('/api/tts-capture', (req, res) => {
        if (req.method === 'GET' && req.url?.startsWith('/latest')) {
          void (async () => {
            for (const extension of ['mp3', 'wav']) {
              try {
                const audio = await readFile(
                  join(TTS_CAPTURE_DIR, `latest.${extension}`),
                );
                res.statusCode = 200;
                res.setHeader(
                  'Content-Type',
                  extension === 'mp3' ? 'audio/mpeg' : 'audio/wav',
                );
                res.setHeader('Cache-Control', 'no-store');
                res.end(audio);
                return;
              } catch {
                // Try the other supported audio format.
              }
            }
            res.statusCode = 404;
            res.end('No captured TTS audio is available yet.');
          })();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 20 * 1024 * 1024) chunks.push(chunk);
        });
        req.on('end', async () => {
          try {
            if (size > 20 * 1024 * 1024) throw new Error('audio too large');
            const audio = Buffer.concat(chunks);
            const extension = detectAudioExtension(audio);
            await mkdir(TTS_CAPTURE_DIR, { recursive: true });
            const fileName = `minimax-${Date.now()}.${extension}`;
            await Promise.all([
              writeFile(join(TTS_CAPTURE_DIR, fileName), audio),
              writeFile(join(TTS_CAPTURE_DIR, `latest.${extension}`), audio),
            ]);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ fileName, size: audio.length }));
          } catch {
            res.statusCode = 500;
            res.end();
          }
        });
      });
    },
  };
}

function replyLatencyPlugin(): Plugin {
  return {
    name: 'reply-latency-log',
    configureServer(server) {
      server.middlewares.use('/api/reply-latency', (req, res) => {
        if (req.method === 'GET') {
          const limit = Math.min(
            60,
            Math.max(1, Number(new URL(req.url || '/', 'http://localhost').searchParams.get('limit')) || 24),
          );
          void readFile(REPLY_LATENCY_LOG_PATH, 'utf8')
            .then((raw) =>
              raw
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-limit)
                .reverse()
                .map((line) => JSON.parse(line)),
            )
            .catch(() => [])
            .then((records) => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.statusCode = 200;
              res.end(JSON.stringify({ records }));
            });
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const event = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as {
              requestId?: unknown;
            };
            if (typeof event.requestId !== 'string' || !event.requestId) {
              throw new Error('missing request id');
            }
            await mkdir(dirname(REPLY_LATENCY_LOG_PATH), { recursive: true });
            await appendFile(
              REPLY_LATENCY_LOG_PATH,
              `${JSON.stringify(event)}\n`,
              'utf8',
            );
            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end();
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    runtimeOwnerLeasePlugin(),
    radarCityRelayPlugin(),
    liveProgramPlugin(),
    liveSafetyGatewayPlugin(),
    conversationHistoryPlugin(),
    acceptanceLedgerPlugin(),
    stressTestPlugin(),
    runtimeSettingsPlugin(),
    skillRoutingAgentPlugin(),
    minimaxAudioBridgePlugin(),
    liveRuntimeMonitorPlugin(),
    typhoonContextPlugin(),
    localTtsCapturePlugin(),
    replyLatencyPlugin(),
  ],
  server: {
    proxy: {
      // Keep MiniMax credentials and cross-origin behaviour out of the live
      // browser runtime.  The gateway intentionally reads only the already
      // persisted local runtime setting; it never returns the credential.
      '/api/minimax-tts': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        rewrite: () => '/v1/t2a_v2',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            try {
              const settings = JSON.parse(runtimeSettings || '{}') as {
                tts?: { minimaxApiKey?: unknown };
              };
              const apiKey =
                typeof settings.tts?.minimaxApiKey === 'string'
                  ? settings.tts.minimaxApiKey.trim()
                  : '';
              if (apiKey)
                proxyReq.setHeader('Authorization', `Bearer ${apiKey}`);
            } catch {
              // The downstream provider returns the authoritative error when
              // no valid local runtime setting exists.
            }
          });
        },
      },
      '/api/musetalk': {
        target: 'http://127.0.0.1:8195',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/musetalk/, ''),
      },
      '/api/flashhead': {
        target: 'http://127.0.0.1:8196',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/flashhead/, ''),
      },
      '/api/live-connectors/ordinaryroad': {
        target: process.env.BILIBILI_SUPERVISOR_URL || 'http://127.0.0.1:8197',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api\/live-connectors\/ordinaryroad/, ''),
      },
      // Compatibility alias for one migration cycle. It is no longer exposed
      // as a Bilibili-native connector in the product UI.
      '/api/bilibili': {
        target: process.env.BILIBILI_SUPERVISOR_URL || 'http://127.0.0.1:8197',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bilibili/, ''),
      },
    },
  },
});
