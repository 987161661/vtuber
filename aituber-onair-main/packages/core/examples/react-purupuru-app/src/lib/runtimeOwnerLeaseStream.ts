import type {
  RuntimeOwnerHeartbeatIdentity,
  RuntimeOwnerHeartbeatResult,
} from './runtimeOwnerHeartbeatWorker';

export type RuntimeOwnerEventSourceLike = {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
};

type RuntimeOwnerLeaseStreamOptions = {
  endpoint: string;
  identity: RuntimeOwnerHeartbeatIdentity;
  createEventSource(url: string): RuntimeOwnerEventSourceLike;
  onResult(result: RuntimeOwnerHeartbeatResult): void;
};

/**
 * Keeps the lease on a server-timed stream. OBS may freeze every browser
 * timer, including Worker timers, but it leaves an open HTTP connection alive.
 */
export function startRuntimeOwnerLeaseStream(
  options: RuntimeOwnerLeaseStreamOptions,
): () => void {
  const url = new URL(options.endpoint);
  url.searchParams.set('ownerId', options.identity.ownerId);
  url.searchParams.set('label', options.identity.label);
  url.searchParams.set('role', options.identity.role);
  const source = options.createEventSource(url.href);
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      options.onResult({ type: 'result', ok: true, payload });
    } catch {
      options.onResult({ type: 'result', ok: false });
    }
  };
  source.onerror = () => {
    options.onResult({ type: 'result', ok: false });
  };
  return () => {
    source.onmessage = null;
    source.onerror = null;
    source.close();
  };
}
