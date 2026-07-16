import {
  hashSoulState,
  type SoulEventV1,
  type SoulStateV1,
} from '@aituber-onair/soul';
import type {
  SoulInspectorDecisionView,
  SoulInspectorEventView,
  SoulInspectorOutcomeView,
  SoulInspectorStateView,
  SoulInspectorTelemetryView,
  SoulInspectorMemoryRefView,
} from '../components/SoulInspectorPanel';
import { LINGLAN_SOUL_PROFILE } from './linglanSoul';
import type { SoulTurnEvaluationV1 } from './soulRuntimeClient';

export interface SoulInspectorTraceV1 {
  state: SoulInspectorStateView;
  event: SoulInspectorEventView;
  decision: SoulInspectorDecisionView;
  outcome?: SoulInspectorOutcomeView;
  telemetry: SoulInspectorTelemetryView;
  memoryRefs: readonly SoulInspectorMemoryRefView[];
}

export function projectSoulEvaluation(
  evaluation: SoulTurnEvaluationV1,
  event: SoulEventV1,
): SoulInspectorTraceV1 {
  const labels = new Map(
    LINGLAN_SOUL_PROFILE.goals.map((goal) => [goal.id, goal.label]),
  );
  return {
    state: projectSoulState(evaluation.state, labels),
    event: {
      id: event.id,
      kind: event.kind,
      evidenceLevel: event.evidenceLevel,
      provenance: event.provenance,
      occurredAt: event.occurredAt,
      actorLabel: event.actor?.displayName ?? event.actor?.id,
      summary: eventSummary(event),
    },
    decision: {
      id: evaluation.decision.id,
      action: evaluation.decision.action,
      truthMode: evaluation.decision.truthMode,
      utility: evaluation.decision.utility,
      selectedCandidateId: evaluation.decision.selectedCandidateId,
      goalsServed: evaluation.decision.goalsServed,
      reasonCodes: evaluation.decision.reasonCodes,
      candidateScores: evaluation.decision.candidateScores.map((score) => ({
        ...score,
        label: evaluation.proposal.candidates.find(
          (candidate) => candidate.id === score.candidateId,
        )?.action,
      })),
      internalAffect: stripAffectCauses(evaluation.decision.internalAffect),
      expressedAffect: stripAffectCauses(evaluation.decision.expressedAffect),
      createdAt: evaluation.decision.createdAt,
      expiresAt: evaluation.decision.expiresAt,
    },
    telemetry: {
      modelProfileId: evaluation.meta.modelProfileId,
      firstContentMs: evaluation.meta.firstContentLatencyMs,
      totalMs: evaluation.meta.latencyMs,
      fastPathMs: evaluation.meta.latencyMs,
      fallback: evaluation.meta.fallback,
      fallbackReason: evaluation.meta.fallbackReason,
    },
    memoryRefs: evaluation.frame.memories.map((memory) => ({
      id: memory.id,
      provenance: memory.provenance,
      confidence: memory.confidence,
    })),
  };
}

export function projectSoulState(
  state: SoulStateV1,
  providedLabels?: ReadonlyMap<string, string>,
): SoulInspectorStateView {
  const labels =
    providedLabels ??
    new Map(LINGLAN_SOUL_PROFILE.goals.map((goal) => [goal.id, goal.label]));
  return {
    version: state.version,
    stateHash: hashSoulState(state),
    constitutionHash: state.constitutionHash,
    updatedAt: state.updatedAt,
    focusLabel: state.focus.topic ?? state.focus.currentGoalId,
    goals: Object.values(state.goals).map((goal) => ({
      ...goal,
      label: labels.get(goal.id),
    })),
    affect: stripAffectCauses(state.affect),
    lastAppraisal: state.lastAppraisal
      ? {
          goalCongruence: state.lastAppraisal.goalCongruence,
          identityRespect: state.lastAppraisal.identityRespect,
          novelty: state.lastAppraisal.novelty,
          controllability: state.lastAppraisal.controllability,
          socialEvaluation: state.lastAppraisal.socialEvaluation,
          certainty: state.lastAppraisal.certainty,
          attentionCompetition: state.lastAppraisal.attentionCompetition,
          reasonCodes: state.lastAppraisal.reasonCodes,
        }
      : null,
  };
}

function stripAffectCauses(
  affect: SoulTurnEvaluationV1['state']['affect'],
) {
  return {
    valence: affect.valence,
    arousal: affect.arousal,
    dominance: affect.dominance,
    joy: affect.joy,
    anger: affect.anger,
    boredom: affect.boredom,
    jealousy: affect.jealousy,
  };
}

function eventSummary(event: SoulEventV1): string {
  const text = event.data.text;
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 180);
  if (event.kind === 'silence-tick') {
    const duration = Number(event.data.durationMs || 0);
    return `直播间持续安静 ${Math.max(0, Math.round(duration / 1_000))} 秒`;
  }
  return `${event.kind} 事件已写入带来源账本`;
}
