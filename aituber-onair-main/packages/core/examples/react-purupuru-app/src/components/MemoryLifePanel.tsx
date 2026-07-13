import { useMemo, useState } from 'react';
import type { StreamerMemoryApi } from '../hooks/useStreamerMemory';
import type { StreamerMemoryRecord } from '../types/memory';
import type { DigitalHumanProfile } from '../types/settings';
import { MemoryArchiveEditor } from './MemoryArchiveEditor';

type LifeView = 'now' | 'sleep_queue' | 'long_term' | 'fading' | 'forgotten';

const phaseLabels: Record<LifeView, { label: string; description: string }> = {
  now: { label: '此刻', description: '仍在意识里保持的短时互动。' },
  sleep_queue: { label: '今夜', description: '等待重放、聚类和压缩的经历。' },
  long_term: {
    label: '长时',
    description: '经过睡眠和反复刺激后稳定下来的记忆。',
  },
  fading: {
    label: '模糊',
    description: '正在淡去，只会被强线索重新唤醒。',
  },
  forgotten: {
    label: '遗忘',
    description: '已退出主动召回，只保留审计痕迹。',
  },
};

const longTermTypeLabels: Record<string, string> = {
  episodic: '情景记忆',
  semantic: '语义记忆',
  relational: '关系记忆',
  procedural: '程序记忆',
};

