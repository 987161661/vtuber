import { useEffect, useRef, useState } from 'react';
import type { LiveComment } from '@aituber-onair/comment-intelligence';
import type { SocialStreamSettings } from '../types/settings';

export type StreamBusHealth =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'error';

type SocialStreamPayload = {
  chatname?: unknown;
  chatmessage?: unknown;
  chatimg?: unknown;
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
};

function normalizePayload(payload: SocialStreamPayload): LiveComment | null {
  const text = typeof payload.chatmessage === 'string' ? payload.chatmessage.trim() : '';
  const authorName = typeof payload.chatname === 'string' ? payload.chatname.trim() : '';
  if (!text || !authorName) return null;

  const platform = typeof payload.type === 'string' ? payload.type.toLowerCase() : 'web';
  const timestamp = typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
    ? payload.timestamp
    : Date.now();
  const rawId = typeof payload.id === 'string' ? payload.id : '';
  const id = rawId || `ssn:${platform}:${authorName}:${timestamp}:${text}`;

  return {
    id,
    platform: 'web',
    text,
    timestamp,
    author: {
      id: `${platform}:${authorName}`,
      name: authorName,
      displayName: authorName,
      ...(typeof payload.chatimg === 'string' ? { avatarUrl: payload.chatimg } : {}),
    },
    metadata: { sourcePlatform: platform, streamBus: 'social-stream' },
  };
}

/**
 * Optional Social Stream Ninja listener. It deliberately transports only
 * audience events: all LLM, TTS, and avatar work remains local to this app.
 */
export function useSocialStreamBus(
  settings: SocialStreamSettings,
  onComment: (comments: LiveComment[]) => void,
) {
  const [health, setHealth] = useState<StreamBusHealth>('disabled');
  const [error, setError] = useState('');
  const onCommentRef = useRef(onComment);
  const fingerprintsRef = useRef(new Map<string, number>());

  useEffect(() => {
    onCommentRef.current = onComment;
  }, [onComment]);

  const isEnabled = settings.enabled && Boolean(settings.sessionId.trim());
  const baseUrl = settings.serverUrl.trim().replace(/\/$/, '');
  const hasValidUrl = /^wss:\/\//.test(baseUrl);

  useEffect(() => {
    if (!isEnabled || !hasValidUrl) return;
    const socket = new WebSocket(`${baseUrl}/join/${encodeURIComponent(settings.sessionId.trim())}/4`);
    socket.onopen = () => {
      setHealth('connected');
      setError('');
    };
    socket.onerror = () => {
      setHealth('error');
      setError('无法连接 Social Stream Ninja。请检查 session 与远程 API 开关。');
    };
    socket.onclose = () => {
      setHealth((current) => (current === 'error' ? current : 'disabled'));
    };
    socket.onmessage = (event) => {
      try {
        const comment = normalizePayload(JSON.parse(String(event.data)) as SocialStreamPayload);
        if (!comment) return;
        const sourcePlatform = String(comment.metadata?.sourcePlatform || 'web');
        if (!settings.platforms.includes(sourcePlatform)) return;
        const key = `${comment.metadata?.sourcePlatform}:${comment.author.id}:${comment.text}`;
        const now = Date.now();
        const previous = fingerprintsRef.current.get(key);
        if (previous && now - previous < 30_000) return;
        fingerprintsRef.current.set(key, now);
        for (const [fingerprint, seenAt] of fingerprintsRef.current) {
          if (now - seenAt > 10 * 60_000) fingerprintsRef.current.delete(fingerprint);
        }
        onCommentRef.current([comment]);
      } catch {
        // SSN can publish non-chat control messages on the same relay.
      }
    };

    return () => socket.close();
  }, [baseUrl, hasValidUrl, isEnabled, settings.platforms, settings.sessionId]);

  if (!isEnabled) return { health: 'disabled' as const, error: '' };
  if (!hasValidUrl) {
    return { health: 'error' as const, error: '消息总线地址必须使用 wss://' };
  }
  return { health: health === 'disabled' ? 'connecting' : health, error };
}
