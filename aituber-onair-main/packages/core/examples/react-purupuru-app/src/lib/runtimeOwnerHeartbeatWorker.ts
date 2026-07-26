export type RuntimeOwnerHeartbeatIdentity = {
  ownerId: string;
  label: string;
  role: string;
};

export type RuntimeOwnerHeartbeatResult = {
  type: 'result';
  ok: boolean;
  payload?: Record<string, unknown>;
};

export type RuntimeOwnerHeartbeatWorkerLike = {
  onmessage:
    | ((event: MessageEvent<Record<string, unknown>>) => void)
    | null;
  postMessage(message: Record<string, unknown>): void;
  terminate(): void;
};

type RuntimeOwnerHeartbeatWorkerOptions = {
  createWorker(source: string): RuntimeOwnerHeartbeatWorkerLike;
  endpoint: string;
  heartbeatMs: number;
  identity: RuntimeOwnerHeartbeatIdentity;
  onResult(result: RuntimeOwnerHeartbeatResult): void;
};

const WORKER_SOURCE = `
let config = null;
let timer = 0;
let inFlight = false;

async function heartbeat() {
  if (!config || inFlight) return;
  inFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.identity),
      signal: controller.signal
    });
    const payload = response.ok ? await response.json() : undefined;
    self.postMessage({ type: 'result', ok: response.ok, payload });
  } catch {
    self.postMessage({ type: 'result', ok: false });
  } finally {
    clearTimeout(timeout);
    inFlight = false;
  }
}

self.onmessage = (event) => {
  if (event.data?.type !== 'start') return;
  config = event.data;
  clearInterval(timer);
  void heartbeat();
  timer = setInterval(heartbeat, Math.max(1000, config.heartbeatMs));
};
`;

/**
 * Runs lease renewal outside the iframe main thread. Chromium aggressively
 * throttles timers for visually hidden cross-origin frames, but a dedicated
 * worker can keep the server-side owner lease alive.
 */
export function startRuntimeOwnerHeartbeatWorker(
  options: RuntimeOwnerHeartbeatWorkerOptions,
): () => void {
  const worker = options.createWorker(WORKER_SOURCE);
  worker.onmessage = (event) => {
    const data = event.data;
    if (data?.type !== 'result' || typeof data.ok !== 'boolean') return;
    options.onResult({
      type: 'result',
      ok: data.ok,
      payload:
        data.payload && typeof data.payload === 'object'
          ? (data.payload as Record<string, unknown>)
          : undefined,
    });
  };
  worker.postMessage({
    type: 'start',
    endpoint: options.endpoint,
    heartbeatMs: options.heartbeatMs,
    identity: options.identity,
  });
  return () => {
    worker.onmessage = null;
    worker.terminate();
  };
}
