import { useEffect, useRef, useState } from 'react';

const LEASE_HEARTBEAT_MS = 3_000;

export type RuntimeOwnerRole =
  | 'control-room'
  | 'obs-overlay'
  | 'stress-runner'
  | 'unknown';

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

export interface RuntimeOwnerLeaseState {
  ownsRuntime: boolean;
  ownerId: string;
  leaseToken?: string;
  status: 'idle' | 'claiming' | 'owned' | 'contended' | 'unavailable';
}

export type RuntimeOwnerLeaseIdentity = {
  label: string;
  role: RuntimeOwnerRole;
};

/** Serializes every listener/overlay candidate onto one browser runtime. */
export function useRuntimeOwnerLease(
  candidate: boolean,
  identity: RuntimeOwnerLeaseIdentity,
): RuntimeOwnerLeaseState {
  const [ownerId] = useState(() => crypto.randomUUID());
  const [status, setStatus] =
    useState<RuntimeOwnerLeaseState['status']>('idle');
  const [activeLeaseToken, setActiveLeaseToken] = useState<string>();
  const activationRef = useRef(0);
  const { label, role } = identity;

  useEffect(() => {
    const activation = ++activationRef.current;
    if (!candidate) {
      queueMicrotask(() => {
        setStatus('idle');
        setActiveLeaseToken(undefined);
      });
      return;
    }

    // Browser lock namespaces differ between localhost and 127.0.0.1, so the
    // local server remains the authoritative owner across control/OBS pages.
    let disposed = false;
    let leaseToken = '';
    const heartbeat = async () => {
      try {
        const response = await fetch('/api/live-runtime-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, label, role }),
        });
        if (!response.ok) throw 0;
        const payload = (await response.json()) as {
          owns?: unknown;
          leaseToken?: unknown;
        };
        const ownsRuntime = payload.owns === true;
        if (ownsRuntime && typeof payload.leaseToken === 'string') {
          leaseToken = payload.leaseToken;
          if (!disposed) setActiveLeaseToken(payload.leaseToken);
        } else if (!disposed) {
          setActiveLeaseToken(undefined);
        }
        if (!disposed) setStatus(ownsRuntime ? 'owned' : 'contended');
      } catch {
        if (!disposed) {
          setStatus('unavailable');
          setActiveLeaseToken(undefined);
        }
      }
    };
    setStatus('claiming');
    void heartbeat();
    const timer = window.setInterval(
      () => void heartbeat(),
      LEASE_HEARTBEAT_MS,
    );

    return () => {
      disposed = true;
      window.clearInterval(timer);
      // Strict Mode immediately replaces effects in development. A delayed,
      // generation-checked release cannot delete the replacement heartbeat.
      window.setTimeout(() => {
        // The mutable generation is intentionally checked at callback time.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (activationRef.current !== activation || !leaseToken) return;
        void fetch('/api/live-runtime-owner', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, leaseToken }),
        }).catch(() => undefined);
      }, 250);
    };
  }, [candidate, label, ownerId, role]);

  return {
    ownsRuntime: status === 'owned' && Boolean(activeLeaseToken),
    ownerId,
    leaseToken: activeLeaseToken,
    status,
  };
}
