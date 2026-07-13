import { describe, expect, it } from 'vitest';
import { createCustomSseEventAdapter } from '../../examples/react-purupuru-app/src/services/live-platform/customSse';
import { isLiveRoomEvent } from '../../examples/react-purupuru-app/src/services/live-platform/types';

describe('custom SSE live-platform adapter', () => {
  it('preserves bridge query parameters while adding replay metadata', () => {
    const adapter = createCustomSseEventAdapter(
      'https://bridge.example.com/events?token=demo',
    );

    const url = new URL(adapter.createEventUrl('control-runtime', 'evt-42'));
    expect(url.origin).toBe('https://bridge.example.com');
    expect(url.pathname).toBe('/events');
    expect(url.searchParams.get('token')).toBe('demo');
    expect(url.searchParams.get('client')).toBe('control-runtime');
    expect(url.searchParams.get('lastEventId')).toBe('evt-42');
  });

  it('accepts only the platform-independent room event contract', () => {
    expect(
      isLiveRoomEvent({
        id: 'evt-1',
        type: 'comment',
        text: 'hello',
        timestamp: 1,
        author: { id: 'viewer-1', name: 'Viewer' },
      }),
    ).toBe(true);
    expect(
      isLiveRoomEvent({
        id: 'evt-2',
        type: 'platform-private-event',
        text: 'hello',
        timestamp: 1,
        author: { id: 'viewer-1', name: 'Viewer' },
      }),
    ).toBe(false);
  });
});
