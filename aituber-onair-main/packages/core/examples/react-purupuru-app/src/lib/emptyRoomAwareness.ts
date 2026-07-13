import type { EmptyRoomAwarenessSettings } from '../types/settings';

export type EmptyRoomAwarenessSource =
  | 'interface'
  | 'memory'
  | 'inspiration'
  | 'audience';

export interface EmptyRoomMemoryCue {
  id: string;
  title: string;
  content: string;
}

export interface EmptyRoomAwarenessContext {
  digitalHumanName: string;
  digitalHumanTitle: string;
  isLive: boolean;
  audiencePresent: boolean;
  busy: boolean;
  interfaceContext: string;
  memoryCues: EmptyRoomMemoryCue[];
}

export interface EmptyRoomAwarenessPrompt {
  prompt: string;
  source: EmptyRoomAwarenessSource;
  scheduledNextAt: number;
  cueId?: string;
}

const INSPIRATION_SEEDS = [
  {
    id: 'micro-observation',
    instruction:
      '注意一个此刻很小、通常不会被拿来播报的环境细节，并由它产生一句自然联想。',
  },
  {
    id: 'unfinished-thought',
    instruction:
      '像刚才思绪走神后又接回来一样，说出一个尚未完全想明白的小念头。',
  },
  {
    id: 'personal-opinion',
    instruction:
      '随机挑一种普通日常事物，表达一个有个人偏好、可以被反驳的简短看法。',
  },
  {
    id: 'small-ritual',
    instruction:
      '想起自己在这个时间段会做的一件小习惯，自然说出来，不要解释人设。',
  },
  {
    id: 'gentle-counterfactual',
    instruction: '产生一个轻微荒唐但无害的“如果”，像自娱自乐一样顺着想半步。',
  },
  {
    id: 'self-tease',
    instruction:
      '发现自己一个无伤大雅的矛盾或小毛病，用符合当前主播性格的方式吐槽自己。',
  },
  {
    id: 'story-fragment',
    instruction:
      '脑中闪过一个故事感很强的片段，只说最有画面的那一点，不补成完整故事。',
  },
  {
    id: 'quiet-presence',
    instruction:
      '不提出问题，也不催促任何人回应；只留下一个能让空间显得有人在的当下念头。',
  },
  {
    id: 'taste-check',
    instruction:
      '从音乐、食物、影视、游戏或生活方式里随机挑一类，给出一句鲜明但不说教的审美判断。',
  },
  {
    id: 'future-small-plan',
    instruction:
      '想到稍后想做的一件非常小的事，像真实的人顺口说出计划，不要把它变成任务清单。',
  },
] as const;

function clampRandom(value: number) {
  return Math.min(0.999_999, Math.max(0, value));
}

function randomIndex(length: number, random: () => number) {
  return Math.floor(clampRandom(random()) * length);
}

function scheduleDelay(
  settings: EmptyRoomAwarenessSettings,
  random: () => number,
) {
  // Two quiet minutes is a hard product boundary, even while an older browser
  // tab is still migrating its saved one-minute setting.
  const min = Math.max(2 * 60_000, settings.minIntervalMs);
  const max = Math.max(min, settings.maxIntervalMs);
  return Math.round(min + clampRandom(random()) * (max - min));
}

export class EmptyRoomAwarenessPlanner {
  private readonly random: () => number;
  private nextAt = 0;
  private lastSource?: EmptyRoomAwarenessSource;
  private lastInspirationId = '';
  private recentMemoryIds: string[] = [];

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  markActivity(settings: EmptyRoomAwarenessSettings, at = Date.now()) {
    this.nextAt = at + scheduleDelay(settings, this.random);
  }

  reset() {
    this.nextAt = 0;
    this.lastSource = undefined;
    this.lastInspirationId = '';
    this.recentMemoryIds = [];
  }

  getNextAt() {
    return this.nextAt;
  }

