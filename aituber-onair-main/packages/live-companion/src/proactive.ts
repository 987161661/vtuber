import type { LivePresenceTracker } from './presence.js';
import type {
  LiveEnvironmentEvent,
  LiveStreamSnapshot,
  ProactiveTalkDecision,
  ProactiveTalkPolicy,
  ProactiveTalkPrompt,
  ViewerPresenceState,
} from './types.js';

export const DEFAULT_PROACTIVE_TALK_POLICY: ProactiveTalkPolicy = {
  enabled: true,
  maxViewerCountForDirectAddress: 8,
  minQuietMs: 45_000,
  minViewerPresenceMs: 3 * 60_000,
  minViewerSilentMs: 3 * 60_000,
  viewerActiveWindowMs: 90_000,
  globalCooldownMs: 2 * 60_000,
  perViewerCooldownMs: 30 * 60_000,
  maxDirectAddressesPerStream: 3,
  maxProactiveTurnsPerStream: 12,
  allowGenericFill: true,
  environmentEventMaxAgeMs: 5 * 60_000,
};

export interface ProactiveTalkPlannerInput {
  stream: LiveStreamSnapshot;
  environmentEvents?: LiveEnvironmentEvent[];
}

export class ProactiveTalkPlanner {
  private readonly presence: LivePresenceTracker;
  private streamId?: string;
  private sequence = 0;
  private lastDeliveredAt?: number;
  private deliveredCount = 0;
  private directAddressCount = 0;
  private viewerLastAddressedAt = new Map<string, number>();
  private readonly policy: ProactiveTalkPolicy;

  constructor(
    presence: LivePresenceTracker,
    policy: Partial<ProactiveTalkPolicy> = {},
  ) {
    this.presence = presence;
    this.policy = { ...DEFAULT_PROACTIVE_TALK_POLICY, ...policy };
  }

  resetStream(streamId: string): void {
    this.streamId = streamId;
    this.sequence = 0;
    this.lastDeliveredAt = undefined;
    this.deliveredCount = 0;
    this.directAddressCount = 0;
    this.viewerLastAddressedAt.clear();
  }

  evaluate(input: ProactiveTalkPlannerInput): ProactiveTalkDecision | null {
    const { stream } = input;
    if (!this.policy.enabled) return null;
    if (this.streamId !== stream.streamId) this.resetStream(stream.streamId);
    if (this.deliveredCount >= this.policy.maxProactiveTurnsPerStream) {
      return null;
    }
    if (
      this.lastDeliveredAt !== undefined &&
      stream.now - this.lastDeliveredAt < this.policy.globalCooldownMs
    ) {
      return null;
    }

    const latestActivityAt = Math.max(
      stream.startedAt,
      stream.lastAudienceMessageAt ?? 0,
      stream.lastHostSpeechAt ?? 0,
    );
    const isQuiet = stream.now - latestActivityAt >= this.policy.minQuietMs;
    const event = pickEnvironmentEvent(
      input.environmentEvents ?? [],
      stream.now,
      this.policy.environmentEventMaxAgeMs,
    );
    const urgentEvent = event?.priority === 'urgent';
    if (!isQuiet && !urgentEvent) return null;

    if (
      stream.viewerCount <= this.policy.maxViewerCountForDirectAddress &&
      this.directAddressCount < this.policy.maxDirectAddressesPerStream
    ) {
      const viewer = this.pickSilentViewer(stream.now);
      if (viewer) return this.createViewerDecision(stream, viewer, event);
    }

    if (event) return this.createEnvironmentDecision(stream, event);
    if (!this.policy.allowGenericFill) return null;
    return this.createFillDecision(stream);
  }

  markDelivered(decision: ProactiveTalkDecision, deliveredAt: number): void {
    this.lastDeliveredAt = deliveredAt;
    this.deliveredCount += 1;
    if (decision.targetViewerId) {
      this.directAddressCount += 1;
      this.viewerLastAddressedAt.set(decision.targetViewerId, deliveredAt);
    }
  }

