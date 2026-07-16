import {
  LiveHostCoordinator,
  type LiveHostAction,
  type LiveHostEvent,
  type LiveHostPolicy,
  type LiveHostScope,
  type LiveHostSnapshot,
} from '@aituber-onair/live-companion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useLiveHostCoordinator(
  policy: Partial<LiveHostPolicy>,
  scope?: LiveHostScope,
) {
  const scopeKey = scope
    ? `${scope.profileId}\u0000${scope.sessionId}\u0000${scope.streamId ?? ''}`
    : 'unscoped';
  const coordinator = useMemo(
    () => new LiveHostCoordinator(policy),
    // A persona/session change must create a clean execution authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey],
  );
  const speechPermissionsRef = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState<LiveHostAction[]>([]);
  const [snapshot, setSnapshot] = useState<LiveHostSnapshot>(() =>
    coordinator.snapshot(),
  );

  useEffect(() => {
    coordinator.updatePolicy(policy);
    speechPermissionsRef.current.clear();
    setPendingActions([]);
    setSnapshot(coordinator.snapshot());
  }, [coordinator, policy]);

  const dispatch = useCallback(
    (event: LiveHostEvent): LiveHostAction[] => {
      const scopedEvent =
        scope && !event.scope ? ({ ...event, scope } as LiveHostEvent) : event;
      const decisions = coordinator.dispatch(scopedEvent);
      for (const decision of decisions) {
        if (decision.kind === 'speak-turn') {
          speechPermissionsRef.current.add(decision.eventId);
        } else if (
          (decision.kind === 'drop' || decision.kind === 'interrupt') &&
          decision.eventId
        ) {
          speechPermissionsRef.current.delete(decision.eventId);
        }
      }
      const deferred = decisions.filter((decision) =>
        [
          'emit-avatar-intent',
          'enter-recovery',
          'request-operator-attention',
        ].includes(decision.kind),
      );
      if (deferred.length > 0) {
        setPendingActions((current) => {
          const byId = new Map(
            current.map((action) => [action.actionId, action]),
          );
          deferred.forEach((action) => byId.set(action.actionId, action));
          return [...byId.values()].slice(-64);
        });
      }
      setSnapshot(coordinator.snapshot());
      return decisions;
    },
    [coordinator, scope],
  );

  const claimSpeechPermission = useCallback(
    (eventId: string) => {
      if (!speechPermissionsRef.current.has(eventId)) return false;
      speechPermissionsRef.current.delete(eventId);
      return true;
    },
    [],
  );

  const acknowledgeActions = useCallback((actionIds: readonly string[]) => {
    if (actionIds.length === 0) return;
    const acknowledged = new Set(actionIds);
    setPendingActions((current) =>
      current.filter((action) => !acknowledged.has(action.actionId)),
    );
  }, []);

  return {
    dispatch,
    snapshot,
    claimSpeechPermission,
    pendingActions,
    acknowledgeActions,
  };
}
