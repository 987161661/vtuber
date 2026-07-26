import { describe, expect, it } from 'vitest';
import { fetchMinimaxWithRetry } from '../../examples/react-purupuru-app/server/minimaxGatewayFetch';

describe('MiniMax gateway fetch', () => {
  it('retries one transient HTTP failure with the same request body', async () => {
    const bodies: string[] = [];
    const response = await fetchMinimaxWithRetry({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      init: {
        method: 'POST',
        body: '{"model":"MiniMax-M3"}',
      },
      timeoutMs: 1_000,
      fetcher: async (_input, init) => {
        bodies.push(String(init?.body));
        return bodies.length === 1
          ? new Response('temporary', { status: 502 })
          : new Response('ok', { status: 200 });
      },
    });

    expect(response.status).toBe(200);
    expect(bodies).toEqual([
      '{"model":"MiniMax-M3"}',
      '{"model":"MiniMax-M3"}',
    ]);
  });

  it('does not retry an authentication failure', async () => {
    let calls = 0;
    const response = await fetchMinimaxWithRetry({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      init: { method: 'POST' },
      timeoutMs: 1_000,
      fetcher: async () => {
        calls += 1;
        return new Response('unauthorized', { status: 401 });
      },
    });

    expect(response.status).toBe(401);
    expect(calls).toBe(1);
  });

  it('retries one connection failure and then returns the response', async () => {
    let calls = 0;
    const response = await fetchMinimaxWithRetry({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      init: { method: 'POST' },
      timeoutMs: 1_000,
      fetcher: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return new Response('ok', { status: 200 });
      },
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });
});
