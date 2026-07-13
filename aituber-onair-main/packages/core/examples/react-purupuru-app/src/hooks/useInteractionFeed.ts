import { useCallback, useMemo, useState } from 'react';
import type { LiveLifecycleTransition } from '../lib/liveResponseScheduler';

const DEFAULT_LIMIT = 40;

/** A compact, latest-state view of every audience event observed this session. */
export type InteractionFeedItem = LiveLifecycleTransition & {
  updateCount: number;
};

export type InteractionFeedSummary = {
  pending: number;
  generated: number;
  filtered: number;
};

export function useInteractionFeed(limit = DEFAULT_LIMIT) {
  const [items, setItems] = useState<InteractionFeedItem[]>([]);

  const mergeTransition = useCallback(
    (
      current: InteractionFeedItem[],
      transition: LiveLifecycleTransition,
    ): InteractionFeedItem[] => {
      const previous = current.find((item) => item.eventId === transition.eventId);
      const next: InteractionFeedItem = {
        ...previous,
        ...transition,
        text: transition.text || previous?.text || '',
        viewerId: transition.viewerId ?? previous?.viewerId,
        viewerName: transition.viewerName ?? previous?.viewerName,
        sourcesSeen:
          transition.sourcesSeen.length > 0
            ? transition.sourcesSeen
            : (previous?.sourcesSeen ?? []),
        updateCount: (previous?.updateCount ?? 0) + 1,
      };
      return [
        next,
        ...current.filter((item) => item.eventId !== transition.eventId),
      ].slice(0, limit);
    },
    [limit],
  );

  const record = useCallback(
    (transition: LiveLifecycleTransition) => {
      setItems((current) => mergeTransition(current, transition));
    },
    [mergeTransition],
  );

  const restore = useCallback(
    (transitions: LiveLifecycleTransition[]) => {
      setItems((current) =>
        transitions.reduce(
          (next, transition) => mergeTransition(next, transition),
          current,
        ),
      );
    },
    [mergeTransition],
  );

  const summary = useMemo<InteractionFeedSummary>(
    () => ({
      pending: items.filter((item) =>
        ['received', 'queued', 'selected', 'speaking'].includes(item.stage),
      ).length,
      generated: items.filter((item) =>
        ['generated', 'speaking', 'done'].includes(item.stage),
      ).length,
      filtered: items.filter(
        (item) => item.stage === 'dropped' || item.stage === 'deduplicated',
      ).length,
    }),
    [items],
  );

  return { items, record, restore, summary };
}
