export interface SoulMutationFence {
  ownerId: string;
  leaseToken: string;
}

export function hasSoulMutationFence(
  fence?: SoulMutationFence,
): fence is SoulMutationFence {
  return Boolean(fence?.ownerId.trim() && fence.leaseToken.trim());
}

export function soulMutationHeaders(
  fence?: SoulMutationFence,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(hasSoulMutationFence(fence)
      ? {
          'X-Runtime-Owner-Id': fence.ownerId.trim(),
          'X-Runtime-Lease-Token': fence.leaseToken.trim(),
        }
      : {}),
  };
}
