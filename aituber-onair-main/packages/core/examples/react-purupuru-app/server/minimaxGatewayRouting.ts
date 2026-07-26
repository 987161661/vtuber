const MINIMAX_CHAT_COMPLETIONS_ENDPOINT =
  'https://api.minimaxi.com/v1/chat/completions';
const MINIMAX_MODELS_ENDPOINT = 'https://api.minimaxi.com/v1/models';

export function resolveMinimaxUpstreamEndpoint(
  method: string | undefined,
  mountedPath: string | undefined,
): string {
  const pathname = new URL(
    mountedPath || '/',
    'http://minimax-gateway.local',
  ).pathname;
  if ((method || 'GET').toUpperCase() === 'GET' && pathname === '/models') {
    return MINIMAX_MODELS_ENDPOINT;
  }
  return MINIMAX_CHAT_COMPLETIONS_ENDPOINT;
}
