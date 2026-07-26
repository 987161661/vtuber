import { describe, expect, it } from 'vitest';
import { resolveMinimaxUpstreamEndpoint } from '../../examples/react-purupuru-app/server/minimaxGatewayRouting';

describe('MiniMax gateway routing', () => {
  it('routes the model preflight probe to the provider model catalog', () => {
    expect(resolveMinimaxUpstreamEndpoint('GET', '/models')).toBe(
      'https://api.minimaxi.com/v1/models',
    );
  });

  it('keeps generation requests on chat completions', () => {
    expect(resolveMinimaxUpstreamEndpoint('POST', '/')).toBe(
      'https://api.minimaxi.com/v1/chat/completions',
    );
  });
});
