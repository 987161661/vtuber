import { useMemo, useState, type CSSProperties } from 'react';
import {
  applySimulatorEventToViewer,
  createSimulatorRoomEvent,
  SIMULATOR_PLATFORM_PROFILES,
  summarizeSimulatorEvents,
  type SimulatorInteractionType,
  type SimulatorPlatformProfile,
  type SimulatorViewer,
} from '../lib/simulatorRoom';
import type {
  LiveRoomEvent,
  LiveRoomEventType,
} from '../services/live-platform/types';

interface SimulatorRoomConsoleProps {
  onEmit: (event: LiveRoomEvent) => void;
}

const eventDescriptors: Record<
  SimulatorInteractionType,
  { label: string; hint: string }
> = {
  comment: { label: '发弹幕', hint: '输入观众想说的话' },
  follow: { label: '点关注', hint: '记录一次新增关注' },
  like: { label: '点赞', hint: '模拟连续点赞' },
  gift: { label: '送礼', hint: '选择测试礼物、数量和单价' },
  entry: { label: '进场', hint: '模拟观众进入直播间' },
  superchat: { label: '醒目留言', hint: '模拟付费高亮消息' },
};

const eventLabels: Record<LiveRoomEventType, string> = {
  comment: '弹幕',
  superchat: '醒目留言',
  gift: '礼物',
  guard: '守护',
  follow: '关注',
  like: '点赞',
  entry: '进场',
};

const parityEventOrder: SimulatorInteractionType[] = [
  'comment',
  'follow',
  'like',
  'gift',
  'entry',
  'superchat',
];

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatEventTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function profileStyle(accent: string): CSSProperties {
  return { '--profile-accent': accent } as CSSProperties;
}

