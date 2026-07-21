import { describe, expect, it } from 'vitest';
import { resolveClientChunk } from '../../examples/react-purupuru-app/clientChunkStrategy';

describe('client chunk strategy', () => {
  it.each([
    ['D:/repo/node_modules/react-dom/client.js', 'react-runtime'],
    ['D:/repo/node_modules/react/index.js', 'react-runtime'],
    ['D:/repo/node_modules/scheduler/index.js', 'react-runtime'],
    ['D:/repo/packages/chat/dist/esm/index.js', 'chat-runtime'],
    ['D:/repo/packages/chat/src/index.ts', 'chat-runtime'],
    ['D:/repo/packages/soul/dist/model.js', 'soul-runtime'],
    ['D:/repo/packages/soul/src/model.ts', 'soul-runtime'],
    ['D:/repo/packages/manneri/dist/index.js', 'host-runtime'],
    [
      'D:/repo/packages/comment-intelligence/dist/createCommentIntelligence.js',
      'host-runtime',
    ],
    ['D:/repo/packages/live-companion/dist/coordinator.js', 'host-runtime'],
    ['D:/repo/packages/live-companion/src/coordinator.ts', 'host-runtime'],
    [
      'D:/repo/packages/core/examples/react-purupuru-app/src/config/characterProfile.ts',
      'profile-runtime',
    ],
    [
      'D:/repo/packages/core/examples/react-purupuru-app/src/lib/purupuruRenderer.ts',
      'avatar-runtime',
    ],
  ])('maps %s to %s', (id, expected) => {
    expect(resolveClientChunk(id)).toBe(expected);
  });

  it('does not collapse the application root, core, or lazy voice modules', () => {
    expect(
      resolveClientChunk(
        'D:/repo/packages/core/examples/react-purupuru-app/src/App.tsx',
      ),
    ).toBeUndefined();
    expect(
      resolveClientChunk('D:/repo/packages/core/dist/core/AITuberOnAirCore.js'),
    ).toBeUndefined();
    expect(
      resolveClientChunk(
        'D:/repo/packages/core/examples/react-purupuru-app/src/hooks/useSettings.ts',
      ),
    ).toBeUndefined();
    expect(
      resolveClientChunk(
        'D:/repo/packages/voice/dist/esm/services/VoiceEngineAdapter.js',
      ),
    ).toBeUndefined();
    expect(
      resolveClientChunk(
        'D:/repo/packages/voice/dist/esm/engines/VoiceEngineFactory.js',
      ),
    ).toBeUndefined();
  });

  it('normalizes Windows path separators', () => {
    expect(
      resolveClientChunk(
        'D:\\repo\\packages\\comment-intelligence\\dist\\index.js',
      ),
    ).toBe('host-runtime');
  });
});
