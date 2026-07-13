import { useMemo, useState } from 'react';
import type { StreamerMemoryApi } from '../hooks/useStreamerMemory';
import type { DigitalHumanProfile } from '../types/settings';
import {
  MEMORY_DIMENSIONS,
  type MemoryDetailValue,
  type MemoryDimension,
  type MemoryStatus,
  type StreamerMemoryRecord,
} from '../types/memory';

const statusLabels: Record<MemoryStatus, string> = {
  candidate: '待确认',
  confirmed: '已确认',
  protected: '稳定档案',
  suppressed: '有争议',
  archived: '已归档',
};

const layerLabels: Record<StreamerMemoryRecord['layer'], string> = {
  interaction: '近期互动',
  fact: '原子事实',
  reflection: '综合反思',
  profile: '稳定档案',
};

function formatTime(value?: number) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '未记录';
}

function fieldValue(value: MemoryDetailValue | undefined) {
  return Array.isArray(value) ? value.join('、') : String(value ?? '');
}

export function MemoryArchiveEditor({
  profile,
  memory,
}: {
  profile: DigitalHumanProfile;
  memory: StreamerMemoryApi;
}) {
  const records = useMemo(
    () =>
      memory.records.filter((record) => record.digitalHumanId === profile.id),
    [memory.records, profile.id],
  );
  const [dimension, setDimension] = useState<MemoryDimension>('self');
  const [status, setStatus] = useState<MemoryStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftState, setDraft] = useState<StreamerMemoryRecord | null>(null);
  const definition = MEMORY_DIMENSIONS.find((item) => item.id === dimension)!;

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records
      .filter((record) => record.dimension === dimension)
      .filter((record) => status === 'all' || record.status === status)
      .filter((record) => {
        if (!normalizedQuery) return true;
        return [
          record.title,
          record.content,
          record.subjectName,
          ...Object.values(record.details).map(fieldValue),
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => {
        const rank: Record<MemoryStatus, number> = {
          candidate: 5,
          suppressed: 4,
          protected: 3,
          confirmed: 2,
          archived: 1,
        };
        return (
          rank[b.status] - rank[a.status] ||
          b.importance - a.importance ||
          b.updatedAt - a.updatedAt
        );
      });
  }, [dimension, query, records, status]);
  const effectiveSelectedId =
    selectedId && filtered.some((record) => record.id === selectedId)
      ? selectedId
      : filtered[0]?.id || null;
  const selected = records.find((record) => record.id === effectiveSelectedId);
  const draft = draftState?.id === selected?.id ? draftState : selected || null;

  const addRecord = async () => {
    const record = await memory.add({
      digitalHumanId: profile.id,
      dimension,
      layer: 'fact',
      status: 'confirmed',
      title: `新的${definition.shortLabel}记录`,
      subjectType: dimension === 'relationship' ? 'viewer' : 'self',
      subjectName:
        dimension === 'relationship' ? '待填写对象' : profile.displayName,
      content: '请填写这条档案记录的完整内容。',
      importance: 5,
      confidence: 1,
      temporalScope: dimension === 'episode' ? 'episode' : 'pattern',
      visibility: 'internal',
      sourceType: 'manual',
      reinforcement: 1,
      details: Object.fromEntries(
        definition.fields.map((field) => [field.key, '']),
      ),
    });
    setSelectedId(record.id);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    await memory.revise(
      draft.id,
      {
        title: draft.title.trim() || '未命名档案',
        subjectType: draft.subjectType,
        subjectId: draft.subjectId?.trim() || undefined,
        subjectName: draft.subjectName.trim() || '未指定对象',
        content: draft.content.trim(),
        details: draft.details,
        importance: draft.importance,
        confidence: draft.confidence,
        temporalScope: draft.temporalScope,
        visibility: draft.visibility,
        layer: draft.layer,
      },
      '运营者在数字人档案台保存修改',
    );
    setDraft(null);
  };
  const runAction = async (action: () => Promise<void>) => {
    await action();
    setDraft(null);
  };

  const counts = useMemo(
    () => ({
      total: records.length,
      candidate: records.filter((record) => record.status === 'candidate')
        .length,
      disputed: records.filter((record) => record.status === 'suppressed')
        .length,
      protected: records.filter((record) => record.status === 'protected')
        .length,
    }),
    [records],
  );

  return (
    <div className="memory-archive-shell">
      <header className="memory-archive-header">
        <div>
          <span className="archive-kicker">PERSONA MEMORY DOSSIER</span>
          <h3>{profile.displayName} · 记忆与关系档案</h3>
          <p>
            每条记忆都有对象、来源、时间、证据和修订历史；只有已确认档案会进入播出上下文。
          </p>
        </div>
        <div className="archive-ledger" aria-label="档案统计">
          <span>
            <strong>{counts.total}</strong>全部
          </span>
          <span>
            <strong>{counts.candidate}</strong>待确认
          </span>
          <span>
            <strong>{counts.disputed}</strong>有争议
          </span>
          <span>
            <strong>{counts.protected}</strong>稳定档案
          </span>
        </div>
      </header>

      <nav className="memory-dimension-tabs" aria-label="六维记忆档案">
        {MEMORY_DIMENSIONS.map((item) => {
          const count = records.filter(
            (record) => record.dimension === item.id,
          ).length;
          return (
            <button
              type="button"
              key={item.id}
              className={dimension === item.id ? 'is-active' : ''}
              onClick={() => setDimension(item.id)}
            >
              <span>{item.shortLabel}</span>
              <small>{count.toString().padStart(2, '0')}</small>
            </button>
          );
        })}
      </nav>

      <div className="memory-archive-toolbar">
        <div>
          <strong>{definition.label}</strong>
          <small>{notice || definition.description}</small>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、内容、对象或档案字段"
          aria-label="搜索记忆档案"
        />
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as MemoryStatus | 'all')
          }
          aria-label="筛选档案状态"
        >
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="archive-toolbar-actions">
          <button
            type="button"
            onClick={() =>
              void memory.reflect(profile.id).then((count) => {
                setNotice(
                  count
                    ? `已生成 ${count} 条待确认反思。`
                    : '暂无可整理的新事实组合。',
                );
              })
            }
          >
            整理为反思
          </button>
          <button
            type="button"
            className="archive-add-action"
            onClick={() => void addRecord()}
          >
            新增档案记录
          </button>
        </div>
      </div>

      <div className="memory-archive-grid">
        <div className="memory-entry-list">
          {filtered.length ? (
            filtered.map((record) => (
              <button
                type="button"
                key={record.id}
                className={`memory-entry-card status-${record.status} ${record.id === effectiveSelectedId ? 'is-selected' : ''}`}
                onClick={() => {
                  setSelectedId(record.id);
                  setDraft(null);
                }}
              >
                <span className="evidence-spine" aria-hidden="true" />
                <span className="memory-entry-meta">
                  <em>{statusLabels[record.status]}</em>
                  <small>
                    {layerLabels[record.layer]} · 重要度 {record.importance}
                  </small>
                </span>
                <strong>{record.title}</strong>
                <p>{record.content}</p>
                <span className="memory-entry-subject">
                  对象：{record.subjectName}
                </span>
              </button>
            ))
          ) : (
            <div className="archive-empty-state">
              <strong>这个档案柜还是空的</strong>
              <p>新增第一条记录，或调整搜索与状态筛选。</p>
            </div>
          )}
        </div>

        <section className="memory-record-editor">
          {draft ? (
            <>
              <div className="record-editor-heading">
                <div>
                  <span>
                    {statusLabels[draft.status]} · {layerLabels[draft.layer]}
                  </span>
                  <h4>{draft.title}</h4>
                </div>
                <small>最后修订 {formatTime(draft.updatedAt)}</small>
              </div>

              <div className="record-editor-fields">
                <label>
                  档案标题
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  记录对象
                  <input
                    value={draft.subjectName}
                    onChange={(event) =>
                      setDraft({ ...draft, subjectName: event.target.value })
                    }
                  />
                </label>
                <label>
                  对象标识
                  <input
                    value={draft.subjectId || ''}
                    placeholder="平台用户 ID，可留空"
                    onChange={(event) =>
                      setDraft({ ...draft, subjectId: event.target.value })
                    }
                  />
                </label>
                <label>
                  记忆层级
                  <select
                    value={draft.layer}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        layer: event.target
                          .value as StreamerMemoryRecord['layer'],
                      })
                    }
                  >
                    {Object.entries(layerLabels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  时间属性
                  <select
                    value={draft.temporalScope}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        temporalScope: event.target
                          .value as StreamerMemoryRecord['temporalScope'],
                      })
                    }
                  >
                    <option value="pattern">长期模式</option>
                    <option value="state">当前状态</option>
                    <option value="episode">具体事件</option>
                    <option value="past">历史记录</option>
                  </select>
                </label>
                <label>
                  公开范围
                  <select
                    value={draft.visibility}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        visibility: event.target
                          .value as StreamerMemoryRecord['visibility'],
                      })
                    }
                  >
                    <option value="public">可公开表达</option>
                    <option value="internal">仅内部使用</option>
                    <option value="private">私密，不进入播出召回</option>
                  </select>
                </label>
                <label className="record-editor-wide">
                  完整记录
                  <textarea
                    value={draft.content}
                    onChange={(event) =>
                      setDraft({ ...draft, content: event.target.value })
                    }
                  />
                </label>
                {definition.fields.map((field) => (
                  <label key={field.key} className="record-editor-wide">
                    {field.label}
                    <textarea
                      value={fieldValue(draft.details[field.key])}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          details: {
                            ...draft.details,
                            [field.key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label className="importance-field record-editor-wide">
                  <span>
                    重要度 <strong>{draft.importance}</strong>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={draft.importance}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        importance: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>

              <div className="evidence-ledger">
                <div>
                  <span>确认</span>
                  <strong>+{draft.reinforcement.toFixed(1)}</strong>
                </div>
                <div>
                  <span>反驳</span>
                  <strong>-{draft.disputation.toFixed(1)}</strong>
                </div>
                <div>
                  <span>可信度</span>
                  <strong>{Math.round(draft.confidence * 100)}%</strong>
                </div>
                <div>
                  <span>来源</span>
                  <strong>{draft.sourceType}</strong>
                </div>
              </div>

              <div className="record-editor-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void save()}
                >
                  保存修订
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(() => memory.confirm(draft.id))}
                >
                  确认可信
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(() => memory.dispute(draft.id))}
                >
                  标记有误
                </button>
                {!draft.protected && draft.layer !== 'profile' && (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(() => memory.promote(draft.id))
                    }
                  >
                    固化为档案
                  </button>
                )}
                {!draft.protected && draft.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(() => memory.archive(draft.id))
                    }
                  >
                    归档
                  </button>
                )}
                {draft.status === 'archived' && (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(() => memory.restore(draft.id))
                    }
                  >
                    恢复
                  </button>
                )}
                {!draft.protected && (
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() =>
                      void runAction(() => memory.remove(draft.id))
                    }
                  >
                    删除
                  </button>
                )}
              </div>

              <details className="record-provenance">
                <summary>
                  证据与版本历史 · {draft.versionHistory.length} 次修订
                </summary>
                <dl>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatTime(draft.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>最近确认</dt>
                    <dd>{formatTime(draft.lastConfirmedAt)}</dd>
                  </div>
                  <div>
                    <dt>来源事件</dt>
                    <dd>{draft.sourceEventIds.length || '运营者预设'}</dd>
                  </div>
                </dl>
                {draft.versionHistory
                  .slice()
                  .reverse()
                  .map((version) => (
                    <article key={`${version.replacedAt}-${version.content}`}>
                      <span>
                        {formatTime(version.replacedAt)} · {version.reason}
                      </span>
                      <p>{version.content}</p>
                    </article>
                  ))}
              </details>
            </>
          ) : (
            <div className="archive-empty-state">
              <strong>选择一条档案</strong>
              <p>右侧会显示完整字段、证据和修订历史。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
