import { useEffect, useState } from 'react';

const LIVE_RUNTIME_LOCK = 'aituber-live-runtime-owner';

/** Serializes every listener/overlay candidate onto one browser runtime. */
export function useRuntimeOwnerLease(candidate: boolean): boolean {
  const [ownsRuntime, setOwnsRuntime] = useState(false);

  useEffect(() => {
    if (!candidate) return;

    const controller = new AbortController();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    if (!navigator.locks) {
      // Web Locks is available in the Chromium versions used by OBS. Keep a
      // functional fallback for unusual browsers without pretending it is a
      // cross-tab lease.
      queueMicrotask(() => {
        if (!controller.signal.aborted) setOwnsRuntime(true);
      });
      return () => {
        controller.abort();
        setOwnsRuntime(false);
      };
    }

    void navigator.locks
      .request(
        LIVE_RUNTIME_LOCK,
        { mode: 'exclusive', signal: controller.signal },
        async () => {
          if (controller.signal.aborted) return;
          setOwnsRuntime(true);
          await released;
          setOwnsRuntime(false);
        },
      )
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Live runtime owner lease failed.', error);
        }
      });

    return () => {
      controller.abort();
      release();
      setOwnsRuntime(false);
    };
  }, [candidate]);

  return ownsRuntime;
}
