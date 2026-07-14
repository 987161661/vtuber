import { useMemo, useState } from 'react';
import type { LiveRoomEvent, LiveRoomEventType } from '../services/live-platform/types';

type SimulatorViewer = { id: string; name: string };

interface SimulatorRoomConsoleProps {
  onEmit: (event: LiveRoomEvent) => void;
}

const eventTypes: Array<{ type: LiveRoomEventType; label: string }> = [
  { type: 'comment', label: '弹幕' },
  { type: 'follow', label: '关注' },
  { type: 'like', label: '点赞' },
  { type: 'gift', label: '礼物' },
  { type: 'entry', label: '进场' },
];

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function SimulatorRoomConsole({ onEmit }: SimulatorRoomConsoleProps) {
  const [roomId, setRoomId] = useState('sim-room-001');
  const [viewers, setViewers] = useState<SimulatorViewer[]>([
    { id: 'viewer-alice', name: '小雨' },
    { id: 'viewer-bob', name: '北辰' },
  ]);
  const [selectedViewerId, setSelectedViewerId] = useState('viewer-alice');
  const [newViewerName, setNewViewerName] = useState('');
  const [text, setText] = useState('晚上好，今天状态怎么样？');
  const [eventType, setEventType] = useState<LiveRoomEventType>('comment');
  const [lastEvent, setLastEvent] = useState<LiveRoomEvent | null>(null);

  const selectedViewer = viewers.find((viewer) => viewer.id === selectedViewerId) ?? viewers[0];
  const canEmit = Boolean(selectedViewer);
  const preview = useMemo(() => {
    if (!selectedViewer) return null;
    return {
      id: 'simulator:preview',
      type: eventType,
      text: eventType === 'comment' ? text : eventType === 'gift' ? '荧光棒 x1' : '',
      // Preview data is intentionally inert. A real timestamp is assigned
      // only when the operator emits the event.
      timestamp: 0,
      author: { id: selectedViewer.id, name: selectedViewer.name },
      metadata: {
        connectorId: 'simulator',
        platformId: 'simulator',
        sourcePlatform: 'simulator',
        roomId,
      },
    } satisfies LiveRoomEvent;
  }, [eventType, roomId, selectedViewer, text]);

  const addViewer = () => {
    const name = newViewerName.trim();
    if (!name) return;
    const viewer = { id: createId('viewer'), name };
    setViewers((current) => [...current, viewer]);
    setSelectedViewerId(viewer.id);
    setNewViewerName('');
  };

  const emit = () => {
    if (!selectedViewer) return;
    const event: LiveRoomEvent = {
      id: createId('simulator'),
      type: eventType,
      text: eventType === 'comment' ? text.trim() : eventType === 'gift' ? '荧光棒 x1' : '',
      timestamp: Date.now(),
      author: { id: selectedViewer.id, name: selectedViewer.name },
      metadata: {
        connectorId: 'simulator',
        platformId: 'simulator',
        sourcePlatform: 'simulator',
        roomId,
        simulator: true,
        ...(eventType === 'gift' ? { giftName: '荧光棒', giftCount: 1, giftPrice: 0 } : {}),
      },
    };
    setLastEvent(event);
    onEmit(event);
  };

  return (
    <section className="simulator-room-console" aria-label="模拟直播间">
      <div className="simulator-room-heading">
        <div>
          <span className="section-kicker">LOCAL EVENT LAB</span>
          <h3>模拟直播间</h3>
          <p>直接向数字人注入标准化 LiveRoomEvent，不连接真实平台。</p>
        </div>
        <span className="simulator-live-badge"><i /> TEST ROOM</span>
      </div>

      <div className="simulator-room-grid">
        <div className="simulator-control-stack">
          <label>房间 ID<input value={roomId} onChange={(event) => setRoomId(event.target.value)} /></label>
          <div className="simulator-viewer-row">
            <label>当前观众<select value={selectedViewerId} onChange={(event) => setSelectedViewerId(event.target.value)}>
              {viewers.map((viewer) => <option key={viewer.id} value={viewer.id}>{viewer.name}</option>)}
            </select></label>
            <label>添加观众<input value={newViewerName} placeholder="观众昵称" onChange={(event) => setNewViewerName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addViewer(); }} /></label>
            <button type="button" className="simulator-secondary-button" onClick={addViewer}>添加</button>
          </div>
          <div className="simulator-viewer-chips" aria-label="观众列表">
            {viewers.map((viewer) => <button type="button" key={viewer.id} className={viewer.id === selectedViewerId ? 'is-selected' : ''} onClick={() => setSelectedViewerId(viewer.id)}>{viewer.name}</button>)}
          </div>
          <div className="simulator-event-row">
            <label>互动类型<select value={eventType} onChange={(event) => setEventType(event.target.value as LiveRoomEventType)}>
              {eventTypes.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
            </select></label>
            {eventType === 'comment' && <label className="simulator-text-field">弹幕内容<input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') emit(); }} /></label>}
            <button type="button" className="simulator-emit-button" disabled={!canEmit || (eventType === 'comment' && !text.trim())} onClick={emit}>发送到数字人 ↗</button>
          </div>
        </div>
        <div className="simulator-json-panel">
          <div className="simulator-json-title"><span>JSON PREVIEW</span><span>{lastEvent ? '已发送' : '待发送'}</span></div>
          <pre>{JSON.stringify(lastEvent ?? preview, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}
