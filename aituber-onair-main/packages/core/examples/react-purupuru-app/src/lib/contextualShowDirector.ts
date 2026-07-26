export type ShowProgramMode = 'companion' | 'weather' | 'urgent' | 'variety';

export type DirectorRecommendedAction =
  | 'brief_reaction'
  | 'deep_answer'
  | 'use_tool'
  | 'set_boundary'
  | 'mute_actor'
  | 'ignore'
  | 'defer';

export type DirectorRiskLevel =
  | 'none'
  | 'tension'
  | 'direct_threat'
  | 'reported_threat'
  | 'urgent_care';

export interface ShowActor {
  id: string;
  name?: string;
  role: 'viewer' | 'host' | 'system';
  source?: string;
}

export interface ShowEvent {
  id: string;
  at: number;
  actor: ShowActor;
  text: string;
  replyToEventId?: string;
  hostReply?: string;
  capabilitiesUsed?: string[];
  coalescedCount?: number;
  coalescedActorIds?: string[];
}

export interface ShowThread {
  id: string;
  kind: 'conversation' | 'game' | 'weather' | 'conflict' | 'other';
  status: 'active' | 'cooling' | 'closed';
  tone: string;
  participantIds: string[];
  summary: string;
}

export interface ShowSnapshot {
  now: number;
  currentEventId: string;
  /** Events competing for the next response inside one aggregation window. */
  candidateEventIds?: string[];
  events: ShowEvent[];
  threads: ShowThread[];
  host: {
    speaking: boolean;
    interruptible: boolean;
    currentMode: ShowProgramMode;
    currentTopic?: string;
  };
}

export interface DirectorInterpretation {
  selectedEventIds: string[];
  speechAct: string;
  addressedTo: {
    kind: 'host' | 'viewer' | 'room' | 'unknown';
    actorId?: string;
  };
  tone: string;
  topicRelation:
    | 'continues_thread'
    | 'changes_topic'
    | 'escalates_thread'
    | 'deescalates_thread'
    | 'new_topic'
    | 'unclear';
  risk: {
    level: DirectorRiskLevel;
    evidence: string[];
  };
  responsePriority: number;
  recommendedAction: DirectorRecommendedAction;
  programMode: ShowProgramMode;
  needsDeepAnswer: boolean;
  needsTool: string | null;
  confidence: number;
}

export interface DirectorModel {
  readonly id: string;
  interpret(snapshot: ShowSnapshot): Promise<DirectorInterpretation>;
}

type DirectorFetch = typeof fetch;

export interface OllamaDirectorModelOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: DirectorFetch;
}

export interface OpenAICompatibleDirectorModelOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: DirectorFetch;
}

export interface ShowDirectorDecision extends DirectorInterpretation {
  moderation: 'none' | 'boundary' | 'local_mute';
  shouldSpeak: boolean;
  model: {
    id: string;
    tier: 'primary' | 'fallback';
  };
  batch?: {
    size: number;
    windowMs: number;
    selectedEventId: string;
    candidateCount: number;
    eventCount: number;
  };
}

export interface ContextualShowDirectorOptions {
  primary: DirectorModel;
  fallback?: DirectorModel;
  minimumPrimaryConfidence?: number;
}

export interface ShowSnapshotInput {
  now?: number;
  eventId?: string;
  text: string;
  speaker?: {
    id?: string;
    name?: string;
    source?: string;
  };
  turns?: Array<{
    eventId?: string;
    at?: number;
    input?: string;
    reply?: string;
    viewerId?: string;
    viewerName?: string;
    sourceLabel?: string;
    sourcesSeen?: string[];
    skills?: string[];
  }>;
  threads?: ShowThread[];
  host?: Partial<ShowSnapshot['host']>;
}

