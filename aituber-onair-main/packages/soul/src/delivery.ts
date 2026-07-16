import type {
  OutcomeEventV1,
  SoulDecisionV1,
  SoulStateV1,
} from './contracts.js';
import { clamp, deepClone, unique } from './utils.js';

export function reserveSoulDecision(
  state: SoulStateV1,
  decision: SoulDecisionV1,
  now: number,
): SoulStateV1 {
  assertDecisionScope(state, decision);
  if (decision.expiresAt <= now)
    throw new Error('Cannot reserve an expired decision');
  if (
    state.delivery.committedDecisionIds.includes(decision.id) ||
    state.delivery.rolledBackDecisionIds.includes(decision.id)
  ) {
    throw new Error('Cannot reserve a finalized decision');
  }
  if (state.delivery.reservations[decision.id]) return deepClone(state);

  return {
    ...deepClone(state),
    version: state.version + 1,
    updatedAt: Math.max(state.updatedAt, now),
    delivery: {
      ...deepClone(state.delivery),
      reservations: {
        ...deepClone(state.delivery.reservations),
        [decision.id]: {
          decisionId: decision.id,
          action: decision.action,
          targetActorId: decision.targetActorId,
          reservedAt: now,
          expiresAt: decision.expiresAt,
        },
      },
    },
  };
}

export function applySoulOutcome(
  state: SoulStateV1,
  decision: SoulDecisionV1,
  outcome: OutcomeEventV1,
): SoulStateV1 {
  assertOutcome(state, decision, outcome);
  if (state.delivery.outcomeIds.includes(outcome.id)) return deepClone(state);
  if (outcome.status === 'spoken') {
    return commitSoulDecision(state, decision, outcome);
  }
  if (
    outcome.status === 'partial' ||
    outcome.status === 'interrupted' ||
    outcome.status === 'failed' ||
    outcome.status === 'skipped'
  ) {
    return rollbackSoulDecision(state, decision, outcome);
  }
  return recordProgressOutcome(state, outcome);
}

export function commitSoulDecision(
  state: SoulStateV1,
  decision: SoulDecisionV1,
  outcome: OutcomeEventV1,
): SoulStateV1 {
  assertOutcome(state, decision, outcome);
  if (outcome.status !== 'spoken') {
    throw new Error('Only a fully spoken outcome may commit a decision');
  }
  if (state.delivery.committedDecisionIds.includes(decision.id)) {
    return addOutcomeId(state, outcome);
  }
  if (!state.delivery.reservations[decision.id]) {
    throw new Error('Decision must be reserved before it can be committed');
  }
  const reservations = { ...deepClone(state.delivery.reservations) };
  delete reservations[decision.id];
  return {
    ...deepClone(state),
    version: state.version + 1,
    updatedAt: Math.max(state.updatedAt, outcome.occurredAt),
    lastActionAt: outcome.occurredAt,
    ctaFatigue:
      decision.action === 'invite-support'
        ? clamp(state.ctaFatigue + 0.45)
        : state.ctaFatigue,
    delivery: {
      reservations,
      committedDecisionIds: unique([
        ...state.delivery.committedDecisionIds,
        decision.id,
      ]),
      rolledBackDecisionIds: [...state.delivery.rolledBackDecisionIds],
      outcomeIds: unique([...state.delivery.outcomeIds, outcome.id]),
    },
  };
}

export function rollbackSoulDecision(
  state: SoulStateV1,
  decision: SoulDecisionV1,
  outcome: OutcomeEventV1,
): SoulStateV1 {
  assertOutcome(state, decision, outcome);
  if (outcome.status === 'spoken') {
    throw new Error('A spoken decision cannot be rolled back');
  }
  if (state.delivery.rolledBackDecisionIds.includes(decision.id)) {
    return addOutcomeId(state, outcome);
  }
  const reservations = { ...deepClone(state.delivery.reservations) };
  delete reservations[decision.id];
  return {
    ...deepClone(state),
    version: state.version + 1,
    updatedAt: Math.max(state.updatedAt, outcome.occurredAt),
    delivery: {
      reservations,
      committedDecisionIds: [...state.delivery.committedDecisionIds],
      rolledBackDecisionIds: unique([
        ...state.delivery.rolledBackDecisionIds,
        decision.id,
      ]),
      outcomeIds: unique([...state.delivery.outcomeIds, outcome.id]),
    },
  };
}

function recordProgressOutcome(
  state: SoulStateV1,
  outcome: OutcomeEventV1,
): SoulStateV1 {
  return {
    ...deepClone(state),
    version: state.version + 1,
    updatedAt: Math.max(state.updatedAt, outcome.occurredAt),
    delivery: {
      ...deepClone(state.delivery),
      outcomeIds: unique([...state.delivery.outcomeIds, outcome.id]),
    },
  };
}

function addOutcomeId(
  state: SoulStateV1,
  outcome: OutcomeEventV1,
): SoulStateV1 {
  if (state.delivery.outcomeIds.includes(outcome.id)) return deepClone(state);
  return {
    ...deepClone(state),
    delivery: {
      ...deepClone(state.delivery),
      outcomeIds: [...state.delivery.outcomeIds, outcome.id],
    },
  };
}

function assertDecisionScope(
  state: SoulStateV1,
  decision: SoulDecisionV1,
): void {
  if (
    state.scope.personaId !== decision.scope.personaId ||
    state.scope.platform !== decision.scope.platform ||
    state.scope.roomId !== decision.scope.roomId ||
    state.scope.sessionId !== decision.scope.sessionId
  ) {
    throw new Error('Decision scope does not match soul state');
  }
}

function assertOutcome(
  state: SoulStateV1,
  decision: SoulDecisionV1,
  outcome: OutcomeEventV1,
): void {
  assertDecisionScope(state, decision);
  if (outcome.decisionId !== decision.id) {
    throw new Error('Outcome decisionId does not match decision');
  }
  if (
    outcome.scope.personaId !== state.scope.personaId ||
    outcome.scope.platform !== state.scope.platform ||
    outcome.scope.roomId !== state.scope.roomId ||
    outcome.scope.sessionId !== state.scope.sessionId
  ) {
    throw new Error('Outcome scope does not match soul state');
  }
}
