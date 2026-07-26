import { describe, expect, it } from 'vitest';
import { createRuntimeOwnerLeaseRegistry } from '../../examples/react-purupuru-app/server/runtimeOwnerLease';

describe('runtime owner lease registry', () => {
  it('grants one owner and exposes only sanitized public identity metadata', () => {
    const registry = createRuntimeOwnerLeaseRegistry({
      ttlMs: 10_000,
      createToken: () => 'token-one',
    });
    const result = registry.claim(
      {
        ownerId: 'private-owner-id',
        label: '  主控\u0000 页面  ',
        role: 'control-room',
      },
      1_000,
    );

    expect(result).toMatchObject({
      owns: true,
      lease: {
        active: true,
        owner: {
          label: '主控 页面',
          role: 'control-room',
          acquiredAt: 1_000,
          renewedAt: 1_000,
          expiresAt: 11_000,
          remainingMs: 10_000,
        },
      },
    });
    expect(result.lease.owner?.fingerprint).toMatch(/^[a-f0-9]{8}$/u);
    expect(JSON.stringify(result)).not.toContain('private-owner-id');
  });

  it('renews the same owner without resetting acquisition time', () => {
    const registry = createRuntimeOwnerLeaseRegistry({ ttlMs: 10_000 });
    registry.claim({ ownerId: 'one', label: '旧名称' }, 1_000);

    const renewed = registry.claim(
      { ownerId: 'one', label: '直播总控', role: 'control-room' },
      4_000,
    );

    expect(renewed).toMatchObject({
      owns: true,
      lease: {
        owner: {
          label: '直播总控',
          acquiredAt: 1_000,
          renewedAt: 4_000,
          expiresAt: 14_000,
        },
      },
    });
  });

  it('reports contention and grants a new owner after expiry', () => {
    const registry = createRuntimeOwnerLeaseRegistry({ ttlMs: 10_000 });
    registry.claim({ ownerId: 'one', label: 'OBS 覆盖层' }, 1_000);

    expect(
      registry.claim({ ownerId: 'two', label: '直播总控' }, 2_000),
    ).toMatchObject({
      owns: false,
      lease: {
        active: true,
        owner: { label: 'OBS 覆盖层', remainingMs: 9_000 },
      },
    });
    expect(
      registry.claim({ ownerId: 'two', label: '直播总控' }, 11_000),
    ).toMatchObject({
      owns: true,
      lease: {
        owner: { label: '直播总控', acquiredAt: 11_000 },
      },
    });
  });

  it('releases only for the current owner and expires ownership checks', () => {
    const registry = createRuntimeOwnerLeaseRegistry({ ttlMs: 10_000 });
    registry.claim({ ownerId: 'one' }, 1_000);

    expect(registry.release('two', 'token-one', 2_000).active).toBe(true);
    expect(registry.isOwner('one', 10_999)).toBe(true);
    expect(registry.currentOwnerId(10_999)).toBe('one');
    expect(registry.isOwner('one', 11_000)).toBe(false);
    expect(registry.currentOwnerId(11_000)).toBeUndefined();

    const claim = registry.claim({ ownerId: 'one' }, 20_000);
    expect(registry.release('one', 'stale-token', 21_000).active).toBe(true);
    expect(registry.release('one', claim.leaseToken ?? '', 21_000)).toEqual({
      active: false,
    });
  });

  it('authorizes mutations only for the current unexpired lease token', () => {
    let tokenNumber = 0;
    const registry = createRuntimeOwnerLeaseRegistry({
      ttlMs: 10_000,
      createToken: () => `token-${++tokenNumber}`,
    });
    const first = registry.claim({ ownerId: 'one' }, 1_000);

    expect(registry.isLeaseOwner('one', first.leaseToken ?? '', 10_999)).toBe(
      true,
    );
    expect(registry.isLeaseOwner('one', 'stale-token', 10_999)).toBe(false);
    expect(registry.isLeaseOwner('one', first.leaseToken ?? '', 11_000)).toBe(
      false,
    );

    const second = registry.claim({ ownerId: 'two' }, 11_000);
    expect(second.leaseToken).toBe('token-2');
    expect(registry.isLeaseOwner('one', first.leaseToken ?? '', 11_001)).toBe(
      false,
    );
    expect(registry.isLeaseOwner('two', second.leaseToken ?? '', 11_001)).toBe(
      true,
    );
  });
});
