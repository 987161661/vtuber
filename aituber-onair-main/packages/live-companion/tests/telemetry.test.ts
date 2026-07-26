import { describe, expect, it } from 'vitest';
import {
  LiveHostCoordinator,
  type LiveTelemetryRecordV1,
  type LiveTelemetrySink,
} from '../src/index.js';

describe('live runtime telemetry', () => {
  it('records the complete turn lifecycle without exposing viewer content or identity', () => {
    const records: LiveTelemetryRecordV1[] = [];
    const sink: LiveTelemetrySink = { record: (record) => records.push(record) };
    const coordinator = new LiveHostCoordinator({}, sink);

    coordinator.dispatch({ type: 'stream-state', at: 0, isLive: true });
    coordinator.dispatch({
      type: 'audience-message',
      at: 10,
      eventId: 'turn-1',
      viewerId: 'private-viewer-id',
    });
    coordinator.dispatch({
      type: 'generation',
      at: 20,
      eventId: 'turn-1',
      stage: 'started',
      turn: { eventId: 'turn-1', kind: 'viewer', priority: 'normal', createdAt: 10 },
    });
    coordinator.dispatch({
      type: 'delivery-observation',
      at: 25,
      eventId: 'turn-1',
      stage: 'llm-first-token',
    });
    coordinator.dispatch({
      type: 'generation',
      at: 30,
      eventId: 'turn-1',
      stage: 'completed',
      turn: { eventId: 'turn-1', kind: 'viewer', priority: 'normal', createdAt: 10 },
    });
    coordinator.dispatch({
      type: 'delivery-observation',
      at: 35,
      eventId: 'turn-1',
      stage: 'tts-first-packet',
    });
    coordinator.dispatch({ type: 'speech', at: 40, eventId: 'turn-1', stage: 'started' });
    coordinator.dispatch({
      type: 'delivery-observation',
      at: 42,
      eventId: 'turn-1',
      stage: 'avatar-first-frame',
    });
    coordinator.dispatch({
      type: 'delivery-observation',
      at: 45,
      eventId: 'turn-1',
      stage: 'platform-ack',
    });
    coordinator.dispatch({ type: 'speech', at: 50, eventId: 'turn-1', stage: 'completed' });

    expect(records.map((record) => record.stage).filter(Boolean)).toEqual([
      'started',
      'llm-first-token',
      'completed',
      'tts-first-packet',
      'started',
      'avatar-first-frame',
      'platform-ack',
      'completed',
    ]);
    expect(JSON.stringify(records)).not.toContain('private-viewer-id');
    expect(records.at(-1)).toMatchObject({ phase: 'cooldown', queueDepth: 0 });
  });

  it('never lets telemetry failure interrupt host decisions', () => {
    const coordinator = new LiveHostCoordinator({}, {
      record() {
        throw new Error('collector unavailable');
      },
    });

    expect(
      coordinator.dispatch({ type: 'audience-message', at: 1, eventId: 'turn-1' }),
    ).toMatchObject([{ kind: 'queue-audience-turn' }]);
  });
});
