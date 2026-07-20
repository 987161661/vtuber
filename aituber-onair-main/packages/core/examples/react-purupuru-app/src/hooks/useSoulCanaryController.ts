import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SoulScopeV1 } from '@aituber-onair/soul';
import type { SoulRuntimeMode } from '../types/settings';
import {
  createSoulCanaryClient,
  type SoulCanaryActiveSummary,
  type SoulCanaryOperatorCredential,
  type SoulCanaryRuntimeCredential,
} from '../lib/soulCanaryClient';

type RuntimeEvent = Record<string, unknown> & { stage: string; at: number };

export function useSoulCanaryController(options: {
  runtimeMode: SoulRuntimeMode;
  scope: SoulScopeV1;
  isRuntimeOwner: boolean;
  runtimeOwnerId: string;
  emitRuntimeEvent: (event: RuntimeEvent) => void;
  refreshPrimaryGate: () => Promise<boolean>;
}) {
  const {
    runtimeMode,
    scope,
    isRuntimeOwner,
    runtimeOwnerId,
    emitRuntimeEvent,
    refreshPrimaryGate,
  } = options;
  const client = useMemo(
    () =>
      createSoulCanaryClient({
        request: fetch,
        storage: {
          getItem: (key) => window.sessionStorage.getItem(key),
          setItem: (key, value) => window.sessionStorage.setItem(key, value),
          removeItem: (key) => window.sessionStorage.removeItem(key),
        },
      }),
    [],
  );
  const [operatorCredential, setOperatorCredential] =
    useState<SoulCanaryOperatorCredential | null>(() =>
      client.readOperatorCredential(),
    );
  const [active, setActive] = useState<SoulCanaryActiveSummary | null>(null);
  const [busy, setBusy] = useState<
    'starting' | 'finishing' | 'aborting' | undefined
  >();
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const runtimeCredentialRef = useRef<SoulCanaryRuntimeCredential | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const current = (await client.listActive())[0] ?? null;
      if (cancelled) return;
      setActive(current);
      setOperatorCredential((credential) => {
        if (!credential || current?.runId === credential.runId) {
          return credential;
        }
        client.clearOperatorCredential();
        return null;
      });
    };
    void refresh().catch(() => undefined);
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      5_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client]);

  useEffect(() => {
    if (!active) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!isRuntimeOwner || runtimeMode !== 'canary') {
      runtimeCredentialRef.current = null;
      return;
    }
    let cancelled = false;
    const claim = async () => {
      const credential = await client.claimRuntimeForScope(
        scope,
        runtimeOwnerId,
        runtimeCredentialRef.current,
      );
      if (cancelled) return;
      const previousRunId = runtimeCredentialRef.current?.runId;
      runtimeCredentialRef.current = credential;
      if (credential && credential.runId !== previousRunId) {
        emitRuntimeEvent({
          stage: 'soul_canary_runtime_claimed',
          at: Date.now(),
          runId: credential.runId,
        });
      }
    };
    void claim().catch(() => undefined);
    const timer = window.setInterval(
      () => void claim().catch(() => undefined),
      5_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    client,
    emitRuntimeEvent,
    isRuntimeOwner,
    runtimeMode,
    runtimeOwnerId,
    scope,
  ]);

  const start = useCallback(async () => {
    if (runtimeMode !== 'canary') {
      setError('请先将 Soul Runtime 切换为 Canary。');
      return;
    }
    setBusy('starting');
    setError('');
    try {
      const credential = await client.start(scope);
      setOperatorCredential(credential);
      setActive(credential);
      setClock(Date.now());
      emitRuntimeEvent({
        stage: 'soul_canary_started',
        at: Date.now(),
        runId: credential.runId,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'soul_canary_start_failed',
      );
    } finally {
      setBusy(undefined);
    }
  }, [client, emitRuntimeEvent, runtimeMode, scope]);

  const finish = useCallback(async () => {
    if (!operatorCredential) return;
    setBusy('finishing');
    setError('');
    try {
      await client.finish(operatorCredential);
      setOperatorCredential(null);
      setActive(null);
      runtimeCredentialRef.current = null;
      await refreshPrimaryGate();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'soul_canary_finish_failed',
      );
    } finally {
      setBusy(undefined);
    }
  }, [client, operatorCredential, refreshPrimaryGate]);

  const abort = useCallback(async () => {
    if (!operatorCredential) return;
    setBusy('aborting');
    setError('');
    try {
      await client.abort(operatorCredential);
      setOperatorCredential(null);
      setActive(null);
      runtimeCredentialRef.current = null;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'soul_canary_abort_failed',
      );
    } finally {
      setBusy(undefined);
    }
  }, [client, operatorCredential]);

  const runtimeEventHeaders = useCallback((): Record<string, string> => {
    if (!isRuntimeOwner || runtimeMode !== 'canary') return {};
    return client.runtimeEventHeaders(
      runtimeCredentialRef.current,
      scope,
      runtimeOwnerId,
    );
  }, [client, isRuntimeOwner, runtimeMode, runtimeOwnerId, scope]);

  return {
    active,
    operatorCredential,
    busy,
    error,
    clock,
    start,
    finish,
    abort,
    runtimeEventHeaders,
  };
}
