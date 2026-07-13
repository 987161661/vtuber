/**
 * Stable iframe protocol for any host page embedding the virtual presenter.
 * `linglan:*` is accepted only as a migration path for the existing radar.
 */
export type HostBridgeMessageKind = 'engagement' | 'chat' | 'narrate';

const CURRENT_TYPES: Record<HostBridgeMessageKind | 'ready' | 'chat-ack', string> = {
  engagement: 'aituber:engagement',
  chat: 'aituber:chat',
  narrate: 'aituber:narrate',
  ready: 'aituber:ready',
  'chat-ack': 'aituber:chat-ack',
};

const LEGACY_TYPES: Record<HostBridgeMessageKind | 'ready' | 'chat-ack', string> = {
  engagement: 'linglan:engagement',
  chat: 'linglan:chat',
  narrate: 'linglan:narrate',
  ready: 'linglan:ready',
  'chat-ack': 'linglan:chat-ack',
};

export function getHostBridgeMessageKind(value: unknown): HostBridgeMessageKind | undefined {
  if (typeof value !== 'string') return undefined;
  return (Object.keys(CURRENT_TYPES) as Array<keyof typeof CURRENT_TYPES>).find(
    (kind) =>
      kind !== 'ready' &&
      kind !== 'chat-ack' &&
      (CURRENT_TYPES[kind] === value || LEGACY_TYPES[kind] === value),
  ) as HostBridgeMessageKind | undefined;
}

export function isLegacyHostBridgeMessage(value: unknown): boolean {
  return typeof value === 'string' && Object.values(LEGACY_TYPES).includes(value);
}

export function hostBridgeType(
  kind: HostBridgeMessageKind | 'ready' | 'chat-ack',
  legacy = false,
): string {
  return legacy ? LEGACY_TYPES[kind] : CURRENT_TYPES[kind];
}