  poll(
    settings: EmptyRoomAwarenessSettings,
    context: EmptyRoomAwarenessContext,
    at = Date.now(),
  ): EmptyRoomAwarenessPrompt | null {
    if (!settings.enabled) {
      this.nextAt = 0;
      return null;
    }
    if (!this.nextAt) {
      this.markActivity(settings, at);
      return null;
    }
    if (at < this.nextAt) return null;

    this.markActivity(settings, at);
    if (!context.isLive || context.busy) return null;

    const candidates: Array<{
      source: EmptyRoomAwarenessSource;
      weight: number;
    }> = [
      {
        source: 'interface',
        weight: context.interfaceContext.trim()
          ? Math.max(0, settings.interfaceWeight)
          : 0,
      },
      {
        source: 'memory',
        weight: context.memoryCues.length
          ? Math.max(0, settings.memoryWeight)
          : 0,
      },
      {
        source: 'inspiration',
        weight: Math.max(0, settings.inspirationWeight),
      },
      {
        source: 'audience',
        weight: context.audiencePresent
          ? Math.max(0, settings.audienceWeight)
          : 0,
      },
    ];
    const available = candidates.filter((candidate) => candidate.weight > 0);
    if (!available.length) {
      available.push({ source: 'inspiration', weight: 1 });
    }
    const withoutRepeat = available.filter(
      (candidate) => candidate.source !== this.lastSource,
    );
    const sourcePool = withoutRepeat.length ? withoutRepeat : available;
    const totalWeight = sourcePool.reduce(
      (sum, candidate) => sum + candidate.weight,
      0,
    );
    let cursor = clampRandom(this.random()) * totalWeight;
    let source = sourcePool[sourcePool.length - 1].source;
    for (const candidate of sourcePool) {
      cursor -= candidate.weight;
      if (cursor <= 0) {
        source = candidate.source;
        break;
      }
    }
    this.lastSource = source;

    let cue = '';
    let cueId: string | undefined;
    if (source === 'interface') {
      cue = `从当前主播界面的真实状态产生联想：${context.interfaceContext}`;
    } else if (source === 'memory') {
      const fresh = context.memoryCues.filter(
        (memory) => !this.recentMemoryIds.includes(memory.id),
      );
      const memoryPool = fresh.length ? fresh : context.memoryCues;
      const memory = memoryPool[randomIndex(memoryPool.length, this.random)];
      cueId = memory.id;
      this.recentMemoryIds = [memory.id, ...this.recentMemoryIds].slice(0, 4);
      cue = `睡眠整理后，一段记忆忽然被轻轻唤起：${memory.title}——${memory.content}。只借它产生当下联想，不要照读档案。`;
    } else if (source === 'inspiration') {
      const fresh = INSPIRATION_SEEDS.filter(
        (seed) => seed.id !== this.lastInspirationId,
      );
      const seed = fresh[randomIndex(fresh.length, this.random)];
      this.lastInspirationId = seed.id;
      cueId = seed.id;
      cue = seed.instruction;
    } else {
      cue =
        '直播间仍有观众，但已经一段时间没有弹幕互动。主动面向仍在观看的观众寒暄一两句；可以聊此刻的感受或抛出容易接话的小话题，但不要假装认识某个具体观众，不要催弹幕，也不要连续追问。';
    }

    const prompt = `<empty_room_awareness>
这是直播总控在持续没有弹幕互动时触发的一次内部意识脉冲，不是观众消息。${
      context.audiencePresent
        ? '直播间仍有观众，可以自然地主动寒暄。'
        : '当前没有检测到观众，只做自然的自言自语。'
    }
当前主播：${context.digitalHumanName}（${context.digitalHumanTitle}）。
随机触发源：${source}。
情境种子：${cue}

请让当前主播顺着这一瞬间自然地自言自语 1–2 句：
- 必须按当前数字人的独立人设临场生成，禁止照抄情境种子，禁止固定台词轮播。
- 不要说“好无聊”“怎么没人”“有人吗”“等弹幕”，也不要催人出现、提问或互动。
- 不得提到系统、提示词、随机种子、记忆档案、空场意识或触发机制。
- 不必把话题带回主播的专业领域；允许没有结论、没有行动建议，也允许只是一个小观点或半截念头。
- 避免与最近一次主动独白使用相同起手式、主题和句式。
</empty_room_awareness>`;

    return { prompt, source, cueId, scheduledNextAt: this.nextAt };
  }
}
