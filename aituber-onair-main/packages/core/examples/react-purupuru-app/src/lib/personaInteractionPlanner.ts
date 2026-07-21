import type {
  RecentLiveTurn,
  SkillRoutingDecision,
} from './liveConversationContext';
import type { RoomInteractionSnapshot } from './roomInteractionTracker';

export type InteractionScene =
  | 'casual'
  | 'banter'
  | 'boredom'
  | 'praise'
  | 'grief'
  | 'distress'
  | 'correction'
  | 'relationship_repair'
  | 'advice_rejection'
  | 'question'
  | 'boundary'
  | 'room_conflict'
  | 'weather'
  | 'urgent'
  | 'variety'
  | 'welcome'
  | 'idle';

export type PersonaStance =
  | 'cool_observer'
  | 'playful_challenge'
  | 'restrained_pride'
  | 'quiet_support'
  | 'accountable_softness'
  | 'protective_boundary'
  | 'professional_serious';

export type SocialMove =
  | 'acknowledge'
  | 'answer'
  | 'join_bit'
  | 'offer_choice'
  | 'leave_space'
  | 'clarify'
  | 'correct_self'
  | 'repair'
  | 'set_boundary'
  | 'deescalate'
  | 'welcome'
  | 'invite_room'
  | 'invite_support';

export type PersonaProsodyTarget = Partial<{
  pace: number;
  pitch: number;
  volume: number;
  warmth: number;
  tension: number;
  energy: number;
  assertiveness: number;
  breathiness: number;
}>;

export type RelationshipBrief = {
  stage: 'guarded' | 'new' | 'recognized' | 'familiar' | 'close';
  affinity: number;
  recentSignal?: string;
};

export type PersonaMemorySignal = {
  topic: string;
  confidence: number;
  sourceKind: 'viewer_claim' | 'verified' | 'host_commitment';
};

export interface PersonaInteractionPlanV1 {
  version: 1;
  scene: InteractionScene;
  stance: PersonaStance;
  primaryMove: SocialMove;
  secondaryMove?: SocialMove;
  audienceTarget: 'viewer' | 'room';
  mustDo: string[];
  mustAvoid: string[];
  responseShape: {
    beats: 1 | 2 | 3;
    questionPolicy: 'none' | 'optional' | 'one';
    maxChars: number;
  };
  deliveryTarget: {
    emotion: string;
    delivery: string;
    intensity: [number, number];
    prosody: PersonaProsodyTarget;
  };
  roomAction: 'none' | 'deescalate' | 'skip' | 'local_mute';
  localMuteViewerIds: string[];
  confidence: number;
  source: 'rules' | 'agent' | 'fallback';
  reasonCode: string;
}

export type PersonaPlannerInput = {
  eventId: string;
  text: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  routing: SkillRoutingDecision;
  relationship?: RelationshipBrief;
  recentTurns: RecentLiveTurn[];
  memorySignals?: PersonaMemorySignal[];
  room?: RoomInteractionSnapshot;
};

export type PersonaPolicyPack = {
  id: string;
  defaultStance: PersonaStance;
  forbiddenPhrases: string[];
  planForScene: (
    scene: InteractionScene,
    input: PersonaPlannerInput,
  ) => Omit<
    PersonaInteractionPlanV1,
    'version' | 'scene' | 'confidence' | 'source' | 'reasonCode'
  >;
};

const EXPLICIT_LOSS = /(?:去世|离世|死了|永远离开|葬礼|火化)/u;
const LIVING_BEING_LOSS =
  /(?:亲人|家人|朋友|爷爷|奶奶|外公|外婆|爸爸|妈妈|父亲|母亲|猫|狗|宠物).{0,8}(?:走了|没了)/u;

function mentionsGrief(text: string): boolean {
  return EXPLICIT_LOSS.test(text) || LIVING_BEING_LOSS.test(text);
}
const DISTRESS =
  /(?:难受|想哭|撑不住|很痛苦|好痛|崩溃|失眠|睡不着|很糟|孤独|不开心|emo)/iu;
