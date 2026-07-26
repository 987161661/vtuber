import type { ViewerEntryObservation } from '../lib/viewerEntryWelcome';
import {
  buildViewerEntryWelcomePrompt,
  shouldWelcomeViewerEntry,
  type ViewerWelcomeRelationship,
} from '../lib/viewerEntryWelcome';
import { viewerFollowIdentityKey } from '../lib/viewerFollowRegistry';

export const FAN_ENTRY_WELCOME_COOLDOWN_MS = 30 * 60_000;
export const FAN_ENTRY_WELCOME_STORAGE_KEY =
  'aituber-fan-entry-welcome-cooldowns-v1';

type WelcomeStorage = Pick<Storage, 'getItem' | 'setItem'>;

type StoredWelcomeCooldowns = {
  version: 1;
  welcomedAtByIdentity: Record<string, number>;
};

export type FanEvidence =
  | 'observed-follow'
  | 'verified-platform-relation';

export type FanEntryWelcomeInput = {
  installed: boolean;
  hostId: string;
  viewerId: string;
  viewerName: string;
  platform: string;
  observedAt: number;
  observation: ViewerEntryObservation;
  followObservedAt?: number;
  metadata?: Record<string, unknown>;
  relationship?: ViewerWelcomeRelationship;
  viewerLocation?: string;
};

export type FanEntryWelcome = {
  prompt: string;
  audienceKind: 'fan' | 'small-room-viewer';
  fanEvidence?: FanEvidence;
};

function defaultStorage(): WelcomeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readStoredCooldowns(
  storage: WelcomeStorage | undefined,
): Map<string, number> {
  if (!storage) return new Map();
  try {
    const raw = storage.getItem(FAN_ENTRY_WELCOME_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Partial<StoredWelcomeCooldowns>;
    if (
      parsed.version !== 1 ||
      !parsed.welcomedAtByIdentity ||
      typeof parsed.welcomedAtByIdentity !== 'object'
    ) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed.welcomedAtByIdentity).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

function verifiedFanEvidence(input: {
  followObservedAt?: number;
  metadata?: Record<string, unknown>;
}): FanEvidence | undefined {
  if (
    typeof input.followObservedAt === 'number' &&
    Number.isFinite(input.followObservedAt)
  ) {
    return 'observed-follow';
  }
  return input.metadata?.viewerRelation === 'fan' &&
    input.metadata?.viewerRelationState === 'verified'
    ? 'verified-platform-relation'
    : undefined;
}

function cooldownIdentity(input: {
  hostId: string;
  platform: string;
  viewerId: string;
}): string | undefined {
  const viewerKey = viewerFollowIdentityKey(input);
  const hostId = input.hostId.trim();
  return viewerKey && hostId ? `${hostId}:${viewerKey}` : undefined;
}

/**
 * Installable host skill for audience-aware entry greetings. Platform adapters
 * normalize fan evidence; this module owns room-size policy, relationship tone
 * and repeat-entry cooldowns behind one small interface.
 */
export function createFanEntryWelcomeSkill(options?: {
  cooldownMs?: number;
  storage?: WelcomeStorage;
}) {
  const cooldownMs = Math.max(
    0,
    options?.cooldownMs ?? FAN_ENTRY_WELCOME_COOLDOWN_MS,
  );
  const storage = options?.storage ?? defaultStorage();
  const welcomedAtByIdentity = readStoredCooldowns(storage);

  const persist = () => {
    if (!storage) return;
    try {
      const payload: StoredWelcomeCooldowns = {
        version: 1,
        welcomedAtByIdentity: Object.fromEntries(welcomedAtByIdentity),
      };
      storage.setItem(FAN_ENTRY_WELCOME_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // The current live session can continue with the in-memory cooldown.
    }
  };

  return {
    prepare(input: FanEntryWelcomeInput): FanEntryWelcome | null {
      if (!input.installed || !Number.isFinite(input.observedAt)) return null;
      const identity = cooldownIdentity(input);
      if (!identity) return null;
      const fanEvidence = verifiedFanEvidence(input);
      if (
        !shouldWelcomeViewerEntry({
          ...input.observation,
          isFan: fanEvidence !== undefined,
        })
      ) {
        return null;
      }
      const lastWelcomedAt = welcomedAtByIdentity.get(identity);
      if (
        lastWelcomedAt !== undefined &&
        input.observedAt - lastWelcomedAt < cooldownMs
      ) {
        return null;
      }
      const prompt = buildViewerEntryWelcomePrompt({
        viewerName: input.viewerName,
        platform: input.platform,
        estimatedAudience: input.observation.estimatedAudience,
        isFan: fanEvidence !== undefined,
        relationship: input.relationship,
        viewerLocation: input.viewerLocation,
      });
      if (!prompt) return null;
      welcomedAtByIdentity.set(identity, input.observedAt);
      persist();
      return {
        prompt,
        audienceKind: fanEvidence ? 'fan' : 'small-room-viewer',
        fanEvidence,
      };
    },
  };
}

export const fanEntryWelcomeSkill = createFanEntryWelcomeSkill();
