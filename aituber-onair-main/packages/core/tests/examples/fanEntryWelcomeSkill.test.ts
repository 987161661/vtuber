import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FAN_ENTRY_WELCOME_COOLDOWN_MS,
  createFanEntryWelcomeSkill,
  type FanEntryWelcomeInput,
} from '../../examples/react-purupuru-app/src/content-skills/fanEntryWelcome';
import {
  CONTENT_SKILLS,
  FAN_ENTRY_WELCOME_SKILL_ID,
} from '../../examples/react-purupuru-app/src/content-skills/registry';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function entry(
  overrides: Partial<FanEntryWelcomeInput> = {},
): FanEntryWelcomeInput {
  return {
    installed: true,
    hostId: 'host-1',
    viewerId: 'viewer-1',
    viewerName: '小雨',
    platform: 'bilibili',
    observedAt: 1_000_000,
    observation: {
      isNewPresence: true,
      estimatedAudience: 3,
      recentEntryCount: 1,
    },
    ...overrides,
  };
}

describe('fan entry welcome skill', () => {
  it('is registered and owns the application entry-welcome policy', () => {
    expect(CONTENT_SKILLS).toContainEqual(
      expect.objectContaining({ id: FAN_ENTRY_WELCOME_SKILL_ID }),
    );
    const appSource = readFileSync(
      new URL('../../examples/react-purupuru-app/src/App.tsx', import.meta.url),
      'utf8',
    );
    expect(appSource).toContain('fanEntryWelcomeSkill.prepare({');
    expect(appSource).not.toContain('shouldWelcomeViewerEntry(entryObservation)');
  });

  it('is controlled by the digital human skill installation', () => {
    const skill = createFanEntryWelcomeSkill({ storage: createStorage() });

    expect(skill.prepare(entry({ installed: false }))).toBeNull();
  });

  it('welcomes named ordinary viewers only while the room is small', () => {
    const skill = createFanEntryWelcomeSkill({ storage: createStorage() });

    expect(skill.prepare(entry())?.audienceKind).toBe('small-room-viewer');
    expect(
      skill.prepare(
        entry({
          viewerId: 'viewer-2',
          observation: {
            isNewPresence: true,
            estimatedAudience: 9,
            recentEntryCount: 1,
          },
        }),
      ),
    ).toBeNull();
  });

  it('welcomes verified fans in large rooms from either evidence adapter', () => {
    const skill = createFanEntryWelcomeSkill({ storage: createStorage() });
    const largeRoom = {
      isNewPresence: true,
      estimatedAudience: 500,
      recentEntryCount: 1,
    };

    expect(
      skill.prepare(
        entry({ observation: largeRoom, followObservedAt: 900_000 }),
      ),
    ).toMatchObject({
      audienceKind: 'fan',
      fanEvidence: 'observed-follow',
    });
    expect(
      skill.prepare(
        entry({
          viewerId: 'viewer-2',
          observation: largeRoom,
          metadata: {
            viewerRelation: 'fan',
            viewerRelationState: 'verified',
          },
        }),
      ),
    ).toMatchObject({
      audienceKind: 'fan',
      fanEvidence: 'verified-platform-relation',
    });
  });

  it('persists a per-host cooldown across repeated entry observations', () => {
    const storage = createStorage();
    const first = createFanEntryWelcomeSkill({ storage });
    const fanEntry = entry({ followObservedAt: 900_000 });

    expect(first.prepare(fanEntry)).not.toBeNull();
    expect(
      first.prepare({
        ...fanEntry,
        observedAt: fanEntry.observedAt + FAN_ENTRY_WELCOME_COOLDOWN_MS - 1,
      }),
    ).toBeNull();

    const restored = createFanEntryWelcomeSkill({ storage });
    expect(
      restored.prepare({
        ...fanEntry,
        observedAt: fanEntry.observedAt + FAN_ENTRY_WELCOME_COOLDOWN_MS,
      }),
    ).not.toBeNull();
    expect(
      restored.prepare({
        ...fanEntry,
        hostId: 'host-2',
        observedAt: fanEntry.observedAt + 1,
      }),
    ).not.toBeNull();
  });
});
