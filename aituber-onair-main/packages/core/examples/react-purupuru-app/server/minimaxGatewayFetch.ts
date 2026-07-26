export interface MiniMaxGatewayFetchOptions {
  endpoint: string;
  init: RequestInit;
  timeoutMs: number;
  fetcher?: typeof fetch;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Retries exactly once at the provider boundary. Callers keep a single retry
 * budget instead of multiplying retries across routing and generation layers.
 */
export async function fetchMinimaxWithRetry({
  endpoint,
  init,
  timeoutMs,
  fetcher = fetch,
}: MiniMaxGatewayFetchOptions): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(endpoint, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (attempt === 0 && isTransientStatus(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('minimax_upstream_unreachable');
}
