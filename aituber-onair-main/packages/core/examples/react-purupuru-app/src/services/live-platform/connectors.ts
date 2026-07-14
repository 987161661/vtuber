import type {
  LiveConnectorId,
  LiveConnectorSettings,
  PlatformConnectionSettings,
  PlatformOutboundPolicy,
} from '../../types/settings';

export type SpeechDeliveryKind =
  | 'viewer-reply'
  | 'proactive-speech'
  | 'operator-broadcast';

export interface PlatformCapabilities {
  inbound: boolean;
  outbound: boolean;
  credential: boolean;
  events: Array<
    'comment' | 'gift' | 'superchat' | 'entry' | 'like' | 'status' | 'stats'
  >;
}

export interface ConnectorPlatformManifest {
  id: string;
  label: string;
  capabilities: PlatformCapabilities;
  note?: string;
}

export interface ConnectorManifest {
  id: LiveConnectorId;
  label: string;
  platforms: ConnectorPlatformManifest[];
  discoversPlatforms?: boolean;
}

export interface SpeechDeliveryContext {
  eventId: string;
  kind: SpeechDeliveryKind;
  sourceConnectorId?: LiveConnectorId;
  sourcePlatformId?: string;
}

export interface SpeechDeliveryTarget {
  connectorId: LiveConnectorId;
  platformId: string;
  roomId: string;
}

export const DEFAULT_OUTBOUND_POLICY: PlatformOutboundPolicy = {
  viewerReplies: false,
  proactiveSpeech: false,
  operatorBroadcasts: false,
};

export const ORDINARYROAD_PLATFORMS: ConnectorPlatformManifest[] = [
  {
    id: 'bilibili',
    label: '哔哩哔哩',
    capabilities: {
      inbound: true,
      outbound: true,
      credential: true,
      events: ['comment', 'gift', 'superchat', 'entry', 'like', 'status', 'stats'],
    },
  },
  {
    id: 'douyu',
    label: '斗鱼',
    capabilities: {
      inbound: true,
      outbound: true,
      credential: true,
      events: ['comment', 'gift', 'superchat', 'entry', 'status'],
    },
  },
  {
    id: 'huya',
    label: '虎牙',
    capabilities: {
      inbound: true,
      outbound: true,
      credential: true,
      events: ['comment', 'gift', 'entry', 'status'],
    },
  },
  {
    id: 'douyin',
    label: '抖音',
    capabilities: {
      inbound: true,
      outbound: false,
      credential: false,
      events: ['comment', 'gift', 'entry', 'like', 'status', 'stats'],
    },
    note: 'OrdinaryRoad 当前只保证接收；文字回写尚未稳定实现。',
  },
  {
    id: 'kuaishou',
    label: '快手',
    capabilities: {
      inbound: true,
      outbound: true,
      credential: true,
      events: ['comment', 'gift', 'like', 'stats'],
    },
  },
];

export const CONNECTOR_MANIFESTS: Record<LiveConnectorId, ConnectorManifest> = {
  ordinaryroad: {
    id: 'ordinaryroad',
    label: 'OrdinaryRoad',
    platforms: ORDINARYROAD_PLATFORMS,
  },
  'social-stream-ninja': {
    id: 'social-stream-ninja',
    label: 'Social Stream Ninja',
    platforms: [],
    discoversPlatforms: true,
  },
};

export function createPlatformConnection(
  roomId = '',
  enabled = false,
  outbound: Partial<PlatformOutboundPolicy> = {},
): PlatformConnectionSettings {
  return {
    enabled,
    roomId,
    outbound: { ...DEFAULT_OUTBOUND_POLICY, ...outbound },
  };
}

export function platformOwner(
  settings: LiveConnectorSettings,
  platformId: string,
): LiveConnectorId | undefined {
  if (
    settings.ordinaryRoad.enabled &&
    settings.ordinaryRoad.platforms[platformId]?.enabled
  ) {
    return 'ordinaryroad';
  }
  if (
    settings.socialStreamNinja.enabled &&
    settings.socialStreamNinja.platforms[platformId]?.enabled
  ) {
    return 'social-stream-ninja';
  }
  return undefined;
}

function policyAllows(
  connection: PlatformConnectionSettings,
  kind: SpeechDeliveryKind,
) {
  if (kind === 'viewer-reply') return connection.outbound.viewerReplies;
  if (kind === 'proactive-speech') return connection.outbound.proactiveSpeech;
  return connection.outbound.operatorBroadcasts;
}

export function resolveSpeechDeliveryTargets(
  settings: LiveConnectorSettings,
  context: SpeechDeliveryContext,
): SpeechDeliveryTarget[] {
  const targets: SpeechDeliveryTarget[] = [];
  const entries: Array<[
    LiveConnectorId,
    boolean,
    Record<string, PlatformConnectionSettings>,
  ]> = [
    ['ordinaryroad', settings.ordinaryRoad.enabled, settings.ordinaryRoad.platforms],
    [
      'social-stream-ninja',
      settings.socialStreamNinja.enabled,
      settings.socialStreamNinja.platforms,
    ],
  ];

  for (const [connectorId, connectorEnabled, platforms] of entries) {
    if (!connectorEnabled) continue;
    for (const [platformId, connection] of Object.entries(platforms)) {
      if (!connection.enabled || !policyAllows(connection, context.kind)) continue;
      if (platformOwner(settings, platformId) !== connectorId) continue;
      if (
        context.kind === 'viewer-reply' &&
        (context.sourceConnectorId !== connectorId ||
          context.sourcePlatformId !== platformId)
      ) {
        continue;
      }
      const manifest = CONNECTOR_MANIFESTS[connectorId].platforms.find(
        (item) => item.id === platformId,
      );
      if (manifest && !manifest.capabilities.outbound) continue;
      targets.push({ connectorId, platformId, roomId: connection.roomId });
    }
  }
  return targets;
}

export function transferPlatformOwnership(
  settings: LiveConnectorSettings,
  platformId: string,
  target: LiveConnectorId,
): LiveConnectorSettings {
  const ordinary = settings.ordinaryRoad.platforms[platformId];
  const social = settings.socialStreamNinja.platforms[platformId];
  return {
    schemaVersion: 1,
    ordinaryRoad: {
      ...settings.ordinaryRoad,
      platforms: {
        ...settings.ordinaryRoad.platforms,
        ...(ordinary || target === 'ordinaryroad'
          ? {
              [platformId]: {
                ...(ordinary ?? createPlatformConnection()),
                enabled: target === 'ordinaryroad',
              },
            }
          : {}),
      },
    },
    socialStreamNinja: {
      ...settings.socialStreamNinja,
      platforms: {
        ...settings.socialStreamNinja.platforms,
        ...(social || target === 'social-stream-ninja'
          ? {
              [platformId]: {
                ...(social ?? createPlatformConnection()),
                enabled: target === 'social-stream-ninja',
              },
            }
          : {}),
      },
    },
  };
}