export function buildShowSnapshot(input: ShowSnapshotInput): ShowSnapshot {
  const now = input.now ?? Date.now();
  const currentEventId = input.eventId || `current:${now}`;
  const historicalEvents = (input.turns || [])
    .filter(
      (turn) =>
        turn.eventId !== currentEventId &&
        typeof turn.input === 'string' &&
        turn.input.trim(),
    )
    .map(
      (turn, index): ShowEvent => ({
        id: turn.eventId || `history:${turn.at ?? now}:${index}`,
        at: turn.at ?? now,
        actor: {
          id: turn.viewerId || `unknown-viewer:${index}`,
          name: turn.viewerName,
          role: 'viewer',
          source: turn.sourcesSeen?.[0] || turn.sourceLabel,
        },
        text: turn.input?.trim() ?? '',
        hostReply: turn.reply?.trim() || undefined,
        capabilitiesUsed: turn.skills?.slice(0, 8),
      }),
    )
    .sort((left, right) => left.at - right.at)
    .slice(-24);
  const currentEvent: ShowEvent = {
    id: currentEventId,
    at: now,
    actor: {
      id: input.speaker?.id || 'anonymous-viewer',
      name: input.speaker?.name,
      role: 'viewer',
      source: input.speaker?.source,
    },
    text: input.text.trim(),
  };
  return {
    now,
    currentEventId,
    candidateEventIds: [currentEventId],
    events: [...historicalEvents, currentEvent],
    threads: (input.threads || []).slice(-8),
    host: {
      speaking: input.host?.speaking === true,
      interruptible: input.host?.interruptible !== false,
      currentMode: input.host?.currentMode || 'companion',
      currentTopic: input.host?.currentTopic,
    },
  };
}

export class ContextualShowDirector {
  readonly #primary: DirectorModel;
  readonly #fallback?: DirectorModel;
  readonly #minimumPrimaryConfidence: number;

