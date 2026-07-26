import type { PersonaTopicEntry } from './personaTopicLedger';

interface IdleThoughtStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}

const STORAGE_PREFIX = 'aituber-idle-thought-history:';
const MAX_HISTORY_ENTRIES = 12;

function storageKey(personaId: string) {
  return `${STORAGE_PREFIX}${personaId}`;
}

function isTopicEntry(value: unknown): value is PersonaTopicEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PersonaTopicEntry>;
  return (
    typeof entry.topicFamily === 'string' &&
    Array.isArray(entry.entities) &&
    entry.entities.every((entity) => typeof entity === 'string') &&
    typeof entry.drive === 'string' &&
    typeof entry.source === 'string' &&
    ['new', 'continue', 'close'].includes(String(entry.continuity)) &&
    typeof entry.spokenAt === 'number' &&
    Number.isFinite(entry.spokenAt) &&
    typeof entry.audienceResponded === 'boolean'
  );
}

export function loadIdleThoughtHistory(
  storage: IdleThoughtStorage,
  personaId: string,
): PersonaTopicEntry[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(personaId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isTopicEntry)
      .slice(-MAX_HISTORY_ENTRIES)
      .map((entry) => ({ ...entry, entities: [...entry.entities] }));
  } catch {
    return [];
  }
}

export function saveIdleThoughtHistory(
  storage: IdleThoughtStorage,
  personaId: string,
  entries: readonly PersonaTopicEntry[],
) {
  try {
    storage.setItem(
      storageKey(personaId),
      JSON.stringify(entries.slice(-MAX_HISTORY_ENTRIES)),
    );
  } catch {
    // Browser privacy modes and quota failures must not break live playback.
  }
}
