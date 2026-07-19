export type AudienceActivityMode =
  | 'empty'
  | 'active'
  | 'passive'
  | 'likely-resting';

export type AudienceIdentity = {
  id?: string;
  name?: string;
  platform?: string;
};

export type AudienceActivityMember = AudienceIdentity & {
  lastInteractionAt: number;
};

export type AudienceRestingBelief = AudienceIdentity & {
  lastInteractionAt: number;
  restIntentAt: number;
  evidence: 'explicit-rest-intent' | 'farewell';
};

export type AudienceAwarenessSnapshot = {
  mode: AudienceActivityMode;
  reportedAudienceCount: number;
  activeAudienceCount: number;
  engageableAudienceCount: number;
  likelyRestingAudienceCount: number;
  likelyRestingMembers: AudienceRestingBelief[];
};

type ViewerBelief = AudienceIdentity & {
  lastInteractionAt: number;
  restIntentAt?: number;
  restIntentEvidence?: AudienceRestingBelief['evidence'];
  contradictedAt?: number;
};

export const AUDIENCE_ACTIVE_WINDOW_MS = 5 * 60_000;
export const REST_INTENT_TTL_MS = 8 * 60 * 60_000;

const EXPLICIT_REST_INTENT =
  /(?:我(?:先|要|准备|去|该)?(?:在这(?:里)?|在直播间)?(?:挂机)?(?:睡|睡觉|休息)|(?:在这(?:里)?|直播间)(?:挂机)?睡|挂机睡|困了.*(?:睡|休息)|睡觉了)/u;
const FAREWELL = /(?:^|[，。！？\s])晚安(?:啦|了|哈|呀|喽|咯)?(?:[，。！？\s]|$)/u;
const REST_SEQUENCE = /(?:早点睡|先睡|去睡|睡吧|休息吧|晚安)/u;

function identityKey(viewer: AudienceIdentity): string | undefined {
  const platform = viewer.platform?.trim() || 'unknown';
  if (viewer.id?.trim()) return `${platform}:id:${viewer.id.trim()}`;
  if (viewer.name?.trim()) return `${platform}:name:${viewer.name.trim()}`;
  return undefined;
}

function classifyRestMessage(
  text: string,
  existing?: ViewerBelief,
): AudienceRestingBelief['evidence'] | undefined {
  const normalized = text.trim();
  if (EXPLICIT_REST_INTENT.test(normalized)) return 'explicit-rest-intent';
  if (FAREWELL.test(normalized)) return 'farewell';
  if (existing?.restIntentAt && REST_SEQUENCE.test(normalized)) {
    return existing.restIntentEvidence ?? 'farewell';
  }
  return undefined;
}

/**
 * Session-scoped epistemic ledger. It records what a viewer actually said and
 * derives only a reversible "likely resting" belief. A later ordinary message
 * is stronger evidence and immediately invalidates the belief.
 */
export class AudienceAwarenessLedger {
  private readonly beliefs = new Map<string, ViewerBelief>();

  clear() {
    this.beliefs.clear();
  }

  remove(viewer: AudienceIdentity) {
    const key = identityKey(viewer);
    if (key) this.beliefs.delete(key);
  }

  observeMessage(viewer: AudienceIdentity, text: string, at = Date.now()) {
    const key = identityKey(viewer);
    if (!key || !Number.isFinite(at)) return;
    const previous = this.beliefs.get(key);
    const restEvidence = classifyRestMessage(text, previous);
    const next: ViewerBelief = {
      ...previous,
      ...viewer,
      lastInteractionAt: at,
    };
    if (restEvidence) {
      next.restIntentAt = at;
      next.restIntentEvidence = restEvidence;
      next.contradictedAt = undefined;
    } else if (previous?.restIntentAt && at > previous.restIntentAt) {
      next.contradictedAt = at;
    }
    this.beliefs.set(key, next);
  }

  snapshot(input: {
    reportedAudienceCount: number;
    activeMembers: AudienceActivityMember[];
    at?: number;
  }): AudienceAwarenessSnapshot {
    const at = input.at ?? Date.now();
    const reportedAudienceCount = Number.isFinite(input.reportedAudienceCount)
      ? Math.max(0, Math.floor(input.reportedAudienceCount))
      : 0;
    const activeKeys = new Set(
      input.activeMembers
        .filter(
          (member) =>
            at - member.lastInteractionAt <= AUDIENCE_ACTIVE_WINDOW_MS,
        )
        .map(identityKey)
        .filter((key): key is string => Boolean(key)),
    );
    for (const [key, belief] of this.beliefs) {
      if (at - belief.lastInteractionAt <= AUDIENCE_ACTIVE_WINDOW_MS) {
        activeKeys.add(key);
      }
    }
    const restingCandidates = [...this.beliefs.entries()]
      .filter(([, belief]) => {
        if (!belief.restIntentAt) return false;
        if (belief.contradictedAt && belief.contradictedAt > belief.restIntentAt) {
          return false;
        }
        return at - belief.restIntentAt <= REST_INTENT_TTL_MS;
      })
      .map(([, belief]) => ({
        id: belief.id,
        name: belief.name,
        platform: belief.platform,
        lastInteractionAt: belief.lastInteractionAt,
        restIntentAt: belief.restIntentAt!,
        evidence: belief.restIntentEvidence ?? 'farewell',
      }));
    const likelyRestingMembers = restingCandidates.filter((member) => {
      const key = identityKey(member);
      return reportedAudienceCount > 0 || Boolean(key && activeKeys.has(key));
    });
    const restingKeys = new Set(
      likelyRestingMembers
        .map(identityKey)
        .filter((key): key is string => Boolean(key)),
    );
    const engageableAudienceCount = [...activeKeys].filter(
      (key) => !restingKeys.has(key),
    ).length;
    const activeAudienceCount = activeKeys.size;
    const mode: AudienceActivityMode = engageableAudienceCount
      ? 'active'
      : likelyRestingMembers.length
        ? 'likely-resting'
        : reportedAudienceCount > 0 || activeAudienceCount > 0
          ? 'passive'
          : 'empty';
    return {
      mode,
      reportedAudienceCount,
      activeAudienceCount,
      engageableAudienceCount,
      likelyRestingAudienceCount: likelyRestingMembers.length,
      likelyRestingMembers,
    };
  }
}