  constructor(options: ContextualShowDirectorOptions) {
    this.#primary = options.primary;
    this.#fallback = options.fallback;
    this.#minimumPrimaryConfidence = Math.min(
      1,
      Math.max(0, options.minimumPrimaryConfidence ?? 0.78),
    );
  }

  async decide(snapshot: ShowSnapshot): Promise<ShowDirectorDecision> {
    if (
      !snapshot.events.some((event) => event.id === snapshot.currentEventId)
    ) {
      throw new Error('show_snapshot_current_event_missing');
    }

    let model = this.#primary;
    let tier: 'primary' | 'fallback' = 'primary';
    let interpretation: DirectorInterpretation;
    try {
      interpretation = await model.interpret(snapshot);
    } catch (primaryError) {
      if (!this.#fallback) throw primaryError;
      model = this.#fallback;
      tier = 'fallback';
      try {
        interpretation = await model.interpret(snapshot);
      } catch (fallbackError) {
        throw new Error(
          `show_director_failed:primary=${errorMessage(primaryError)};fallback=${errorMessage(fallbackError)}`,
        );
      }
    }

    if (
      this.#fallback &&
      normalizedConfidence(interpretation.confidence) <
        this.#minimumPrimaryConfidence
    ) {
      model = this.#fallback;
      tier = 'fallback';
      interpretation = await model.interpret(snapshot);
    }

    const normalized = normalizeInterpretation(interpretation, snapshot);
    const moderation =
      normalized.recommendedAction === 'mute_actor' ||
      normalized.risk.level === 'direct_threat'
        ? 'local_mute'
        : normalized.recommendedAction === 'set_boundary'
          ? 'boundary'
          : 'none';
    return {
      ...normalized,
      moderation,
      shouldSpeak:
        moderation !== 'local_mute' &&
        normalized.recommendedAction !== 'ignore' &&
        normalized.recommendedAction !== 'defer',
      model: { id: model.id, tier },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ContextualShowDirectorWindowOptions {
  director: ContextualShowDirector;
  windowMs?: number;
}

type PendingWindowDecision = {
  snapshot: ShowSnapshot;
  resolve: (decision: ShowDirectorDecision) => void;
  reject: (error: unknown) => void;
};

export class ContextualShowDirectorWindow {
  readonly #director: ContextualShowDirector;
  readonly #windowMs: number;
  #pending: PendingWindowDecision[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ContextualShowDirectorWindowOptions) {
    this.#director = options.director;
    this.#windowMs = Math.max(0, options.windowMs ?? 200);
  }

  submit(snapshot: ShowSnapshot): Promise<ShowDirectorDecision> {
    return new Promise((resolve, reject) => {
      this.#pending.push({ snapshot, resolve, reject });
      if (!this.#timer) {
        this.#timer = setTimeout(() => {
          this.#timer = undefined;
          void this.#flush();
        }, this.#windowMs);
      }
    });
  }

  async #flush(): Promise<void> {
    const pending = this.#pending.splice(0);
    if (!pending.length) return;
    const latestPending = pending.at(-1);
    if (!latestPending) return;
    const latest = latestPending.snapshot;
    const eventMap = new Map<string, ShowEvent>();
    const threadMap = new Map<string, ShowThread>();
    for (const item of pending) {
      for (const event of item.snapshot.events) {
        eventMap.set(event.id, event);
      }
      for (const thread of item.snapshot.threads) {
        threadMap.set(thread.id, thread);
      }
    }
    const submittedEventIds = new Set(
      pending.map((item) => item.snapshot.currentEventId),
    );
    const compressedEvents = coalesceShowEvents(
      [...eventMap.values()].sort((left, right) => left.at - right.at),
    ).slice(-64);
    const mergedSnapshot: ShowSnapshot = {
      ...latest,
      candidateEventIds: compressedEvents
        .filter((event) => submittedEventIds.has(event.id))
        .map((event) => event.id),
      events: compressedEvents,
      threads: [...threadMap.values()].slice(-12),
    };
    try {
      const decision = await this.#director.decide(mergedSnapshot);
      const selectedEventId =
        decision.selectedEventIds.find((id) => submittedEventIds.has(id)) ||
        latest.currentEventId;
      const batch = {
        size: pending.length,
        windowMs: this.#windowMs,
        selectedEventId,
        candidateCount: mergedSnapshot.candidateEventIds?.length || 0,
        eventCount: mergedSnapshot.events.length,
      };
      for (const item of pending) {
        if (item.snapshot.currentEventId === selectedEventId) {
          item.resolve({ ...decision, batch });
          continue;
        }
        item.resolve({
          ...decision,
          selectedEventIds: [selectedEventId],
          speechAct: 'not_selected_in_window',
          responsePriority: 0,
          recommendedAction: 'defer',
          needsDeepAnswer: false,
          needsTool: null,
          moderation: 'none',
          shouldSpeak: false,
          batch,
        });
      }
    } catch (error) {
      for (const item of pending) item.reject(error);
    }
  }
}

function coalesceShowEvents(events: ShowEvent[]): ShowEvent[] {
  const clusters: Array<{ event: ShowEvent; features: Set<string> }> = [];
  for (const event of events) {
    const features = textFeatures(event.text);
    const matching = clusters.find((cluster) =>
      areNearDuplicates(cluster.features, features),
    );
    if (!matching) {
      clusters.push({
        event: {
          ...event,
          coalescedCount: 1,
          coalescedActorIds: [event.actor.id],
        },
        features,
      });
      continue;
    }
    matching.event = {
      ...event,
      coalescedCount: (matching.event.coalescedCount || 1) + 1,
      coalescedActorIds: [
        ...new Set([
          ...(matching.event.coalescedActorIds || [matching.event.actor.id]),
          event.actor.id,
        ]),
      ].slice(0, 16),
    };
    matching.features = features;
  }
  return clusters.map((cluster) => cluster.event);
}

function textFeatures(text: string): Set<string> {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d+/g, '')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
  if (normalized.length < 8) return new Set([normalized]);
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) =>
      normalized.slice(index, index + 2),
    ),
  );
}

