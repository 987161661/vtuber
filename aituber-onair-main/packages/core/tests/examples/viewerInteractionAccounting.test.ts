import { describe, expect, it, vi } from 'vitest';
import {
  accountViewerInteraction,
  type InteractionAccountingQueue,
  type ViewerInteractionDirector,
} from '../../examples/react-purupuru-app/src/lib/viewerInteractionAccounting';
import type { OperatorQueueItem } from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function queueItem(
  overrides: Partial<OperatorQueueItem> = {},
): OperatorQueueItem {
  return {
    eventId: 'event-1',
    attemptId: 'event-1:attempt:1',
    turnVersion: 2,
    text: '今晚会下雨吗？',
    source: 'viewer-chat',
    viewerId: 'viewer-a',
    viewerName: '小雨',
    sourcesSeen: ['bilibili'],
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 0,
    status: 'preparing',
    leaseOwnerId: 'owner-1',
    skills: [],
    ...overrides,
  };
}

function director(): ViewerInteractionDirector & {
  relationships: Record<string, { visits: number }>;
} {
  const relationships = {
    'bilibili:viewer-a': { visits: 2 },
    'bilibili:viewer-b': { visits: 7 },
  };
  return {
    relationships,
    observeAudienceMessage: vi.fn(),
    observeViewerInteraction: vi.fn(() => {
      relationships['bilibili:viewer-a'].visits += 1;
    }),
    recordRelationshipSignal: vi.fn(),
    getRelationshipSnapshot: vi.fn(() => structuredClone(relationships)),
  };
}

function accountingQueue(): InteractionAccountingQueue & {
  claims: string[];
  metrics: Array<Record<string, unknown>>;
} {
  const claims: string[] = [];
  const metrics: Array<Record<string, unknown>> = [];
  return {
    claims,
    metrics,
    claim: vi.fn(async ({ item, effects, claimId }) => {
      claims.push(...effects);
      return {
        ...item,
        interactionAccounting: Object.fromEntries(
          effects.map((effect) => [
            effect,
            {
              claimId,
              attemptId: item.attemptId,
              ownerId: item.leaseOwnerId!,
              claimedAt: 2_000,
            },
          ]),
        ),
      };
    }),
    recordMetrics: vi.fn(async (input) => {
      metrics.push(input);
    }),
  };
}

