import { describe, expect, it } from 'vitest';
import { resolveEffectiveLiveRoomStatus } from '../../examples/react-purupuru-app/src/lib/liveRoomRuntimeState';

describe('live room runtime authority', () => {
  it('keeps the OBS host live while the bridge is online and auto broadcast is enabled', () => {
    expect(
      resolveEffectiveLiveRoomStatus(
        { state: 'online', isLive: false, onlineCount: 6 },
        { obsOverlayActive: true, autoBroadcastEnabled: true },
      ),
    ).toMatchObject({ state: 'online', isLive: true, onlineCount: 6 });
  });

  it('promotes the per-platform audience count into the room snapshot', () => {
    expect(
      resolveEffectiveLiveRoomStatus(
        {
          state: 'online',
          platforms: {
            bilibili: {
              platformId: 'bilibili',
              roomId: '21573209',
              state: 'online',
              onlineCount: 6,
            },
          },
        },
        { obsOverlayActive: true, autoBroadcastEnabled: true },
      ).onlineCount,
    ).toBe(6);
  });

  it('does not promote a preview page or an offline bridge', () => {
    expect(
      resolveEffectiveLiveRoomStatus(
        { state: 'online', isLive: false },
        { obsOverlayActive: false, autoBroadcastEnabled: true },
      ).isLive,
    ).toBe(false);
    expect(
      resolveEffectiveLiveRoomStatus(
        { state: 'offline', isLive: false },
        { obsOverlayActive: true, autoBroadcastEnabled: true },
      ).isLive,
    ).toBe(false);
  });

  it('preserves an explicit live signal', () => {
    const status = { state: 'online', isLive: true };
    expect(
      resolveEffectiveLiveRoomStatus(status, {
        obsOverlayActive: false,
        autoBroadcastEnabled: false,
      }),
    ).toBe(status);
  });
});