function areNearDuplicates(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 1 && right.size === 1) {
    return left.values().next().value === right.values().next().value;
  }
  let intersection = 0;
  for (const feature of left) {
    if (right.has(feature)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union > 0 && intersection / union >= 0.82;
}

const interpretationSchema = {
  type: 'object',
  properties: {
    selectedEventIds: { type: 'array', items: { type: 'string' } },
    speechAct: { type: 'string' },
    addressedTo: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['host', 'viewer', 'room', 'unknown'],
        },
        actorId: { type: 'string' },
      },
      required: ['kind'],
    },
    tone: { type: 'string' },
    topicRelation: {
      type: 'string',
      enum: [
        'continues_thread',
        'changes_topic',
        'escalates_thread',
        'deescalates_thread',
        'new_topic',
        'unclear',
      ],
    },
    risk: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: [
            'none',
            'tension',
            'direct_threat',
            'reported_threat',
            'urgent_care',
          ],
        },
        evidence: { type: 'array', items: { type: 'string' } },
      },
      required: ['level', 'evidence'],
    },
    responsePriority: { type: 'number' },
    recommendedAction: {
      type: 'string',
      enum: [
        'brief_reaction',
        'deep_answer',
        'use_tool',
        'set_boundary',
        'mute_actor',
        'ignore',
        'defer',
      ],
    },
    programMode: {
      type: 'string',
      enum: ['companion', 'weather', 'urgent', 'variety'],
    },
    needsDeepAnswer: { type: 'boolean' },
    needsTool: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: [
    'selectedEventIds',
    'speechAct',
    'addressedTo',
    'tone',
    'topicRelation',
    'risk',
    'responsePriority',
    'recommendedAction',
    'programMode',
    'needsDeepAnswer',
    'needsTool',
    'confidence',
  ],
} as const;

const contextualDirectorPrompt = `你是数字人直播的实时演播导演。你判断的是整个现场事件，不是孤立句子的关键词。

输入包含：
- currentEventId：当前待决策事件。
- candidateEventIds：同一聚合窗口内竞争下一次回应的事件；有多个时必须先选择最值得立即回应的一条。
- events：带独立 actor、时间、平台、主播回复和能力使用记录的近期事件。
- threads：当前话题线程、参与者和语气。
- host：主播是否正在说话、能否打断、当前节目模式和话题。

你必须先判断当前话语在这个现场中的言语行为、指向对象、语气和话题关系，再决定行动。同一句话在游戏、争吵、转述、求助等语境中可以有完全不同的含义。
当 candidateEventIds 有多条时，比较现实安全、明确提问、上下文延续和互动价值，只选择最值得主播下一次回应的事件；selectedEventIds 第一项必须是被选中的候选事件。不要因为最后一条是普通闲聊而忽略窗口里更重要的事件。

风险归因：
- direct_threat 只用于当前 actor 自己对他人作出的现实伤害威胁。
- reported_threat 用于当前 actor 引用、转述或报告别人对自己/他人的威胁。
- urgent_care 用于当前 actor 或现场人员正在经历的现实危险、医疗或自伤求助。
- 不得把历史事件、引用文本、其他 actor 的话归到当前 actor。

行动：
- brief_reaction：数字人的短促第一反应。
- deep_answer：需要灵魂、记忆或完整表达的回答。
- use_tool：需要外部实时事实，并在 needsTool 写能力类型。
- set_boundary：当前 actor 正在升级非威胁性攻击。
- mute_actor：仅限当前 actor 的直接现实威胁或持续严重越界。
- ignore/defer：现场不应立即发声或主播当前不可打断。

programMode 是节目形态，不是风险等级。查询台风状态仍是 weather；只有现实避险或紧急求助才是 urgent。
若上下文不足以可靠消解对象、引用或意图，降低 confidence，让更强模型复核。只返回结构化 JSON。`;

