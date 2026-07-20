import { createHash } from 'node:crypto';
import { sanitizeSpeechText } from '../../../../voice/src/utils/sanitizeSpeechText';
import type {
  OperatorQueueItem,
  PreparedSpeechPlan,
} from '../src/lib/operatorQueue';
import type { OperatorQueueCommand } from './operatorQueueRuntime';

type OperatorQueueMutationCommand = Exclude<
  OperatorQueueCommand,
  { action: 'ingest' }
>;

type OperatorQueueIngestCommand = Extract<
  OperatorQueueCommand,
  { action: 'ingest' }
>;

export function decodeOperatorQueueIngest(
  action: string,
  body: Record<string, unknown>,
  context: { items: readonly OperatorQueueItem[]; now: number },
): OperatorQueueIngestCommand {
  if (action !== 'ingest' && action !== 'manual-broadcast') {
    throw new Error('invalid queue ingest action');
  }
  const eventId = String(body.eventId || '').trim();
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!eventId || !text || text.length > 1_000) {
    throw new Error('invalid queue item');
  }
  const prompt =
    action === 'ingest' && typeof body.prompt === 'string'
      ? body.prompt.trim()
      : '';
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

  const sourcesSeen = stringArray(body.sourcesSeen);
  const roomContext = sanitizeRoomContext(body.roomContext, context.now);
  const existing = context.items.find((item) => item.eventId === eventId);
  if (existing) {
    return {
      action: 'ingest',
      item: { ...existing, roomContext, sourcesSeen },
    };
  }

  const preparedReply = manualReply || directReply || undefined;
  const preparedSpeechPlan = sanitizePreparedSpeechPlan(body.speechPlan);
  const viewerId =
    typeof body.viewerId === 'string' ? body.viewerId : undefined;
  const repeatedByViewer = Boolean(
    viewerId &&
      context.items.some(
        (item) =>
          item.viewerId === viewerId &&
          context.now - item.createdAt <= 15_000 &&
          normalizeQueueText(item.text) === normalizeQueueText(text),
      ),
  );
  const beatCount = preparedReply
    ? Math.max(
        1,
        preparedSpeechPlan?.beats.length ??
          preparedReply.split(/(?<=[。！？!?])/u).filter((part) => part.trim())
            .length,
      )
    : 0;

  return {
    action: 'ingest',
    item: {
      eventId,
      attemptId: `${eventId}:attempt:1`,
      turnVersion: 2,
      text,
      prompt: prompt || undefined,
      source: String(body.source || 'external-chat'),
      sourceLabel:
        typeof body.sourceLabel === 'string' ? body.sourceLabel : undefined,
      viewerId,
      viewerName:
        typeof body.viewerName === 'string' ? body.viewerName : undefined,
      sourcesSeen,
      createdAt: finiteTimestamp(body.createdAt) ?? context.now,
      updatedAt: context.now,
      order: directReply
        ? Math.min(0, ...context.items.map((item) => item.order)) - 1
        : context.items.length,
      status: preparedReply
        ? 'ready'
        : repeatedByViewer
          ? 'skipped'
          : 'pending',
      skipReason: repeatedByViewer ? 'duplicate_text' : undefined,
      preparedReply,
      preparedSpeechPlan,
      preparedAt: preparedReply ? context.now : undefined,
      skills: [],
      testRunId:
        typeof body.testRunId === 'string' ? body.testRunId : undefined,
      stepId: typeof body.stepId === 'string' ? body.stepId : undefined,
      scenarioId:
        typeof body.scenarioId === 'string' ? body.scenarioId : undefined,
      retryCount: 0,
      beatCount,
      completedBeatCount: 0,
      replyHash: preparedReply
        ? createHash('sha256').update(preparedReply).digest('hex').slice(0, 16)
        : undefined,
      faultKind: decodeFaultKind(body.testRunId, body.faultKind),
      presenceOnly: body.presenceOnly === true,
      engagementSignals: decodeEngagementSignals(body.engagementSignals),
      roomContext,
    },
  };
}

