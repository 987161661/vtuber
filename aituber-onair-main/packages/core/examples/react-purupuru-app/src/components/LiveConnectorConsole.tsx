import { useMemo, useState } from 'react';
import type {
  LiveConnectorId,
  LiveConnectorSettings,
  PlatformConnectionSettings,
  PlatformOutboundPolicy,
} from '../types/settings';
import type { LiveRoomStatus } from '../services/live-platform/types';
import {
  createPlatformConnection,
  ORDINARYROAD_PLATFORMS,
  platformOwner,
  transferPlatformOwnership,
} from '../services/live-platform/connectors';
import {
  clearOrdinaryRoadCredential,
  saveOrdinaryRoadCredential,
  saveOrdinaryRoadPlatformConfig,
} from '../services/live-platform/ordinaryRoad';
import type { StreamBusHealth } from '../hooks/useSocialStreamBus';

interface LiveConnectorConsoleProps {
  settings: LiveConnectorSettings;
  ordinaryRoadStatus: LiveRoomStatus;
  socialBusHealth: StreamBusHealth;
  socialBusError: string;
  socialDiscoveredPlatforms: string[];
  onChange: (update: (current: LiveConnectorSettings) => LiveConnectorSettings) => void;
}

type ConnectorTab = LiveConnectorId;
type PolicyKey = keyof PlatformOutboundPolicy;

const policyLabels: Record<PolicyKey, string> = {
  viewerReplies: '观众回复',
  proactiveSpeech: '主动发言',
  operatorBroadcasts: '控制台播报',
};

function connectionStateLabel(state?: string) {
  if (state === 'connected' || state === 'online') return '已连接';
  if (state === 'connecting') return '连接中';
  if (state === 'error') return '连接失败';
  if (state === 'disabled') return '未启用';
  return state || '待配置';
}

function credentialLabel(state?: string) {
  if (state === 'valid') return '有效';
  if (state === 'invalid') return '失效';
  if (state === 'configured') return '已配置';
  if (state === 'unknown') return '无法验证';
  return '未配置';
}

function updatePlatform(
  settings: LiveConnectorSettings,
  connectorId: ConnectorTab,
  platformId: string,
  update: Partial<PlatformConnectionSettings>,
) {
  const connector =
    connectorId === 'ordinaryroad'
      ? settings.ordinaryRoad
      : settings.socialStreamNinja;
  const current = connector.platforms[platformId] ?? createPlatformConnection();
  const nextConnection = {
    ...current,
    ...update,
    outbound: { ...current.outbound, ...update.outbound },
  };
  if (connectorId === 'ordinaryroad') {
    return {
      ...settings,
      ordinaryRoad: {
        ...settings.ordinaryRoad,
        platforms: {
          ...settings.ordinaryRoad.platforms,
          [platformId]: nextConnection,
        },
      },
    };
  }
  return {
    ...settings,
    socialStreamNinja: {
      ...settings.socialStreamNinja,
      platforms: {
        ...settings.socialStreamNinja.platforms,
        [platformId]: nextConnection,
      },
    },
  };
}

