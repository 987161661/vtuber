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
  [
    'support_ack',
    /点赞|点了赞|赞收|谢谢.*赞|感谢.*赞|亮一格|点亮|靠你们养|靠你们撑|多撑.*格/u,
  ],
  ['time_mood', /周[一二三四五六日天]|摸鱼|下班|还挂着|没处去|躲清静|躲清净/u],
  ['drinks', /茶|咖啡|饮料|水杯|茶杯|保温杯|喝水|泡了/u],
  ['food', /零食|吃饭|午饭|晚饭|夜宵|咸味|甜点/u],
  ['music', /音乐|歌曲|歌单|旋律|节奏|耳机/u],
  ['stories', /故事|悬疑|小说|剧情|结局|角色/u],
  ['live_craft', /直播|节目|开场|收尾|表达|台词|主持/u],
  ['room_presence', /直播间|房间|在场|安静|没人|观众/u],
  ['relationships', /朋友|女朋友|男朋友|家人|关系|认识/u],
  ['weather', /天气|台风|下雨|雷达|气温|风雨/u],
  ['hazards', /洪灾|洪水|雨灾|水灾|内涝|积水|山洪|泥石流|灾情|预警/u],
];

function semanticFamilies(text: string) {
  return SEMANTIC_FAMILIES.flatMap(([family, pattern]) =>
    pattern.test(text) ? [family] : [],
  );
}

function normalizedComparableText(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '')
    .replace(/(?:这个|那个|现在|目前|就是|其实|一下|已经|还是|可以)/gu, '');
}

function bigrams(text: string) {
  const chars = Array.from(normalizedComparableText(text));
  const values = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) {
    values.add(`${chars[index]}${chars[index + 1]}`);
  }
  return values;
}

/**
 * Final deterministic guard for low-priority proactive speech. It compares
 * meaning-bearing topic families first and lexical overlap second, so a model
 * cannot repeat the just-finished audience topic merely by paraphrasing it.
 */
export function isRecentSemanticTopicRepeat(
  candidate: string,
  recentTexts: readonly string[],
) {
  const candidateFamilies = new Set(semanticFamilies(candidate));
  const candidateNormalized = normalizedComparableText(candidate);
  const candidateBigrams = bigrams(candidate);
  if (!candidateNormalized || candidateBigrams.size < 2) return false;
  return recentTexts.some((recentText) => {
    const recentFamilies = semanticFamilies(recentText);
    if (recentFamilies.some((family) => candidateFamilies.has(family))) {
      return true;
    }
    const recentNormalized = normalizedComparableText(recentText);
    if (
      Math.min(candidateNormalized.length, recentNormalized.length) >= 8 &&
      (candidateNormalized.includes(recentNormalized) ||
        recentNormalized.includes(candidateNormalized))
    ) {
      return true;
    }
    const recentBigrams = bigrams(recentText);
    const intersection = [...candidateBigrams].filter((value) =>
      recentBigrams.has(value),
    ).length;
    const union = new Set([...candidateBigrams, ...recentBigrams]).size;
    return union > 0 && intersection / union >= 0.45;
  });
}

/**
 * Support acknowledgements are single-use interaction replies, never a source
 * for later quiet-room monologues. Keeping this rule deterministic prevents a
 * single like from driving an hour of paraphrased proactive speech.
 */
export function isSingleUseEngagementEcho(candidate: string): boolean {
  return semanticFamilies(candidate).includes('support_ack');
}

function normalizedTokens(text: string) {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{Script=Han}]{2,6}|[a-z0-9]{3,16}/gu)
      ?.slice(0, 4) ?? []
  );
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

  constructor(maxEntries = 12, cooldownTurns = 6, cooldownMs = 30 * 60_000) {
    this.maxEntries = maxEntries;
    this.cooldownTurns = cooldownTurns;
    this.cooldownMs = cooldownMs;
  }

  snapshot() {
    return this.entries.map((entry) => ({
      ...entry,
      entities: [...entry.entities],
    }));
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
