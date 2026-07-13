import { describe, expect, it } from 'vitest';
import {
  InMemoryLiveMemoryRepository,
  LiveMemoryManager,
} from '../src/index.js';

describe('LiveMemoryManager', () => {
  it('builds stream and viewer scoped five-dimensional context', async () => {
    let sequence = 0;
    const manager = new LiveMemoryManager(new InMemoryLiveMemoryRepository(), {
      now: () => 10_000,
      idFactory: () => `memory-${sequence++}`,
    });

    await manager.remember({
      dimension: 'working',
      content: 'The current segment is a speedrun attempt.',
      scope: { kind: 'stream', streamId: 'stream-a' },
      source: 'stream-event',
    });
    await manager.remember({
      dimension: 'episode',
      content: 'The audience celebrated the first boss clear.',
      scope: { kind: 'stream', streamId: 'stream-a' },
      source: 'chat',
      salience: 0.8,
    });
    await manager.remember({
      dimension: 'viewer',
      content: 'Mina prefers puzzle games and short questions.',
      scope: { kind: 'viewer', viewerId: 'viewer-mina' },
      source: 'chat',
    });
    await manager.remember({
      dimension: 'reflection',
      content: 'Explain the goal before a quiet gameplay segment.',
      scope: { kind: 'global' },
      source: 'reflection',
    });
    await manager.remember({
      dimension: 'persona',
      content: 'The host is curious, playful, and never pressures viewers.',
      scope: { kind: 'global' },
      source: 'host-note',
    });
    await manager.remember({
      dimension: 'viewer',
      content: 'Another viewer likes horror games.',
      scope: { kind: 'viewer', viewerId: 'viewer-other' },
      source: 'chat',
    });

    const prompt = await manager.buildPromptContext({
      streamId: 'stream-a',
      viewerId: 'viewer-mina',
    });

    expect(prompt).toContain('[Current live context]');
    expect(prompt).toContain('[Current stream timeline]');
    expect(prompt).toContain('[Viewer continuity]');
    expect(prompt).toContain('[Past stream reflections]');
    expect(prompt).toContain('[Character continuity]');
    expect(prompt).toContain('Mina prefers puzzle games');
    expect(prompt).not.toContain('Another viewer likes horror games');
  });

  it('expires volatile working memory and validates scopes', async () => {
    let now = 1_000;
    const manager = new LiveMemoryManager(new InMemoryLiveMemoryRepository(), {
      now: () => now,
      defaultWorkingTtlMs: 500,
    });
    await manager.remember({
      dimension: 'working',
      content: 'A poll is currently open.',
      scope: { kind: 'stream', streamId: 'stream-a' },
      source: 'stream-event',
    });

    expect(await manager.recall({ streamId: 'stream-a' })).toHaveLength(1);
    now = 1_501;
    expect(await manager.recall({ streamId: 'stream-a' })).toHaveLength(0);

    await expect(
      manager.remember({
        dimension: 'viewer',
        content: 'Invalid global viewer memory.',
        scope: { kind: 'global' },
        source: 'import',
      }),
    ).rejects.toThrow('viewer scope');
  });
});
