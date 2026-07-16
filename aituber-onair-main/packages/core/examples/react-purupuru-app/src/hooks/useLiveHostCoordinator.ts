import {
  LiveHostCoordinator,
  type LiveHostDecision,
  type LiveHostEvent,
  type LiveHostPolicy,
  type LiveHostSnapshot,
} from '@aituber-onair/live-companion';
import { useCallback, useEffect, useState } from 'react';

const DISABLED_SNAPSHOT: LiveHostSnapshot = {
  phase: 'observing',
  lastAudienceActivityAt: 0,
  lastHostSpeechAt: 0,
  proactiveDeliveredCount: 0,
  proactiveRemaining: 12,
  nextProactiveAt: 0,
  recoveryCount: 0,
  currentBeatInterruptible: false,
  lastDecisionReason: 'host_coordinator_v2_disabled',
};

export function useLiveHostCoordinator(
  enabled: boolean,
  policy: Partial<LiveHostPolicy>,
) {
  const [coordinator] = useState(() => new LiveHostCoordinator(policy));
  const [snapshot, setSnapshot] = useState<LiveHostSnapshot>(() =>
    enabled ? coordinator.snapshot() : DISABLED_SNAPSHOT,
  );

  useEffect(() => {
    coordinator.updatePolicy(policy);
    if (enabled) setSnapshot(coordinator.snapshot());
  }, [coordinator, enabled, policy]);

  const dispatch = useCallback(
    (event: LiveHostEvent): LiveHostDecision[] => {
      if (!enabled) return [];
      const decisions = coordinator.dispatch(event);
      setSnapshot(coordinator.snapshot());
      return decisions;
    },
    [coordinator, enabled],
  );

  return { dispatch, snapshot };
}
