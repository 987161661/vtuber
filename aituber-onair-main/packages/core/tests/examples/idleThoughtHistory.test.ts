import { describe, expect, it } from 'vitest';
import {
  loadIdleThoughtHistory,
  saveIdleThoughtHistory,
} from '../../examples/react-purupuru-app/src/lib/idleThoughtHistory';
import type { PersonaTopicEntry } from '../../examples/react-purupuru-app/src/lib/personaTopicLedger';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function topic(index: number): PersonaTopicEntry {
  return {
    topicFamily: `topic-${index}`,
    entities: [`entity-${index}`],
    drive: 'curiosity',
    source: 'memory',
    continuity: 'new',
    spokenAt: index * 1_000,
    audienceResponded: false,
    expressionMode: 'notice',
  };
}

describe('idle thought history', () => {
  it('restores only the latest bounded topic history for one persona', () => {
    const storage = createStorage();
    saveIdleThoughtHistory(
      storage,
      'linglan',
      Array.from({ length: 15 }, (_, index) => topic(index + 1)),
    );

    const restored = loadIdleThoughtHistory(storage, 'linglan');

    expect(restored).toHaveLength(12);
    expect(restored[0].topicFamily).toBe('topic-4');
    expect(loadIdleThoughtHistory(storage, 'another-persona')).toEqual([]);
  });

  it('treats malformed browser state as empty history', () => {
    const storage = createStorage();
    storage.setItem('aituber-idle-thought-history:linglan', '{broken');

    expect(loadIdleThoughtHistory(storage, 'linglan')).toEqual([]);
  });
});
