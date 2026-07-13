import { describe, expect, it } from 'vitest';
import { LivePresenceTracker, ProactiveTalkPlanner } from '../src/index.js';

describe('ProactiveTalkPlanner', () => {
  it('gently targets a known silent viewer only in a small quiet room', () => {
    const presence = new LivePresenceTracker();
    presence.startStream('stream-a');
    presence.observe({
      kind: 'join',
      at: 0,
      viewer: {
        id: 'viewer-mina',
        displayName: 'Mina',
        platform: 'custom',
        addressable: true,
        mayMentionName: true,
      },
    });
    presence.observe({
      kind: 'heartbeat',
      at: 240_000,
      viewer: {
        id: 'viewer-mina',
        displayName: 'Mina',
        platform: 'custom',
        addressable: true,
        mayMentionName: true,
      },
    });
    const planner = new ProactiveTalkPlanner(presence, {
      minQuietMs: 30_000,
      minViewerPresenceMs: 180_000,
      minViewerSilentMs: 180_000,
      globalCooldownMs: 60_000,
      perViewerCooldownMs: 600_000,
    });

    const decision = planner.evaluate({
      stream: {
        streamId: 'stream-a',
        now: 240_000,
        startedAt: 0,
        viewerCount: 2,
        lastHostSpeechAt: 180_000,
        topic: 'Puzzle game',
      },
    });

    expect(decision?.kind).toBe('address-silent-viewer');
    expect(decision?.targetViewerId).toBe('viewer-mina');
    expect(decision?.prompt.targetViewer?.displayName).toBe('Mina');
    expect(decision?.prompt.constraints.join(' ')).toContain(
      'Never say that the viewer is being tracked',
    );

    if (!decision) throw new Error('Expected a proactive decision');
    planner.markDelivered(decision, 240_000);
    expect(
      planner.evaluate({
        stream: {
          streamId: 'stream-a',
          now: 280_000,
          startedAt: 0,
          viewerCount: 2,
          lastHostSpeechAt: 180_000,
        },
      }),
    ).toBeNull();
  });

  it('does not expose names without permission and avoids direct targeting in crowds', () => {
    const presence = new LivePresenceTracker();
    presence.startStream('stream-b');
    presence.observe({
      kind: 'heartbeat',
      at: 300_000,
      viewer: {
        id: 'viewer-private',
        displayName: 'PrivateName',
        platform: 'web',
        addressable: true,
        mayMentionName: false,
      },
    });
    const planner = new ProactiveTalkPlanner(presence, {
      minQuietMs: 1,
      minViewerPresenceMs: 0,
      minViewerSilentMs: 0,
      viewerActiveWindowMs: 600_000,
      maxViewerCountForDirectAddress: 5,
    });

    const privateDecision = planner.evaluate({
      stream: {
        streamId: 'stream-b',
        now: 300_000,
        startedAt: 0,
        viewerCount: 1,
      },
    });
    expect(privateDecision?.prompt.targetViewer?.displayName).toBeUndefined();

    planner.resetStream('stream-c');
    const crowdDecision = planner.evaluate({
      stream: {
        streamId: 'stream-c',
        now: 300_000,
        startedAt: 0,
        viewerCount: 20,
      },
      environmentEvents: [
        {
          id: 'event-1',
          type: 'game-state',
          occurredAt: 299_000,
          summary: 'The player reached a new area.',
        },
      ],
    });
    expect(crowdDecision?.kind).toBe('react-to-environment');
    expect(crowdDecision?.targetViewerId).toBeUndefined();
  });

  it('requires explicit presence identity instead of inferring lurkers from counts', () => {
    const presence = new LivePresenceTracker();
    presence.startStream('stream-a');
    const planner = new ProactiveTalkPlanner(presence, {
      minQuietMs: 0,
      allowGenericFill: false,
    });

    expect(
      planner.evaluate({
        stream: {
          streamId: 'stream-a',
          now: 60_000,
          startedAt: 0,
          viewerCount: 3,
        },
      }),
    ).toBeNull();
  });
});