export function LiveConnectorConsole(props: LiveConnectorConsoleProps) {
  const [tab, setTab] = useState<ConnectorTab>('ordinaryroad');
  const [selectedByTab, setSelectedByTab] = useState<Record<ConnectorTab, string>>({
    ordinaryroad: 'bilibili',
    'social-stream-ninja': '',
  });
  const [credentialDraft, setCredentialDraft] = useState('');
  const [customSource, setCustomSource] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const ordinary = props.settings.ordinaryRoad;
  const social = props.settings.socialStreamNinja;
  const socialPlatforms = useMemo(
    () =>
      [...new Set([
        ...props.socialDiscoveredPlatforms,
        ...Object.keys(social.platforms),
      ])].sort(),
    [props.socialDiscoveredPlatforms, social.platforms],
  );
  const platformIds =
    tab === 'ordinaryroad'
      ? ORDINARYROAD_PLATFORMS.map((platform) => platform.id)
      : socialPlatforms;
  const selectedPlatform =
    selectedByTab[tab] || platformIds[0] || '';
  const manifest = ORDINARYROAD_PLATFORMS.find(
    (platform) => platform.id === selectedPlatform,
  );
  const currentConnector = tab === 'ordinaryroad' ? ordinary : social;
  const connection = selectedPlatform
    ? currentConnector.platforms[selectedPlatform] ?? createPlatformConnection()
    : createPlatformConnection();
  const owner = selectedPlatform
    ? platformOwner(props.settings, selectedPlatform)
    : undefined;
  const platformStatus = props.ordinaryRoadStatus.platforms?.[selectedPlatform];
  const effectiveRoomId = connection.roomId || platformStatus?.roomId || '';
  const connectorEnabled = currentConnector.enabled;

  const choosePlatform = (platformId: string) => {
    setSelectedByTab((current) => ({ ...current, [tab]: platformId }));
    setCredentialDraft('');
    setNotice('');
  };

  const saveOrdinaryConfig = async (
    platformId: string,
    enabled: boolean,
    roomId: string,
  ) => {
    setBusy(true);
    try {
      await saveOrdinaryRoadPlatformConfig(ordinary.gatewayUrl, platformId, {
        enabled: ordinary.enabled && enabled,
        roomId,
      });
      setNotice('平台配置已同步到本地网关。');
    } catch (error) {
      setNotice(`网关同步失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleConnector = async (enabled: boolean) => {
    props.onChange((current) =>
      tab === 'ordinaryroad'
        ? { ...current, ordinaryRoad: { ...current.ordinaryRoad, enabled } }
        : {
            ...current,
            socialStreamNinja: { ...current.socialStreamNinja, enabled },
          },
    );
    if (tab === 'ordinaryroad') {
      setBusy(true);
      await Promise.allSettled(
        Object.entries(ordinary.platforms).map(([platformId, item]) =>
          saveOrdinaryRoadPlatformConfig(ordinary.gatewayUrl, platformId, {
            enabled: enabled && item.enabled,
            roomId:
              item.roomId ||
              props.ordinaryRoadStatus.platforms?.[platformId]?.roomId ||
              '',
          }),
        ),
      );
      setBusy(false);
    }
  };

  const togglePlatform = async (enabled: boolean) => {
    if (!selectedPlatform) return;
    const existingOwner = platformOwner(props.settings, selectedPlatform);
    if (enabled && existingOwner && existingOwner !== tab) {
      const accepted = window.confirm(
        `${selectedPlatform} 当前由 ${existingOwner} 接管。是否原子转移到 ${tab}？`,
      );
      if (!accepted) return;
    }
    props.onChange((current) => {
      const transferred = enabled
        ? transferPlatformOwnership(current, selectedPlatform, tab)
        : current;
      return updatePlatform(transferred, tab, selectedPlatform, { enabled });
    });
    if (tab === 'ordinaryroad') {
      await saveOrdinaryConfig(selectedPlatform, enabled, effectiveRoomId);
    }
  };

  const updatePolicy = (key: PolicyKey, enabled: boolean) => {
    if (!selectedPlatform) return;
    props.onChange((current) =>
      updatePlatform(current, tab, selectedPlatform, {
        outbound: { ...connection.outbound, [key]: enabled },
      }),
    );
  };

  const addManualSource = () => {
    const platformId = customSource.trim().toLowerCase();
    if (!platformId) return;
    props.onChange((current) =>
      updatePlatform(current, 'social-stream-ninja', platformId, {}),
    );
    setSelectedByTab((current) => ({
      ...current,
      'social-stream-ninja': platformId,
    }));
    setCustomSource('');
  };

  const submitCredential = async () => {
    if (!selectedPlatform || !credentialDraft.trim()) return;
    setBusy(true);
    try {
      await saveOrdinaryRoadCredential(
        ordinary.gatewayUrl,
        selectedPlatform,
        credentialDraft,
      );
      setNotice('凭据已提交给本地网关；输入框已清空。');
    } catch (error) {
      setNotice(`凭据提交失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setCredentialDraft('');
      setBusy(false);
    }
  };

  return (
    <div className="live-connector-console">
      <div className="connector-tabs" role="tablist" aria-label="直播连接器">
        <button
          role="tab"
          aria-selected={tab === 'ordinaryroad'}
          className={tab === 'ordinaryroad' ? 'active ordinaryroad' : ''}
          onClick={() => setTab('ordinaryroad')}
        >
          <span>国内平台客户端</span>
          <strong>OrdinaryRoad</strong>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'social-stream-ninja'}
          className={tab === 'social-stream-ninja' ? 'active ssn' : ''}
          onClick={() => setTab('social-stream-ninja')}
        >
          <span>浏览器聚合总线</span>
          <strong>Social Stream Ninja</strong>
        </button>
      </div>

      <div className="connector-command-bar">
        <div>
          <span className={`health-dot ${tab === 'ordinaryroad' ? props.ordinaryRoadStatus.state : props.socialBusHealth}`} />
          {tab === 'ordinaryroad'
            ? connectionStateLabel(props.ordinaryRoadStatus.state)
            : connectionStateLabel(props.socialBusHealth)}
        </div>
        <label className="master-toggle">
          <input
            type="checkbox"
            checked={connectorEnabled}
            onChange={(event) => void toggleConnector(event.target.checked)}
          />
          启用此连接器
        </label>
      </div>

      {tab === 'social-stream-ninja' && (
        <div className="ssn-prerequisite">
          <strong>SSN 必要条件</strong>
          <span>扩展中须同时开启“远程 API”和“向 API server 发布聊天消息”。</span>
        </div>
      )}

      <div className="connector-console-body">
        <aside className="platform-rail" aria-label="平台列表">
          {platformIds.map((platformId) => {
            const item = currentConnector.platforms[platformId];
            const itemOwner = platformOwner(props.settings, platformId);
            const status = props.ordinaryRoadStatus.platforms?.[platformId];
            const label =
              ORDINARYROAD_PLATFORMS.find((entry) => entry.id === platformId)?.label ??
              platformId;
            return (
              <button
                key={platformId}
                className={selectedPlatform === platformId ? 'selected' : ''}
                onClick={() => choosePlatform(platformId)}
              >
                <span>{label}</span>
                <small>
                  {itemOwner && itemOwner !== tab
                    ? '被另一连接器接管'
                    : status?.state
                      ? connectionStateLabel(status.state)
                      : item?.enabled
                        ? '已启用'
                        : '待配置'}
                </small>
              </button>
            );
          })}
          {tab === 'social-stream-ninja' && (
            <div className="manual-source">
              <input
                value={customSource}
                onChange={(event) => setCustomSource(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addManualSource();
                }}
                placeholder="手动平台标识"
                aria-label="手动平台标识"
              />
              <button onClick={addManualSource}>添加</button>
            </div>
          )}
        </aside>

        <section className="platform-editor">
          {!selectedPlatform ? (
            <div className="empty-platform-state">
              <strong>尚未发现平台</strong>
              <span>打开对应直播页面并启用 SSN 扩展，或手动添加平台标识。</span>
            </div>
          ) : (
            <>
              <header>
                <div>
                  <span className="connector-kicker">{tab}</span>
                  <h2>{manifest?.label ?? selectedPlatform}</h2>
                </div>
                <label className="platform-enable">
                  <input
                    type="checkbox"
                    checked={connection.enabled && owner === tab}
                    onChange={(event) => void togglePlatform(event.target.checked)}
                    disabled={!connectorEnabled || busy}
                  />
                  接管平台
                </label>
              </header>

              {tab === 'ordinaryroad' ? (
                <div className="platform-fields">
                  <label>
                    房间 ID
                    <input
                      value={effectiveRoomId}
                      onChange={(event) => {
                        const roomId = event.target.value;
                        props.onChange((current) =>
                          updatePlatform(current, tab, selectedPlatform, { roomId }),
                        );
                      }}
                      onBlur={() =>
                        void saveOrdinaryConfig(
                          selectedPlatform,
                          connection.enabled,
                          effectiveRoomId,
                        )
                      }
                      placeholder="每个平台配置一个直播间"
                    />
                  </label>
                  {manifest?.capabilities.credential && (
                    <div className="credential-field">
                      <label>
                        Cookie / 登录凭据
                        <input
                          type="password"
                          autoComplete="off"
                          value={credentialDraft}
                          onChange={(event) => setCredentialDraft(event.target.value)}
                          placeholder={`状态：${credentialLabel(platformStatus?.credentialState)}`}
                        />
                      </label>
                      <button disabled={!credentialDraft.trim() || busy} onClick={() => void submitCredential()}>
                        安全保存
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          void clearOrdinaryRoadCredential(ordinary.gatewayUrl, selectedPlatform)
                            .then(() => setNotice('本地凭据已清除。'))
                            .catch((error) => setNotice(`清除失败：${String(error)}`));
                        }}
                      >
                        清除
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="platform-fields ssn-fields">
                  <label>
                    Session ID
                    <input
                      value={social.sessionId}
                      onChange={(event) =>
                        props.onChange((current) => ({
                          ...current,
                          socialStreamNinja: {
                            ...current.socialStreamNinja,
                            sessionId: event.target.value,
                          },
                        }))
                      }
                      placeholder="SSN session ID"
                    />
                  </label>
                  <label>
                    API WebSocket
                    <input
                      value={social.serverUrl}
                      onChange={(event) =>
                        props.onChange((current) => ({
                          ...current,
                          socialStreamNinja: {
                            ...current.socialStreamNinja,
                            serverUrl: event.target.value,
                          },
                        }))
                      }
                      placeholder="wss://io.socialstream.ninja"
                    />
                  </label>
                </div>
              )}

              <div className="capability-row">
                <span>接收：{tab === 'ordinaryroad' && manifest?.capabilities.inbound === false ? '不支持' : '支持'}</span>
                <span>
                  回写：{tab === 'ordinaryroad' && manifest?.capabilities.outbound === false ? '仅接收' : '支持'}
                </span>
                {platformStatus?.lastEventAt && <span>最近事件：{new Date(platformStatus.lastEventAt).toLocaleTimeString()}</span>}
                {platformStatus?.lastSentAt && <span>最后发送：{new Date(platformStatus.lastSentAt).toLocaleTimeString()}</span>}
              </div>
              {manifest?.note && <p className="capability-note">{manifest.note}</p>}

              <fieldset className="delivery-policies">
                <legend>文字回写策略</legend>
                {(Object.keys(policyLabels) as PolicyKey[]).map((key) => {
                  const unsupported =
                    tab === 'ordinaryroad' && manifest?.capabilities.outbound === false;
                  return (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={!unsupported && connection.outbound[key]}
                        disabled={!connection.enabled || unsupported}
                        onChange={(event) => updatePolicy(key, event.target.checked)}
                      />
                      <span>{policyLabels[key]}</span>
                      <small>
                        {unsupported
                          ? '上游未提供可靠文字回写'
                          : key === 'viewerReplies'
                            ? '只回到消息来源平台'
                            : '按此平台独立开关分发'}
                      </small>
                    </label>
                  );
                })}
              </fieldset>
            </>
          )}
          {(notice || props.socialBusError) && (
            <p className="connector-notice" role="status">
              {notice || props.socialBusError}
            </p>
          )}
        </section>
      </div>

      <div className="signal-route-strip" aria-label="实时信号路由">
        <span className={connectorEnabled ? 'active' : ''}>{tab === 'ordinaryroad' ? 'OrdinaryRoad' : 'SSN'}</span>
        <i>→</i><span>{selectedPlatform || '等待平台'}</span>
        <i>→</i><span>回复队列</span>
        <i>→</i><span>TTS 开始</span>
        <i>→</i><span className={connection.enabled ? 'active' : ''}>文字回写</span>
      </div>
    </div>
  );
}
