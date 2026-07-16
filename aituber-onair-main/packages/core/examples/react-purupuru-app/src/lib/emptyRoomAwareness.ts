import type {
  EmptyRoomAwarenessSettings,
  EmptyRoomBehaviorStrategy,
} from '../types/settings';
import type { LiveRoomEventType } from '../services/live-platform/types';
import type { RoomInteractionSnapshot } from './roomInteractionTracker';
import {
  formatProactiveIntent,
  PersonaRuntimeState,
  type ProactiveIntentPlanV1,
} from './personaRuntimeState';

export type EmptyRoomAwarenessSource = 'strategy' | 'soul-opportunity';

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

export interface EmptyRoomAwarenessContext {
  digitalHumanName: string;
  digitalHumanTitle: string;
  isLive: boolean;
  audiencePresent: boolean;
  participantCount: number;
  busy: boolean;
  interfaceContext: string;
  memoryCues: EmptyRoomMemoryCue[];
  audienceMembers: EmptyRoomAudienceMember[];
}

export interface LegacyEmptyRoomAwarenessPrompt {
  prompt: string;
  source: 'strategy';
  strategyId: string;
  strategyName: string;
  personaIntent: ProactiveIntentPlanV1;
  scheduledNextAt: number;
}

export interface SoulQuietOpportunityPrompt {
  prompt: string;
  source: 'soul-opportunity';
  roomContext: RoomInteractionSnapshot;
  scheduledNextAt: number;
}

export type EmptyRoomAwarenessPrompt =
  | LegacyEmptyRoomAwarenessPrompt
  | SoulQuietOpportunityPrompt;

export function createSoulQuietEventData(input: {
  durationMs: number;
  roomContext?: RoomInteractionSnapshot;
  sourceLabel?: string;
  /** Must come from authoritative Soul focus, never a legacy drive guess. */
  selfDirectedEngagement?: boolean;
}) {
  const rawParticipantCount = input.roomContext?.participantCount ?? 0;
  const rawDurationMs = input.durationMs;
  const participantCount = Number.isFinite(rawParticipantCount)
    ? Math.max(0, Math.floor(rawParticipantCount))
    : 0;
  return {
    durationMs: Number.isFinite(rawDurationMs)
      ? Math.max(0, Math.floor(rawDurationMs))
      : 0,
    audiencePresent: participantCount > 0,
    participantCount,
    selfDirectedEngagement: input.selfDirectedEngagement === true,
    sourceLabel: input.sourceLabel,
  };
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

export class EmptyRoomAwarenessPlanner {
  private readonly random: () => number;
  private readonly personaRuntime: PersonaRuntimeState;
  private nextAt = 0;

  constructor(
    random: () => number = Math.random,
    personaRuntime = new PersonaRuntimeState(),
  ) {
    this.random = random;
    this.personaRuntime = personaRuntime;
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

  private consumeDueOpportunity(
    settings: EmptyRoomAwarenessSettings,
    context: EmptyRoomAwarenessContext,
    at: number,
  ) {
    if (!settings.enabled) {
      this.nextAt = 0;
      return false;
    }
    if (!this.nextAt) {
      this.markActivity(settings, at);
      return false;
    }
    if (at < this.nextAt) return false;
    this.markActivity(settings, at);
    return (
      isInsideLocalSchedule(settings, at) && context.isLive && !context.busy
    );
  }

  poll(
    settings: EmptyRoomAwarenessSettings,
    context: EmptyRoomAwarenessContext,
    at = Date.now(),
  ): LegacyEmptyRoomAwarenessPrompt | null {
    if (!this.consumeDueOpportunity(settings, context, at)) return null;

    const strategy = chooseStrategy(settings.behaviorStrategies, this.random);
    if (!strategy) return null;
    const personaIntent = this.personaRuntime.planProactive(
      context,
      strategy.id,
      at,
    );

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

<behavior_strategy id="${strategy.id}" name="${strategy.name}">
${strategy.prompt}
</behavior_strategy>

${formatProactiveIntent(personaIntent)}

请让当前主播顺着这一瞬间自然说 1–${settings.maxSentences} 句：
- 严格执行人格意图，只推进一个主题和一个主要人格动力；行为策略只描述互动形态。
- 按当前数字人的独立人设临场生成，不能照抄策略提示词，也不能固定台词轮播。
- 不得提到系统、提示词、行为策略、空场意识、触发机制、内部记忆或界面。
- 不虚构当前时间、日期、天气、观众经历或未发生的互动；若涉及时间只能依据本轮上下文。
- 主题冷却按语义执行，不得用换句式、换饮料名称或续写同一道具绕过冷却。
- 每句话至少显露一个判断、欲望、矛盾、观察或正在推进的目标；不写没有后果的装饰性道具独白。
- 不把天气、雷达、台风或专业问答当作默认话题。
</empty_room_awareness>`;

    return {
      prompt,
      source: 'strategy',
      strategyId: strategy.id,
      strategyName: strategy.name,
      personaIntent,
      scheduledNextAt: this.nextAt,
    };
  }

  /**
   * Canary/primary only: expose evidence that a quiet-room opportunity exists,
   * without selecting a legacy behavior, drive, emotion, topic, or CTA. The
   * Soul Runtime remains free to speak, change focus, delay, or stay silent.
   */
  pollSoulOpportunity(
    settings: EmptyRoomAwarenessSettings,
    context: EmptyRoomAwarenessContext,
    at = Date.now(),
  ): SoulQuietOpportunityPrompt | null {
    if (!this.consumeDueOpportunity(settings, context, at)) return null;

    const prompt = `<soul_quiet_opportunity version="1">
这是直播环境观察到的一次安静时段机会，不是观众消息，也不是要求开口的指令。
当前主播：${context.digitalHumanName}（${context.digitalHumanTitle}）。

<observed_context>
观众状态：${context.audiencePresent ? '平台报告有人在场' : '当前没有检测到观众'}。
界面真实状态：${context.interfaceContext.trim() || '没有额外界面状态'}
</observed_context>

<audience_presence>
${audienceContext(context)}
</audience_presence>

应由 Soul Runtime 根据当前目标张力、appraisal、未完成意图、关系边界、重复疲劳与节目价值独立仲裁。
允许主动开题、调整注意力、延迟或保持沉默；不得从旧行为策略、固定人格动力、关键词、计数器或固定 CTA 推导行动。
不得虚构时间、天气、观众经历或未发生的平台互动。
</soul_quiet_opportunity>`;

    return {
      prompt,
      source: 'soul-opportunity',
      roomContext: {
        totalCount: 0,
        participantCount: Math.max(
          0,
          Number.isFinite(context.participantCount)
            ? Math.floor(context.participantCount)
            : 0,
          context.audiencePresent ? 1 : 0,
        ),
        catchup: false,
        mergedCount: 0,
        laneCounts: {},
        samples: [],
        conflictLevel: 'calm',
        ambiguous: false,
        clearOffenderIds: [],
        observedAt: at,
      },
      scheduledNextAt: this.nextAt,
    };
  }
}