  private pickSilentViewer(now: number): ViewerPresenceState | undefined {
    return this.presence
      .getSilentViewers({
        now,
        minPresenceMs: this.policy.minViewerPresenceMs,
        minSilentMs: this.policy.minViewerSilentMs,
        activeWindowMs: this.policy.viewerActiveWindowMs,
      })
      .find((state) => {
        const lastAddressedAt = this.viewerLastAddressedAt.get(state.viewer.id);
        return (
          lastAddressedAt === undefined ||
          now - lastAddressedAt >= this.policy.perViewerCooldownMs
        );
      });
  }

  private createViewerDecision(
    stream: LiveStreamSnapshot,
    state: ViewerPresenceState,
    event?: LiveEnvironmentEvent,
  ): ProactiveTalkDecision {
    const mayMentionName = state.viewer.mayMentionName === true;
    return {
      id: this.nextId(stream.now),
      kind: 'address-silent-viewer',
      reason: 'The room is quiet and a known viewer has stayed for a while.',
      createdAt: stream.now,
      targetViewerId: state.viewer.id,
      environmentEventId: event?.id,
      prompt: {
        intent: 'welcome-silent-viewer',
        targetViewer: {
          id: state.viewer.id,
          displayName: mayMentionName ? state.viewer.displayName : undefined,
          mayMentionName,
        },
        streamContext: {
          topic: stream.topic,
          segment: stream.segment,
          environmentSummary: event?.summary,
        },
        constraints: [
          'Be warm and brief.',
          'Ask an easy optional question related to the current stream.',
          'Never say that the viewer is being tracked, watched, or lurking.',
          'Do not pressure the viewer to reply.',
          mayMentionName
            ? 'The display name may be used once.'
            : 'Do not invent or mention a viewer name.',
        ],
      },
    };
  }

  private createEnvironmentDecision(
    stream: LiveStreamSnapshot,
    event: LiveEnvironmentEvent,
  ): ProactiveTalkDecision {
    return {
      id: this.nextId(stream.now),
      kind: 'react-to-environment',
      reason: `A speakable ${event.type} event occurred.`,
      createdAt: stream.now,
      environmentEventId: event.id,
      prompt: this.createBasePrompt(stream, 'react-to-environment', event),
    };
  }

  private createFillDecision(
    stream: LiveStreamSnapshot,
  ): ProactiveTalkDecision {
    return {
      id: this.nextId(stream.now),
      kind: 'fill-dead-air',
      reason: 'The stream has been quiet beyond the configured threshold.',
      createdAt: stream.now,
      prompt: this.createBasePrompt(stream, 'fill-dead-air'),
    };
  }

  private createBasePrompt(
    stream: LiveStreamSnapshot,
    intent: ProactiveTalkPrompt['intent'],
    event?: LiveEnvironmentEvent,
  ): ProactiveTalkPrompt {
    return {
      intent,
      streamContext: {
        topic: stream.topic,
        segment: stream.segment,
        environmentSummary: event?.summary,
      },
      constraints: [
        'Use one or two natural sentences.',
        'Connect to the current stream instead of changing topic abruptly.',
        'Avoid repeating a recent opener or catchphrase.',
      ],
    };
  }

  private nextId(now: number): string {
    return `proactive-${now}-${this.sequence++}`;
  }
}

function pickEnvironmentEvent(
  events: LiveEnvironmentEvent[],
  now: number,
  maxAgeMs: number,
): LiveEnvironmentEvent | undefined {
  const priority = { low: 0, normal: 1, high: 2, urgent: 3 } as const;
  return events
    .filter(
      (event) =>
        (event.expiresAt === undefined || event.expiresAt > now) &&
        event.occurredAt <= now &&
        now - event.occurredAt <= maxAgeMs,
    )
    .sort((left, right) => {
      const priorityDelta =
        priority[right.priority ?? 'normal'] -
        priority[left.priority ?? 'normal'];
      return priorityDelta || right.occurredAt - left.occurredAt;
    })[0];
}
