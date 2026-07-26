export type RuntimeOwnerHeartbeatOutcome = {
  ok: boolean;
  payload?: Record<string, unknown>;
};

export type RuntimeOwnerClientLease = {
  status: 'idle' | 'claiming' | 'owned' | 'contended' | 'unavailable';
  leaseToken?: string;
  confirmedExpiresAt?: number;
};

export function selectRuntimeOwnerLeaseTransport(capabilities: {
  worker: boolean;
  eventSource: boolean;
}): 'worker' | 'event-source' | 'timer' {
  if (capabilities.worker) return 'worker';
  if (capabilities.eventSource) return 'event-source';
  return 'timer';
}

function readConfirmedExpiry(
  payload: Record<string, unknown>,
): number | undefined {
  const lease = payload.lease;
  if (!lease || typeof lease !== 'object') return undefined;
  const owner = (lease as Record<string, unknown>).owner;
  if (!owner || typeof owner !== 'object') return undefined;
  const expiresAt = (owner as Record<string, unknown>).expiresAt;
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt)
    ? expiresAt
    : undefined;
}

/**
 * Reconciles heartbeat transport results with the last server-confirmed lease.
 * A transport timeout is not an ownership revocation: the lease remains valid
 * until the server-provided expiry. An explicit contention response is
 * authoritative and yields immediately.
 */
export function reconcileRuntimeOwnerLease(
  previous: RuntimeOwnerClientLease,
  result: RuntimeOwnerHeartbeatOutcome,
  at: number,
): RuntimeOwnerClientLease {
  if (!result.ok) {
    if (
      previous.status === 'owned' &&
      previous.leaseToken &&
      typeof previous.confirmedExpiresAt === 'number' &&
      previous.confirmedExpiresAt > at
    ) {
      return previous;
    }
    return { status: 'unavailable' };
  }

  const payload = result.payload;
  if (payload?.owns !== true) return { status: 'contended' };
  if (typeof payload.leaseToken !== 'string' || !payload.leaseToken) {
    return { status: 'unavailable' };
  }

  const confirmedExpiresAt = readConfirmedExpiry(payload);
  return {
    status: 'owned',
    leaseToken: payload.leaseToken,
    ...(confirmedExpiresAt !== undefined ? { confirmedExpiresAt } : {}),
  };
}
