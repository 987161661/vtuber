import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readLiveRuntimeEventHistory,
  selectLiveRuntimeEventHistory,
} from '../../examples/react-purupuru-app/server/liveRuntimeEventHistory';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('live runtime event history', () => {
  it('filters before applying the limit and preserves chronological order', () => {
    const raw = [
      JSON.stringify({ stage: 'operator_attention_opened', at: 1 }),
      JSON.stringify({ stage: 'queued', at: 2 }),
      JSON.stringify({ stage: 'operator_attention_resolved', at: 3 }),
      JSON.stringify({ stage: 'generated', at: 4 }),
      JSON.stringify({ stage: 'operator_attention_opened', at: 5 }),
    ].join('\n');

    expect(
      selectLiveRuntimeEventHistory(raw, {
        limit: 2,
        stagePrefix: 'operator_attention_',
      }),
    ).toEqual([
      { stage: 'operator_attention_resolved', at: 3 },
      { stage: 'operator_attention_opened', at: 5 },
    ]);
  });

  it('skips malformed lines without discarding valid history', () => {
    const raw = [
      JSON.stringify({ stage: 'queued', at: 1 }),
      '{"stage":',
      JSON.stringify({ stage: 'done', at: 3 }),
    ].join('\n');

    expect(selectLiveRuntimeEventHistory(raw, { limit: 10 })).toEqual([
      { stage: 'queued', at: 1 },
      { stage: 'done', at: 3 },
    ]);
  });

  it('reads recent matching events from a bounded tail of a large log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'live-runtime-history-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'events.jsonl');
    const oldNoise = Array.from({ length: 2_000 }, (_, index) =>
      JSON.stringify({
        stage: 'runtime-owner-heartbeat',
        at: index,
        padding: 'x'.repeat(200),
      }),
    );
    const recent = [
      JSON.stringify({ stage: 'generated', at: 2_001 }),
      JSON.stringify({ stage: 'dropped', at: 2_002 }),
      JSON.stringify({ stage: 'generated', at: 2_003 }),
    ];
    await writeFile(path, [...oldNoise, ...recent].join('\n'), 'utf8');

    await expect(
      readLiveRuntimeEventHistory(path, {
        limit: 2,
        stagePrefix: 'generated',
        chunkBytes: 128,
        maxScanBytes: 1_024,
      }),
    ).resolves.toEqual([
      { stage: 'generated', at: 2_001 },
      { stage: 'generated', at: 2_003 },
    ]);
  });
});
