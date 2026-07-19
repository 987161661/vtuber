import { describe, expect, it } from 'vitest';
import {
  decodeOperatorQueueCommand,
  decodeOperatorQueueIngest,
  sanitizePreparedSpeechPlan,
} from '../../examples/react-purupuru-app/server/operatorQueueHttpAdapter';

describe('operator queue HTTP adapter', () => {
  it('builds a ready manual broadcast from one normalized ingest interface', () => {
    expect(
      decodeOperatorQueueIngest(
        'manual-broadcast',
        {
          eventId: ' manual-1 ',
          text: ' announce this ',
          reply: ' prepared reply ',
          source: 'operator-manual',
          sourcesSeen: ['control-room', 12],
        },
        { items: [], now: 10_000 },
      ),
    ).toMatchObject({
      action: 'ingest',
      item: {
        eventId: 'manual-1',
        attemptId: 'manual-1:attempt:1',
        text: 'announce this',
        source: 'operator-manual',
        sourcesSeen: ['control-room'],
        createdAt: 10_000,
        updatedAt: 10_000,
        order: 0,
        status: 'ready',
        preparedReply: 'prepared reply',
        preparedAt: 10_000,
        beatCount: 1,
        completedBeatCount: 0,
      },
    });
  });

  it('keeps exact viewer repeats visible as skipped emphasis candidates', () => {
    const previous = decodeOperatorQueueIngest(
      'ingest',
      {
        eventId: 'event-1',
        text: 'Hello   World',
        viewerId: 'viewer-1',
      },
      { items: [], now: 1_000 },
    ).item;

    expect(
      decodeOperatorQueueIngest(
        'ingest',
        {
          eventId: 'event-2',
          text: ' hello world ',
          viewerId: 'viewer-1',
        },
        { items: [previous], now: 15_000 },
      ).item,
    ).toMatchObject({
      eventId: 'event-2',
      status: 'skipped',
      skipReason: 'duplicate_text',
      order: 1,
    });
  });

  it('prioritizes direct replies and bounds quiet-room context deterministically', () => {
    const existing = decodeOperatorQueueIngest(
      'ingest',
      { eventId: 'existing', text: 'existing' },
      { items: [], now: 10_000 },
    ).item;
    existing.order = -3;
    const item = decodeOperatorQueueIngest(
      'ingest',
      {
        eventId: 'quiet-1',
        text: 'quiet room cue',
        prompt: 'internal context',
        source: 'quiet-room-awareness',
        directReply: 'acknowledged',
        roomContext: {
          totalCount: 99_999,
          participantCount: '3',
          conflictLevel: 'attack',
          samples: [{ id: 's1', viewerId: 'v1', text: 'sample' }],
          observedAt: 'invalid',
        },
      },
      { items: [existing], now: 20_000 },
    ).item;

    expect(item).toMatchObject({
      prompt: 'internal context',
      order: -4,
      status: 'ready',
      preparedReply: 'acknowledged',
      roomContext: {
        totalCount: 10_000,
        participantCount: 3,
        conflictLevel: 'attack',
        observedAt: 20_000,
        samples: [{ id: 's1', viewerId: 'v1', text: 'sample', at: 20_000 }],
      },
    });
  });

  it('rejects unsafe ingest variants before they reach the queue runtime', () => {
    const decode = (action: string, body: Record<string, unknown>) =>
      decodeOperatorQueueIngest(action, body, { items: [], now: 1 });

    expect(() => decode('delete', { eventId: 'e', text: 'x' })).toThrow(
      'invalid queue ingest action',
    );
    expect(() => decode('ingest', { eventId: '', text: 'x' })).toThrow(
      'invalid queue item',
    );
    expect(() =>
      decode('ingest', {
        eventId: 'e',
        text: 'x',
        source: 'viewer-chat',
        prompt: 'not allowed',
      }),
    ).toThrow('invalid queue prompt');
    expect(() =>
      decode('manual-broadcast', { eventId: 'e', text: 'x', reply: ' ' }),
    ).toThrow('manual broadcast text is required');
  });

  it('decodes a ready request and sanitizes its speech plan', () => {
    expect(
      decodeOperatorQueueCommand('ready', {
        eventId: ' event-1 ',
        attemptId: ' attempt-2 ',
        reply: ' reply ',
        skills: ['weather', 3, 'conversation'],
        speechPlan: {
          version: 2,
          beats: [
            {
              text: ' hello ',
              emotion: 'warm',
              emotionIntensity: 4,
              pauseAfterMs: 9_000,
              prosody: { pace: 2, unknown: 1 },
            },
          ],
        },
      }),
    ).toEqual({
      action: 'ready',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      reply: 'reply',
      skills: ['weather', 'conversation'],
      speechPlan: {
        version: 2,
        beats: [
          {
            text: 'hello',
            emotion: 'warm',
            emotionIntensity: 1,
            pauseAfterMs: 2_500,
            prosody: { pace: 1 },
          },
        ],
      },
    });
  });

  it('normalizes numeric, boolean and owner fields for lifecycle commands', () => {
    expect(
      decodeOperatorQueueCommand('renew-lease', {
        eventId: 'event-1',
        attemptId: ' attempt-2 ',
        ownerId: ' runtime-a ',
      }),
    ).toEqual({
      action: 'renew-lease',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'runtime-a',
    });
    expect(
      decodeOperatorQueueCommand('beat-progress', {
        eventId: 'event-1',
        attemptId: ' attempt-2 ',
        ownerId: ' runtime-a ',
        beatCount: '3',
        completedBeatCount: '2',
        byteLength: '40',
        replaceBeatPlan: true,
      }),
    ).toEqual({
      action: 'beat-progress',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'runtime-a',
      beatCount: 3,
      completedBeatCount: 2,
      byteLength: 40,
      replaceBeatPlan: true,
    });
    expect(
      decodeOperatorQueueCommand('done', {
        eventId: 'event-1',
        attemptId: ' attempt-2 ',
        ownerId: ' runtime-a ',
        beatCount: '1',
        completedBeatCount: 1,
        audioByteLength: '256',
        reason: 'played',
      }),
    ).toEqual({
      action: 'done',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'runtime-a',
      beatCount: 1,
      completedBeatCount: 1,
      audioByteLength: 256,
      reason: 'played',
    });
  });

  it('preserves attempt and lease ownership on a runtime failure command', () => {
    expect(
      decodeOperatorQueueCommand('fail', {
        eventId: 'event-1',
        attemptId: 'attempt-2',
        ownerId: 'runtime-owner',
        reason: 'tts failed',
      }),
    ).toEqual({
      action: 'fail',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'runtime-owner',
      reason: 'tts failed',
    });
  });

  it('preserves attempt and lease ownership on a runtime skip command', () => {
    expect(
      decodeOperatorQueueCommand('skip', {
        eventId: 'event-1',
        attemptId: ' attempt-2 ',
        ownerId: ' runtime-owner ',
        reason: 'llm_no_reply',
      }),
    ).toEqual({
      action: 'skip',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'runtime-owner',
      reason: 'llm_no_reply',
    });
  });

  it('preserves attempt and lease ownership on a runtime retry command', () => {
    expect(
      decodeOperatorQueueCommand('retry', {
        eventId: 'event-1',
        attemptId: ' attempt-2 ',
        ownerId: ' runtime-owner ',
        reason: 'generation_core_rejected',
      }),
    ).toEqual({
      action: 'retry',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'runtime-owner',
      reason: 'generation_core_rejected',
    });
  });

  it('normalizes the shared interaction accounting protocol', () => {
    expect(
      decodeOperatorQueueCommand('claim-interaction-accounting', {
        eventId: ' event-1 ',
        attemptId: ' attempt-2 ',
        ownerId: ' owner-1 ',
        claimId: ' claim-1 ',
        effects: ['relationship', 'engagement', 'relationship', 'unknown'],
      }),
    ).toEqual({
      action: 'claim-interaction-accounting',
      eventId: 'event-1',
      attemptId: 'attempt-2',
      ownerId: 'owner-1',
      claimId: 'claim-1',
      effects: ['relationship', 'engagement'],
    });
    expect(
      decodeOperatorQueueCommand('record-interaction-metrics', {
        eventId: 'event-1',
        claimId: ' claim-1 ',
        relationshipVisitDelta: '1',
        otherViewerRelationshipMutated: false,
      }),
    ).toEqual({
      action: 'record-interaction-metrics',
      eventId: 'event-1',
      claimId: 'claim-1',
      relationshipVisitDelta: 1,
      otherViewerRelationshipMutated: false,
    });
  });

  it('keeps invalid speech plans out and rejects unknown actions', () => {
    expect(
      sanitizePreparedSpeechPlan({ version: 1, beats: [] }),
    ).toBeUndefined();
    expect(() =>
      decodeOperatorQueueCommand('unknown', { eventId: 'event-1' }),
    ).toThrow('invalid queue action');
  });
});
