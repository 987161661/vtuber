export type SafetyModeration = 'none' | 'boundary' | 'local_mute';
export type SafetyAction = 'allow' | 'boundary' | 'local_mute';

export type SafetyViewer = {
  viewerId: string;
  viewerName?: string;
  sourceLabel?: string;
  score: number;
  mutedUntil?: number;
  lastSeenAt: number;
};

export type SafetyEvent = {
  id: string;
  at: number;
  eventId?: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  moderation: SafetyModeration;
  action: SafetyAction;
  reason: string;
  score?: number;
  mutedUntil?: number;
};

export type SafetyDecisionInput = {
  eventId?: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  moderation: SafetyModeration;
  reason?: string;
};

const TEN_MINUTES = 10 * 60_000;
const SCORE_DECAY_MS = 10 * 60_000;
const ESCALATE_BOUNDARY_SCORE = 4;

/**
 * Policy state only: it never guesses whether text is harmful. That semantic
 * judgement belongs to the director agent. This gateway turns that judgement
 * plus repeat behaviour into one auditable local broadcast action.
 */
export class LiveSafetyGateway {
  private readonly viewers = new Map<string, SafetyViewer>();
  private readonly events: SafetyEvent[] = [];

  evaluate(input: SafetyDecisionInput, now = Date.now()): SafetyEvent {
    const viewerId = input.viewerId?.trim();
    const existing = viewerId ? this.viewers.get(viewerId) : undefined;
    const elapsed = existing ? Math.max(0, now - existing.lastSeenAt) : 0;
    const decayedScore = existing
      ? Math.max(0, existing.score - Math.floor(elapsed / SCORE_DECAY_MS))
      : 0;
    const increment = input.moderation === 'local_mute'
      ? 5
      : input.moderation === 'boundary'
        ? 2
        : 0;
    const score = decayedScore + increment;
    const alreadyMuted = Boolean(existing?.mutedUntil && existing.mutedUntil > now);
    const shouldMute = Boolean(viewerId) && (
      alreadyMuted ||
      input.moderation === 'local_mute' ||
      (input.moderation === 'boundary' && score >= ESCALATE_BOUNDARY_SCORE)
    );
    const mutedUntil = shouldMute ? Math.max(existing?.mutedUntil ?? 0, now + TEN_MINUTES) : undefined;
    const action: SafetyAction = shouldMute
      ? 'local_mute'
      : input.moderation === 'boundary'
        ? 'boundary'
        : 'allow';
    if (viewerId) {
      this.viewers.set(viewerId, {
        viewerId,
        viewerName: input.viewerName || existing?.viewerName,
        sourceLabel: input.sourceLabel || existing?.sourceLabel,
        score,
        mutedUntil,
        lastSeenAt: now,
      });
    }
    const event: SafetyEvent = {
      id: crypto.randomUUID(), at: now, eventId: input.eventId, viewerId,
      viewerName: input.viewerName, sourceLabel: input.sourceLabel,
      moderation: input.moderation, action,
      reason: input.reason || 'director_safety_decision', score: viewerId ? score : undefined,
      mutedUntil,
    };
    this.events.unshift(event);
    this.events.splice(200);
    return event;
  }

  release(viewerId: string, now = Date.now()): SafetyEvent | undefined {
    const viewer = this.viewers.get(viewerId);
    if (!viewer) return undefined;
    viewer.mutedUntil = undefined;
    viewer.score = 0;
    viewer.lastSeenAt = now;
    const event: SafetyEvent = {
      id: crypto.randomUUID(), at: now, viewerId, viewerName: viewer.viewerName,
      sourceLabel: viewer.sourceLabel, moderation: 'none', action: 'allow',
      reason: 'operator_release', score: 0,
    };
    this.events.unshift(event);
    return event;
  }

  snapshot(now = Date.now()) {
    const viewers = [...this.viewers.values()]
      .filter((viewer) => viewer.mutedUntil && viewer.mutedUntil > now)
      .sort((left, right) => (right.mutedUntil ?? 0) - (left.mutedUntil ?? 0));
    return { viewers, events: this.events.slice(0, 40) };
  }
}
