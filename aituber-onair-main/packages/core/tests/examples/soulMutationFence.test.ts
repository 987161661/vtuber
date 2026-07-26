import { describe, expect, it } from 'vitest';
import { hasSoulMutationFence } from '../../examples/react-purupuru-app/src/lib/soulMutationFence';

describe('Soul mutation fence', () => {
  it('allows migration writes only for a complete runtime-owner fence', () => {
    expect(hasSoulMutationFence()).toBe(false);
    expect(
      hasSoulMutationFence({
        ownerId: 'runtime-owner',
        leaseToken: '',
      }),
    ).toBe(false);
    expect(
      hasSoulMutationFence({
        ownerId: 'runtime-owner',
        leaseToken: 'lease-token',
      }),
    ).toBe(true);
  });
});