describe('viewer interaction accounting', () => {
  it('accounts one direct audience message through one durable claim', async () => {
    const liveDirector = director();
    const queue = accountingQueue();

    const result = await accountViewerInteraction({
      item: queueItem(),
      soulPublicBehaviorEnabled: false,
      director: liveDirector,
      queue,
      ownerId: 'owner-1',
      createClaimId: () => 'claim-1',
    });

    expect(result).toEqual({
      relationshipClaimed: true,
      engagementClaimed: false,
      relationshipVisitDelta: 1,
      otherViewerRelationshipMutated: false,
      metricsStatus: 'recorded',
    });
    expect(queue.claims).toEqual(['relationship']);
    expect(liveDirector.observeAudienceMessage).toHaveBeenCalledWith(
      { id: 'viewer-a', name: '小雨', platform: 'bilibili' },
      '今晚会下雨吗？',
      1_000,
    );
    expect(liveDirector.observeViewerInteraction).toHaveBeenCalledOnce();
    expect(queue.metrics).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        claimId: 'claim-1',
        relationshipVisitDelta: 1,
        otherViewerRelationshipMutated: false,
      }),
    ]);
  });

  it('does not reapply a relationship effect claimed by another retry', async () => {
    const liveDirector = director();
    const queue = accountingQueue();
    queue.claim = vi.fn(async ({ item }) => ({
      ...item,
      interactionAccounting: {
        relationship: {
          claimId: 'older-claim',
          attemptId: 'event-1:attempt:0',
          ownerId: 'older-owner',
          claimedAt: 1_500,
        },
      },
    }));

    const result = await accountViewerInteraction({
      item: queueItem(),
      soulPublicBehaviorEnabled: false,
      director: liveDirector,
      queue,
      ownerId: 'owner-1',
      createClaimId: () => 'claim-2',
    });

    expect(result.relationshipClaimed).toBe(false);
    expect(liveDirector.observeAudienceMessage).not.toHaveBeenCalled();
    expect(liveDirector.observeViewerInteraction).not.toHaveBeenCalled();
    expect(queue.recordMetrics).not.toHaveBeenCalled();
  });

  it('records audience awareness without duplicating Soul-owned relationships', async () => {
    const liveDirector = director();
    const queue = accountingQueue();

    const result = await accountViewerInteraction({
      item: queueItem(),
      soulPublicBehaviorEnabled: true,
      director: liveDirector,
      queue,
      ownerId: 'owner-1',
      createClaimId: () => 'claim-soul',
    });

    expect(result.relationshipVisitDelta).toBe(0);
    expect(liveDirector.observeAudienceMessage).toHaveBeenCalledOnce();
    expect(liveDirector.observeViewerInteraction).not.toHaveBeenCalled();
    expect(queue.metrics[0]).toMatchObject({
      relationshipVisitDelta: 0,
      otherViewerRelationshipMutated: false,
    });
  });

  it('accounts engagement signals once without treating them as chat awareness', async () => {
    const liveDirector = director();
    const queue = accountingQueue();

    const result = await accountViewerInteraction({
      item: queueItem({ engagementSignals: ['follow', 'like'] }),
      soulPublicBehaviorEnabled: false,
      director: liveDirector,
      queue,
      ownerId: 'owner-1',
      createClaimId: () => 'claim-engagement',
    });

    expect(result).toMatchObject({
      relationshipClaimed: true,
      engagementClaimed: true,
      relationshipVisitDelta: 1,
    });
    expect(queue.claims).toEqual(['relationship', 'engagement']);
    expect(liveDirector.observeAudienceMessage).not.toHaveBeenCalled();
    expect(liveDirector.recordRelationshipSignal).toHaveBeenNthCalledWith(
      1,
      { id: 'viewer-a', name: '小雨', platform: 'bilibili' },
      'follow',
    );
    expect(liveDirector.recordRelationshipSignal).toHaveBeenNthCalledWith(
      2,
      { id: 'viewer-a', name: '小雨', platform: 'bilibili' },
      'like',
    );
  });

  it('leaves presence-only and already-accounted turns untouched', async () => {
    const liveDirector = director();
    const queue = accountingQueue();

    const result = await accountViewerInteraction({
      item: queueItem({
        presenceOnly: true,
        interactionObservedAt: 1_500,
        engagementAppliedAt: 1_500,
        engagementSignals: ['follow'],
      }),
      soulPublicBehaviorEnabled: false,
      director: liveDirector,
      queue,
      ownerId: 'owner-1',
    });

    expect(result).toEqual({
      relationshipClaimed: false,
      engagementClaimed: false,
      relationshipVisitDelta: 0,
      otherViewerRelationshipMutated: false,
      metricsStatus: 'not-required',
    });
    expect(queue.claim).not.toHaveBeenCalled();
  });

  it('does not lose a claimed engagement effect when metric telemetry fails', async () => {
    const liveDirector = director();
    const queue = accountingQueue();
    queue.recordMetrics = vi.fn(async () => {
      throw new Error('metrics unavailable');
    });

    const result = await accountViewerInteraction({
      item: queueItem({ engagementSignals: ['gift'] }),
      soulPublicBehaviorEnabled: false,
      director: liveDirector,
      queue,
      ownerId: 'owner-1',
      createClaimId: () => 'claim-metrics-failure',
    });

    expect(result.metricsStatus).toBe('failed');
    expect(liveDirector.observeViewerInteraction).toHaveBeenCalledOnce();
    expect(liveDirector.recordRelationshipSignal).toHaveBeenCalledWith(
      { id: 'viewer-a', name: '小雨', platform: 'bilibili' },
      'gift',
    );
  });
});