export function decodeOperatorQueueCommand(
  action: string,
  body: Record<string, unknown>,
): OperatorQueueMutationCommand {
  const eventId = String(body.eventId || '').trim();
  const reason = typeof body.reason === 'string' ? body.reason : undefined;
  const ownerId = String(body.ownerId || '').trim();
  const attemptId = String(body.attemptId || '').trim();

  switch (action) {
    case 'delete':
    case 'consume-fault':
      return { action, eventId };
    case 'move':
      return { action, eventId, order: Number(body.order) };
    case 'edit-reply':
      return {
        action,
        eventId,
        reply: typeof body.reply === 'string' ? body.reply : '',
      };
    case 'skip':
      return { action, eventId, attemptId, ownerId, reason };
    case 'retry':
      return { action, eventId, attemptId, ownerId, reason };
    case 'fail':
      return { action, eventId, attemptId, ownerId, reason };
    case 'claim-interaction-accounting':
      return {
        action,
        eventId,
        attemptId,
        ownerId,
        claimId: String(body.claimId || '').trim(),
        effects: decodeInteractionAccountingEffects(body.effects),
      };
    case 'record-interaction-metrics':
      return {
        action,
        eventId,
        claimId: String(body.claimId || '').trim(),
        otherViewerRelationshipMutated: Boolean(
          body.otherViewerRelationshipMutated,
        ),
        relationshipVisitDelta: Number(body.relationshipVisitDelta) || 0,
      };
    case 'beat-progress':
      return {
        action,
        eventId,
        attemptId,
        ownerId,
        beatCount: Number(body.beatCount) || 0,
        completedBeatCount: Number(body.completedBeatCount) || 0,
        byteLength: Number(body.byteLength) || 0,
        replaceBeatPlan: body.replaceBeatPlan === true,
      };
    case 'claim-prepare':
      return { action, eventId, ownerId };
    case 'renew-lease':
      return { action, eventId, attemptId, ownerId };
    case 'ready':
      return {
        action,
        eventId,
        attemptId,
        reply: typeof body.reply === 'string' ? body.reply.trim() : undefined,
        skills: Array.isArray(body.skills)
          ? body.skills.filter(
              (skill): skill is string => typeof skill === 'string',
            )
          : undefined,
        speechPlan: sanitizePreparedSpeechPlan(body.speechPlan),
      };
    case 'claim-speak':
      return { action, eventId, attemptId, ownerId };
    case 'done':
      return {
        action,
        eventId,
        attemptId,
        ownerId,
        beatCount: Number(body.beatCount) || 0,
        completedBeatCount: Number(body.completedBeatCount) || 0,
        audioByteLength: Number(body.audioByteLength) || 0,
        reason,
      };
    default:
      throw new Error('invalid queue action');
  }
}

function decodeInteractionAccountingEffects(
  value: unknown,
): Array<'relationship' | 'engagement'> {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].filter(
    (effect): effect is 'relationship' | 'engagement' =>
      effect === 'relationship' || effect === 'engagement',
  );
}

