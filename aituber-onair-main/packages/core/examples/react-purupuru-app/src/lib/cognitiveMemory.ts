import { createMemoryRecord } from '../config/memoryArchiveSeed';
import type {
  CognitiveMemoryPhase,
  LongTermMemoryType,
  MemoryDimension,
  MemoryInteraction,
  StreamerMemoryRecord,
} from '../types/memory';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const GREETING_ONLY =
  /^(?:你好|嗨|哈喽|晚上好|早上好|来了|打卡|在吗|主播好|哈哈+|666+|hi|hello)[啊呀哦嘛吗～~！!。.s]*$/i;
const EXPLICIT_REMEMBER = /(?:记住|别忘|以后还要|下次还|你还记得|remember)/i;
const EMOTIONAL =
  /(?:难过|开心|感动|害怕|焦虑|生气|失望|喜欢|讨厌|重要|终于|谢谢你)/i;
const COMMITMENT = /(?:答应|约定|承诺|下次|以后一起|别再|一定要)/i;
const SAFETY = /(?:危险|预警|撤离|救援|失联|停电|洪水|内涝|报警)/i;
const CONTRADICTION = /(?:不是|不再|改了|说错|别叫|不要再|取消|已经不|其实不)/i;

export interface TraceSignals {
  salience: number;
  emotionalSalience: number;
  novelty: number;
  goalRelevance: number;
  explicitRemember: boolean;
  isNoise: boolean;
}

export interface SleepReport {
  id: string;
  mode: 'micro' | 'post_stream' | 'deep';
  startedAt: number;
  completedAt: number;
  replayed: number;
  compressed: number;
  promoted: number;
  strengthened: number;
  revised: number;
  faded: number;
  dormant: number;
  forgotten: number;
}

export interface SleepResult {
  records: StreamerMemoryRecord[];
  report: SleepReport;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function meaningfulTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
  const tokens = normalized.split(' ').filter((token) => token.length >= 2);
  const cjk = normalized.replace(/[^\p{Script=Han}]/gu, '');
  for (let index = 0; index < cjk.length - 1; index += 1) {
    tokens.push(cjk.slice(index, index + 2));
  }
  return Array.from(new Set(tokens));
}

