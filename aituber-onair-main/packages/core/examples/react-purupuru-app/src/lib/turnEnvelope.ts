export type TurnState =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'spoken'
  | 'skipped'
  | 'failed';

export type TurnScope = {
  personaId: string;
  platform: string;
  roomId: string;
  sessionId: string;
};

export type TurnFactSnapshot = {
  kind: 'city-report';
  city: string;
  queryTime?: string;
  allowedNumbers: string[];
  sourceNames: string[];
};

export type TurnEnvelopeV2 = {
  version: 2;
  eventId: string;
  attemptId: string;
  source: string;
  sourceLabel?: string;
  viewerId?: string;
  viewerName?: string;
  scope: TurnScope;
  input: string;
  intent?: string;
  factSnapshot?: TurnFactSnapshot;
  createdAt: number;
  updatedAt: number;
  preparingAt?: number;
  readyAt?: number;
  speakingAt?: number;
  completedAt?: number;
  state: TurnState;
  outcomeReason?: string;
};

const ALLOWED_TRANSITIONS: Record<TurnState, readonly TurnState[]> = {
  pending: ['preparing', 'skipped', 'failed'],
  preparing: ['ready', 'skipped', 'failed'],
  ready: ['speaking', 'skipped', 'failed'],
  speaking: ['spoken', 'skipped', 'failed'],
  spoken: [],
  skipped: [],
  failed: [],
};

export function createAttemptId(eventId: string, attempt = 1): string {
  return `${eventId}:attempt:${attempt}`;
}

export function createTurnEnvelopeV2(input: {
  eventId: string;
  attemptId?: string;
  source: string;
  sourceLabel?: string;
  viewerId?: string;
  viewerName?: string;
  scope?: TurnScope;
  text: string;
  intent?: string;
  factSnapshot?: TurnFactSnapshot;
  createdAt?: number;
}): TurnEnvelopeV2 {
  const createdAt = input.createdAt ?? Date.now();
  return {
    version: 2,
    eventId: input.eventId,
    attemptId: input.attemptId ?? createAttemptId(input.eventId),
    source: input.source,
    sourceLabel: input.sourceLabel,
    viewerId: input.viewerId,
    viewerName: input.viewerName,
    scope: input.scope ?? {
      personaId: 'unknown',
      platform: input.source,
      roomId: 'unknown',
      sessionId: 'unknown',
    },
    input: input.text,
    intent: input.intent,
    factSnapshot: input.factSnapshot,
    createdAt,
    updatedAt: createdAt,
    state: 'pending',
  };
}

export function transitionTurn(
  envelope: TurnEnvelopeV2,
  state: TurnState,
  at = Date.now(),
  outcomeReason?: string,
): TurnEnvelopeV2 {
  if (envelope.state === state) return envelope;
  if (!ALLOWED_TRANSITIONS[envelope.state].includes(state)) {
    throw new Error(`invalid_turn_transition:${envelope.state}->${state}`);
  }
  return {
    ...envelope,
    state,
    updatedAt: at,
    outcomeReason,
    preparingAt: state === 'preparing' ? at : envelope.preparingAt,
    readyAt: state === 'ready' ? at : envelope.readyAt,
    speakingAt: state === 'speaking' ? at : envelope.speakingAt,
    completedAt:
      state === 'spoken' || state === 'skipped' || state === 'failed'
        ? at
        : envelope.completedAt,
  };
}

export function matchesTurnAttempt(
  envelope: Pick<TurnEnvelopeV2, 'eventId' | 'attemptId'> | undefined,
  eventId: string | undefined,
  attemptId: string | undefined,
): boolean {
  return Boolean(
    envelope &&
      eventId &&
      attemptId &&
      envelope.eventId === eventId &&
      envelope.attemptId === attemptId,
  );
}

export function transitionStoredTurn(
  store: Map<string, TurnEnvelopeV2>,
  eventId: string,
  attemptId: string,
  state: TurnState,
  at = Date.now(),
  outcomeReason?: string,
): TurnEnvelopeV2 {
  const current = store.get(eventId);
  if (!matchesTurnAttempt(current, eventId, attemptId)) {
    throw new Error(`stale_turn_attempt:${eventId}:${attemptId}`);
  }
  const next = transitionTurn(current!, state, at, outcomeReason);
  store.set(eventId, next);
  return next;
}
