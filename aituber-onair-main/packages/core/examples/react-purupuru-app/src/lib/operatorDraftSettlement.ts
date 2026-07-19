import type { LiveHostEvent } from '@aituber-onair/live-companion';
import type {
  OperatorQueueItem,
  PreparedSpeechPlan,
} from './operatorQueue';
import {
  transitionStoredTurn,
  type TurnEnvelopeV2,
  type TurnState,
} from './turnEnvelope';

export type OperatorDraftSettlementPorts = {
  mutateQueue: (
    eventId: string,
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  refreshQueue: () => Promise<unknown>;
  emitRuntimeEvent: (event: Record<string, unknown>) => void;
  dispatchLiveHostEvent: (event: LiveHostEvent) => unknown;
  incrementCoordinatorRecoveries: () => void;
};

export type OperatorDraftSettlementResult = {
  status: 'ready' | 'skipped' | 'scope-rejected';
};

function projectDurableTurn(
  input: {
    turns: Map<string, TurnEnvelopeV2>;
    item: OperatorQueueItem;
    state: TurnState;
    at: number;
    reason?: string;
  },
  emitRuntimeEvent: OperatorDraftSettlementPorts['emitRuntimeEvent'],
): void {
  try {
    transitionStoredTurn(
      input.turns,
      input.item.eventId,
      input.item.attemptId,
      input.state,
      input.at,
      input.reason,
    );
  } catch (error) {
    emitRuntimeEvent({
      eventId: input.item.eventId,
      attemptId: input.item.attemptId,
      stage: 'turn_projection_failed',
      at: input.at,
      reason: error instanceof Error ? error.message : String(error),
      durableState: input.state,
    });
  }
}

export async function settleOperatorDraft(
  input: {
    item: OperatorQueueItem;
    ownerId: string;
    reply: string;
    skills: string[];
    speechPlan?: PreparedSpeechPlan;
    scopeIsCurrent: boolean;
    turns: Map<string, TurnEnvelopeV2>;
    now?: () => number;
    noReplyToken?: string;
  },
  ports: OperatorDraftSettlementPorts,
): Promise<OperatorDraftSettlementResult> {
  const at = (input.now ?? Date.now)();
  const { item } = input;
  const turn = {
    eventId: item.eventId,
    kind: item.source.includes('quiet-room')
      ? ('proactive' as const)
      : ('viewer' as const),
    priority: 'normal' as const,
    createdAt: item.createdAt,
    targetViewerId: item.viewerId,
  };
  const refreshAfterCommit = () =>
    ports.refreshQueue().catch(() => undefined);

  if (!input.scopeIsCurrent) {
    const reason = 'scope_changed_before_draft_commit';
    await ports.mutateQueue(item.eventId, 'fail', {
      attemptId: item.attemptId,
      ownerId: input.ownerId,
      reason,
    });
    await refreshAfterCommit();
    projectDurableTurn(
      { turns: input.turns, item, state: 'failed', at, reason },
      ports.emitRuntimeEvent,
    );
    ports.emitRuntimeEvent({
      eventId: item.eventId,
      attemptId: item.attemptId,
      stage: 'failed',
      at,
      reason,
    });
    ports.dispatchLiveHostEvent({
      type: 'generation',
      at,
      eventId: item.eventId,
      stage: 'failed',
      turn,
    });
    return { status: 'scope-rejected' };
  }

  if (input.reply === (input.noReplyToken ?? '[[NO_REPLY]]')) {
    const reason = 'llm_no_reply';
    await ports.mutateQueue(item.eventId, 'skip', {
      attemptId: item.attemptId,
      ownerId: input.ownerId,
      reason,
    });
    await refreshAfterCommit();
    projectDurableTurn(
      { turns: input.turns, item, state: 'skipped', at, reason },
      ports.emitRuntimeEvent,
    );
    ports.emitRuntimeEvent({
      eventId: item.eventId,
      attemptId: item.attemptId,
      stage: 'dropped',
      at,
      text: item.text,
      source: item.source,
      sourceLabel: item.sourceLabel,
      viewerId: item.viewerId,
      viewerName: item.viewerName,
      sourcesSeen: item.sourcesSeen,
      reason,
    });
    ports.dispatchLiveHostEvent({
      type: 'generation',
      at,
      eventId: item.eventId,
      stage: 'failed',
      turn,
    });
    ports.incrementCoordinatorRecoveries();
    return { status: 'skipped' };
  }

  await ports.mutateQueue(item.eventId, 'ready', {
    attemptId: item.attemptId,
    reply: input.reply,
    skills: input.skills,
    speechPlan: input.speechPlan,
  });
  await refreshAfterCommit();
  projectDurableTurn(
    { turns: input.turns, item, state: 'ready', at },
    ports.emitRuntimeEvent,
  );
  ports.emitRuntimeEvent({
    eventId: item.eventId,
    attemptId: item.attemptId,
    stage: 'generated',
    at,
    text: item.text,
    source: item.source,
    sourceLabel: item.sourceLabel,
    viewerId: item.viewerId,
    viewerName: item.viewerName,
    sourcesSeen: item.sourcesSeen,
    preparedReply: input.reply,
    speechPlan: input.speechPlan,
    skills: input.skills,
  });
  return { status: 'ready' };
}
