import { useEffect, useRef, useState } from 'react';

const LEASE_HEARTBEAT_MS = 3_000;

/** Serializes every listener/overlay candidate onto one browser runtime. */
export function useRuntimeOwnerLease(candidate: boolean): boolean {
  const [ownsRuntime, setOwnsRuntime] = useState(false);
  const ownerIdRef = useRef(`runtime-lease-${crypto.randomUUID()}`);

  useEffect(() => {
    const ownerId = ownerIdRef.current;
    if (!candidate) {
      queueMicrotask(() => setOwnsRuntime(false));
      return;
    }

    // Web Locks are scoped to a browser origin. OBS/control pages can be
    // opened through localhost and 127.0.0.1, which makes them different lock
    // namespaces even though they drive the same Vite process. The local
    // server is therefore the authoritative lease owner.
    let disposed = false;
    const heartbeat = async () => {
      try {
        const response = await fetch('/api/live-runtime-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId }),
        });
        const payload = (await response.json()) as { owns?: unknown };
        if (!disposed) setOwnsRuntime(payload.owns === true);
      } catch {
        if (!disposed) setOwnsRuntime(false);
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), LEASE_HEARTBEAT_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      void fetch('/api/live-runtime-owner', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId }),
      }).catch(() => undefined);
    };
  }, [candidate]);

  return ownsRuntime;
}
