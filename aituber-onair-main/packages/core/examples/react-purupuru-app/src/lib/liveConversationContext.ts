import type { OperatorQueueStatus } from './operatorQueue';

export type RecentLiveTurn = {
  eventId?: string;
  at: number;
  input: string;
  reply?: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  sourcesSeen?: string[];
  skills?: string[];
  status?: OperatorQueueStatus;
};

export type LiveResponseContract = {
  contract: string;
  inheritedSkills: string[];
  skillQuery: string;
  preferMultipleBeats: boolean;
  hasPrimaryQuestion: boolean;
};

export type SkillRoutingDecision = {
  inheritTyphoon: boolean;
  /** Explicit capability selection; avoids overloading weather with typhoon. */
  skillIds?: string[];
  /** Normalized query passed to the selected capability. */
  skillQuery?: string;
  reason: string;
  mode: 'companion' | 'weather' | 'urgent' | 'variety';
  intent: string;
  direction: string;
  shouldSpeak: boolean;
  moderation: 'none' | 'boundary' | 'local_mute';
};

const PROGRAM_DEFAULT: SkillRoutingDecision = {
  inheritTyphoon: false,
  reason: 'router_unavailable_companion',
  mode: 'companion',
  intent: 'casual',
  direction: '自然接住当前话题，不提及台风。',
  shouldSpeak: true,
  moderation: 'none',
};

const QUESTION_OR_REQUEST =
  /[？?]|哪|什么|怎么|为何|为什么|多少|几个|是否|能否|可以吗|有没有|查|说说|讲讲|告诉/;
const EMOTION_SIDE_CHANNEL = /吓|怕|哭|急|慌|担心|紧张|笑死|哈哈|难受|生气/;

export function mergeRecentLiveTurns(
  current: RecentLiveTurn[],
  incoming: RecentLiveTurn[],
) {
  const byIdentity = new Map<string, RecentLiveTurn>();
  [...current, ...incoming].forEach((turn) => {
    if (!turn.input.trim()) return;
    const identity =
      turn.eventId ||
      `${turn.at}:${turn.input.slice(0, 80)}:${turn.reply?.slice(0, 80) ?? ''}`;
    byIdentity.set(identity, turn);
  });
  return [...byIdentity.values()].sort((left, right) => left.at - right.at);
}

export function buildLiveRoomTranscript(
  turns: RecentLiveTurn[],
  currentViewerId?: string,
  now = Date.now(),
) {
  if (!turns.length) return '';
  const recent = turns.filter((turn) => now - turn.at <= 90_000);
  const currentViewerTurns = currentViewerId
    ? recent.filter((turn) => turn.viewerId === currentViewerId).slice(-2)
    : [];
  const selected = [...new Map(
    [...recent.slice(-8), ...currentViewerTurns].map((turn) => [
      turn.eventId || `${turn.at}:${turn.input}`,
      turn,
    ]),
  ).values()].sort((left, right) => left.at - right.at);
  if (!selected.length) return '';
  const transcript = selected
    .map(
      (turn) =>
      `观众${turn.viewerName ? `（${turn.viewerName}）` : ''}${turn.viewerId ? ` [${turn.viewerId}]` : ''}${turn.sourceLabel ? `，来源：${turn.sourceLabel}` : ''}：${turn.input}${
          turn.reply ? `\n凌岚：${turn.reply}` : '\n（该条未播出回复）'
        }${turn.skills?.length ? `\n已用技能：${turn.skills.join('、')}` : ''}`,
    )
    .join('\n\n');
  return `\n\n<live_room_transcript>\n这是最近90秒、最多8个有效回合的短期上下文；只用于理解追问和多人插话，绝不是节目主题。不得把旧话题带回当前回答，也不得向观众提及内部记录。\n${transcript}\n</live_room_transcript>`;
}

