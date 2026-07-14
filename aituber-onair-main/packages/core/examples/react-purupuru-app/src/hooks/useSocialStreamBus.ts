import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveComment } from '@aituber-onair/comment-intelligence';
import type { SocialStreamNinjaConnectorSettings } from '../types/settings';
import type {
  LivePlatformReply,
  LivePlatformReplyResult,
} from '../services/live-platform/types';

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
  sources?: unknown;
  chatSources?: unknown;
};

function normalizePlatform(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : 'web';
}

function normalizePayload(payload: SocialStreamPayload): LiveComment | null {
  const text =
    typeof payload.chatmessage === 'string'
      ? payload.chatmessage.trim()
      : '';
  const authorName =
    typeof payload.chatname === 'string' ? payload.chatname.trim() : '';
  if (!text || !authorName) return null;

  const platform = normalizePlatform(payload.type);
  const timestamp =
    typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
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
      ...(typeof payload.chatimg === 'string'
        ? { avatarUrl: payload.chatimg }
        : {}),
    },
    metadata: {
      sourcePlatform: platform,
      platformId: platform,
      connectorId: 'social-stream-ninja',
      streamBus: 'social-stream',
    },
  };
}

function extractSources(payload: SocialStreamPayload): string[] {
  const candidate = payload.sources ?? payload.chatSources;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (typeof item === 'string') return [normalizePlatform(item)];
    if (!item || typeof item !== 'object') return [];
    const value = (item as { type?: unknown; source?: unknown }).type ??
      (item as { source?: unknown }).source;
    return typeof value === 'string' ? [normalizePlatform(value)] : [];
  });
}

/**
 * Bidirectional Social Stream Ninja connector. Channel 4 receives chat while
 * channel 1 carries targeted remote-control commands back to the extension.
 */
export function useSocialStreamBus(
  settings: SocialStreamNinjaConnectorSettings,
  onComment: (comments: LiveComment[]) => void,
) {
  const [health, setHealth] = useState<StreamBusHealth>('disabled');
  const [error, setError] = useState('');
  const [discoveredPlatforms, setDiscoveredPlatforms] = useState<string[]>([]);
  const onCommentRef = useRef(onComment);
  const controlSocketRef = useRef<WebSocket | null>(null);
  const sentKeysRef = useRef(new Set<string>());
  const fingerprintsRef = useRef(new Map<string, number>());

  useEffect(() => {
    onCommentRef.current = onComment;
  }, [onComment]);

  const isEnabled = settings.enabled && Boolean(settings.sessionId.trim());
  const baseUrl = settings.serverUrl.trim().replace(/\/$/, '');
  const hasValidUrl = /^wss:\/\//.test(baseUrl);
  const enabledPlatforms = Object.entries(settings.platforms)
    .filter(([, connection]) => connection.enabled)
    .map(([platformId]) => platformId);
  const enabledPlatformKey = enabledPlatforms.sort().join('|');

  useEffect(() => {
    if (!isEnabled || !hasValidUrl) {
      controlSocketRef.current = null;
      return;
    }
    const connectingTimer = window.setTimeout(() => setHealth('connecting'), 0);
    const sessionId = encodeURIComponent(settings.sessionId.trim());
    const listener = new WebSocket(`${baseUrl}/join/${sessionId}/4`);
    const control = new WebSocket(`${baseUrl}/join/${sessionId}/1`);
    controlSocketRef.current = control;
    let listenerReady = false;
    let controlReady = false;
    const enabledPlatformSet = new Set(
      enabledPlatformKey.split('|').filter(Boolean),
    );
    const updateConnected = () => {
      if (listenerReady && controlReady) {
        setHealth('connected');
        setError('');
        control.send(JSON.stringify({ action: 'getChatSources' }));
      }
    };
    listener.onopen = () => {
      listenerReady = true;
      updateConnected();
    };
    control.onopen = () => {
      controlReady = true;
      updateConnected();
    };
    const fail = () => {
      setHealth('error');
      setError(
        '无法连接 Social Stream Ninja。请确认 Session ID，并在 SSN 中启用远程 API 和聊天消息发布。',
      );
    };
    listener.onerror = fail;
    control.onerror = fail;
    const closed = () =>
      setHealth((current) => (current === 'error' ? current : 'connecting'));
    listener.onclose = closed;
    control.onclose = closed;
    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(String(event.data)) as SocialStreamPayload;
        const sources = extractSources(payload);
        if (sources.length) {
          setDiscoveredPlatforms((current) =>
            [...new Set([...current, ...sources])].sort(),
          );
        }
        const comment = normalizePayload(payload);
        if (!comment) return;
        const sourcePlatform = String(
          comment.metadata?.sourcePlatform || 'web',
        );
        setDiscoveredPlatforms((current) =>
          current.includes(sourcePlatform)
            ? current
            : [...current, sourcePlatform].sort(),
        );
        if (!enabledPlatformSet.has(sourcePlatform)) return;
        const key = `${sourcePlatform}:${comment.author.id}:${comment.text}`;
        const now = Date.now();
        const previous = fingerprintsRef.current.get(key);
        if (previous && now - previous < 30_000) return;
        fingerprintsRef.current.set(key, now);
        for (const [fingerprint, seenAt] of fingerprintsRef.current) {
          if (now - seenAt > 10 * 60_000)
            fingerprintsRef.current.delete(fingerprint);
        }
        onCommentRef.current([comment]);
      } catch {
        // Control responses and keep-alive payloads share these channels.
      }
    };
    listener.onmessage = handleMessage;
    control.onmessage = handleMessage;
    return () => {
      window.clearTimeout(connectingTimer);
      listener.close();
      control.close();
      if (controlSocketRef.current === control) controlSocketRef.current = null;
    };
  }, [baseUrl, enabledPlatformKey, hasValidUrl, isEnabled, settings.sessionId]);

  const send = useCallback(
    async (
      platformId: string,
      reply: LivePlatformReply,
    ): Promise<LivePlatformReplyResult> => {
      if (sentKeysRef.current.has(reply.idempotencyKey)) {
        return {
          ok: true,
          duplicate: true,
          chunksTotal: 1,
          chunksSent: 1,
          state: 'accepted',
        };
      }
      const socket = controlSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('social_stream_control_not_connected');
      }
      socket.send(
        JSON.stringify({
          action: 'sendChat',
          target: platformId,
          value: reply.message,
        }),
      );
      sentKeysRef.current.add(reply.idempotencyKey);
      while (sentKeysRef.current.size > 2000) {
        const oldest = sentKeysRef.current.values().next().value;
        if (oldest) sentKeysRef.current.delete(oldest);
      }
      return {
        ok: true,
        duplicate: false,
        chunksTotal: 1,
        chunksSent: 1,
        state: 'accepted',
      };
    },
    [],
  );

  if (!isEnabled) {
    return {
      health: 'disabled' as const,
      error: '',
      discoveredPlatforms,
      send,
    };
  }
  if (!hasValidUrl) {
    return {
      health: 'error' as const,
      error: '消息总线地址必须使用 wss://',
      discoveredPlatforms,
      send,
    };
  }
  return { health, error, discoveredPlatforms, send };
}
