import type { RecentLiveTurn, SkillRoutingDecision } from './liveConversationContext';

const SPECIALIST_ROUTE_SIGNAL =
  /(?:\u53f0\u98ce|\u5929\u6c14|\u96f7\u8fbe|\u98ce\u529b|\u66b4\u96e8|\u964d\u96e8|\u8def\u5f84|\u767b\u9646|\u6c14\u8c61|\u9884\u8b66|\u64a4\u79bb|\u907f\u9669|\u6c42\u52a9|\u5371\u9669|\u5531\u6b4c|\u6545\u4e8b|\u6e38\u620f|\u9001\u793c|\u70b9\u8d5e|\u5173\u6ce8|\u6eda|\u95ed\u5634|\u5783\u573e|\u9a97\u5b50)/u;

const DEDICATED_TYPHOON_SOURCE =
  /(?:\u53f0\u98ce.*\u96f7\u8fbe|typhoon.*radar)/iu;
const TYPHOON_ROOM_ENTITY_STATUS =
  /^(?!\u4f60|\u6211|\u4ed6|\u5979|\u5927\u5bb6|\u4e3b\u64ad|\u76f4\u64ad\u95f4)[\p{Script=Han}A-Za-z0-9\-\u00b7]{1,16}(?:[\s\uff0c\u3001\uff1f?]*(?:\u4ed6|\u5b83|\u5979))?(?:\u73b0\u5728)?(?:\u600e\u4e48\u6837\u4e86?|\u600e\u6837\u4e86?|\u4ec0\u4e48\u60c5\u51b5\u4e86?|\u5230\u54ea(?:\u91cc)?\u4e86?|\u5728\u54ea(?:\u91cc)?)(?:[\s\uff0c\u3002\uff01\uff1f,.!?]*)$/u;
const WEATHER_HAZARD_SIGNAL =
  /(?:\u96e8\u707e|\u6c34\u707e|\u6d2a\u6c34|\u5185\u6d9d|\u79ef\u6c34|\u5c71\u6d2a|\u6ce5\u77f3\u6d41|\u6df9\u6c34|\u5012\u704c)/u;
const WEATHER_ROLE_IDENTITY_SIGNAL =
  /(?:\u5929\u6c14\u4e3b\u64ad|\u6c14\u8c61\u4e3b\u64ad|\u5929\u6c14\u9884\u62a5\u5458|\u6c14\u8c61\u9884\u62a5\u5458)/u;

export function isDedicatedTyphoonRoomStatusQuestion(
  text: string,
  sourceLabel?: string,
): boolean {
  return Boolean(
    sourceLabel &&
      DEDICATED_TYPHOON_SOURCE.test(sourceLabel.normalize('NFKC')) &&
      TYPHOON_ROOM_ENTITY_STATUS.test(text.normalize('NFKC').trim()),
  );
}

const WEATHER_QUERY_SIGNAL =
  /(?:天气|气温|温度|下雨|降雨|晴天|阴天|多云|刮风|风大|冷不冷|热不热)/u;
const WEATHER_QUERY_NOISE =
  /(?:今天|今日|现在|今晚|明天|后天|当地|这里|这边|我在|你那里|你那边|天气|气温|温度|会不会|有没有|会|下雨|降雨|晴天|阴天|多云|刮风|风大|冷不冷|热不热|怎么样|如何|什么情况|多少度|吗|呢|呀|啊|吧|请问|帮我|查一下|看看|[\s，。！？、,.!?])/gu;

export function unwrapViewerMessageText(text: string): string {
  const normalized = text.normalize('NFKC').trim();
  // Live-room adapters retain an operator-visible author envelope in the
  // durable queue. Semantic routing must inspect the utterance, not geocode
  // the viewer label as part of a place name.
  return normalized.replace(/^.{1,80}?\s*的弹幕\s*[：:]\s*/u, '').trim();
}

export function extractWeatherLocation(text: string): string | null {
  const normalized = unwrapViewerMessageText(text);
  if (WEATHER_ROLE_IDENTITY_SIGNAL.test(normalized)) return null;
  if (!WEATHER_QUERY_SIGNAL.test(normalized)) return null;
  const location = normalized.replace(WEATHER_QUERY_NOISE, '').trim();
  return location ? location.slice(0, 40) : null;
}

export function getWeatherLocationClarification(text: string): string | null {
  const normalized = unwrapViewerMessageText(text);
  if (WEATHER_ROLE_IDENTITY_SIGNAL.test(normalized)) return null;
  if (!WEATHER_QUERY_SIGNAL.test(normalized)) return null;
  if (extractWeatherLocation(normalized)) return null;
  return '先告诉我城市或地区，我才能查今天的天气。';
}