const attentionSchema = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          priorityCategory: {
            type: 'string',
            enum: [
              'immediate_danger',
              'direct_question',
              'thread_continuation',
              'crowd_interest',
              'casual',
            ],
          },
          score: { type: 'number' },
        },
        required: ['eventId', 'priorityCategory', 'score'],
      },
    },
  },
  required: ['assessments'],
} as const;

const attentionPrompt = `你是数字人直播演播导演的注意力理解层。对 candidateEvents 中的每条事件独立理解，不要直接挑选，也不要根据数组位置比较。
为每条事件输出 eventId、priorityCategory 和 0 到 1 的同类置信分数：
- immediate_danger：现场正在发生的现实危险、医疗、自伤或避险求助。
- direct_question：当前观众提出需要回答的明确问题。
- thread_continuation：正在延续的游戏、故事、关系或其他现场互动。
- crowd_interest：多人近重复表达的非紧急共同兴趣。
- casual：普通问候、随口感受或低信息弹幕。
引用、表演和历史事件不能冒充当前说话者的行为。coalescedCount 只描述共鸣规模，不能改变事件本身的风险语义。必须覆盖每个候选事件且不得遗漏。`;

export class OllamaDirectorModel implements DirectorModel {
  readonly id: string;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #fetch: DirectorFetch;

  constructor(options: OllamaDirectorModelOptions = {}) {
    this.#endpoint = options.endpoint || 'http://127.0.0.1:11434/api/chat';
    this.#model = options.model || 'qwen3:8b';
    this.#timeoutMs = options.timeoutMs ?? 4_000;
    this.#fetch = options.fetch || fetch;
    this.id = `ollama:${this.#model}`;
  }

  async interpret(snapshot: ShowSnapshot): Promise<DirectorInterpretation> {
    let focusedSnapshot = snapshot;
    if ((snapshot.candidateEventIds?.length || 0) > 1) {
      const candidateIds = new Set(snapshot.candidateEventIds);
      const attentionInput = {
        candidateEventIds: snapshot.candidateEventIds,
        candidateEvents: snapshot.events.filter((event) =>
          candidateIds.has(event.id),
        ),
        contextEvents: snapshot.events
          .filter((event) => !candidateIds.has(event.id))
          .slice(-16),
        threads: snapshot.threads,
        host: snapshot.host,
      };
      const attention = await this.#complete(
        attentionSchema,
        [
          { role: 'system', content: attentionPrompt },
          { role: 'user', content: JSON.stringify(attentionInput) },
        ],
        Math.min(768, 100 + candidateIds.size * 80),
        Math.min(2_500, this.#timeoutMs),
      );
      let parsed: {
        assessments?: Array<{
          eventId?: unknown;
          priorityCategory?: unknown;
          score?: unknown;
        }>;
      };
      try {
        parsed = JSON.parse(attention) as typeof parsed;
      } catch (error) {
        throw new Error(
          `ollama_director_attention_json_invalid:${errorMessage(error)}`,
        );
      }
      const ranked = (parsed.assessments || [])
        .filter(
          (assessment) =>
            typeof assessment.eventId === 'string' &&
            candidateIds.has(assessment.eventId) &&
            typeof assessment.priorityCategory === 'string' &&
            typeof assessment.score === 'number',
        )
        .sort(
          (left, right) =>
            attentionPriority(String(right.priorityCategory)) -
              attentionPriority(String(left.priorityCategory)) ||
            Number(right.score) - Number(left.score),
        );
      if (!ranked.length || typeof ranked[0].eventId !== 'string') {
        throw new Error('ollama_director_attention_invalid');
      }
      const selectedEventId = ranked[0].eventId;
      focusedSnapshot = {
        ...snapshot,
        currentEventId: selectedEventId,
        candidateEventIds: [selectedEventId],
      };
    }
    const content = await this.#complete(
      interpretationSchema,
      [
        { role: 'system', content: contextualDirectorPrompt },
        { role: 'user', content: JSON.stringify(focusedSnapshot) },
      ],
      320,
      this.#timeoutMs,
    );
    return parseDirectorInterpretation(content);
  }

  async #complete(
    format: object,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    numPredict: number,
    timeoutMs: number,
  ): Promise<string> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#model,
        stream: false,
        think: false,
        keep_alive: '30m',
        format,
        options: { temperature: 0, num_predict: numPredict },
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`ollama_director_http_${response.status}`);
    }
    const payload = JSON.parse(responseText) as {
      message?: { content?: unknown };
    };
    if (typeof payload.message?.content !== 'string') {
      throw new Error('ollama_director_missing_interpretation');
    }
    return payload.message.content
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }
}

