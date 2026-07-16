import { describe, expect, it } from 'vitest';
import {
  relationshipIdentityKey,
  relationshipSignalAffinity,
  relationshipStorageKey,
} from '../examples/react-purupuru-app/src/hooks/useLiveDirector';

describe('viewer relationship isolation', () => {
  it('isolates the same viewer id by profile and platform', () => {
    expect(relationshipStorageKey('linglan')).not.toBe(
      relationshipStorageKey('another-host'),
    );
    expect(
      relationshipIdentityKey({ id: '42', platform: 'bilibili' }),
    ).not.toBe(relationshipIdentityKey({ id: '42', platform: 'youtube' }));
  });

  it('does not buy long-term affinity with support events', () => {
    for (const signal of [
      'follow',
      'like',
      'gift',
      'superchat',
      'guard',
    ] as const) {
      expect(relationshipSignalAffinity(signal)).toBe(0);
    }
    expect(relationshipSignalAffinity('constructive')).toBeGreaterThan(0);
  });
});
