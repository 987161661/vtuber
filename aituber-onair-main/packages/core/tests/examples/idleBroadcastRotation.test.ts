import { describe, expect, it } from 'vitest';
import {
  createIdleBroadcastRotationState,
  loadIdleBroadcastRotation,
  saveIdleBroadcastRotation,
  selectIdleBroadcastContent,
} from '../../examples/react-purupuru-app/src/lib/idleBroadcastRotation';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('idle broadcast rotation', () => {
  it('assigns eight of every ten idle opportunities to unique weather content', () => {
    let state = createIdleBroadcastRotationState();
    const selected = Array.from({ length: 100 }, () => {
      const result = selectIdleBroadcastContent(state);
      state = result.state;
      return result.content;
    });

    const weather = selected.filter(Boolean);
    expect(weather).toHaveLength(80);
    expect(weather.filter((item) => item?.kind === 'weather-joke')).toHaveLength(
      40,
    );
    expect(weather.filter((item) => item?.kind === 'weather-fact')).toHaveLength(
      40,
    );
    expect(new Set(weather.map((item) => item?.id)).size).toBe(80);
    expect(new Set(weather.map((item) => item?.text)).size).toBe(80);
  });

  it('persists used content ids so reloads cannot repeat a weather item', () => {
    const storage = createStorage();
    let state = createIdleBroadcastRotationState();
    const first = selectIdleBroadcastContent(state);
    state = first.state;
    saveIdleBroadcastRotation(storage, 'linglan', state);

    const restored = loadIdleBroadcastRotation(storage, 'linglan');
    const second = selectIdleBroadcastContent(restored);

    expect(first.content).not.toBeNull();
    expect(second.content).not.toBeNull();
    expect(second.content?.id).not.toBe(first.content?.id);
    expect(second.content?.text).not.toBe(first.content?.text);
  });
});
