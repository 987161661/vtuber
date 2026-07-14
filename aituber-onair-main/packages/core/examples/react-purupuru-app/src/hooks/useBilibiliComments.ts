import type {
  BilibiliRoomMessage,
  BilibiliSupervisorStatus,
} from '../services/bilibili/bilibiliService';
import { bilibiliEventAdapter } from '../services/live-platform/bilibili';
import type { LivePlatformEventAdapter } from '../services/live-platform/types';
import type {
  LiveRoomEvent,
  LiveRoomStatus,
} from '../services/live-platform/types';
import { useLivePlatformEvents } from './useLivePlatformEvents';

interface UseBilibiliCommentsParams {
  adapter?: LivePlatformEventAdapter<LiveRoomEvent, LiveRoomStatus>;
  isEnabled: boolean;
  clientKey?: string;
  onComment: (comment: BilibiliRoomMessage) => void;
  onStatus?: (status: BilibiliSupervisorStatus) => void;
}

/** Compatibility wrapper: Bilibili is now one LivePlatformEventAdapter. */
export function useBilibiliComments({
  adapter = bilibiliEventAdapter,
  isEnabled,
  clientKey = 'browser-runtime',
  onComment,
  onStatus,
}: UseBilibiliCommentsParams): void {
  useLivePlatformEvents({
    adapter,
    isEnabled,
    clientKey,
    onEvent: onComment,
    onStatus,
  });
}
