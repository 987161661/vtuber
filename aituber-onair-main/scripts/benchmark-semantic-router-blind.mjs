import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { routeWithLocalQwen } from '../packages/core/examples/react-purupuru-app/src/lib/localSemanticRouter.ts';

const CURRENT_ROUTER_URL =
  process.env.CURRENT_ROUTER_URL || 'http://127.0.0.1:5173/api/skill-route';
const scenarioPath = join(
  process.cwd(),
  'scripts',
  process.env.BLIND_SCENARIO_MODULE || 'router-blind-scenarios.mjs',
);
const { blindScenarios } = await import(pathToFileURL(scenarioPath).href);
const scenarioSha256 = createHash('sha256')
  .update(await readFile(scenarioPath))
  .digest('hex');

function allowed(value) {
  return Array.isArray(value) ? value : [value];
}

function score(scenario, decision) {
  const checks = {
    mode: allowed(scenario.expected.mode).includes(decision.mode),
    moderation: allowed(scenario.expected.moderation).includes(
      decision.moderation,
    ),
    shouldSpeak: decision.shouldSpeak === scenario.expected.shouldSpeak,
  };
  if (typeof scenario.expected.inheritTyphoon === 'boolean') {
    checks.inheritTyphoon =
      decision.inheritTyphoon === scenario.expected.inheritTyphoon;
  }
  return { checks, passed: Object.values(checks).every(Boolean) };
}

async function currentRouter(scenario) {
  const response = await fetch(CURRENT_ROUTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: scenario.text,
      speaker: {
        id: 'blind-viewer',
        name: '盲测观众',
        source: '后端盲测',
      },
      turns: scenario.turns || [],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function candidateRouter(scenario) {
  return routeWithLocalQwen(
    {
      text: scenario.text,
      speaker: {
        id: 'blind-viewer',
        name: '盲测观众',
        source: '后端盲测',
      },
      turns: scenario.turns || [],
    },
    { timeoutMs: 5_000 },
  );
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

function summarize(results) {
  const completed = results.filter((result) => !result.error);
  const latencies = completed.map((result) => result.latencyMs);
  const passed = results.filter((result) => result.passed).length;
  return {
    samples: results.length,
    completed: completed.length,
    passed,
    accuracy: results.length ? passed / results.length : 0,
    errors: results.length - completed.length,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.max(...latencies) : null,
      mean: latencies.length
        ? Math.round(
            latencies.reduce((total, value) => total + value, 0) /
              latencies.length,
          )
        : null,
    },
  };
}

async function runSequential(name, adapter) {
  const results = [];
  for (const scenario of blindScenarios) {
    const startedAt = performance.now();
    try {
      const decision = await adapter(scenario);
      const result = {
        adapter: name,
        scenarioId: scenario.id,
        latencyMs: Math.round(performance.now() - startedAt),
        decision,
        ...score(scenario, decision),
      };
      results.push(result);
      console.log(
        `${name.padEnd(14)} ${String(result.latencyMs).padStart(5)}ms ${result.passed ? 'PASS' : 'FAIL'} ${scenario.id} -> ${decision.mode}/${decision.moderation}`,
      );
    } catch (error) {
      results.push({
        adapter: name,
        scenarioId: scenario.id,
        latencyMs: Math.round(performance.now() - startedAt),
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function runCandidateBurst() {
  const selected = blindScenarios.slice(0, 8);
  const wallStartedAt = performance.now();
  const results = await Promise.all(
    selected.map(async (scenario) => {
      const startedAt = performance.now();
      try {
        const decision = await candidateRouter(scenario);
        return {
          scenarioId: scenario.id,
          latencyMs: Math.round(performance.now() - startedAt),
          decision,
          ...score(scenario, decision),
        };
      } catch (error) {
        return {
          scenarioId: scenario.id,
          latencyMs: Math.round(performance.now() - startedAt),
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return {
    concurrency: 8,
    wallMs: Math.round(performance.now() - wallStartedAt),
    summary: summarize(results),
    results,
  };
}

await candidateRouter(blindScenarios[0]);
const currentResults = await runSequential('current', currentRouter);
const candidateResults = await runSequential('qwen-hybrid', candidateRouter);
const burst = await runCandidateBurst();
const currentSummary = summarize(currentResults);
const candidateSummary = summarize(candidateResults);
const adoptionGate = {
  minimumAccuracy: 0.95,
  maximumP95Ms: 1_500,
  requireZeroErrors: true,
  requireBetterThanCurrent: true,
  requireEightWayBurstZeroErrors: true,
};
const adopted =
  candidateSummary.accuracy >= adoptionGate.minimumAccuracy &&
  candidateSummary.latencyMs.p95 <= adoptionGate.maximumP95Ms &&
  candidateSummary.errors === 0 &&
  candidateSummary.accuracy > currentSummary.accuracy &&
  burst.summary.errors === 0;
const report = {
  generatedAt: new Date().toISOString(),
  scenarioSha256,
  scenarioCount: blindScenarios.length,
  adoptionGate,
  adopted,
  summary: { current: currentSummary, candidate: candidateSummary },
  burst,
  results: [...currentResults, ...candidateResults],
};
const outputDirectory = join(process.cwd(), '.runtime', 'router-benchmarks');
await mkdir(outputDirectory, { recursive: true });
const outputPath = join(outputDirectory, `router-blind-${Date.now()}.json`);
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log('\nBLIND SUMMARY');
console.log(JSON.stringify(report.summary, null, 2));
console.log(`ADOPT ${adopted}`);
console.log(`REPORT ${outputPath}`);
