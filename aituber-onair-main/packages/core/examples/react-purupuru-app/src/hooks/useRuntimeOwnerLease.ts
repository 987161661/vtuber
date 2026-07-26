import { useEffect, useRef, useState } from 'react';
import {
  startRuntimeOwnerHeartbeatWorker,
  type RuntimeOwnerHeartbeatResult,
} from '../lib/runtimeOwnerHeartbeatWorker';
import {
  reconcileRuntimeOwnerLease,
  selectRuntimeOwnerLeaseTransport,
  type RuntimeOwnerClientLease,
} from '../lib/runtimeOwnerLeaseState';
import { startRuntimeOwnerLeaseStream } from '../lib/runtimeOwnerLeaseStream';

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
  const [clientLease, setClientLease] = useState<RuntimeOwnerClientLease>({
    status: 'idle',
  });
  const clientLeaseRef = useRef(clientLease);
  clientLeaseRef.current = clientLease;
  const activationRef = useRef(0);
  const { label, role } = identity;

  useEffect(() => {
    const activation = ++activationRef.current;
    if (!candidate) {
      queueMicrotask(() => {
        const idleLease = { status: 'idle' } as const;
        clientLeaseRef.current = idleLease;
        setClientLease(idleLease);
      });
      return;
    }

    // Browser lock namespaces differ between localhost and 127.0.0.1, so the
    // local server remains the authoritative owner across control/OBS pages.
    let disposed = false;
    let leaseToken = '';
    const applyHeartbeatResult = (result: RuntimeOwnerHeartbeatResult) => {
      if (disposed) return;
      const next = reconcileRuntimeOwnerLease(
        clientLeaseRef.current,
        result,
        Date.now(),
      );
      clientLeaseRef.current = next;
      if (next.leaseToken) leaseToken = next.leaseToken;
      setClientLease(next);
    };
    const heartbeat = async () => {
      try {
        const response = await fetch('/api/live-runtime-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, label, role }),
        });
        applyHeartbeatResult({
          type: 'result',
          ok: response.ok,
          payload: response.ok
            ? ((await response.json()) as Record<string, unknown>)
            : undefined,
        });
      } catch {
        applyHeartbeatResult({ type: 'result', ok: false });
      }
    };
    const claimingLease = { status: 'claiming' } as const;
    clientLeaseRef.current = claimingLease;
    setClientLease(claimingLease);
    let stopHeartbeat: () => void;
    const transport = selectRuntimeOwnerLeaseTransport({
      worker:
        typeof Worker !== 'undefined' &&
        typeof Blob !== 'undefined' &&
        typeof URL.createObjectURL === 'function',
      eventSource: typeof EventSource !== 'undefined',
    });
    if (transport === 'worker') {
      stopHeartbeat = startRuntimeOwnerHeartbeatWorker({
        endpoint: new URL('/api/live-runtime-owner', window.location.href).href,
        heartbeatMs: LEASE_HEARTBEAT_MS,
        identity: { ownerId, label, role },
        onResult: applyHeartbeatResult,
        createWorker: (source) => {
          const workerUrl = URL.createObjectURL(
            new Blob([source], { type: 'text/javascript' }),
          );
          try {
            return new Worker(workerUrl);
          } finally {
            URL.revokeObjectURL(workerUrl);
          }
        },
      });
    } else if (transport === 'event-source') {
      stopHeartbeat = startRuntimeOwnerLeaseStream({
        endpoint: new URL(
          '/api/live-runtime-owner/stream',
          window.location.href,
        ).href,
        identity: { ownerId, label, role },
        onResult: applyHeartbeatResult,
        createEventSource: (url) => new EventSource(url),
      });
    } else {
      void heartbeat();
      const timer = window.setInterval(
        () => void heartbeat(),
        LEASE_HEARTBEAT_MS,
      );
      stopHeartbeat = () => window.clearInterval(timer);
    }

    return () => {
      disposed = true;
      stopHeartbeat();
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
    ownsRuntime:
      clientLease.status === 'owned' && Boolean(clientLease.leaseToken),
    ownerId,
    leaseToken: clientLease.leaseToken,
    status: clientLease.status,
  };
}
