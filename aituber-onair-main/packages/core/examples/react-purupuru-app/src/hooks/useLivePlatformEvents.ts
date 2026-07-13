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
    let releaseLock: (() => void) | null = null;
    let retryTimer = 0;
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

    if (navigator.locks) {
      const acquireListenerLock = async () => {
        while (!cancelled) {
          let acquired = false;
          await navigator.locks.request(
            adapter.listenerLockName,
            { ifAvailable: true },
            async (lock) => {
              if (!lock || cancelled) return;
              acquired = true;
              connect();
              await new Promise<void>((resolve) => {
                releaseLock = resolve;
              });
            },
          );
          if (cancelled || acquired) return;
          onStatusRef.current?.({ state: 'standby' } as TStatus);
          await new Promise<void>((resolve) => {
            retryTimer = window.setTimeout(resolve, 2_000);
          });
        }
      };
      void acquireListenerLock();
    } else {
      connect();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(reconnectTimer);
      source?.close();
      releaseLock?.();
    };
  }, [adapter, clientKey, isEnabled]);
}
