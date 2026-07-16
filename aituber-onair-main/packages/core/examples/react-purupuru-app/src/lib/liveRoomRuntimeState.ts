import type { LiveRoomStatus } from '../services/live-platform/types';

export interface LiveRoomRuntimeAuthority {
  obsOverlayActive: boolean;
  autoBroadcastEnabled: boolean;
}

/**
 * The platform bridge can stay connected while reporting an unreliable
 * `isLive: false`.  The loaded OBS overlay is the operational authority for
 * this app: when it is active, auto broadcast is enabled, and the bridge is
 * online, the host must remain live so quiet-room scheduling is not cancelled.
 */
export function resolveEffectiveLiveRoomStatus(
  status: LiveRoomStatus,
  authority: LiveRoomRuntimeAuthority,
): LiveRoomStatus {
  const platformOnlineCounts = Object.values(status.platforms || {})
    .map((platform) => platform.onlineCount)
    .filter((count): count is number => Number.isFinite(count));
  const nestedOnlineCount = platformOnlineCounts.length
    ? Math.max(...platformOnlineCounts)
    : undefined;
  const onlineCount =
    nestedOnlineCount === undefined
      ? status.onlineCount
      : Math.max(status.onlineCount || 0, nestedOnlineCount);
  const obsRuntimeIsLive =
    status.state === 'online' &&
    authority.obsOverlayActive &&
    authority.autoBroadcastEnabled;

  const isLive = status.isLive === true || obsRuntimeIsLive;
  if (status.isLive === isLive && status.onlineCount === onlineCount)
    return status;
  return { ...status, isLive, onlineCount };
}
