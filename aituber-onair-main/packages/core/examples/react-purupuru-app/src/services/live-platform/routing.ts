import type {
  SocialStreamSettings,
  StreamSettings,
} from '../../types/settings';

export interface LiveConnectorRouting {
  ordinaryRoadConnected: boolean;
  consumeOrdinaryRoadBilibiliEvents: boolean;
  mirrorSpeechToBilibili: boolean;
  ssnHandlesBilibili: boolean;
}

export function resolveLiveConnectorRouting(
  stream: Pick<StreamSettings, 'bilibiliEnabled' | 'bilibiliReplyEnabled'>,
  socialStream: Pick<SocialStreamSettings, 'enabled' | 'platforms'>,
): LiveConnectorRouting {
  const ssnHandlesBilibili =
    socialStream.enabled && socialStream.platforms.includes('bilibili');
  const ordinaryRoadConnected = stream.bilibiliEnabled;

  return {
    ordinaryRoadConnected,
    consumeOrdinaryRoadBilibiliEvents:
      ordinaryRoadConnected && !ssnHandlesBilibili,
    mirrorSpeechToBilibili:
      ordinaryRoadConnected && stream.bilibiliReplyEnabled,
    ssnHandlesBilibili,
  };
}
