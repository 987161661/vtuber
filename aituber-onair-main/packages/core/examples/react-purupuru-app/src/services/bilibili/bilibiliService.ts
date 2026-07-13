import type { LiveRoomEvent, LiveRoomStatus } from '../live-platform/types';

/** @deprecated Use LiveRoomEvent. Kept for existing Bilibili integrations. */
export type BilibiliRoomMessage = LiveRoomEvent;

export interface BilibiliSupervisorStatus extends LiveRoomStatus {
  roomId?: number;
  retryMs?: number;
}