function formatViewerSupport(
  viewer: SimulatorViewer,
  platform: SimulatorPlatformProfile,
) {
  return [
    platform.events.includes('follow')
      ? viewer.followed
        ? '已关注'
        : '未关注'
      : null,
    platform.events.includes('like') ? `${viewer.likes} 赞` : null,
    platform.events.includes('gift')
      ? `${viewer.giftValue.toFixed(2)} 礼物价值`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function SimulatorRoomConsole({ onEmit }: SimulatorRoomConsoleProps) {
  const [platformId, setPlatformId] = useState('bilibili');
  const [roomIds, setRoomIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      SIMULATOR_PLATFORM_PROFILES.map((profile) => [
        profile.id,
        `${profile.id}-sim-001`,
      ]),
    ),
  );
  const [viewers, setViewers] = useState<SimulatorViewer[]>([
    {
      id: 'viewer-alice',
      name: '小雨',
      followed: false,
      likes: 0,
      giftValue: 0,
    },
    { id: 'viewer-bob', name: '北辰', followed: false, likes: 0, giftValue: 0 },
  ]);
  const [selectedViewerId, setSelectedViewerId] = useState('viewer-alice');
  const [newViewerName, setNewViewerName] = useState('');
  const [text, setText] = useState('晚上好，今天状态怎么样？');
  const [eventType, setEventType] =
    useState<SimulatorInteractionType>('comment');
  const [likeCount, setLikeCount] = useState(10);
  const [giftName, setGiftName] = useState('辣条');
  const [giftCount, setGiftCount] = useState(1);
  const [giftPrice, setGiftPrice] = useState(0.1);
  const [superchatAmount, setSuperchatAmount] = useState(30);
  const [events, setEvents] = useState<LiveRoomEvent[]>([]);

  const selectedPlatform =
    SIMULATOR_PLATFORM_PROFILES.find((profile) => profile.id === platformId) ??
    SIMULATOR_PLATFORM_PROFILES[0];
  const roomId =
    roomIds[selectedPlatform.id] ?? `${selectedPlatform.id}-sim-001`;
  const selectedViewer =
    viewers.find((viewer) => viewer.id === selectedViewerId) ?? viewers[0];
  const platformEvents = useMemo(
    () =>
      events.filter(
        (event) => event.metadata?.simulatedPlatformId === selectedPlatform.id,
      ),
    [events, selectedPlatform.id],
  );
  const summary = useMemo(
    () => summarizeSimulatorEvents(platformEvents),
    [platformEvents],
  );
  const unavailableEvents = parityEventOrder.filter(
    (type) => !selectedPlatform.events.includes(type),
  );

  const draft = useMemo(() => {
    if (!selectedViewer) return null;
    return {
      roomId,
      platformId: selectedPlatform.id,
      viewer: selectedViewer,
      type: eventType,
      commentText: text,
      likeCount,
      giftName,
      giftCount,
      giftPrice,
      superchatAmount,
    };
  }, [
    eventType,
    giftCount,
    giftName,
    giftPrice,
    likeCount,
    roomId,
    selectedPlatform.id,
    selectedViewer,
    superchatAmount,
    text,
  ]);

  const preview = useMemo(
    () =>
      draft
        ? createSimulatorRoomEvent(draft, {
            id: 'simulator:preview',
            timestamp: 0,
          })
        : null,
    [draft],
  );

  const selectPlatform = (profile: SimulatorPlatformProfile) => {
    setPlatformId(profile.id);
    if (!profile.events.includes(eventType)) {
      setEventType(profile.events[0] ?? 'comment');
    }
    const firstGift = profile.giftPresets[0];
    if (firstGift) {
      setGiftName(firstGift.name);
      setGiftPrice(firstGift.price);
    }
  };

  const addViewer = () => {
    const name = newViewerName.trim();
    if (!name) return;
    const viewer: SimulatorViewer = {
      id: createId('viewer'),
      name,
      followed: false,
      likes: 0,
      giftValue: 0,
    };
    setViewers((current) => [...current, viewer]);
    setSelectedViewerId(viewer.id);
    setNewViewerName('');
  };

  const emit = () => {
    const requiresText = eventType === 'comment' || eventType === 'superchat';
    if (!draft || (requiresText && !draft.commentText.trim())) return;
    const event = createSimulatorRoomEvent(draft, {
      id: createId('simulator'),
      timestamp: Date.now(),
    });
    setEvents((current) => [event, ...current].slice(0, 150));
    setViewers((current) =>
      current.map((viewer) => applySimulatorEventToViewer(viewer, event)),
    );
    onEmit(event);
  };

  const selectGift = (name: string) => {
    const gift = selectedPlatform.giftPresets.find(
      (item) => item.name === name,
    );
    setGiftName(name);
    if (gift) setGiftPrice(gift.price);
  };

  const clearPlatformEvents = () => {
    setEvents((current) =>
      current.filter(
        (event) => event.metadata?.simulatedPlatformId !== selectedPlatform.id,
      ),
    );
  };

  const requiresText = eventType === 'comment' || eventType === 'superchat';
  const canEmit =
    Boolean(selectedViewer) && (!requiresText || Boolean(text.trim()));
  const selectedEvent = eventDescriptors[eventType];
  return (
    <section
      className="simulator-room-console"
      aria-label="模拟直播间"
      data-platform={selectedPlatform.id}
      style={
        {
          '--platform-accent': selectedPlatform.accent,
        } as CSSProperties
      }
    >
      <header className="simulator-room-heading">
        <div>
          <span className="section-kicker">AUDIENCE SIGNAL STUDIO</span>
          <h1>模拟直播间</h1>
          <p>切换真实平台能力模型；只显示当前连接器确实能够接收的观众行为。</p>
        </div>
        <label className="simulator-room-id">
          <span>{selectedPlatform.shortLabel} 房间 ID</span>
          <input
            value={roomId}
            onChange={(event) =>
              setRoomIds((current) => ({
                ...current,
                [selectedPlatform.id]: event.target.value,
              }))
            }
          />
        </label>
      </header>

      <nav className="simulator-platform-rail" aria-label="切换模拟直播平台">
        {SIMULATOR_PLATFORM_PROFILES.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className={profile.id === selectedPlatform.id ? 'is-selected' : ''}
            style={profileStyle(profile.accent)}
            onClick={() => selectPlatform(profile)}
          >
            <i />
            <span>
              <strong>{profile.shortLabel}</strong>
              <small>{profile.events.length} 种互动</small>
            </span>
          </button>
        ))}
      </nav>

      <section className="simulator-platform-contract">
        <div className="simulator-platform-identity">
          <i />
          <div>
            <strong>{selectedPlatform.label} 模拟链路</strong>
            <span>
              对照 {selectedPlatform.connectorLabel} ·{' '}
              {selectedPlatform.outbound
                ? '真实接入支持文字回写'
                : '真实接入只接收'}
            </span>
          </div>
        </div>
        <div className="simulator-capability-list">
          {selectedPlatform.events.map((type) => (
            <span key={type}>{eventDescriptors[type].label}</span>
          ))}
        </div>
        <p>
          {selectedPlatform.note ??
            (unavailableEvents.length
              ? `未开放：${unavailableEvents
                  .map((type) => eventDescriptors[type].label)
                  .join('、')}`
              : '当前观众互动能力已全部映射。')}
        </p>
      </section>

      <div className="simulator-signal-strip" aria-label="当前平台模拟数据概览">
        <article>
          <span>平台</span>
          <strong>{selectedPlatform.shortLabel}</strong>
        </article>
        <article>
          <span>虚拟观众</span>
          <strong>{viewers.length}</strong>
        </article>
        <article>
          <span>新增关注</span>
          <strong>{summary.follows}</strong>
        </article>
        <article>
          <span>点赞</span>
          <strong>{summary.likes}</strong>
        </article>
        <article>
          <span>礼物</span>
          <strong>{summary.gifts}</strong>
          <small>价值 {summary.giftValue.toFixed(2)}</small>
        </article>
        <article>
          <span>事件总数</span>
          <strong>{summary.total}</strong>
        </article>
      </div>

      <div className="simulator-room-grid">
        <div className="simulator-stage">
          <section className="simulator-audience-panel">
            <div className="simulator-section-title">
              <div>
                <span>01 / 选择观众</span>
                <h2>谁在 {selectedPlatform.shortLabel} 互动</h2>
              </div>
              <div className="simulator-add-viewer">
                <input
                  value={newViewerName}
                  aria-label="新观众昵称"
                  placeholder="输入新观众昵称"
                  onChange={(event) => setNewViewerName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addViewer();
                  }}
                />
                <button
                  type="button"
                  onClick={addViewer}
                  disabled={!newViewerName.trim()}
                >
                  添加观众
                </button>
              </div>
            </div>
            <div className="simulator-viewer-list" aria-label="虚拟观众列表">
              {viewers.map((viewer) => (
                <button
                  type="button"
                  key={viewer.id}
                  className={
                    viewer.id === selectedViewerId ? 'is-selected' : ''
                  }
                  onClick={() => setSelectedViewerId(viewer.id)}
                >
                  <i>{viewer.name.slice(0, 1)}</i>
                  <span>
                    <strong>{viewer.name}</strong>
                    <small>
                      {formatViewerSupport(viewer, selectedPlatform) ||
                        '当前平台仅模拟消息互动'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="simulator-action-panel">
            <div className="simulator-section-title">
              <div>
                <span>02 / 编排行为</span>
                <h2>{selectedViewer?.name ?? '观众'}要做什么</h2>
              </div>
              <small>{selectedEvent.hint}</small>
            </div>
            <div
              className="simulator-action-tabs"
              role="tablist"
              aria-label="互动类型"
            >
              {selectedPlatform.events.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={type === eventType}
                  className={type === eventType ? 'is-selected' : ''}
                  data-event={type}
                  onClick={() => setEventType(type)}
                >
                  {eventDescriptors[type].label}
                </button>
              ))}
            </div>

            <div className="simulator-action-fields">
              {(eventType === 'comment' || eventType === 'superchat') && (
                <label className="simulator-wide-field">
                  <span>
                    {eventType === 'superchat' ? '醒目留言内容' : '弹幕内容'}
                  </span>
                  <input
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') emit();
                    }}
                  />
                </label>
              )}
              {eventType === 'superchat' && (
                <label>
                  <span>金额</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={superchatAmount}
                    onChange={(event) =>
                      setSuperchatAmount(Number(event.target.value))
                    }
                  />
                </label>
              )}
              {eventType === 'follow' && (
                <div className="simulator-action-message is-follow">
                  <strong>{selectedViewer?.name} 将关注当前主播</strong>
                  <span>通用协议事件会进入关系与直播互动链路。</span>
                </div>
              )}
              {eventType === 'like' && (
                <label>
                  <span>连续点赞数</span>
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={likeCount}
                    onChange={(event) =>
                      setLikeCount(Number(event.target.value))
                    }
                  />
                </label>
              )}
              {eventType === 'gift' && (
                <>
                  <label>
                    <span>测试礼物预设</span>
                    <select
                      value={giftName}
                      onChange={(event) => selectGift(event.target.value)}
                    >
                      {selectedPlatform.giftPresets.map((gift) => (
                        <option key={gift.name} value={gift.name}>
                          {gift.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>数量</span>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={giftCount}
                      onChange={(event) =>
                        setGiftCount(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    <span>测试单价</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={giftPrice}
                      onChange={(event) =>
                        setGiftPrice(Number(event.target.value))
                      }
                    />
                  </label>
                </>
              )}
              {eventType === 'entry' && (
                <div className="simulator-action-message is-entry">
                  <strong>{selectedViewer?.name} 将进入直播间</strong>
                  <span>适合验证迎新、首次互动和冷启动表现。</span>
                </div>
              )}
              <button
                type="button"
                className="simulator-emit-button"
                data-event={eventType}
                disabled={!canEmit}
                onClick={emit}
              >
                发送{eventLabels[eventType]}事件
                <span>↗</span>
              </button>
            </div>
          </section>
        </div>

        <aside className="simulator-event-monitor">
          <div className="simulator-monitor-heading">
            <div>
              <span>03 / 事件监看</span>
              <h2>{selectedPlatform.shortLabel} 直播间动态</h2>
            </div>
            {platformEvents.length > 0 && (
              <button type="button" onClick={clearPlatformEvents}>
                清空当前平台
              </button>
            )}
          </div>
          <div className="simulator-event-feed" aria-live="polite">
            {platformEvents.map((event) => (
              <article key={event.id} data-event={event.type}>
                <i />
                <div>
                  <header>
                    <strong>{event.author.name}</strong>
                    <span>{selectedPlatform.shortLabel}</span>
                    <span>{eventLabels[event.type]}</span>
                    <time>{formatEventTime(event.timestamp)}</time>
                  </header>
                  <p>{event.text}</p>
                </div>
              </article>
            ))}
            {platformEvents.length === 0 && (
              <div className="simulator-empty-feed">
                <strong>{selectedPlatform.shortLabel} 还没有互动</strong>
                <span>
                  当前只允许发送真实连接器已开放的事件，第一条会从这里进入数字人链路。
                </span>
              </div>
            )}
          </div>
          <details className="simulator-json-panel">
            <summary>查看下一条标准事件 JSON</summary>
            <pre>{JSON.stringify(preview, null, 2)}</pre>
          </details>
        </aside>
      </div>
    </section>
  );
}