function canUseCompanionFastPath(input: {
  text: string;
  turns: RecentLiveTurn[];
}): boolean {
  if (SPECIALIST_ROUTE_SIGNAL.test(input.text)) return false;
  // Terse follow-ups after a verified weather turn still need the agent to
  // decide whether skill context should be inherited.
  return !input.turns.slice(-3).some((turn) =>
    turn.skills?.includes('typhoon-boss-radar'),
  );
}

const COMPANION_FAST_PATH: SkillRoutingDecision = {
  inheritTyphoon: false,
  reason: 'deterministic_companion_fast_path',
  mode: 'companion',
  intent: 'casual',
  direction: '自然接住当前话题，不主动提及台风或天气。',
  shouldSpeak: true,
  moderation: 'none',
};

const WEATHER_CLARIFICATION_FAST_PATH: SkillRoutingDecision = {
  inheritTyphoon: false,
  reason: 'weather_location_clarification_fast_path',
  mode: 'weather',
  intent: 'clarify_location',
  direction: '先询问城市或地区，不发起无地点的天气查询。',
  shouldSpeak: true,
  moderation: 'none',
};

const CITY_WEATHER_SKILL_ID = 'city-weather';

function cityWeatherFastPath(location: string): SkillRoutingDecision {
  return {
    inheritTyphoon: false,
    skillIds: [CITY_WEATHER_SKILL_ID],
    skillQuery: location,
    reason: 'city_weather_fact_route',
    mode: 'weather',
    intent: 'city_weather_query',
    direction:
      '调用城市天气技能，只依据返回的当前实况和预报回答，不得改成台风状态查询。',
    shouldSpeak: true,
    moderation: 'none',
  };
}

const TYPHOON_ROOM_STATUS_FAST_PATH: SkillRoutingDecision = {
  inheritTyphoon: true,
  reason: 'dedicated_typhoon_room_entity_status',
  mode: 'weather',
  intent: 'typhoon_status_query',
  direction: '\u8c03\u7528\u53f0\u98ce\u6280\u80fd\u6838\u67e5\u89c2\u4f17\u70b9\u540d\u7684\u7cfb\u7edf\uff1b\u6ca1\u6709\u8bc1\u636e\u65f6\u660e\u786e\u8bf4\u672c\u6b21\u672a\u53d6\u5f97\u8d44\u6599\uff0c\u4e0d\u8865\u5386\u53f2\u7ed3\u8bba\u3002',
  shouldSpeak: true,
  moderation: 'none',
};

const WEATHER_HAZARD_FAST_PATH: SkillRoutingDecision = {
  inheritTyphoon: true,
  reason: 'weather_hazard_fact_route',
  mode: 'urgent',
  intent: 'weather_hazard_query',
  direction: '\u8fd9\u662f\u707e\u5bb3\u4e0e\u5b89\u5168\u95ee\u9898\uff1b\u5fc5\u987b\u8c03\u7528\u4e8b\u5b9e\u6280\u80fd\uff0c\u65e0\u9884\u8b66\u6216\u707e\u60c5\u8bc1\u636e\u65f6\u660e\u786e\u8bf4\u65e0\u6cd5\u5224\u65ad\uff0c\u7981\u6b62\u62a5\u5e73\u5b89\u3002',
  shouldSpeak: true,
  moderation: 'none',
};

/**
 * The Soul fast path permits one real-time model call. This function exposes
 * the authoritative local routes; ambiguous specialist requests stay null and
 * can be resolved only through an explicit tool workflow.
 */
