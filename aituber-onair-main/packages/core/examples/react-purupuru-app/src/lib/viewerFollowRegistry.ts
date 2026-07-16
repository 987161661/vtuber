export const VIEWER_FOLLOW_STORAGE_KEY = 'aituber-viewer-follows-v1';

type ViewerFollowStorage = Pick<Storage, 'getItem' | 'setItem'>;

type StoredViewerFollows = {
  version: 1;
  followedAtByIdentity: Record<string, number>;
};

export type ViewerFollowIdentity = {
  platform: string;
  viewerId: string;
};

export type HostViewerRelationEvent = {
  type: 'aituber:viewer-relation';
  version: 1;
  id: string;
  relation: 'follow';
  state: 'verified';
  viewerId: string;
  viewerName?: string;
  platform: string;
  observedAt: number;
};

export type HostLiveCommentEvent = {
  type: 'aituber:live-comment';
  version: 1;
  id: string;
  text: string;
  viewerId: string;
  viewerName: string;
  platform: string;
  receivedAt: number;
  followEvidence: 'observed' | 'unknown';
  followObservedAt?: number;
};

function defaultStorage(): ViewerFollowStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeViewerPlatform(platform: string): string {
  return platform.trim().toLowerCase();
}

export function normalizeViewerId(viewerId: string): string {
  return viewerId.trim();
}

export function viewerFollowIdentityKey(
  identity: ViewerFollowIdentity,
): string | undefined {
  const platform = normalizeViewerPlatform(identity.platform);
  const viewerId = normalizeViewerId(identity.viewerId);
  if (!platform || !viewerId) return undefined;
  return `${platform}:${viewerId}`;
}

function readStoredFollows(
  storage: ViewerFollowStorage | undefined,
): Map<string, number> {
  if (!storage) return new Map();
  try {
    const raw = storage.getItem(VIEWER_FOLLOW_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Partial<StoredViewerFollows>;
    if (
      parsed.version !== 1 ||
      !parsed.followedAtByIdentity ||
      typeof parsed.followedAtByIdentity !== 'object'
    ) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed.followedAtByIdentity).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

export function createViewerFollowRegistry(
  providedStorage?: ViewerFollowStorage,
) {
  const storage = providedStorage ?? defaultStorage();
  const followedAtByIdentity = readStoredFollows(storage);

  const persist = () => {
    if (!storage) return;
    try {
      const payload: StoredViewerFollows = {
        version: 1,
        followedAtByIdentity: Object.fromEntries(followedAtByIdentity),
      };
      storage.setItem(VIEWER_FOLLOW_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Keep the in-memory observation usable for the current live session.
    }
  };

  return {
    record(identity: ViewerFollowIdentity, followedAt: number) {
      const key = viewerFollowIdentityKey(identity);
      if (!key || !Number.isFinite(followedAt)) return undefined;
      followedAtByIdentity.set(key, followedAt);
      persist();
      return followedAt;
    },
    observedAt(identity: ViewerFollowIdentity) {
      const key = viewerFollowIdentityKey(identity);
      return key ? followedAtByIdentity.get(key) : undefined;
    },
  };
}

export const viewerFollowRegistry = createViewerFollowRegistry();

export function createViewerRelationEvent(input: {
  id: string;
  viewerId: string;
  viewerName?: string;
  platform: string;
  observedAt: number;
}): HostViewerRelationEvent {
  return {
    type: 'aituber:viewer-relation',
    version: 1,
    id: input.id,
    relation: 'follow',
    state: 'verified',
    viewerId: normalizeViewerId(input.viewerId),
    viewerName: input.viewerName,
    platform: normalizeViewerPlatform(input.platform),
    observedAt: input.observedAt,
  };
}

export function createLiveCommentEvent(input: {
  id: string;
  text: string;
  viewerId: string;
  viewerName: string;
  platform: string;
  receivedAt: number;
  followObservedAt?: number;
}): HostLiveCommentEvent {
  return {
    type: 'aituber:live-comment',
    version: 1,
    id: input.id,
    text: input.text,
    viewerId: normalizeViewerId(input.viewerId),
    viewerName: input.viewerName,
    platform: normalizeViewerPlatform(input.platform),
    receivedAt: input.receivedAt,
    followEvidence:
      input.followObservedAt === undefined ? 'unknown' : 'observed',
    ...(input.followObservedAt === undefined
      ? {}
      : { followObservedAt: input.followObservedAt }),
  };
}
