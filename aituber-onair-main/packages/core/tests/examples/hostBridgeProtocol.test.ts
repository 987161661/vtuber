import { describe, expect, it } from 'vitest';
import {
  getHostBridgeMessageKind,
  hostBridgeType,
  isLegacyHostBridgeMessage,
} from '../../examples/react-purupuru-app/src/services/host-bridge/protocol';

describe('generic host bridge protocol', () => {
  it('accepts the generic protocol and the Linglan migration aliases', () => {
    expect(getHostBridgeMessageKind('aituber:chat')).toBe('chat');
    expect(getHostBridgeMessageKind('linglan:chat')).toBe('chat');
    expect(getHostBridgeMessageKind('other:chat')).toBeUndefined();
    expect(hostBridgeType('ready')).toBe('aituber:ready');
    expect(hostBridgeType('chat-ack', true)).toBe('linglan:chat-ack');
    expect(isLegacyHostBridgeMessage('linglan:narrate')).toBe(true);
  });
});