export function sanitizePreparedSpeechPlan(
  value: unknown,
): PreparedSpeechPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as { version?: unknown; beats?: unknown };
  if (source.version !== 2 || !Array.isArray(source.beats)) return undefined;
  const prosodyKeys = new Set([
    'pace',
    'pitch',
    'volume',
    'warmth',
    'tension',
    'energy',
    'assertiveness',
    'breathiness',
  ]);
  const beats = source.beats.slice(0, 3).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const beat = raw as Record<string, unknown>;
    const text = sanitizeSpeechText(String(beat.text || '')).slice(0, 1_200);
    if (!text) return [];
    const prosody = Object.fromEntries(
      Object.entries(
        (beat.prosody &&
        typeof beat.prosody === 'object' &&
        !Array.isArray(beat.prosody)
          ? beat.prosody
          : {}) as Record<string, unknown>,
      )
        .filter(
          ([key, number]) =>
            prosodyKeys.has(key) &&
            typeof number === 'number' &&
            Number.isFinite(number),
        )
        .map(([key, number]) => [
          key,
          Math.min(1, Math.max(-1, number as number)),
        ]),
    );
    const string = (key: string, max = 80) =>
      typeof beat[key] === 'string'
        ? beat[key].trim().slice(0, max) || undefined
        : undefined;
    const numeric = (key: string, min: number, max: number) =>
      typeof beat[key] === 'number' && Number.isFinite(beat[key])
        ? Math.min(max, Math.max(min, beat[key] as number))
        : undefined;
    return [
      {
        text,
        ttsText: string('ttsText', 1_400),
        emotion: string('emotion'),
        delivery: string('delivery'),
        emotionIntensity: numeric('emotionIntensity', 0, 1),
        prosody: Object.keys(prosody).length ? prosody : undefined,
        pauseAfterMs: numeric('pauseAfterMs', 0, 2_500),
        motion: string('motion'),
        gaze: string('gaze'),
        gesture: string('gesture'),
        interruptibleAfter:
          typeof beat.interruptibleAfter === 'boolean'
            ? beat.interruptibleAfter
            : undefined,
      },
    ];
  });
  return beats.length ? { version: 2, beats } : undefined;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeQueueText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function decodeFaultKind(
  testRunId: unknown,
  value: unknown,
): OperatorQueueItem['faultKind'] {
  if (!testRunId) return undefined;
  return [
    'typhoon-skill-timeout',
    'model-truncation',
    'tts-first-beat-failure',
    'prepare-lease-expiry',
  ].includes(String(value))
    ? (value as OperatorQueueItem['faultKind'])
    : undefined;
}

function decodeEngagementSignals(
  value: unknown,
): OperatorQueueItem['engagementSignals'] {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (
      signal,
    ): signal is NonNullable<OperatorQueueItem['engagementSignals']>[number] =>
      ['follow', 'like', 'gift', 'superchat', 'guard'].includes(String(signal)),
  );
}

function boundedInteger(value: unknown, max: number): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(max, Math.floor(number)))
    : 0;
}

function sanitizeRoomContext(
  value: unknown,
  now: number,
): OperatorQueueItem['roomContext'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const samples = (Array.isArray(record.samples) ? record.samples : [])
    .slice(0, 12)
    .flatMap((sample) => {
      if (!sample || typeof sample !== 'object') return [];
      const entry = sample as Record<string, unknown>;
      const text =
        typeof entry.text === 'string' ? entry.text.slice(0, 240) : '';
      const viewerId =
        typeof entry.viewerId === 'string' ? entry.viewerId.slice(0, 120) : '';
      if (!text || !viewerId) return [];
      return [
        {
          id: typeof entry.id === 'string' ? entry.id.slice(0, 120) : '',
          viewerId,
          viewerName:
            typeof entry.viewerName === 'string'
              ? entry.viewerName.slice(0, 120)
              : viewerId,
          text,
          at: finiteTimestamp(entry.at) ?? now,
          hostile: entry.hostile === true,
          threat: entry.threat === true,
          targetViewerId:
            typeof entry.targetViewerId === 'string'
              ? entry.targetViewerId.slice(0, 120)
              : undefined,
        },
      ];
    });
  const rawLanes =
    record.laneCounts && typeof record.laneCounts === 'object'
      ? Object.entries(record.laneCounts as Record<string, unknown>).slice(0, 8)
      : [];
  const conflictLevel = ['calm', 'friction', 'escalating', 'attack'].includes(
    String(record.conflictLevel),
  )
    ? (record.conflictLevel as NonNullable<
        OperatorQueueItem['roomContext']
      >['conflictLevel'])
    : 'calm';
  return {
    totalCount: boundedInteger(record.totalCount, 10_000),
    participantCount: boundedInteger(record.participantCount, 10_000),
    catchup: record.catchup === true,
    mergedCount: boundedInteger(record.mergedCount, 10_000),
    laneCounts: Object.fromEntries(
      rawLanes.map(([key, count]) => [
        key.slice(0, 40),
        boundedInteger(count, 10_000),
      ]),
    ),
    samples,
    conflictLevel,
    ambiguous: record.ambiguous === true,
    clearOffenderIds: stringArray(record.clearOffenderIds)
      .slice(0, 12)
      .map((id) => id.slice(0, 120)),
    observedAt: finiteTimestamp(record.observedAt) ?? now,
  };
}