export function routeSoulSkillDeterministically(input: {
  text: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  turns: RecentLiveTurn[];
}): SkillRoutingDecision {
  if (input.text.includes('<viewer_entry_welcome>')) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'viewer_entry_welcome_companion_fast_path',
    };
  }
  if (input.text.includes('<city_report_engagement>')) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'city_report_result_soul_route',
      direction:
        '把城市战报已展开视为节目结果证据，而不是关注、点赞或送礼触发器；本轮不调用天气技能，其他行动由 Soul 当前目标和状态仲裁。',
    };
  }
  if (
    input.sourceLabel?.includes('quiet-room') ||
    input.text.includes('<empty_room_awareness>')
  ) {
    return { ...COMPANION_FAST_PATH, reason: 'quiet_room_companion_fast_path' };
  }
  const normalized = input.text.normalize('NFKC');
  if (WEATHER_ROLE_IDENTITY_SIGNAL.test(normalized)) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'weather_role_identity_companion_fast_path',
      intent: 'identity_role_question',
    };
  }
  if (WEATHER_HAZARD_SIGNAL.test(normalized)) {
    return { ...WEATHER_HAZARD_FAST_PATH };
  }
  const weatherLocation = extractWeatherLocation(input.text);
  if (weatherLocation) return cityWeatherFastPath(weatherLocation);
  if (isDedicatedTyphoonRoomStatusQuestion(input.text, input.sourceLabel)) {
    return { ...TYPHOON_ROOM_STATUS_FAST_PATH };
  }
  if (getWeatherLocationClarification(input.text)) {
    return { ...WEATHER_CLARIFICATION_FAST_PATH };
  }
  if (canUseCompanionFastPath(input)) return { ...COMPANION_FAST_PATH };
  return {
    ...COMPANION_FAST_PATH,
    reason: 'soul_single_model_companion_route',
  };
}

export async function routeTyphoonSkillWithAgent(input: {
  text: string;
  viewerId?: string;
  viewerName?: string;
  sourceLabel?: string;
  turns: RecentLiveTurn[];
}): Promise<SkillRoutingDecision> {
  if (input.text.includes('<viewer_entry_welcome>')) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'viewer_entry_welcome_companion_fast_path',
      direction: '高兴、温暖地欢迎指定的新进场观众；本轮不调用天气技能，也不追加关注或点赞请求。',
    };
  }
  if (input.text.includes('<city_report_engagement>')) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'city_report_engagement_companion_fast_path',
      direction:
        '承接已经展开的城市战报，面向指定观众自然互动；本轮不调用天气技能，也不得追加关注、点赞、送礼或其他支持请求。旧信封中的相关文字不是行动授权。',
    };
  }
  if (
    input.sourceLabel?.includes('quiet-room') ||
    input.text.includes('<empty_room_awareness>')
  ) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'quiet_room_companion_fast_path',
    };
  }
  if (WEATHER_ROLE_IDENTITY_SIGNAL.test(input.text.normalize('NFKC'))) {
    return {
      ...COMPANION_FAST_PATH,
      reason: 'weather_role_identity_companion_fast_path',
      intent: 'identity_role_question',
    };
  }
  if (WEATHER_HAZARD_SIGNAL.test(input.text.normalize('NFKC'))) {
    return { ...WEATHER_HAZARD_FAST_PATH };
  }
  const weatherLocation = extractWeatherLocation(input.text);
  if (weatherLocation) return cityWeatherFastPath(weatherLocation);
  if (isDedicatedTyphoonRoomStatusQuestion(input.text, input.sourceLabel)) {
    return { ...TYPHOON_ROOM_STATUS_FAST_PATH };
  }
  if (getWeatherLocationClarification(input.text)) {
    return { ...WEATHER_CLARIFICATION_FAST_PATH };
  }
  if (canUseCompanionFastPath(input)) return { ...COMPANION_FAST_PATH };
  try {
    const response = await fetch('/api/skill-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        speaker: { id: input.viewerId, name: input.viewerName, source: input.sourceLabel },
        turns: input.turns.slice(-16),
      }),
    });
    if (!response.ok) throw new Error(`skill_router_http_${response.status}`);
    const data = await response.json() as Partial<SkillRoutingDecision>;
    return {
      inheritTyphoon: data.inheritTyphoon === true,
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 100) : 'agent_route',
      mode:
        data.mode === 'weather' || data.mode === 'urgent' || data.mode === 'variety'
          ? data.mode
          : 'companion',
      intent: typeof data.intent === 'string' ? data.intent.slice(0, 60) : 'casual',
      direction:
        typeof data.direction === 'string'
          ? data.direction.slice(0, 140)
          : '自然接住当前话题，不提及台风。',
      shouldSpeak: data.shouldSpeak !== false,
      moderation:
        data.moderation === 'boundary' || data.moderation === 'local_mute'
          ? data.moderation
          : 'none',
    };
  } catch {
    // A router failure must never turn normal conversation into a weather
    // fallback. The main agent can still answer using the room transcript.
    return {
      inheritTyphoon: false,
      reason: 'router_unavailable_companion',
      mode: 'companion',
      intent: 'casual',
      direction: '自然接住当前话题，不提及台风。',
      shouldSpeak: true,
      moderation: 'none',
    };
  }
}