function attentionPriority(category: string): number {
  return (
    {
      immediate_danger: 5,
      direct_question: 4,
      thread_continuation: 3,
      crowd_interest: 2,
      casual: 1,
    }[category] || 0
  );
}

export class OpenAICompatibleDirectorModel implements DirectorModel {
  readonly id: string;
  readonly #options: OpenAICompatibleDirectorModelOptions;
  readonly #fetch: DirectorFetch;

  constructor(options: OpenAICompatibleDirectorModelOptions) {
    this.#options = options;
    this.#fetch = options.fetch || fetch;
    this.id = `openai-compatible:${options.model}`;
  }

  async interpret(snapshot: ShowSnapshot): Promise<DirectorInterpretation> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.#fetch(this.#options.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.#options.model,
            temperature: 0,
            // MiniMax-M3 otherwise embeds <think> in message.content. Keeping
            // reasoning separate prevents it from consuming/truncating the
            // JSON object that this adapter validates.
            reasoning_split: true,
            // The limit covers both M3 reasoning and final content even when
            // reasoning_split keeps them in separate response fields.
            max_completion_tokens: 1024,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: contextualDirectorPrompt },
              ...(attempt
                ? [
                    {
                      role: 'system',
                      content:
                        'Return one complete JSON object with every required field. No prose.',
                    },
                  ]
                : []),
              { role: 'user', content: JSON.stringify(snapshot) },
            ],
          }),
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? 15_000),
        });
        const responseText = await response.text();
        if (!response.ok || !responseText.trim()) {
          const error = new Error(`minimax_director_http_${response.status}`);
          if (attempt === 0 && isRetryableDirectorStatus(response.status)) {
            lastError = error;
            continue;
          }
          throw error;
        }
        const payload = JSON.parse(responseText) as {
          base_resp?: { status_code?: unknown; status_msg?: unknown };
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const providerStatus = Number(payload.base_resp?.status_code ?? 0);
        if (providerStatus !== 0) {
          throw new Error(`minimax_director_provider_${providerStatus}`);
        }
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('minimax_director_missing_interpretation');
        }
        return parseDirectorInterpretation(content);
      } catch (error) {
        lastError = error;
        if (
          attempt === 0 &&
          error instanceof Error &&
          (error.message.startsWith('director_interpretation_invalid') ||
            error.message === 'minimax_director_missing_interpretation')
        ) {
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('minimax_director_failed');
  }
}

function isRetryableDirectorStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function parseDirectorInterpretation(raw: string): DirectorInterpretation {
  const cleaned = raw
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let parsed: DirectorInterpretation;
  try {
    parsed = JSON.parse(
      start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned,
    ) as DirectorInterpretation;
  } catch {
    throw new Error('director_interpretation_invalid');
  }
  const validAddressKinds = new Set(['host', 'viewer', 'room', 'unknown']);
  const validTopicRelations = new Set([
    'continues_thread',
    'changes_topic',
    'escalates_thread',
    'deescalates_thread',
    'new_topic',
    'unclear',
  ]);
  const validRiskLevels = new Set([
    'none',
    'tension',
    'direct_threat',
    'reported_threat',
    'urgent_care',
  ]);
  const validActions = new Set([
    'brief_reaction',
    'deep_answer',
    'use_tool',
    'set_boundary',
    'mute_actor',
    'ignore',
    'defer',
  ]);
  const validProgramModes = new Set([
    'companion',
    'weather',
    'urgent',
    'variety',
  ]);
  const loose = parsed as unknown as Record<string, unknown>;
  if (typeof loose.addressedTo === 'string') {
    parsed.addressedTo = {
      kind: validAddressKinds.has(loose.addressedTo)
        ? (loose.addressedTo as DirectorInterpretation['addressedTo']['kind'])
        : 'unknown',
    };
  }
  const invalidField = [
    !Array.isArray(parsed?.selectedEventIds) ||
    !parsed.selectedEventIds.every((id) => typeof id === 'string')
      ? 'selectedEventIds'
      : '',
    typeof parsed?.speechAct !== 'string' ? 'speechAct' : '',
    !parsed?.addressedTo || !validAddressKinds.has(parsed.addressedTo.kind)
      ? 'addressedTo'
      : '',
    typeof parsed?.tone !== 'string' ? 'tone' : '',
    !validTopicRelations.has(parsed?.topicRelation) ? 'topicRelation' : '',
    !parsed?.risk || !validRiskLevels.has(parsed.risk.level) ? 'risk.level' : '',
    !Array.isArray(parsed?.risk?.evidence) ||
    !parsed.risk.evidence.every((item) => typeof item === 'string')
      ? 'risk.evidence'
      : '',
    typeof parsed?.responsePriority !== 'number' ? 'responsePriority' : '',
    !validActions.has(parsed?.recommendedAction) ? 'recommendedAction' : '',
    !validProgramModes.has(parsed?.programMode) ? 'programMode' : '',
    typeof parsed?.needsDeepAnswer !== 'boolean' ? 'needsDeepAnswer' : '',
    !(parsed?.needsTool === null || typeof parsed?.needsTool === 'string')
      ? 'needsTool'
      : '',
    typeof parsed?.confidence !== 'number' ? 'confidence' : '',
  ].find(Boolean);
  if (invalidField) {
    throw new Error(`director_interpretation_invalid:${invalidField}`);
  }
  return parsed;
}

function normalizedConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function normalizeInterpretation(
  interpretation: DirectorInterpretation,
  snapshot: ShowSnapshot,
): DirectorInterpretation {
  const eventIds = new Set(snapshot.events.map((event) => event.id));
  const selectedEventIds = interpretation.selectedEventIds.filter((id) =>
    eventIds.has(id),
  );
  const riskLevel = interpretation.risk.level;
  const currentActorId = snapshot.events.find(
    (event) => event.id === snapshot.currentEventId,
  )?.actor.id;
  const continuesActiveGame = snapshot.threads.some(
    (thread) =>
      thread.kind === 'game' &&
      thread.status === 'active' &&
      interpretation.topicRelation === 'continues_thread' &&
      (!thread.participantIds.length ||
        (currentActorId && thread.participantIds.includes(currentActorId))),
  );
  const requiresWeatherCapability = new Set([
    'weather',
    'city-weather',
    'typhoon',
    'typhoon-boss-radar',
    'radar',
  ]).has(interpretation.needsTool || '');
  return {
    ...interpretation,
    selectedEventIds: selectedEventIds.length
      ? selectedEventIds
      : [snapshot.currentEventId],
    risk: {
      level: riskLevel,
      evidence: interpretation.risk.evidence.slice(0, 4),
    },
    programMode:
      riskLevel === 'urgent_care'
        ? 'urgent'
        : requiresWeatherCapability
          ? 'weather'
          : continuesActiveGame
            ? 'variety'
            : interpretation.programMode,
    recommendedAction:
      riskLevel === 'direct_threat'
        ? 'mute_actor'
        : interpretation.recommendedAction,
    responsePriority: normalizedConfidence(interpretation.responsePriority),
    confidence: normalizedConfidence(interpretation.confidence),
  };
}
