import { describe, expect, it } from 'vitest';
import {
  reconcileRuntimeOwnerLease,
  selectRuntimeOwnerLeaseTransport,
} from '../../examples/react-purupuru-app/src/lib/runtimeOwnerLeaseState';

describe('runtime owner lease client state', () => {
  it('prefers client-driven worker renewal over a server-driven stream', () => {
    expect(
      selectRuntimeOwnerLeaseTransport({
        worker: true,
        eventSource: true,
      }),
    ).toBe('worker');
  });

  it('keeps an authoritative lease through one transient heartbeat failure', () => {
    const owned = reconcileRuntimeOwnerLease(
      { status: 'claiming' },
      {
        ok: true,
        payload: {
          owns: true,
          leaseToken: 'lease-a',
          lease: {
            active: true,
            owner: { expiresAt: 40_000 },
          },
        },
      },
      10_000,
    );

    expect(
      reconcileRuntimeOwnerLease(owned, { ok: false }, 15_000),
    ).toEqual(owned);
  });

  it('drops a lease after its authoritative expiry', () => {
    expect(
      reconcileRuntimeOwnerLease(
        {
          status: 'owned',
          leaseToken: 'lease-a',
          confirmedExpiresAt: 40_000,
        },
        { ok: false },
        40_000,
      ),
    ).toEqual({ status: 'unavailable' });
  });

  it('yields immediately to an authoritative contention response', () => {
    expect(
      reconcileRuntimeOwnerLease(
        {
          status: 'owned',
          leaseToken: 'lease-a',
          confirmedExpiresAt: 40_000,
        },
        { ok: true, payload: { owns: false } },
        15_000,
      ),
    ).toEqual({ status: 'contended' });
  });
});
