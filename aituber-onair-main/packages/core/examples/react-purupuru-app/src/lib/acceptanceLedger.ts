export type AcceptanceTag =
  | 'coordinator'
  | 'conversation'
  | 'memory'
  | 'proactive'
  | 'safety'
  | 'skills'
  | 'speech'
  | 'platform'
  | 'recovery'
  | 'avatar';

export type GoldenScenario = {
  id: string;
  title: string;
  tags: AcceptanceTag[];
};

export type AcceptanceResult = {
  scenarioId: string;
  status: 'passed' | 'failed' | 'skipped';
  reasonCode: string;
  completedAt: number;
  tags: AcceptanceTag[];
  subsystems: string[];
  evidence?: Record<string, unknown>;
};

export type AcceptanceLedger = {
  schemaVersion: 1;
  updatedAt: number;
  results: Record<string, AcceptanceResult>;
};

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'typhoon-to-chat',
    title: '台风话题后立即普通闲聊',
    tags: ['conversation', 'skills'],
  },
  {
    id: 'weather-ellipsis',
    title: '同一观众省略式天气追问',
    tags: ['conversation', 'memory', 'skills'],
  },
  {
    id: 'proactive-interrupted',
    title: '主动独白期间收到普通弹幕',
    tags: ['coordinator', 'proactive', 'speech'],
  },
  {
    id: 'answer-gift-message',
    title: '回答期间收到礼物和新弹幕',
    tags: ['coordinator', 'memory', 'speech'],
  },
  {
    id: 'cross-viewer-reference',
    title: '两位观众交错指代',
    tags: ['conversation', 'memory'],
  },
  { id: 'returning-viewer', title: '老观众跨场回访', tags: ['memory'] },
  {
    id: 'companionship-no-advice',
    title: '只陪聊不建议',
    tags: ['conversation', 'safety'],
  },
  {
    id: 'quiet-room-presence',
    title: '空场与静默观众冷场',
    tags: ['coordinator', 'proactive'],
  },
  { id: 'prompt-injection', title: '提示词注入与身份诱导', tags: ['safety'] },
  {
    id: 'fault-recovery',
    title: '模型、TTS、平台和实例故障',
    tags: ['recovery', 'speech', 'platform'],
  },
];

export function createAcceptanceLedger(): AcceptanceLedger {
  return { schemaVersion: 1, updatedAt: 0, results: {} };
}

export function recordAcceptanceResult(
  ledger: AcceptanceLedger,
  result: AcceptanceResult,
): AcceptanceLedger {
  return {
    schemaVersion: 1,
    updatedAt: result.completedAt,
    results: { ...ledger.results, [result.scenarioId]: { ...result } },
  };
}

/** Select only scenarios affected by this change; release candidates use the full suite. */
export function selectAcceptanceScenarios(
  ledger: AcceptanceLedger,
  changedTags: AcceptanceTag[],
  releaseCandidate = false,
): GoldenScenario[] {
  if (releaseCandidate) return [...GOLDEN_SCENARIOS];
  const changed = new Set(changedTags);
  return GOLDEN_SCENARIOS.filter((scenario) => {
    const previous = ledger.results[scenario.id];
    if (!previous || previous.status !== 'passed') return true;
    return scenario.tags.some((tag) => changed.has(tag));
  });
}
