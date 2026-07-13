export type MemoryScope =
  | 'core'
  | 'working'
  | 'session'
  | 'viewer'
  | 'knowledge';

export type MemoryKind =
  | 'persona'
  | 'preference'
  | 'fact'
  | 'event'
  | 'commitment'
  | 'summary'
  | 'rule';

export type MemoryDimension =
  | 'self'
  | 'relationship'
  | 'preference'
  | 'episode'
  | 'commitment'
  | 'knowledge';

export type MemoryLayer = 'interaction' | 'fact' | 'reflection' | 'profile';
export type MemoryStatus =
  | 'candidate'
  | 'confirmed'
  | 'protected'
  | 'suppressed'
  | 'archived';
export type MemoryTemporalScope = 'pattern' | 'state' | 'episode' | 'past';
export type MemoryVisibility = 'public' | 'internal' | 'private';
export type CognitiveMemoryTier = 'short_term' | 'long_term';
export type LongTermMemoryType =
  | 'episodic'
  | 'semantic'
  | 'relational'
  | 'procedural';
export type CognitiveMemoryPhase =
  | 'now'
  | 'sleep_queue'
  | 'long_term'
  | 'fading'
  | 'dormant'
  | 'forgotten';
export type MemorySleepState = 'awake' | 'queued' | 'consolidating' | 'settled';
export type MemorySubjectType =
  | 'self'
  | 'operator'
  | 'viewer'
  | 'group'
  | 'topic';

export type MemoryDetailValue = string | number | boolean | string[];

export interface MemoryVersion {
  content: string;
  details: Record<string, MemoryDetailValue>;
  replacedAt: number;
  reason: string;
}

export interface StreamerMemoryRecord {
  id: string;
  digitalHumanId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  dimension: MemoryDimension;
  layer: MemoryLayer;
  status: MemoryStatus;
  title: string;
  subjectType: MemorySubjectType;
  subjectId?: string;
  subjectName: string;
  content: string;
  details: Record<string, MemoryDetailValue>;
  importance: number;
  confidence: number;
  reinforcement: number;
  disputation: number;
  temporalScope: MemoryTemporalScope;
  visibility: MemoryVisibility;
  memoryTier: CognitiveMemoryTier;
  longTermType?: LongTermMemoryType;
  phase: CognitiveMemoryPhase;
  sleepState: MemorySleepState;
  activation: number;
  stability: number;
  halfLifeMs: number;
  salience: number;
  emotionalSalience: number;
  novelty: number;
  goalRelevance: number;
  occurrenceCount: number;
  retrievalCount: number;
  interference: number;
  compressionLevel: number;
  sessionIds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  lastRecalledAt?: number;
  lastSleptAt?: number;
  protected: boolean;
  createdAt: number;
  updatedAt: number;
  validFrom: number;
  invalidAt?: number;
  expiresAt?: number;
  lastConfirmedAt?: number;
  sourceType:
    | 'operator_seed'
    | 'user_observation'
    | 'live_event'
    | 'manual'
    | 'migration'
    | 'reflection';
  sourceEventIds: string[];
  relatedEntryIds: string[];
  versionHistory: MemoryVersion[];
}

export interface MemoryInteraction {
  id: string;
  at: number;
  viewerId?: string;
  viewerName?: string;
  input: string;
  reply: string;
  source: 'chat' | 'live' | 'vision';
}

export type MemoryRecordInput = Pick<
  StreamerMemoryRecord,
  | 'digitalHumanId'
  | 'dimension'
  | 'layer'
  | 'status'
  | 'title'
  | 'subjectType'
  | 'subjectName'
  | 'content'
  | 'importance'
  | 'confidence'
  | 'temporalScope'
  | 'visibility'
> &
  Partial<
    Pick<
      StreamerMemoryRecord,
      | 'scope'
      | 'kind'
      | 'subjectId'
      | 'details'
      | 'reinforcement'
      | 'disputation'
      | 'protected'
      | 'validFrom'
      | 'expiresAt'
      | 'lastConfirmedAt'
      | 'sourceType'
      | 'sourceEventIds'
      | 'relatedEntryIds'
      | 'versionHistory'
      | 'memoryTier'
      | 'longTermType'
      | 'phase'
      | 'sleepState'
      | 'activation'
      | 'stability'
      | 'halfLifeMs'
      | 'salience'
      | 'emotionalSalience'
      | 'novelty'
      | 'goalRelevance'
      | 'occurrenceCount'
      | 'retrievalCount'
      | 'interference'
      | 'compressionLevel'
      | 'sessionIds'
      | 'firstSeenAt'
      | 'lastSeenAt'
      | 'lastRecalledAt'
      | 'lastSleptAt'
    >
  >;

export interface MemoryDimensionDefinition {
  id: MemoryDimension;
  label: string;
  shortLabel: string;
  description: string;
  fields: Array<{ key: string; label: string; placeholder: string }>;
}