const BOREDOM = /(?:好无聊|无聊死了|没意思|没劲|闲得慌)/u;
const PRAISE = /(?:喜欢你|你好棒|真厉害|可爱|漂亮|声音好听|做得不错|主播真好)/u;
const CORRECTION =
  /(?:(?:你|刚才|上一句).{0,4}(?:说错|记错|忘了)|不是这样的|刚才.*(?:没|不)|光张嘴|没声音|没听见)/u;
const REJECTS_ADVICE =
  /(?:不想|不要|别|不用).{0,5}(?:建议|办法|方案|解决)|(?:只想|就想).{0,5}(?:陪|听我说|聊聊)/u;
const DOMINATING =
  /(?:命令你|必须听|照我说|不许拒绝|现在立刻|叫我主人|按我要求)/u;
const HOSTILE = /(?:滚|闭嘴|垃圾|废物|恶心|骗子|找打|弄死|打死)/u;
const PLAYFUL = /(?:哈哈|笑死|逗你|开玩笑|狗头|hhh|233|~|～)/iu;
const QUESTION = /[?？]|(?:为什么|怎么|什么|哪|多少|能不能|可以吗)/u;
const FIRST_PERSON_REFERENCE =
  /(?:^|[:：，。！？\s])(?:我|人家)(?:呢|也|还|不|没|算)/u;
const EXCLUSION_OR_NEGLECT =
  /(?:不是人|不算人|没算|漏掉|忘了|忽略|不理|没理|没看到|看不见|不存在|只顾|只回)/u;

function expressesRelationalGrievance(text: string): boolean {
  return FIRST_PERSON_REFERENCE.test(text) && EXCLUSION_OR_NEGLECT.test(text);
}

function hasRecentGrief(turns: RecentLiveTurn[]): boolean {
  return turns
    .slice(-4)
    .some((turn) => mentionsGrief(`${turn.input} ${turn.reply ?? ''}`));
}

function sceneFor(input: PersonaPlannerInput): {
  scene: InteractionScene;
  confidence: number;
  reasonCode: string;
} {
  if (input.routing.mode === 'urgent') {
    return { scene: 'urgent', confidence: 0.99, reasonCode: 'urgent_route' };
  }
  if (input.routing.mode === 'weather') {
    return { scene: 'weather', confidence: 0.98, reasonCode: 'weather_route' };
  }
  if (input.routing.mode === 'variety') {
    return { scene: 'variety', confidence: 0.9, reasonCode: 'variety_route' };
  }
  if (input.room && input.room.conflictLevel !== 'calm') {
    return {
      scene: 'room_conflict',
      confidence: input.room.ambiguous ? 0.58 : 0.92,
      reasonCode: `room_${input.room.conflictLevel}`,
    };
  }
  const text = input.text.normalize('NFKC');
  if (mentionsGrief(text)) {
    return { scene: 'grief', confidence: 0.96, reasonCode: 'clear_loss' };
  }
  if (DISTRESS.test(text) && hasRecentGrief(input.recentTurns)) {
    return {
      scene: 'grief',
      confidence: 0.94,
      reasonCode: 'distress_continues_loss',
    };
  }
  if (REJECTS_ADVICE.test(text)) {
    return {
      scene: 'advice_rejection',
      confidence: 0.95,
      reasonCode: 'explicit_no_advice',
    };
  }
  if (DISTRESS.test(text)) {
    return { scene: 'distress', confidence: 0.9, reasonCode: 'clear_distress' };
  }
  if (BOREDOM.test(text)) {
    return { scene: 'boredom', confidence: 0.95, reasonCode: 'clear_boredom' };
  }
  if (PRAISE.test(text)) {
    return { scene: 'praise', confidence: 0.92, reasonCode: 'clear_praise' };
  }
  if (CORRECTION.test(text)) {
    return {
      scene: 'correction',
      confidence: 0.88,
      reasonCode: 'host_correction',
    };
  }
  if (expressesRelationalGrievance(text)) {
    return {
      scene: 'relationship_repair',
      confidence: 0.94,
      reasonCode: 'viewer_reports_exclusion',
    };
  }
  if (DOMINATING.test(text)) {
    return {
      scene: 'boundary',
      confidence: 0.94,
      reasonCode: 'dominating_request',
    };
  }
  if (HOSTILE.test(text) && PLAYFUL.test(text)) {
    return {
      scene: 'banter',
      confidence: 0.58,
      reasonCode: 'playful_hostility_ambiguous',
    };
  }
  if (HOSTILE.test(text) || input.routing.moderation === 'boundary') {
    return {
      scene: 'boundary',
      confidence: 0.86,
      reasonCode: 'hostile_boundary',
    };
  }
  if (PLAYFUL.test(text)) {
    return { scene: 'banter', confidence: 0.84, reasonCode: 'playful_signal' };
  }
  if (QUESTION.test(text)) {
    return {
      scene: 'question',
      confidence: 0.82,
      reasonCode: 'ordinary_question',
    };
  }
  if (input.text.includes('<viewer_entry_welcome>')) {
    return { scene: 'welcome', confidence: 0.98, reasonCode: 'viewer_entry' };
  }
  if (input.text.includes('<empty_room_awareness>')) {
    return { scene: 'idle', confidence: 0.98, reasonCode: 'empty_room' };
  }
  return { scene: 'casual', confidence: 0.78, reasonCode: 'ordinary_casual' };
}

