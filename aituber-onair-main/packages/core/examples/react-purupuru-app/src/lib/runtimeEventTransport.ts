export type RuntimeEventFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<unknown>;

export type RuntimeEventTransport = {
  emit: (
    event: Record<string, unknown>,
    headers: Record<string, string>,
  ) => void;
};

type PendingRuntimeEvent = {
  event: Record<string, unknown>;
  headers: Record<string, string>;
};

export function createRuntimeEventTransport(
  fetcher: RuntimeEventFetch,
  maximumConcurrentRequests = 2,
): RuntimeEventTransport {
  if (
    !Number.isInteger(maximumConcurrentRequests) ||
    maximumConcurrentRequests < 1
  ) {
    throw new Error(
      'maximum concurrent runtime event requests must be positive',
    );
  }

  const pending: PendingRuntimeEvent[] = [];
  let activeRequests = 0;
  let pendingHeartbeat: PendingRuntimeEvent | undefined;

  const pump = () => {
    while (activeRequests < maximumConcurrentRequests && pending.length > 0) {
      const item = pending.shift();
      if (!item) return;
      if (item === pendingHeartbeat) pendingHeartbeat = undefined;
      activeRequests += 1;
      void fetcher('/api/live-runtime-events', {
        method: 'POST',
        headers: item.headers,
        body: JSON.stringify(item.event),
      })
        .catch(() => undefined)
        .finally(() => {
          activeRequests -= 1;
          pump();
        });
    }
  };

  return {
    emit(event, headers) {
      if (event.stage === 'runtime-owner-heartbeat' && pendingHeartbeat) {
        pendingHeartbeat.event = event;
        pendingHeartbeat.headers = headers;
        return;
      }
      const item = { event, headers };
      pending.push(item);
      if (event.stage === 'runtime-owner-heartbeat') pendingHeartbeat = item;
      pump();
    },
  };
}
