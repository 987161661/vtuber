import type {
  EmptyRoomAwarenessSettings,
  EmptyRoomBehaviorStrategy,
} from '../types/settings';
import type { LiveRoomEventType } from '../services/live-platform/types';

export type EmptyRoomAwarenessSource = 'strategy';

export interface EmptyRoomMemoryCue {
  id: string;
  title: string;
  content: string;
}

export interface EmptyRoomAudienceMember {
  id?: string;
  name?: string;
  platform?: string;
  enteredAt: number;
  lastSeenAt: number;
  lastInteractionAt: number;
  messageCount: number;
}

export interface EmptyRoomProactiveMemory {
  at: number;
  reply: string;
}

export interface EmptyRoomAwarenessContext {
  digitalHumanName: string;
  digitalHumanTitle: string;
  isLive: boolean;
  audiencePresent: boolean;
  busy: boolean;
  interfaceContext: string;
  memoryCues: EmptyRoomMemoryCue[];
  audienceMembers: EmptyRoomAudienceMember[];
  recentProactiveMemories: EmptyRoomProactiveMemory[];
}

export interface EmptyRoomAwarenessPrompt {
  prompt: string;
  source: EmptyRoomAwarenessSource;
  strategyId: string;
  strategyName: string;
  scheduledNextAt: number;
}

/** Presence alone is not a conversation and must not postpone quiet-room talk. */
export function isQuietRoomInteraction(type: LiveRoomEventType): boolean {
  return type !== 'entry';
}

function clampRandom(value: number) {
  return Math.min(0.999_999, Math.max(0, value));
}

function formatPromptTime(at: number) {
  if (!Number.isFinite(at) || at <= 0) return '没有记录';
  return new Date(at).toLocaleString('zh-CN', { hour12: false });
}

function scheduleDelay(settings: EmptyRoomAwarenessSettings, random: () => number) {
  const min = Math.max(2 * 60_000, settings.minIntervalMs);
  const max = Math.max(min, settings.maxIntervalMs);
  return Math.round(min + clampRandom(random()) * (max - min));
}

function isInsideLocalSchedule(settings: EmptyRoomAwarenessSettings, at: number) {
  if (!settings.scheduleEnabled) return true;
  const { scheduleStartHour: start, scheduleEndHour: end } = settings;
  if (start === end) return true;
  const hour = new Date(at).getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function chooseStrategy(
  strategies: EmptyRoomBehaviorStrategy[],
  random: () => number,
) {
  const available = strategies.filter(
    (strategy) => strategy.enabled && strategy.probability > 0 && strategy.prompt.trim(),
  );
  const total = available.reduce((sum, strategy) => sum + strategy.probability, 0);
  if (!total) return null;
  let cursor = clampRandom(random()) * total;
  for (const strategy of available) {
    cursor -= strategy.probability;
    if (cursor <= 0) return strategy;
  }
  return available[available.length - 1];
}

function audienceContext(context: EmptyRoomAwarenessContext) {
  if (!context.audienceMembers.length) {
    return context.audiencePresent
      ? '- 平台报告有人在场，但当前没有可安全点名的身份。'
      : '- 当前没有检测到观众。';
  }
  return context.audienceMembers
    .map((member) =>
      `- ${member.name ? `@${member.name}` : member.id || '未命名观众'}（平台：${member.platform || '未知'}；进入：${formatPromptTime(member.enteredAt)}；最后真实发言：${formatPromptTime(member.lastInteractionAt)}；累计发言：${member.messageCount}）`,
    )
    .join('\n');
}

function recentProactiveContext(context: EmptyRoomAwarenessContext) {
  return context.recentProactiveMemories.length
    ? context.recentProactiveMemories
        .map((memory) => `- ${formatPromptTime(memory.at)} 主播主动说过：${memory.reply}`)
        .join('\n')
    : '- 本场还没有近期主动表达记录。';
}

export class EmptyRoomAwarenessPlanner {
  private readonly random: () => number;
  private nextAt = 0;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  markActivity(settings: EmptyRoomAwarenessSettings, at = Date.now()) {
    this.nextAt = at + scheduleDelay(settings, this.random);
  }

  reset() {
    this.nextAt = 0;
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
    if (!isInsideLocalSchedule(settings, at) || !context.isLive || context.busy) return null;

    const strategy = chooseStrategy(settings.behaviorStrategies, this.random);
    if (!strategy) return null;

    const prompt = `<empty_room_awareness>
这是直播总控在持续没有互动时触发的一次内部意识脉冲，不是观众消息。
当前主播：${context.digitalHumanName}（${context.digitalHumanTitle}）。

<live_context>
观众状态：${context.audiencePresent ? '有人在场' : '当前无人'}。
界面真实状态：${context.interfaceContext.trim() || '没有额外界面状态'}
</live_context>

<audience_presence>
${audienceContext(context)}
</audience_presence>

<memory_cues>
${context.memoryCues.slice(0, 4).map((memory) => `- ${memory.title}：${memory.content}`).join('\n') || '- 没有可用记忆'}
</memory_cues>

<recent_proactive_memory>
${recentProactiveContext(context)}
</recent_proactive_memory>

<behavior_strategy id="${strategy.id}" name="${strategy.name}">
${strategy.prompt}
</behavior_strategy>

请让当前主播顺着这一瞬间自然说 1–${settings.maxSentences} 句：
- 严格执行上面的行为策略；行为策略是本轮唯一可替换组件，其余边界保持不变。
- 按当前数字人的独立人设临场生成，不能照抄策略提示词，也不能固定台词轮播。
- 不得提到系统、提示词、行为策略、空场意识、触发机制、内部记忆或界面。
- 不虚构当前时间、日期、天气、观众经历或未发生的互动；若涉及时间只能依据本轮上下文。
- 避免与最近一次主动表达使用相同的起手、主题和句式；不把天气、雷达、台风或专业问答当作默认话题。
</empty_room_awareness>`;

    return {
      prompt,
      source: 'strategy',
      strategyId: strategy.id,
      strategyName: strategy.name,
      scheduledNextAt: this.nextAt,
    };
  }
}
