import type {
  InteractionAccountingEffect,
  OperatorQueueItem,
} from './operatorQueue';

type RelationshipSnapshot = Record<
  string,
  { visits?: number }
>;

export type ViewerInteractionDirector = {
  observeAudienceMessage: (
    viewer: { id?: string; name?: string; platform?: string },
    text: string,
    at?: number,
  ) => void;
  observeViewerInteraction: (viewer: {
    id?: string;
    name?: string;
    platform?: string;
  }) => void;
  recordRelationshipSignal: (
    viewer: { id?: string; name?: string; platform?: string },
    signal: NonNullable<OperatorQueueItem['engagementSignals']>[number],
  ) => void;
  getRelationshipSnapshot: () => RelationshipSnapshot;
};

export type InteractionAccountingQueue = {
  claim: (input: {
    item: OperatorQueueItem;
    effects: InteractionAccountingEffect[];
    claimId: string;
    ownerId: string;
  }) => Promise<OperatorQueueItem>;
  recordMetrics: (input: {
    eventId: string;
    claimId: string;
    relationshipVisitDelta: number;
    otherViewerRelationshipMutated: boolean;
  }) => Promise<void>;
};

export type ViewerInteractionAccountingResult = {
  relationshipClaimed: boolean;
  engagementClaimed: boolean;
  relationshipVisitDelta: number;
  otherViewerRelationshipMutated: boolean;
  metricsStatus: 'not-required' | 'recorded' | 'failed';
};

const DIRECT_AUDIENCE_PLATFORMS = new Set([
  'bilibili',
  'douyin',
  'youtube',
  'twitch',
  'ordinary-road',
  'social-stream-ninja',
]);

function ownsClaim(
  item: OperatorQueueItem,
  effect: InteractionAccountingEffect,
  claimId: string,
  ownerId: string,
): boolean {
  const claim = item.interactionAccounting?.[effect];
  return (
    claim?.claimId === claimId &&
    claim.attemptId === item.attemptId &&
    claim.ownerId === ownerId
  );
}

function otherRelationshipChanged(
  before: RelationshipSnapshot,
  after: RelationshipSnapshot,
  currentKey: string,
): boolean {
  return Object.keys({ ...before, ...after }).some(
    (key) =>
      key !== currentKey &&
      JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

/**
 * Claims and applies every relationship side effect for one queue turn. The
 * durable queue claim is acquired before local state changes, so a lease retry
 * cannot count the same viewer message or engagement signal twice.
 */
export async function accountViewerInteraction(input: {
  item: OperatorQueueItem;
  soulPublicBehaviorEnabled: boolean;
  director: ViewerInteractionDirector;
  queue: InteractionAccountingQueue;
  ownerId: string;
  createClaimId?: () => string;
}): Promise<ViewerInteractionAccountingResult> {
  const { item } = input;
  const effects: InteractionAccountingEffect[] = [];
  if (!item.interactionObservedAt && item.viewerId && !item.presenceOnly) {
    effects.push('relationship');
  }
  if (
    !item.engagementAppliedAt &&
    item.viewerId &&
    item.engagementSignals?.length
  ) {
    effects.push('engagement');
  }
  if (!effects.length || !input.ownerId) {
    return {
      relationshipClaimed: false,
      engagementClaimed: false,
      relationshipVisitDelta: 0,
      otherViewerRelationshipMutated: false,
      metricsStatus: 'not-required',
    };
  }

  const claimId = (input.createClaimId ?? (() => crypto.randomUUID()))();
  const claimedItem = await input.queue.claim({
    item,
    effects,
    claimId,
    ownerId: input.ownerId,
  });
  const relationshipClaimed = ownsClaim(
    claimedItem,
    'relationship',
    claimId,
    input.ownerId,
  );
  const engagementClaimed = ownsClaim(
    claimedItem,
    'engagement',
    claimId,
    input.ownerId,
  );
  const platform = item.sourcesSeen[0] || 'unknown';
  const viewer = {
    id: item.viewerId,
    name: item.viewerName,
    platform,
  };

  let relationshipVisitDelta = 0;
  let otherViewerRelationshipMutated = false;
  if (relationshipClaimed) {
    if (
      DIRECT_AUDIENCE_PLATFORMS.has(platform) &&
      !item.engagementSignals?.length
    ) {
      input.director.observeAudienceMessage(viewer, item.text, item.createdAt);
    }
    const relationshipKey = `${platform}:${item.viewerId}`;
    const before = input.director.getRelationshipSnapshot();
    if (!input.soulPublicBehaviorEnabled) {
      input.director.observeViewerInteraction(viewer);
    }
    const after = input.director.getRelationshipSnapshot();
    relationshipVisitDelta =
      (after[relationshipKey]?.visits ?? 0) -
      (before[relationshipKey]?.visits ?? 0);
    otherViewerRelationshipMutated = otherRelationshipChanged(
      before,
      after,
      relationshipKey,
    );
  }

  if (engagementClaimed && !input.soulPublicBehaviorEnabled) {
    for (const signal of item.engagementSignals ?? []) {
      input.director.recordRelationshipSignal(viewer, signal);
    }
  }

  let metricsStatus: ViewerInteractionAccountingResult['metricsStatus'] =
    'not-required';
  if (relationshipClaimed) {
    try {
      await input.queue.recordMetrics({
        eventId: item.eventId,
        claimId,
        relationshipVisitDelta,
        otherViewerRelationshipMutated,
      });
      metricsStatus = 'recorded';
    } catch {
      // The durable claim already prevents duplicate relationship writes.
      // Audit telemetry is best-effort and must not fail reply preparation.
      metricsStatus = 'failed';
    }
  }

  return {
    relationshipClaimed,
    engagementClaimed,
    relationshipVisitDelta,
    otherViewerRelationshipMutated,
    metricsStatus,
  };
}
