export type ProactiveContinuity = 'new' | 'continue' | 'close';

export interface PersonaTopicEntry {
  topicFamily: string;
  entities: string[];
  drive: string;
  source: string;
  continuity: ProactiveContinuity;
  spokenAt: number;
  audienceResponded: boolean;
}

export interface PersonaTopicCandidate {
  topicFamily: string;
  entities: string[];
  source: string;
  sourceRef?: string;
  mustAdvance: string;
}

const SEMANTIC_FAMILIES: Array<[string, RegExp]> = [
  ['drinks', /茶|咖啡|饮料|水杯|茶杯|保温杯|喝水|泡了/u],
  ['food', /零食|吃饭|午饭|晚饭|夜宵|咸味|甜点/u],
  ['music', /音乐|歌曲|歌单|旋律|节奏|耳机/u],
  ['stories', /故事|悬疑|小说|剧情|结局|角色/u],
  ['live_craft', /直播|节目|开场|收尾|表达|台词|主持/u],
  ['room_presence', /直播间|房间|在场|安静|没人|观众/u],
  ['relationships', /朋友|女朋友|男朋友|家人|关系|认识/u],
  ['weather', /天气|台风|下雨|雷达|气温|风雨/u],
];

function normalizedTokens(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{Script=Han}]{2,6}|[a-z0-9]{3,16}/gu)
    ?.slice(0, 4) ?? [];
}

export function inferTopicFamily(text: string, fallback = 'inner_life') {
  for (const [family, pattern] of SEMANTIC_FAMILIES) {
    if (pattern.test(text)) return family;
  }
  return normalizedTokens(text)[0] ?? fallback;
}

export function inferTopicEntities(text: string) {
  const semantic = SEMANTIC_FAMILIES.flatMap(([family, pattern]) =>
    pattern.test(text) ? [family] : [],
  );
  return [...new Set([...semantic, ...normalizedTokens(text)])].slice(0, 5);
}

export class PersonaTopicLedger {
  private entries: PersonaTopicEntry[] = [];
  private readonly maxEntries: number;
  private readonly cooldownTurns: number;
  private readonly cooldownMs: number;

  constructor(
    maxEntries = 12,
    cooldownTurns = 6,
    cooldownMs = 30 * 60_000,
  ) {
    this.maxEntries = maxEntries;
    this.cooldownTurns = cooldownTurns;
    this.cooldownMs = cooldownMs;
  }

  snapshot() {
    return this.entries.map((entry) => ({ ...entry, entities: [...entry.entities] }));
  }

  isCooling(candidate: PersonaTopicCandidate, at = Date.now()) {
    const recent = this.entries.slice(-this.cooldownTurns);
    return recent.some(
      (entry) =>
        at - entry.spokenAt < this.cooldownMs &&
        (entry.topicFamily === candidate.topicFamily ||
          entry.entities.some((entity) => candidate.entities.includes(entity))),
    );
  }

  score(candidate: PersonaTopicCandidate, at = Date.now()) {
    const lastIndex = [...this.entries]
      .reverse()
      .findIndex((entry) => entry.topicFamily === candidate.topicFamily);
    const last = [...this.entries]
      .reverse()
      .find((entry) => entry.topicFamily === candidate.topicFamily);
    const freshness = lastIndex < 0 ? 100 : Math.min(60, lastIndex * 10);
    const age = last ? Math.min(30, (at - last.spokenAt) / 60_000) : 30;
    return freshness + age - (this.isCooling(candidate, at) ? 1_000 : 0);
  }

  commit(entry: PersonaTopicEntry) {
    this.entries.push({ ...entry, entities: [...entry.entities] });
    this.entries = this.entries.slice(-this.maxEntries);
  }
}
