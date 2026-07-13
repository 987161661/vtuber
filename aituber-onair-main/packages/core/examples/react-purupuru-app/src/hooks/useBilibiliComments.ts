import type {
  BilibiliRoomMessage,
  BilibiliSupervisorStatus,
} from '../services/bilibili/bilibiliService';
import { bilibiliEventAdapter } from '../services/live-platform/bilibili';
import { useLivePlatformEvents } from './useLivePlatformEvents';

interface UseBilibiliCommentsParams {
  isEnabled: boolean;
  clientKey?: string;
  onComment: (comment: BilibiliRoomMessage) => void;
  onStatus?: (status: BilibiliSupervisorStatus) => void;
}

/** Compatibility wrapper: Bilibili is now one LivePlatformEventAdapter. */
export function useBilibiliComments({
  isEnabled,
  clientKey = 'browser-runtime',
  onComment,
  onStatus,
}: UseBilibiliCommentsParams): void {
  useLivePlatformEvents({
    adapter: bilibiliEventAdapter,
    isEnabled,
    clientKey,
    onEvent: onComment,
    onStatus,
  });
}
