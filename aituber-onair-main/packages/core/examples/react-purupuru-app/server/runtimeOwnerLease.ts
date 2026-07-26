import { createHash, randomBytes } from 'node:crypto';

export type RuntimeOwnerRole =
  | 'control-room'
  | 'obs-overlay'
  | 'stress-runner'
  | 'unknown';

export type RuntimeOwnerLeaseClaim = {
  ownerId: string;
  label?: string;
  role?: RuntimeOwnerRole;
};

export type RuntimeOwnerLeaseSnapshot = {
  active: boolean;
  owner?: {
    label: string;
    role: RuntimeOwnerRole;
    fingerprint: string;
    acquiredAt: number;
    renewedAt: number;
    expiresAt: number;
    remainingMs: number;
  };
};

export type RuntimeOwnerLeaseClaimResult = {
  owns: boolean;
  lease: RuntimeOwnerLeaseSnapshot;
  leaseToken?: string;
};

type ActiveRuntimeOwnerLease = {
  ownerId: string;
  label: string;
  role: RuntimeOwnerRole;
  acquiredAt: number;
  renewedAt: number;
  expiresAt: number;
  leaseToken: string;
};

export type RuntimeOwnerLeaseRegistry = {
  claim: (
    claim: RuntimeOwnerLeaseClaim,
    at?: number,
  ) => RuntimeOwnerLeaseClaimResult;
  release: (
    ownerId: string,
    leaseToken: string,
    at?: number,
  ) => RuntimeOwnerLeaseSnapshot;
  snapshot: (at?: number) => RuntimeOwnerLeaseSnapshot;
  isOwner: (ownerId: string, at?: number) => boolean;
  isLeaseOwner: (ownerId: string, leaseToken: string, at?: number) => boolean;
  currentOwnerId: (at?: number) => string | undefined;
};

const VALID_ROLES = new Set<RuntimeOwnerRole>([
  'control-room',
  'obs-overlay',
  'stress-runner',
  'unknown',
]);

function cleanText(value: unknown, fallback: string, maxLength = 80): string {
  const normalized = String(value ?? '')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, maxLength) || fallback;
}

function normalizeClaim(claim: RuntimeOwnerLeaseClaim): {
  ownerId: string;
  label: string;
  role: RuntimeOwnerRole;
} {
  const ownerId = cleanText(claim.ownerId, '', 160);
  if (!ownerId) throw new Error('owner id is required');
  const role = VALID_ROLES.has(claim.role ?? 'unknown')
    ? (claim.role ?? 'unknown')
    : 'unknown';
  return {
    ownerId,
    label: cleanText(claim.label, '未命名执行端'),
    role,
  };
}

function fingerprintOwner(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 8);
}

export function createRuntimeOwnerLeaseRegistry(options: {
  ttlMs: number;
  now?: () => number;
  createToken?: () => string;
}): RuntimeOwnerLeaseRegistry {
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('runtime owner lease ttl must be positive');
  }
  const now = options.now ?? Date.now;
  const createToken =
    options.createToken ?? (() => randomBytes(32).toString('hex'));
  let activeLease: ActiveRuntimeOwnerLease | undefined;

  const prune = (at: number) => {
    if (activeLease && activeLease.expiresAt <= at) activeLease = undefined;
  };

  const snapshot = (at = now()): RuntimeOwnerLeaseSnapshot => {
    prune(at);
    if (!activeLease) return { active: false };
    return {
      active: true,
      owner: {
        label: activeLease.label,
        role: activeLease.role,
        fingerprint: fingerprintOwner(activeLease.ownerId),
        acquiredAt: activeLease.acquiredAt,
        renewedAt: activeLease.renewedAt,
        expiresAt: activeLease.expiresAt,
        remainingMs: Math.max(0, activeLease.expiresAt - at),
      },
    };
  };

  return {
    claim(claim, at = now()) {
      const normalized = normalizeClaim(claim);
      prune(at);
      if (activeLease && activeLease.ownerId !== normalized.ownerId) {
        return { owns: false, lease: snapshot(at) };
      }
      activeLease = {
        ownerId: normalized.ownerId,
        label: normalized.label,
        role: normalized.role,
        acquiredAt: activeLease?.acquiredAt ?? at,
        renewedAt: at,
        expiresAt: at + options.ttlMs,
        leaseToken: activeLease?.leaseToken ?? createToken(),
      };
      return {
        owns: true,
        lease: snapshot(at),
        leaseToken: activeLease.leaseToken,
      };
    },
    release(ownerId, leaseToken, at = now()) {
      prune(at);
      if (
        activeLease?.ownerId === cleanText(ownerId, '', 160) &&
        activeLease.leaseToken === leaseToken
      ) {
        activeLease = undefined;
      }
      return snapshot(at);
    },
    snapshot,
    isOwner(ownerId, at = now()) {
      prune(at);
      return activeLease?.ownerId === cleanText(ownerId, '', 160);
    },
    isLeaseOwner(ownerId, leaseToken, at = now()) {
      prune(at);
      return (
        activeLease?.ownerId === cleanText(ownerId, '', 160) &&
        activeLease.leaseToken === leaseToken
      );
    },
    currentOwnerId(at = now()) {
      prune(at);
      return activeLease?.ownerId;
    },
  };
}