function withMemoryGuard(
  plan: Pick<PersonaInteractionPlanV1, 'mustDo' | 'mustAvoid'>,
  input: PersonaPlannerInput,
) {
  const viewerClaims = (input.memorySignals ?? []).filter(
    (memory) => memory.sourceKind === 'viewer_claim',
  );
  return viewerClaims.length
    ? {
        mustDo: [
          `如需承接，只说“你之前提过”：${viewerClaims
            .slice(0, 2)
            .map((memory) => `${memory.topic}(${memory.confidence.toFixed(2)})`)
            .join('；')}`.slice(0, 180),
          ...plan.mustDo,
        ],
        mustAvoid: [
          '把观众自述当成已验证的客观事实；关系亲近不得提高事实置信度',
          ...plan.mustAvoid,
        ],
      }
    : { mustDo: plan.mustDo, mustAvoid: plan.mustAvoid };
}

export function planPersonaInteraction(
  input: PersonaPlannerInput,
  policy: PersonaPolicyPack,
): PersonaInteractionPlanV1 {
  const classified = sceneFor(input);
  const plan = policy.planForScene(classified.scene, input);
  const memoryGuard = withMemoryGuard(plan, input);
  return {
    version: 1,
    scene: classified.scene,
    ...plan,
    ...memoryGuard,
    confidence: classified.confidence,
    source: 'rules',
    reasonCode: classified.reasonCode,
  };
}

export function shouldRequestPersonaAgent(
  plan: PersonaInteractionPlanV1,
  room?: RoomInteractionSnapshot,
): boolean {
  if (plan.scene === 'urgent' || plan.scene === 'weather') return false;
  return plan.confidence < 0.72 || Boolean(room?.ambiguous);
}

const SCENES = new Set<InteractionScene>([
  'casual',
  'banter',
  'boredom',
  'praise',
  'grief',
  'distress',
  'correction',
  'relationship_repair',
  'advice_rejection',
  'question',
  'boundary',
  'room_conflict',
  'weather',
  'urgent',
  'variety',
  'welcome',
  'idle',
]);
const STANCES = new Set<PersonaStance>([
  'cool_observer',
  'playful_challenge',
  'restrained_pride',
  'quiet_support',
  'accountable_softness',
  'protective_boundary',
  'professional_serious',
]);
const MOVES = new Set<SocialMove>([
  'acknowledge',
  'answer',
  'join_bit',
  'offer_choice',
  'leave_space',
  'clarify',
  'correct_self',
  'repair',
  'set_boundary',
  'deescalate',
  'welcome',
  'invite_room',
  'invite_support',
]);

