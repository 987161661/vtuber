import { describe, expect, it } from 'vitest';
import { createStatelessChatService } from '../../examples/react-purupuru-app/src/lib/statelessChatService';

describe('createStatelessChatService', () => {
  it('preserves the ChatServiceFactory static provider registry receiver', () => {
    expect(() =>
      createStatelessChatService('openai-compatible', {
        apiKey: 'test-key',
        model: 'test-model',
        endpoint: 'http://127.0.0.1:1/v1/chat/completions',
        tools: [],
      }),
    ).not.toThrow();
  });
});
