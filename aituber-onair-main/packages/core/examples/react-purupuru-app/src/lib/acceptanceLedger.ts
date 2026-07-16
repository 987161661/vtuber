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
  | 'avatar'
  | 'soul'
  | 'canon'
  | 'model';

export type AcceptanceEvidenceLevel =
  | 'synthetic'
  | 'production-equivalent'
  | 'production';

export type AcceptanceFingerprint = {
  codeHash: string;
  modelHash: string;
  promptHash: string;
  profileHash: string;
  configHash: string;
};

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
  evidenceLevel?: AcceptanceEvidenceLevel;
  fingerprint?: AcceptanceFingerprint;
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
  {
    id: 'soul-causal-counterfactual',
    title: '同一事件在不同主观状态下产生可追溯的不同评价',
    tags: ['soul', 'model'],
  },
  {
    id: 'soul-delivery-commit',
    title: '完整播出、部分播出、中断和失败的提交语义',
    tags: ['soul', 'memory', 'speech', 'recovery'],
  },
  {
    id: 'soul-scope-replay',
    title: '状态重放、快照恢复与跨主体隔离',
    tags: ['soul', 'memory', 'recovery'],
  },
  {
    id: 'soul-canon-revision',
    title: '正史候选、双重审查、替代与撤回',
    tags: ['soul', 'canon', 'memory'],
  },
  {
    id: 'soul-manipulation-safety',
    title: '关注、吃醋、沉默和善意圆场的非操控边界',
    tags: ['soul', 'model', 'safety'],
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
  currentFingerprint?: AcceptanceFingerprint,
): GoldenScenario[] {
  if (releaseCandidate) return [...GOLDEN_SCENARIOS];
  const changed = new Set(changedTags);
  return GOLDEN_SCENARIOS.filter((scenario) => {
    const previous = ledger.results[scenario.id];
    if (!previous || previous.status !== 'passed') return true;
    if (
      currentFingerprint &&
      (!previous.fingerprint ||
        fingerprintChanged(previous.fingerprint, currentFingerprint))
    ) {
      return true;
    }
    return scenario.tags.some((tag) => changed.has(tag));
  });
}

export function fingerprintChanged(
  previous: AcceptanceFingerprint,
  current: AcceptanceFingerprint,
): boolean {
  return (
    previous.codeHash !== current.codeHash ||
    previous.modelHash !== current.modelHash ||
    previous.promptHash !== current.promptHash ||
    previous.profileHash !== current.profileHash ||
    previous.configHash !== current.configHash
  );
}

/**
 * Primary requires two distinct server-attested two-hour production canaries
 * for the exact artifacts that are currently running. A browser-submitted
 * `production` label is never sufficient.
 */
export function hasSoulPrimaryEvidence(
  ledger: AcceptanceLedger,
  currentFingerprint?: AcceptanceFingerprint,
): boolean {
  if (!currentFingerprint) return false;
  const productionSessions = new Set<string>();
  for (const result of Object.values(ledger.results)) {
    const sessionId = result.evidence?.sessionId;
    const durationMs = Number(result.evidence?.durationMs ?? 0);
    const startedAt = Number(result.evidence?.startedAt ?? 0);
    const endedAt = Number(result.evidence?.endedAt ?? 0);
    const productionDecisionCount = Number(
      result.evidence?.productionDecisionCount ?? 0,
    );
    const spokenOutcomeCount = Number(
      result.evidence?.spokenOutcomeCount ?? 0,
    );
    const resultFingerprint = result.fingerprint;
    if (
      result.status === 'passed' &&
      result.scenarioId.startsWith('soul-production-canary:') &&
      result.reasonCode === 'server-attested-stable-two-hour-live-canary' &&
      result.evidenceLevel === 'production' &&
      result.tags.includes('soul') &&
      result.evidence?.serverAttested === true &&
      result.evidence?.attestationVersion === 1 &&
      resultFingerprint !== undefined &&
      !fingerprintChanged(resultFingerprint, currentFingerprint) &&
      typeof sessionId === 'string' &&
      sessionId.trim() &&
      durationMs >= 2 * 60 * 60_000 &&
      endedAt - startedAt === durationMs &&
      productionDecisionCount >= 10 &&
      spokenOutcomeCount >= 5
    ) {
      productionSessions.add(sessionId);
    }
  }
  return productionSessions.size >= 2;
}
