import { useRef } from 'react';
import { LINGLAN_PROFILE } from '../config/characterProfile';
import type { StreamerMemoryApi } from '../hooks/useStreamerMemory';

export function MemoryCenter({ memory }: { memory: StreamerMemoryApi }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    const blob = new Blob([JSON.stringify(await memory.export(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${LINGLAN_PROFILE.id}-memory.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      await memory.import(JSON.parse(await file.text()));
    } catch {
      alert('记忆文件格式无效。');
    }
  };

  return (
    <div className="settings-section">
      <h3>记忆系统</h3>
      <p className="settings-description">
        记忆保存在本机
        IndexedDB。互动先形成短时痕迹；睡眠会重放、压缩和巩固它们，长期缺少刺激的记忆则逐渐模糊和遗忘。
      </p>
      <p className="settings-description">
        上次睡眠：
        {memory.lastConsolidatedAt
          ? new Date(memory.lastConsolidatedAt).toLocaleString()
          : '尚未整理'}
        ；当前痕迹：{memory.records.length}
      </p>
      <div className="settings-row">
        <button type="button" onClick={() => void memory.sleep('post_stream')}>
          立即睡眠整理
        </button>
        <button type="button" onClick={() => void download()}>
          导出
        </button>
        <button type="button" onClick={() => inputRef.current?.click()}>
          导入
        </button>
        <button type="button" onClick={() => void memory.clear('session')}>
          清空短时痕迹
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('确认删除所有记忆？')) void memory.clear();
          }}
        >
          清空全部记忆
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="application/json"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>
      <div className="memory-record-list">
        {memory.records
          .slice()
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, 30)
          .map((record) => (
            <div key={record.id} className="memory-record">
              <span>
                [{record.memoryTier}/{record.phase}] {record.content}
              </span>
              <button
                type="button"
                onClick={() => void memory.remove(record.id)}
              >
                删除
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
