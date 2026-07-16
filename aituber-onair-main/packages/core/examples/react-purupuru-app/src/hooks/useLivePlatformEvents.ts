import { useEffect, useRef } from 'react';
import type { LivePlatformEventAdapter } from '../services/live-platform/types';

interface UseLivePlatformEventsParams<TEvent, TStatus> {
  adapter: LivePlatformEventAdapter<TEvent, TStatus>;
  isEnabled: boolean;
  clientKey?: string;
  onEvent: (event: TEvent) => void;
  onStatus?: (status: TStatus) => void;
}

export function useLivePlatformEvents<TEvent, TStatus>({
  adapter,
  isEnabled,
  clientKey = 'browser-runtime',
  onEvent,
  onStatus,
}: UseLivePlatformEventsParams<TEvent, TStatus>): void {
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onEventRef.current = onEvent;
    onStatusRef.current = onStatus;
  }, [onEvent, onStatus]);

  useEffect(() => {
    if (!isEnabled) return;
    let source: EventSource | null = null;
    let reconnectTimer = 0;
    let cancelled = false;

    const handleRoomEvent = (event: MessageEvent<string>) => {
      try {
        if (event.lastEventId) {
          localStorage.setItem(adapter.cursorStorageKey, event.lastEventId);
        }
        const payload: unknown = JSON.parse(event.data);
        if (adapter.eventGuard && !adapter.eventGuard(payload)) {
          console.warn(`Invalid ${adapter.id} room event payload.`);
          return;
        }
        onEventRef.current(payload as TEvent);
      } catch (error) {
        console.warn(`Invalid ${adapter.id} room event.`, error);
      }
    };
    const handleStatus = (event: MessageEvent<string>) => {
      try {
        onStatusRef.current?.(JSON.parse(event.data) as TStatus);
      } catch (error) {
        console.warn(`Invalid ${adapter.id} room status.`, error);
      }
    };
    const connect = () => {
      if (cancelled) return;
      const lastEventId = localStorage.getItem(adapter.cursorStorageKey) || '';
      source = new EventSource(adapter.createEventUrl(clientKey, lastEventId));
      source.addEventListener(adapter.roomEventName, handleRoomEvent as EventListener);
      source.addEventListener(adapter.statusEventName, handleStatus as EventListener);
      source.onerror = () => {
        onStatusRef.current?.(adapter.disconnectedStatus);
        source?.close();
        source = null;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 1_000);
      };
    };

    // The local runtime-owner lease already elects exactly one candidate
    // across OBS and control pages. Browser Web Locks can be retained by a
    // non-owner page after a Vite reload, leaving the elected runtime with no
    // SSE subscription and silently dropping real platform events.
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [adapter, clientKey, isEnabled]);
}