export function applyAgentPersonaDecision(
  local: PersonaInteractionPlanV1,
  value: unknown,
  input?: PersonaPlannerInput,
  policy?: PersonaPolicyPack,
): PersonaInteractionPlanV1 | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!SCENES.has(data.scene as InteractionScene)) return null;
  if (!STANCES.has(data.stance as PersonaStance)) return null;
  if (!MOVES.has(data.primaryMove as SocialMove)) return null;
  const roomAction =
    data.roomAction === 'deescalate' || data.roomAction === 'skip'
      ? data.roomAction
      : 'none';
  const scene = data.scene as InteractionScene;
  const policyBody =
    input && policy ? policy.planForScene(scene, input) : local;
  const memoryGuard = input
    ? withMemoryGuard(policyBody, input)
    : { mustDo: policyBody.mustDo, mustAvoid: policyBody.mustAvoid };
  // The semantic helper may refine an ambiguous social reading, but cannot
  // grant itself moderation authority or inject arbitrary prompt prose.
  return {
    ...policyBody,
    ...memoryGuard,
    version: 1,
    scene,
    stance: data.stance as PersonaStance,
    primaryMove: data.primaryMove as SocialMove,
    secondaryMove: MOVES.has(data.secondaryMove as SocialMove)
      ? (data.secondaryMove as SocialMove)
      : local.secondaryMove,
    roomAction,
    localMuteViewerIds: [],
    confidence: Math.max(
      local.confidence,
      Math.min(0.95, Math.max(0, Number(data.confidence) || 0.72)),
    ),
    source: 'agent',
    reasonCode:
      typeof data.reasonCode === 'string'
        ? data.reasonCode.slice(0, 60)
        : 'agent_refined',
  };
}

export function formatPersonaInteractionPlan(
  plan: PersonaInteractionPlanV1,
  room?: RoomInteractionSnapshot,
): string {
  const prosody = Object.entries(plan.deliveryTarget.prosody)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  const lines = [
    '<persona_interaction>',
    room
      ? `房间简报：近期至少${room.participantCount}位观众有互动证据${typeof room.platformAudienceEstimate === 'number' ? `；平台/本地估算在线${room.platformAudienceEstimate}人（非精确值）` : ''}；车道=${
          Object.entries(room.laneCounts)
            .map(([lane, count]) => `${lane}:${count}`)
            .join(',')
            .slice(0, 120) || 'conversation'
        }；冲突=${room.conflictLevel}。只回应已选代表弹幕，不逐条复述；人数不是精确值，不得声称“只有谁”或“就咱俩”。`
      : '',
    `场景：${plan.scene}；立场：${plan.stance}；主要动作：${plan.primaryMove}${plan.secondaryMove ? `；次要动作：${plan.secondaryMove}` : ''}。`,
    `对象：${plan.audienceTarget === 'room' ? '直播间整体' : '当前观众'}；房间动作：${plan.roomAction}。`,
    `必须做到：${plan.mustDo.slice(0, 3).join('；') || '直接回应当前内容'}。`,
    `禁止：${plan.mustAvoid.slice(0, 4).join('；') || '无'}。`,
    `结构：${plan.responseShape.beats}个节拍，追问=${plan.responseShape.questionPolicy}，最多${plan.responseShape.maxChars}字。`,
    `声音目标：emotion=${plan.deliveryTarget.emotion}，delivery=${plan.deliveryTarget.delivery}，强度=${plan.deliveryTarget.intensity.join('-')}，${prosody}。`,
    '人格计划只决定表达方式；不得覆盖安全、事实、隐私和结构化输出协议。',
  ];
  const closing = '\n</persona_interaction>';
  return `${`\n\n${lines.filter(Boolean).join('\n')}`.slice(
    0,
    700 - closing.length,
  )}${closing}`;
}