export function buildLiveResponseContract(
  input: string,
  turns: RecentLiveTurn[],
  routing: SkillRoutingDecision = PROGRAM_DEFAULT,
): LiveResponseContract {
  const currentBeijingTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
  const runtimeClockContext = `\n\n<runtime_clock>\n当前北京时间：${currentBeijingTime}。这是判断“现在、今晚、凌晨”等时间词的唯一当前时钟；历史转写和上一轮数据时次只能作为过去记录，禁止拿它们推断当前时间。\n</runtime_clock>`;
  const recentAnswered = [...turns]
    .reverse()
    .filter((turn) => turn.reply && turn.status !== 'skipped');
  const inputBigrams = [...input.matchAll(/[\u3400-\u9fff]{2}/g)].map(
    (match) => match[0],
  );
  // Prefer an earlier host assertion containing the referenced entity. A
  // newer failed answer may repeat the viewer's words without actually
  // becoming the statement being challenged.
  const related =
    recentAnswered.find((turn) =>
      inputBigrams.some((term) => turn.reply?.includes(term)),
    ) ??
    recentAnswered.find((turn) =>
      inputBigrams.some((term) => turn.input.includes(term)),
    );
  const previous = related ?? recentAnswered[0];
  const hasPrimaryQuestion = QUESTION_OR_REQUEST.test(input);
  // An LLM routing turn, not lexical overlap, decides whether a new message
  // truly asks to continue the previous weather investigation.
  const isFollowUp = routing.inheritTyphoon;
  const inheritedSkills = routing.skillIds?.length
    ? [...routing.skillIds]
    : routing.inheritTyphoon
      ? ['typhoon-boss-radar']
      : [];
  const preferMultipleBeats = Boolean(
    hasPrimaryQuestion &&
      (isFollowUp ||
        EMOTION_SIDE_CHANNEL.test(input) ||
        inheritedSkills.length),
  );
  const modeCard: Record<SkillRoutingDecision['mode'], string> = {
    companion: '陪伴直播：闲聊、玩梗、情绪和日常优先。台风不是默认背景，禁止主动提及。',
    variety: '轻量节目：接住唱歌、故事、游戏或共创请求；不能做时给有个性的替代互动，不冷拒绝。',
    weather: '专业栏目：只依据本轮技能事实回答台风/天气/雷达问题。',
    urgent: '紧急信息：先说清安全结论，停止玩笑与关注引导。',
  };
  const contract = `\n\n<live_response_contract>\n当前观众原话：${input}\n当前栏目：${routing.mode}\n栏目规则：${modeCard[routing.mode]}\n互动意图：${routing.intent}\n节目导演：${routing.direction}\n本轮应回应：${routing.shouldSpeak ? '是' : '否；text 必须为 [[NO_REPLY]]'}\n主问题存在：${hasPrimaryQuestion ? '是' : '否'}\n承接上一轮：${isFollowUp ? '是' : '否'}\n技能路由判断：${routing.reason}\n${
    previous?.reply ? `上一轮主播实际说过：${previous.reply}\n` : ''
  }${
    inheritedSkills.length
      ? `必须继承并重新核查的技能：${inheritedSkills.join('、')}\n`
      : ''
  }回复要求：${
    hasPrimaryQuestion
      ? '必须直接、完整回答主问题；情绪、玩笑和安抚只能作为附带节拍，不能替代主答案。'
      : '自然回应当前互动。'
  }${
    isFollowUp
      ? '若“哪来的X”是在质疑上一轮为何提到X，应解释上一轮断言的数据来源，或明确承认并纠正；不要擅自改答X的名字词源。'
      : ''
  }${
    preferMultipleBeats
      ? '本轮适合在确有查证、承接或情绪反应时使用两到三句短节拍；最后一个节拍必须给出完整主答案。'
      : '无需为了表演强行拆句。'
  }\n拟人要求：只有当观众明确询问台风、天气、雷达或相关的上一轮追问时，才调用或提及台风。普通问候、情绪、玩笑、关系和生活话题，就像一个有自己性格的主播一样直接回应，不要拿台风实况做转场。\n回答策略：第一句直接回答观众真正问的内容；资料不能支持时，明确说不知道或资料未提供，不得拿相关但不同的问题代替。\n长度要求：大多数情况下用 1 到 2 句完成，总长不超过 80 个中文字；不要重复题目、不要带出推理过程或内部规则。\n</live_response_contract>`;
  return {
    contract: runtimeClockContext + contract,
    inheritedSkills,
    // Route inheritance is carried separately. Keep the viewer's exact words
    // for the skill endpoint because its structured query parser understands
    // terse live-room follow-ups better than an explanatory wrapper.
    skillQuery: routing.skillQuery?.trim() || input,
    preferMultipleBeats,
    hasPrimaryQuestion,
  };
}