export const MEMORY_DIMENSIONS: MemoryDimensionDefinition[] = [
  {
    id: 'self',
    label: '角色自我档案',
    shortLabel: '角色自我',
    description: '身份、价值、能力、弱点、行为原则与自我认知。',
    fields: [
      {
        key: 'category',
        label: '档案类别',
        placeholder: '身份 / 价值 / 能力 / 弱点',
      },
      { key: 'origin', label: '形成背景', placeholder: '这项设定从何而来' },
      {
        key: 'behaviorImpact',
        label: '行为影响',
        placeholder: '它如何影响直播中的判断和表达',
      },
    ],
  },
  {
    id: 'relationship',
    label: '人物与关系档案',
    shortLabel: '人物关系',
    description: '按人物保存称呼、关系阶段、信任、边界与共同经历。',
    fields: [
      {
        key: 'relationshipStage',
        label: '关系阶段',
        placeholder: '初识 / 熟悉 / 长期协作',
      },
      {
        key: 'preferredAddress',
        label: '首选称呼',
        placeholder: '直播中应该如何称呼对方',
      },
      {
        key: 'interactionStyle',
        label: '相处方式',
        placeholder: '直接、轻松、克制等',
      },
      {
        key: 'trust',
        label: '信任与熟悉度',
        placeholder: '当前信任依据与熟悉程度',
      },
      {
        key: 'boundaries',
        label: '关系边界',
        placeholder: '不应公开或触碰的事项',
      },
      {
        key: 'unresolved',
        label: '未解决事项',
        placeholder: '仍需确认、兑现或继续讨论的事',
      },
    ],
  },
  {
    id: 'preference',
    label: '偏好与习惯档案',
    shortLabel: '偏好习惯',
    description: '记录偏好对象、强度、原因、情境、例外与禁忌。',
    fields: [
      {
        key: 'polarity',
        label: '倾向',
        placeholder: '喜欢 / 反感 / 回避 / 坚持',
      },
      { key: 'intensity', label: '程度', placeholder: '轻微 / 明显 / 强烈' },
      { key: 'context', label: '适用情境', placeholder: '在什么情况下成立' },
      { key: 'reason', label: '原因', placeholder: '形成该偏好或习惯的原因' },
      { key: 'exceptions', label: '例外', placeholder: '哪些情况不适用' },
    ],
  },
  {
    id: 'episode',
    label: '经历与时间线',
    shortLabel: '经历时间线',
    description: '保存事件的起因、经过、结果、情绪、教训与后续影响。',
    fields: [
      { key: 'when', label: '发生时间', placeholder: '日期、时期或相对时间' },
      { key: 'where', label: '地点', placeholder: '事件发生地点' },
      {
        key: 'participants',
        label: '参与者',
        placeholder: '人物或群体，使用顿号分隔',
      },
      { key: 'outcome', label: '结果', placeholder: '事件最终如何结束' },
      { key: 'emotion', label: '情绪影响', placeholder: '这件事带来的感受' },
      { key: 'lesson', label: '获得的教训', placeholder: '从事件中形成的原则' },
      {
        key: 'behaviorImpact',
        label: '当前影响',
        placeholder: '如何影响现在的直播行为',
      },
    ],
  },
  {
    id: 'commitment',
    label: '目标与承诺档案',
    shortLabel: '目标承诺',
    description: '跟踪承诺对象、优先级、进度、期限、下一步与完成证据。',
    fields: [
      {
        key: 'beneficiary',
        label: '承诺对象',
        placeholder: '对谁或为何作出承诺',
      },
      {
        key: 'progress',
        label: '当前进度',
        placeholder: '未开始 / 进行中 / 已完成',
      },
      { key: 'deadline', label: '期限', placeholder: '明确日期或长期有效' },
      { key: 'nextAction', label: '下一步', placeholder: '接下来应采取的动作' },
      {
        key: 'completionEvidence',
        label: '完成证据',
        placeholder: '如何判断已经兑现',
      },
    ],
  },
  {
    id: 'knowledge',
    label: '知识与边界档案',
    shortLabel: '知识边界',
    description: '记录事实、来源、验证时间、有效期、未知项和公开限制。',
    fields: [
      {
        key: 'domain',
        label: '知识领域',
        placeholder: '气象 / 直播运营 / 平台规则等',
      },
      {
        key: 'source',
        label: '可靠来源',
        placeholder: '官方公告、运营者输入或工具结果',
      },
      { key: 'verifiedAt', label: '最近核验', placeholder: '最近一次确认时间' },
      {
        key: 'validity',
        label: '有效期',
        placeholder: '长期有效或需要重新核验的条件',
      },
      {
        key: 'unknowns',
        label: '未知项',
        placeholder: '不能确定或必须现场查询的部分',
      },
      {
        key: 'disclosureRule',
        label: '公开规则',
        placeholder: '直播中可以怎样表达',
      },
    ],
  },
];