export function memorySimilarity(left: string, right: string): number {
  const a = new Set(meaningfulTokens(left));
  const b = new Set(meaningfulTokens(right));
  if (!a.size || !b.size) return left.trim() === right.trim() ? 1 : 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

export function analyzeTrace(input: string, reply: string): TraceSignals {
  const text = `${input} ${reply}`;
  const explicitRemember = EXPLICIT_REMEMBER.test(input);
  const emotionalSalience = EMOTIONAL.test(input) ? 0.72 : 0.12;
  const goalRelevance = COMMITMENT.test(input)
    ? 0.82
    : SAFETY.test(input)
      ? 0.9
      : /(?:怎么|为什么|如何|计划|准备|制作|学习)/i.test(input)
        ? 0.56
        : 0.24;
  const isNoise = GREETING_ONLY.test(input.trim()) && input.length < 24;
  const novelty = isNoise ? 0.08 : input.length > 40 ? 0.72 : 0.46;
  const salience = clamp(
    (explicitRemember ? 0.42 : 0) +
      emotionalSalience * 0.25 +
      goalRelevance * 0.3 +
      novelty * 0.2 +
      (isNoise ? -0.25 : 0),
  );
  void text;
  return {
    salience,
    emotionalSalience,
    novelty,
    goalRelevance,
    explicitRemember,
    isNoise,
  };
}

export function createInteractionTrace(
  interaction: MemoryInteraction,
  digitalHumanId: string,
  sessionId: string,
): StreamerMemoryRecord {
  const signals = analyzeTrace(interaction.input, interaction.reply);
  const viewerName = interaction.viewerName || '直播间';
  return createMemoryRecord({
    digitalHumanId,
    scope: interaction.viewerId ? 'viewer' : 'session',
    kind: 'event',
    dimension: interaction.viewerId ? 'relationship' : 'episode',
    layer: 'interaction',
    status: 'candidate',
    title: signals.isNoise
      ? `${viewerName}的一次普通互动`
      : `${viewerName}的近期互动`,
    subjectType: interaction.viewerId ? 'viewer' : 'group',
    subjectId: interaction.viewerId,
    subjectName: viewerName,
    content: interaction.input.slice(0, 220),
    details: {
      reply: interaction.reply.slice(0, 240),
      interactionSource: interaction.source,
      explicitRemember: signals.explicitRemember,
      isNoise: signals.isNoise,
    },
    importance: Math.max(1, Math.round(signals.salience * 10)),
    // A viewer statement is durable interaction context, not independent
    // verification of external people or events.
    confidence: interaction.viewerId ? 0.65 : 0.8,
    temporalScope: 'episode',
    visibility: interaction.viewerId ? 'private' : 'internal',
    memoryTier: 'short_term',
    phase: 'now',
    sleepState: 'queued',
    activation: 0.9,
    stability: 0.08 + signals.salience * 0.18,
    halfLifeMs: signals.isNoise ? 2 * HOUR : 18 * HOUR,
    salience: signals.salience,
    emotionalSalience: signals.emotionalSalience,
    novelty: signals.novelty,
    goalRelevance: signals.goalRelevance,
    sessionIds: [sessionId],
    sourceType: 'live_event',
    sourceEventIds: [interaction.id],
    firstSeenAt: interaction.at,
    lastSeenAt: interaction.at,
  });
}

function longTermTypeFor(dimension: MemoryDimension): LongTermMemoryType {
  if (dimension === 'relationship') return 'relational';
  if (dimension === 'episode') return 'episodic';
  if (dimension === 'preference' || dimension === 'knowledge')
    return 'semantic';
  if (dimension === 'commitment') return 'procedural';
  return 'semantic';
}

function phaseForActivation(activation: number): CognitiveMemoryPhase {
  if (activation >= 0.42) return 'long_term';
  if (activation >= 0.17) return 'fading';
  if (activation >= 0.055) return 'dormant';
  return 'forgotten';
}

function decay(record: StreamerMemoryRecord, now: number) {
  if (record.protected && record.sourceType === 'operator_seed') {
    return {
      ...record,
      activation: Math.max(0.82, record.activation),
      stability: Math.max(0.86, record.stability),
      phase: 'long_term' as const,
    };
  }
  const elapsed = Math.max(
    0,
    now - (record.lastRecalledAt || record.lastSeenAt),
  );
  const activation = clamp(
    record.activation *
      Math.pow(0.5, elapsed / Math.max(HOUR, record.halfLifeMs)),
  );
  return { ...record, activation, phase: phaseForActivation(activation) };
}

function clusterTraces(records: StreamerMemoryRecord[]) {
  const clusters: StreamerMemoryRecord[][] = [];
  for (const record of records.sort((a, b) => a.createdAt - b.createdAt)) {
    const cluster = clusters.find((items) => {
      const first = items[0];
      return (
        first.dimension === record.dimension &&
        (first.subjectId || first.subjectName) ===
          (record.subjectId || record.subjectName) &&
        items.some(
          (item) => memorySimilarity(item.content, record.content) >= 0.28,
        )
      );
    });
    if (cluster) cluster.push(record);
    else clusters.push([record]);
  }
  return clusters;
}

function compactGist(cluster: StreamerMemoryRecord[]) {
  const ordered = cluster
    .slice()
    .sort((a, b) => b.salience - a.salience || b.lastSeenAt - a.lastSeenAt);
  const unique: string[] = [];
  for (const record of ordered) {
    if (!unique.some((text) => memorySimilarity(text, record.content) > 0.72)) {
      unique.push(record.content.replace(/[。；]+$/g, ''));
    }
  }
  return unique.slice(0, 3).join('；').slice(0, 280);
}

function isContradictory(cluster: StreamerMemoryRecord[]) {
  return cluster.some((record) => CONTRADICTION.test(record.content));
}

export function runSleepCycle(
  allRecords: StreamerMemoryRecord[],
  digitalHumanId: string,
  mode: SleepReport['mode'],
  now = Date.now(),
): SleepResult {
  const report: SleepReport = {
    id: crypto.randomUUID(),
    mode,
    startedAt: now,
    completedAt: now,
    replayed: 0,
    compressed: 0,
    promoted: 0,
    strengthened: 0,
    revised: 0,
    faded: 0,
    dormant: 0,
    forgotten: 0,
  };
  const untouched = allRecords.filter(
    (record) => record.digitalHumanId !== digitalHumanId,
  );
  let records = allRecords
    .filter((record) => record.digitalHumanId === digitalHumanId)
    .map((record) =>
      record.memoryTier === 'long_term' ? decay(record, now) : record,
    );
  const shortTerm = records.filter(
    (record) =>
      record.memoryTier === 'short_term' &&
      record.phase !== 'forgotten' &&
      record.sleepState !== 'settled',
  );
  const clusters = clusterTraces(shortTerm);
  report.replayed = shortTerm.length;

  for (const cluster of clusters) {
    const sessions = Array.from(
      new Set(cluster.flatMap((item) => item.sessionIds)),
    );
    const occurrences = cluster.reduce(
      (sum, item) => sum + item.occurrenceCount,
      0,
    );
    const maxSalience = Math.max(...cluster.map((item) => item.salience));
    const averageSalience =
      cluster.reduce((sum, item) => sum + item.salience, 0) / cluster.length;
    const explicit = cluster.some(
      (item) => item.details.explicitRemember === true,
    );
    const noiseOnly = cluster.every((item) => item.details.isNoise === true);
    const gist = compactGist(cluster);
    const first = cluster[0];
    const shouldPromote =
      explicit ||
      maxSalience >= 0.84 ||
      sessions.length >= 3 ||
      (occurrences >= 4 && averageSalience >= 0.42);

    if (noiseOnly && cluster.length < 3) {
      records = records.map((record) =>
        cluster.some((item) => item.id === record.id)
          ? {
              ...record,
              phase: 'forgotten',
              sleepState: 'settled',
              activation: 0.02,
              compressionLevel: record.compressionLevel + 1,
              lastSleptAt: now,
            }
          : record,
      );
      report.forgotten += cluster.length;
      continue;
    }

    const existing = records.find(
      (record) =>
        record.memoryTier === 'long_term' &&
        record.dimension === first.dimension &&
        (record.subjectId || record.subjectName) ===
          (first.subjectId || first.subjectName) &&
        memorySimilarity(record.content, gist) >= 0.24,
    );

    if (existing && (shouldPromote || cluster.length >= 2)) {
      const contradiction = isContradictory(cluster);
      const combinedSessions = Array.from(
        new Set([...existing.sessionIds, ...sessions]),
      );
      const spacedGain = Math.min(0.28, combinedSessions.length * 0.045);
      const newContent = contradiction ? gist : existing.content;
      records = records.map((record) => {
        if (record.id === existing.id) {
          return {
            ...record,
            content: newContent,
            versionHistory:
              contradiction && newContent !== record.content
                ? [
                    ...record.versionHistory,
                    {
                      content: record.content,
                      details: record.details,
                      replacedAt: now,
                      reason: '睡眠整理发现新的矛盾信息，进入再巩固',
                    },
                  ]
                : record.versionHistory,
            activation: clamp(record.activation + 0.2),
            stability: clamp(
              record.stability +
                spacedGain +
                averageSalience * 0.08 -
                (contradiction ? 0.12 : 0),
            ),
            halfLifeMs: Math.min(
              730 * DAY,
              record.halfLifeMs * (1.18 + combinedSessions.length * 0.04),
            ),
            occurrenceCount: record.occurrenceCount + occurrences,
            reinforcement: record.reinforcement + cluster.length * 0.25,
            sessionIds: combinedSessions,
            sourceEventIds: Array.from(
              new Set([
                ...record.sourceEventIds,
                ...cluster.flatMap((item) => item.sourceEventIds),
              ]),
            ).slice(-80),
            relatedEntryIds: Array.from(
              new Set([
                ...record.relatedEntryIds,
                ...cluster.map((item) => item.id),
              ]),
            ),
            lastSeenAt: Math.max(
              record.lastSeenAt,
              ...cluster.map((item) => item.lastSeenAt),
            ),
            lastSleptAt: now,
            updatedAt: now,
            phase: 'long_term',
          };
        }
        if (cluster.some((item) => item.id === record.id)) {
          return {
            ...record,
            phase: 'forgotten',
            sleepState: 'settled',
            activation: 0.02,
            compressionLevel: record.compressionLevel + 1,
            relatedEntryIds: [...record.relatedEntryIds, existing.id],
            lastSleptAt: now,
          };
        }
        return record;
      });
      report.strengthened += 1;
      if (contradiction) report.revised += 1;
      report.compressed += cluster.length;
      continue;
    }

    if (shouldPromote) {
      const longTerm = createMemoryRecord({
        digitalHumanId,
        scope: first.scope === 'viewer' ? 'viewer' : 'knowledge',
        kind: first.dimension === 'episode' ? 'event' : 'summary',
        dimension: first.dimension,
        layer: 'reflection',
        status: 'confirmed',
        title:
          first.dimension === 'relationship'
            ? `逐渐熟悉的${first.subjectName}`
            : `${first.subjectName}留下的长期印象`,
        subjectType: first.subjectType,
        subjectId: first.subjectId,
        subjectName: first.subjectName,
        content: gist,
        details: {
          gist,
          formedDuringSleep: report.id,
          sourceTraceCount: cluster.length,
        },
        importance: Math.max(...cluster.map((item) => item.importance)),
        confidence: clamp(
          0.55 + averageSalience * 0.3 + sessions.length * 0.04,
        ),
        temporalScope: first.dimension === 'episode' ? 'episode' : 'pattern',
        visibility: first.visibility,
        memoryTier: 'long_term',
        longTermType: longTermTypeFor(first.dimension),
        phase: 'long_term',
        sleepState: 'settled',
        activation: 0.82,
        stability: clamp(0.42 + sessions.length * 0.1 + averageSalience * 0.2),
        halfLifeMs: Math.min(
          365 * DAY,
          21 * DAY * Math.max(1, sessions.length),
        ),
        salience: averageSalience,
        emotionalSalience: Math.max(
          ...cluster.map((item) => item.emotionalSalience),
        ),
        novelty: Math.max(...cluster.map((item) => item.novelty)),
        goalRelevance: Math.max(...cluster.map((item) => item.goalRelevance)),
        occurrenceCount: occurrences,
        reinforcement: cluster.length * 0.5,
        sessionIds: sessions,
        sourceType: 'reflection',
        sourceEventIds: Array.from(
          new Set(cluster.flatMap((item) => item.sourceEventIds)),
        ).slice(-80),
        relatedEntryIds: cluster.map((item) => item.id),
        firstSeenAt: Math.min(...cluster.map((item) => item.firstSeenAt)),
        lastSeenAt: Math.max(...cluster.map((item) => item.lastSeenAt)),
        lastSleptAt: now,
      });
      records.push(longTerm);
      records = records.map((record) =>
        cluster.some((item) => item.id === record.id)
          ? {
              ...record,
              phase: 'forgotten',
              sleepState: 'settled',
              activation: 0.02,
              compressionLevel: record.compressionLevel + 1,
              relatedEntryIds: [...record.relatedEntryIds, longTerm.id],
              lastSleptAt: now,
            }
          : record,
      );
      report.promoted += 1;
      report.compressed += cluster.length;
      continue;
    }

    const keeper = cluster
      .slice()
      .sort((a, b) => b.salience - a.salience || b.createdAt - a.createdAt)[0];
    records = records.map((record) => {
      if (record.id === keeper.id) {
        return {
          ...record,
          title: `${record.subjectName}的本场印象`,
          content: gist,
          phase: 'sleep_queue',
          sleepState: 'settled',
          activation: clamp(0.35 + averageSalience * 0.35),
          stability: clamp(record.stability + averageSalience * 0.08),
          halfLifeMs: Math.max(record.halfLifeMs, 3 * DAY),
          occurrenceCount: occurrences,
          sessionIds: sessions,
          compressionLevel: record.compressionLevel + 1,
          relatedEntryIds: Array.from(
            new Set([
              ...record.relatedEntryIds,
              ...cluster.map((item) => item.id),
            ]),
          ),
          lastSleptAt: now,
          updatedAt: now,
        };
      }
      if (cluster.some((item) => item.id === record.id)) {
        return {
          ...record,
          phase: 'forgotten',
          sleepState: 'settled',
          activation: 0.02,
          compressionLevel: record.compressionLevel + 1,
          relatedEntryIds: [...record.relatedEntryIds, keeper.id],
          lastSleptAt: now,
        };
      }
      return record;
    });
    report.compressed += Math.max(0, cluster.length - 1);
  }

  const longTerm = records.filter(
    (record) => record.memoryTier === 'long_term',
  );
  for (let leftIndex = 0; leftIndex < longTerm.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < longTerm.length;
      rightIndex += 1
    ) {
      const left = longTerm[leftIndex];
      const right = longTerm[rightIndex];
      if (
        left.protected ||
        right.protected ||
        left.dimension !== right.dimension ||
        (left.subjectId || left.subjectName) !==
          (right.subjectId || right.subjectName) ||
        memorySimilarity(left.content, right.content) < 0.38
      ) {
        continue;
      }
      const weaker = left.stability <= right.stability ? left : right;
      records = records.map((record) =>
        record.id === weaker.id
          ? {
              ...record,
              interference: clamp(record.interference + 0.08),
              activation: clamp(record.activation - 0.04),
              phase: phaseForActivation(clamp(record.activation - 0.04)),
            }
          : record,
      );
    }
  }

  report.faded = records.filter((record) => record.phase === 'fading').length;
  report.dormant = records.filter(
    (record) => record.phase === 'dormant',
  ).length;
  report.forgotten = Math.max(
    report.forgotten,
    records.filter((record) => record.phase === 'forgotten').length,
  );
  report.completedAt = Date.now();
  return { records: [...untouched, ...records], report };
}
