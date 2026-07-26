import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const endpoint =
  process.env.CONTEXTUAL_DIRECTOR_URL ||
  'http://127.0.0.1:5173/api/skill-route';
const size = Math.max(2, Number(process.env.DIRECTOR_BURST_SIZE || 32));
const urgentIndex = Math.min(size - 1, 11);
const stamp = Date.now();
const messages = Array.from({ length: size }, (_, index) =>
  index === urgentIndex
    ? '我被困在地下车库，积水已经到胸口了，请马上告诉我怎么办'
    : `普通弹幕${index + 1}：今天聊聊吃饭、游戏和心情，没有紧急情况`,
);
const startedAt = performance.now();
const results = await Promise.all(
  messages.map(async (text, index) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: `utf8-burst-${stamp}-${index}`,
        text,
        speaker: {
          id: `viewer-${index}`,
          name: `观众${index}`,
          source: 'utf8-burst-probe',
        },
        turns: [],
        host: {
          speaking: false,
          interruptible: true,
          currentMode: 'companion',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return {
      index,
      status: response.status,
      body: await response.json(),
    };
  }),
);
const wallMs = Math.round(performance.now() - startedAt);
const spoken = results.filter((result) => result.body.shouldSpeak);
const summary = {
  size,
  wallMs,
  completed: results.filter((result) => result.status === 200).length,
  errors: results.filter((result) => result.status !== 200).length,
  spokenCount: spoken.length,
  selectedIndex: spoken[0]?.index ?? null,
  selectedUrgent: spoken[0]?.index === urgentIndex,
  selectedMode: spoken[0]?.body.mode ?? null,
  batch: results[0]?.body.director?.batch,
};
const report = {
  generatedAt: new Date().toISOString(),
  summary,
  results,
};
const outputDirectory = join(process.cwd(), '.runtime', 'router-benchmarks');
await mkdir(outputDirectory, { recursive: true });
const outputPath = join(
  outputDirectory,
  `contextual-director-burst-${Date.now()}.json`,
);
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log(`REPORT ${outputPath}`);
