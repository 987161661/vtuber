export function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function mean(values: readonly number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForSerialization(value));
}

export function hashValue(value: unknown): string {
  const input = stableStringify(value);
  return `sha256:${bytesToHex(sha256(utf8ToBytes(input)))}`;
}

/**
 * Accepts the legacy FNV digest only while validating already persisted data.
 * All newly written integrity records use SHA-256.
 */
export function matchesHashValue(value: unknown, expected: string): boolean {
  if (expected.startsWith('sha256:')) return hashValue(value) === expected;
  if (expected.startsWith('fnv1a32:')) return legacyHashValue(value) === expected;
  return false;
}

function legacyHashValue(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sortForSerialization(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForSerialization);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForSerialization(child)]),
    );
  }
  return value;
}
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
