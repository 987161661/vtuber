import type {
  SilentViewerQuery,
  ViewerPresenceEvent,
  ViewerPresenceState,
} from './types.js';

export class LivePresenceTracker {
  private viewers = new Map<string, ViewerPresenceState>();
  private streamId?: string;

  startStream(streamId: string): void {
    this.streamId = streamId;
    this.viewers.clear();
  }

  endStream(): void {
    this.streamId = undefined;
    this.viewers.clear();
  }

  observe(event: ViewerPresenceEvent): ViewerPresenceState | undefined {
    if (!this.streamId) {
      throw new Error('startStream must be called before observing viewers');
    }

    if (event.kind === 'leave') {
      const existing = this.viewers.get(event.viewerId);
      if (!existing) return undefined;
      existing.present = false;
      existing.lastSeenAt = Math.max(existing.lastSeenAt, event.at);
      return clonePresence(existing);
    }

    const existing = this.viewers.get(event.viewer.id);
    const state: ViewerPresenceState = existing ?? {
      viewer: { ...event.viewer },
      joinedAt: event.at,
      lastSeenAt: event.at,
      messageCount: 0,
      present: true,
    };
    state.viewer = { ...state.viewer, ...event.viewer };
    state.lastSeenAt = Math.max(state.lastSeenAt, event.at);
    state.present = true;
    if (event.kind === 'chat') {
      state.lastSpokeAt = Math.max(state.lastSpokeAt ?? 0, event.at);
      state.messageCount += 1;
    }
    this.viewers.set(event.viewer.id, state);
    return clonePresence(state);
  }

  getViewer(viewerId: string): ViewerPresenceState | undefined {
    const state = this.viewers.get(viewerId);
    return state ? clonePresence(state) : undefined;
  }

  getPresentViewers(
    now: number,
    activeWindowMs: number,
  ): ViewerPresenceState[] {
    return [...this.viewers.values()]
      .filter(
        (state) => state.present && now - state.lastSeenAt <= activeWindowMs,
      )
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(clonePresence);
  }

  getSilentViewers(query: SilentViewerQuery): ViewerPresenceState[] {
    return this.getPresentViewers(query.now, query.activeWindowMs)
      .filter((state) => {
        const silentSince = state.lastSpokeAt ?? state.joinedAt;
        return (
          state.viewer.addressable === true &&
          !state.viewer.doNotDisturb &&
          query.now - state.joinedAt >= query.minPresenceMs &&
          query.now - silentSince >= query.minSilentMs
        );
      })
      .sort((left, right) => {
        const leftNeverSpoke = left.lastSpokeAt === undefined ? 1 : 0;
        const rightNeverSpoke = right.lastSpokeAt === undefined ? 1 : 0;
        if (leftNeverSpoke !== rightNeverSpoke) {
          return rightNeverSpoke - leftNeverSpoke;
        }
        return left.joinedAt - right.joinedAt;
      });
  }
}

function clonePresence(state: ViewerPresenceState): ViewerPresenceState {
  return {
    ...state,
    viewer: {
      ...state.viewer,
      metadata: state.viewer.metadata
        ? { ...state.viewer.metadata }
        : undefined,
    },
  };
}