function relativeTime(value: number) {
  const elapsed = Date.now() - value;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)} 小时前`;
  return `${Math.round(elapsed / 86_400_000)} 天前`;
}

function viewFor(record: StreamerMemoryRecord): LifeView {
  if (record.phase === 'now') return 'now';
  if (record.phase === 'sleep_queue') return 'sleep_queue';
  if (record.phase === 'long_term') return 'long_term';
  if (record.phase === 'forgotten') return 'forgotten';
  return 'fading';
}

function memoryTone(record: StreamerMemoryRecord) {
  if (record.phase === 'dormant') return '沉睡';
  if (record.phase === 'fading') return '正在模糊';
  if (record.phase === 'forgotten') return '已经遗忘';
  if (record.memoryTier === 'long_term') {
    return longTermTypeLabels[record.longTermType || 'semantic'] || '长时记忆';
  }
  return record.sleepState === 'queued' ? '等待睡眠整理' : '短时印象';
}

export function MemoryLifePanel({
  profile,
  memory,
}: {
  profile: DigitalHumanProfile;
  memory: StreamerMemoryApi;
}) {
  const [view, setView] = useState<LifeView>('now');
  const [sleeping, setSleeping] = useState(false);
  const [notice, setNotice] = useState('');
  const records = useMemo(
    () =>
      memory.records.filter((record) => record.digitalHumanId === profile.id),
    [memory.records, profile.id],
  );
  const byView = useMemo(() => {
    const groups = new Map<LifeView, StreamerMemoryRecord[]>(
      (Object.keys(phaseLabels) as LifeView[]).map((phase) => [phase, []]),
    );
    for (const record of records) groups.get(viewFor(record))?.push(record);
    for (const items of groups.values()) {
      items.sort((left, right) => {
        if (viewFor(left) === 'long_term') {
          return (
            right.activation +
            right.stability -
            left.activation -
            left.stability
          );
        }
        return right.updatedAt - left.updatedAt;
      });
    }
    return groups;
  }, [records]);
  const current = byView.get(view) || [];
  const report = memory.lastSleepReport;

  const sleepNow = async () => {
    setSleeping(true);
    try {
      const result = await memory.sleep('post_stream');
      if (!result) {
        setNotice('当前正在播出，或已有一轮睡眠正在运行。');
        return;
      }
      setNotice(
        `重放 ${result.replayed} 条，压缩 ${result.compressed} 条，形成 ${result.promoted} 条长时记忆，强化 ${result.strengthened} 条。`,
      );
      setView(
        result.promoted || result.strengthened ? 'long_term' : 'sleep_queue',
      );
    } finally {
      setSleeping(false);
    }
  };

  return (
    <div className="memory-life-shell">
      <header className="memory-life-hero">
        <div className="memory-life-title">
          <span>MEMORY RHYTHM / {profile.displayName.toUpperCase()}</span>
          <h3>{profile.displayName}的记忆正在生长</h3>
          <p>
            短时经历会在安静时被重放。重复且有意义的部分逐渐留下，其余内容会被压缩、淡化或遗忘。
          </p>
        </div>
        <div
          className={`sleep-orbit ${sleeping ? 'is-sleeping' : ''}`}
          aria-label={sleeping ? '正在整理记忆' : '记忆睡眠状态'}
        >
          <i />
          <i />
          <i />
          <strong>
            {sleeping ? '睡眠中' : report ? '已醒来' : '尚未睡眠'}
          </strong>
          <small>
            {memory.lastConsolidatedAt
              ? relativeTime(memory.lastConsolidatedAt)
              : '等待首次整理'}
          </small>
        </div>
        <button
          type="button"
          className="sleep-now-action"
          disabled={sleeping}
          onClick={() => void sleepNow()}
        >
          {sleeping ? '正在整理…' : '让她睡一会儿'}
        </button>
      </header>

      <div className="memory-wave" aria-label="记忆生命周期">
        {(Object.keys(phaseLabels) as LifeView[]).map((phase, index) => {
          const count = byView.get(phase)?.length || 0;
          return (
            <button
              type="button"
              key={phase}
              className={`${view === phase ? 'is-active' : ''} wave-${index}`}
              onClick={() => setView(phase)}
            >
              <span className="wave-node" />
              <strong>{phaseLabels[phase].label}</strong>
              <small>{count}</small>
            </button>
          );
        })}
      </div>

      <section className="memory-life-stage">
        <header>
          <div>
            <span>{phaseLabels[view].label}</span>
            <p>{notice || phaseLabels[view].description}</p>
          </div>
          {report && (
            <small>
              上次睡眠：重放 {report.replayed} · 压缩 {report.compressed} · 巩固{' '}
              {report.promoted + report.strengthened}
            </small>
          )}
        </header>

        <div className={`memory-life-list is-${view}`}>
          {current.slice(0, view === 'forgotten' ? 24 : 14).map((record) => (
            <article
              key={record.id}
              className={`living-memory-card phase-${record.phase}`}
            >
              <div className="living-memory-signal">
                <span
                  style={{ width: `${Math.max(3, record.activation * 100)}%` }}
                />
              </div>
              <div className="living-memory-heading">
                <span>{memoryTone(record)}</span>
                <small>{relativeTime(record.lastSeenAt)}</small>
              </div>
              <strong>{record.subjectName}</strong>
              <p>{record.content}</p>
              <footer>
                <span>出现 {record.occurrenceCount} 次</span>
                <span>跨 {Math.max(1, record.sessionIds.length)} 场</span>
                {record.memoryTier === 'long_term' && (
                  <span>稳定度 {Math.round(record.stability * 100)}%</span>
                )}
                {record.compressionLevel > 0 && (
                  <span>已浓缩 {record.compressionLevel} 次</span>
                )}
                {(record.phase === 'dormant' ||
                  record.phase === 'forgotten') && (
                  <button
                    type="button"
                    onClick={() => void memory.restore(record.id)}
                  >
                    尝试唤醒
                  </button>
                )}
              </footer>
            </article>
          ))}
          {!current.length && (
            <div className="memory-life-empty">
              <strong>
                {view === 'now' ? '此刻很安静' : '这里暂时没有记忆'}
              </strong>
              <p>
                {view === 'now'
                  ? '新的直播互动会先在这里短暂停留。'
                  : phaseLabels[view].description}
              </p>
            </div>
          )}
        </div>
      </section>

      <details className="advanced-memory-audit">
        <summary>高级记忆审计</summary>
        <p>用于检查来源、矛盾、版本和隐私边界。日常使用不需要逐条编辑。</p>
        <MemoryArchiveEditor profile={profile} memory={memory} />
      </details>
    </div>
  );
}
