export const LIVE_MEMORY_DIMENSIONS = [
  'working',
  'episode',
  'viewer',
  'reflection',
  'persona',
] as const;

/**
 * Five memory dimensions optimized for live streams.
 *
 * - working: volatile context for the current few minutes
 * - episode: durable timeline and notable moments in one stream
 * - viewer: per-viewer facts, preferences, and relationship continuity
 * - reflection: post-stream lessons and hypotheses for future streams
 * - persona: stable character voice, boundaries, lore, and recurring bits
 */
export type LiveMemoryDimension = (typeof LIVE_MEMORY_DIMENSIONS)[number];

export type LiveMemoryScope =
  | { kind: 'global' }
  | { kind: 'stream'; streamId: string }
  | { kind: 'viewer'; viewerId: string };

export type LiveMemorySource =
  | 'chat'
  | 'presence'
  | 'stream-event'
  | 'host-note'
  | 'reflection'
  | 'import';

export interface LiveMemoryRecord {
  id: string;
  dimension: LiveMemoryDimension;
  content: string;
  scope: LiveMemoryScope;
  source: LiveMemorySource;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  salience: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface LiveMemoryDraft {
  id?: string;
  dimension: LiveMemoryDimension;
  content: string;
  scope: LiveMemoryScope;
  source: LiveMemorySource;
  createdAt?: number;
  expiresAt?: number;
  salience?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface LiveMemoryQuery {
  dimensions?: LiveMemoryDimension[];
  streamId?: string;
  viewerId?: string;
  includeGlobal?: boolean;
  tagsAny?: string[];
  minSalience?: number;
  now?: number;
  limit?: number;
}

export interface LiveMemoryRepository {
  upsert(record: LiveMemoryRecord): Promise<void>;
  query(query?: LiveMemoryQuery): Promise<LiveMemoryRecord[]>;
  remove(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface LiveMemoryRetriever {
  retrieve(
    records: LiveMemoryRecord[],
    queryText: string,
    limit: number,
  ): Promise<LiveMemoryRecord[]>;
}

export interface LiveMemoryPromptOptions {
  streamId?: string;
  viewerId?: string;
  now?: number;
  maxRecordsPerDimension?: number;
  characterBudgetPerDimension?: Partial<Record<LiveMemoryDimension, number>>;
}

export type LivePlatform =
  | 'youtube'
  | 'twitch'
  | 'bilibili'
  | 'douyin'
  | 'web'
  | 'discord'
  | 'custom'
  | 'unknown';

export interface LiveViewerIdentity {
  id: string;
  displayName: string;
  platform: LivePlatform;
  /** The integration has a stable identity and may target this viewer. */
  addressable?: boolean;
  /** The viewer may be addressed by display name in generated speech. */
  mayMentionName?: boolean;
  /** Explicit opt-out for proactive attention. */
  doNotDisturb?: boolean;
  metadata?: Record<string, unknown>;
}

export type ViewerPresenceEvent =
  | {
      kind: 'join' | 'heartbeat';
      viewer: LiveViewerIdentity;
      at: number;
    }
  | {
      kind: 'chat';
      viewer: LiveViewerIdentity;
      at: number;
      message?: string;
    }
  | {
      kind: 'leave';
      viewerId: string;
      at: number;
    };

export interface ViewerPresenceState {
  viewer: LiveViewerIdentity;
  joinedAt: number;
  lastSeenAt: number;
  lastSpokeAt?: number;
  messageCount: number;
  present: boolean;
}

export interface SilentViewerQuery {
  now: number;
  minPresenceMs: number;
  minSilentMs: number;
  activeWindowMs: number;
}

export type LiveEnvironmentEventType =
  | 'topic-change'
  | 'scene-change'
  | 'milestone'
  | 'follow'
  | 'subscription'
  | 'gift'
  | 'raid'
  | 'game-state'
  | 'custom';

export interface LiveEnvironmentEvent {
  id: string;
  type: LiveEnvironmentEventType;
  occurredAt: number;
  summary: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface LiveStreamSnapshot {
  streamId: string;
  now: number;
  startedAt: number;
  viewerCount: number;
  lastAudienceMessageAt?: number;
  lastHostSpeechAt?: number;
  topic?: string;
  segment?: string;
}

export interface ProactiveTalkPrompt {
  intent: 'welcome-silent-viewer' | 'react-to-environment' | 'fill-dead-air';
  targetViewer?: {
    id: string;
    displayName?: string;
    mayMentionName: boolean;
  };
  streamContext: {
    topic?: string;
    segment?: string;
    environmentSummary?: string;
  };
  constraints: string[];
}

export interface ProactiveTalkDecision {
  id: string;
  kind: 'address-silent-viewer' | 'react-to-environment' | 'fill-dead-air';
  reason: string;
  createdAt: number;
  targetViewerId?: string;
  environmentEventId?: string;
  prompt: ProactiveTalkPrompt;
}

export interface ProactiveTalkPolicy {
  enabled: boolean;
  maxViewerCountForDirectAddress: number;
  minQuietMs: number;
  minViewerPresenceMs: number;
  minViewerSilentMs: number;
  viewerActiveWindowMs: number;
  globalCooldownMs: number;
  perViewerCooldownMs: number;
  maxDirectAddressesPerStream: number;
  maxProactiveTurnsPerStream: number;
  allowGenericFill: boolean;
  environmentEventMaxAgeMs: number;
}

export type AvatarActionKind =
  | 'expression'
  | 'motion'
  | 'gesture'
  | 'pose'
  | 'camera'
  | 'effect'
  | 'custom';

export interface EmotionSignal {
  name: string;
  intensity: number;
  valence?: number;
  arousal?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AvatarAction {
  kind: AvatarActionKind;
  name: string;
  intensity?: number;
  durationMs?: number;
  layer?: string;
  interrupt?: 'replace' | 'queue' | 'blend' | 'ignore-if-busy';
  parameters?: Record<string, unknown>;
}

export interface AvatarBehaviorEvent {
  protocolVersion: '1.0';
  id: string;
  occurredAt: number;
  source: 'assistant' | 'proactive-talk' | 'stream-event' | 'operator';
  emotion: EmotionSignal;
  actions: AvatarAction[];
  speechText?: string;
  targetViewerId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AvatarAdapterCapabilities {
  actionKinds: AvatarActionKind[] | '*';
  emotionNames?: string[] | '*';
}

export interface AvatarBehaviorAdapter {
  readonly id: string;
  readonly capabilities: AvatarAdapterCapabilities;
  canHandle?(event: AvatarBehaviorEvent): boolean;
  dispatch(event: AvatarBehaviorEvent): Promise<void>;
}

export interface AvatarDispatchReceipt {
  adapterId: string;
  status: 'delivered' | 'skipped' | 'failed';
  error?: unknown;
}

export interface EmotionBehaviorContext {
  streamId: string;
  source: AvatarBehaviorEvent['source'];
  speechText?: string;
  targetViewerId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/** Adapter point for project-specific emotion-to-action mapping. */
export interface EmotionBehaviorMapper {
  map(
    emotion: EmotionSignal,
    context: EmotionBehaviorContext,
  ): AvatarBehaviorEvent | Promise<AvatarBehaviorEvent>;
}

export type LiveHostPhase =
  | 'offline'
  | 'observing'
  | 'deliberating'
  | 'speaking'
  | 'cooldown'
  | 'recovering'
  | 'operator_hold';

export type LiveHostPriority = 'low' | 'normal' | 'high' | 'urgent';
export type LiveHostTurnKind =
  | 'viewer'
  | 'proactive'
  | 'engagement'
  | 'safety'
  | 'operator';

/**
 * Identity boundary for one coordinator session.
 *
 * Integrations which provide a scope get stale-event protection across
 * persona/stream switches. Scope remains optional on events for backwards
 * compatibility with existing unscoped integrations.
 */
export interface LiveHostScope {
  profileId: string;
  sessionId: string;
  streamId?: string;
}

export interface LiveHostTurn {
  eventId: string;
  kind: LiveHostTurnKind;
  priority: LiveHostPriority;
  createdAt: number;
  targetViewerId?: string;
  proactiveSource?: string;
  proactiveOpportunityId?: string;
  scope?: LiveHostScope;
}

export interface LiveHostPolicy {
  quietThresholdMs: number;
  proactiveCooldownMs: number;
  maxProactiveTurns: number;
  /** Minimum interval between spoken like acknowledgements across the room. */
  likeResponseCooldownMs: number;
}

export type LiveHostEvent = (
  | { type: 'stream-state'; at: number; isLive: boolean; eventId?: string }
  | (ViewerPresenceEvent & {
      type: 'viewer-presence';
      eventId?: string;
    })
  | {
      type: 'audience-message';
      at: number;
      eventId: string;
      viewerId?: string;
      priority?: LiveHostPriority;
    }
  | {
      type: 'engagement';
      at: number;
      eventId: string;
      viewerId?: string;
      priority?: LiveHostPriority;
      engagementKind: 'follow' | 'like' | 'gift' | 'superchat' | 'guard';
    }
  | {
      type: 'environment';
      at: number;
      eventId: string;
      priority: LiveHostPriority;
    }
  | {
      type: 'quiet-candidate';
      at: number;
      eventId: string;
      source: string;
      /** Stable identity of the quiet-room opportunity; defaults to eventId. */
      opportunityId?: string;
      /** Candidates which expire before selection are never prepared. */
      expiresAt?: number;
      prompt: string;
      busy: boolean;
    }
  | {
      type: 'generation';
      at: number;
      eventId: string;
      stage: 'started' | 'completed' | 'failed';
      turn: LiveHostTurn;
    }
  | {
      type: 'speech';
      at: number;
      eventId: string;
      stage:
        | 'started'
        | 'beat-completed'
        | 'completed'
        | 'interrupted'
        | 'failed';
      beatIndex?: number;
      interruptibleAfter?: boolean;
    }
  | {
      type: 'runtime-fault';
      at: number;
      eventId?: string;
      reasonCode: string;
    }
  | {
      type: 'operator-command';
      at: number;
      eventId?: string;
      command: 'takeover' | 'mute' | 'resume';
      isLive?: boolean;
    }
) & { scope?: LiveHostScope };

export interface LiveHostDecisionMetadata {
  /** Stable key for idempotent execution by an integration. */
  actionId?: string;
  /** Coordinator time at which this action was issued. */
  issuedAt?: number;
  /** Bound persona/session scope, when the integration supplied one. */
  scope?: LiveHostScope;
}

export type LiveHostDecisionPayload =
  | {
      kind: 'queue-audience-turn';
      eventId: string;
      targetViewerId?: string;
      priority: LiveHostPriority;
      reasonCode: string;
      /** Complete turn envelope for the queue consumer. */
      turn?: LiveHostTurn;
    }
  | {
      kind: 'prepare-reply';
      eventId: string;
      turnKind: LiveHostTurnKind;
      prompt?: string;
      reasonCode: string;
      /** Complete turn envelope for the generation consumer. */
      turn?: LiveHostTurn;
    }
  | {
      kind: 'speak-turn';
      eventId: string;
      reasonCode: string;
      /** Complete turn envelope for the speech queue consumer. */
      turn?: LiveHostTurn;
    }
  | {
      kind: 'interrupt';
      eventId?: string;
      mode: 'immediate' | 'beat-boundary';
      reasonCode: string;
      turn?: LiveHostTurn;
    }
  | {
      kind: 'drop';
      eventId?: string;
      reasonCode: string;
      turn?: LiveHostTurn;
    }
  | {
      kind: 'emit-avatar-intent';
      eventId: string;
      intent: 'observing' | 'speaking' | 'recovering';
      reasonCode: string;
    }
  | {
      kind: 'enter-recovery';
      eventId?: string;
      reasonCode: string;
      recoveryCount?: number;
    }
  | {
      kind: 'request-operator-attention';
      eventId?: string;
      reasonCode: string;
      severity?: 'warning' | 'critical';
      recoveryCount?: number;
    };

/** Backwards-compatible decision shape. New integrations should consume actions. */
export type LiveHostDecision = LiveHostDecisionPayload &
  LiveHostDecisionMetadata;

type RequireTurnForExecutableAction<T> = T extends {
  kind: 'queue-audience-turn' | 'prepare-reply' | 'speak-turn';
}
  ? Omit<T, 'turn'> & { turn: LiveHostTurn }
  : T extends { kind: 'enter-recovery' }
    ? Omit<T, 'recoveryCount'> & { recoveryCount: number }
    : T extends { kind: 'request-operator-attention' }
      ? Omit<T, 'severity' | 'recoveryCount'> & {
          severity: 'warning' | 'critical';
          recoveryCount: number;
        }
      : T;

/**
 * Fully executable coordinator output. `dispatch` always returns this shape.
 * The legacy `LiveHostDecision` name remains available to existing consumers.
 */
export type LiveHostAction =
  RequireTurnForExecutableAction<LiveHostDecisionPayload> & {
    actionId: string;
    issuedAt: number;
    scope?: LiveHostScope;
  };

export interface LiveHostSnapshot {
  phase: LiveHostPhase;
  scope?: LiveHostScope;
  activeTurn?: LiveHostTurn;
  pendingTurnCount?: number;
  readyTurnIds?: string[];
  pendingInterruptEventId?: string;
  lastAudienceActivityAt: number;
  lastHostSpeechAt: number;
  proactiveDeliveredCount: number;
  proactiveRemaining: number;
  nextProactiveAt: number;
  lastProactiveSource?: string;
  lastProactiveOpportunityId?: string;
  recoveryCount: number;
  currentBeatIndex?: number;
  currentBeatInterruptible: boolean;
  lastDecisionReason: string;
}
