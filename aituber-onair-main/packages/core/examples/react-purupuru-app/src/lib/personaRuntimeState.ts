import type {
  EmptyRoomAwarenessContext,
  EmptyRoomMemoryCue,
} from './emptyRoomAwareness';
import {
  PersonaDriveState,
  type PersonaDriveId,
} from './personaDriveState';
import {
  PersonaEmotionStateMachine,
  type PersonaEmotionPreview,
  type PersonaEmotionSnapshot,
} from './personaEmotionState';
import type { PersonaInteractionPlanV1 } from './personaInteractionPlanner';
import {
  inferTopicEntities,
  inferTopicFamily,
  PersonaTopicLedger,
  type PersonaTopicCandidate,
  type PersonaTopicEntry,
  type ProactiveContinuity,
} from './personaTopicLedger';

export type ProactiveIntentSource =
  | 'room'
  | 'audience'
  | 'memory'
  | 'self_goal'
  | 'interface';

export interface ProactiveIntentPlanV1 {
  version: 1;
  drive: PersonaDriveId;
  driveGoal: string;
  topicFamily: string;
  entities: string[];
  source: ProactiveIntentSource;
  sourceRef?: string;
  continuity: ProactiveContinuity;
  mustAdvance: string;
  mustAvoidTopics: string[];
  emotion: {
    label: string;
    delivery: string;
    intensity: [number, number];
    socialMask: PersonaEmotionPreview['socialMask'];
  };
  reasonCode: string;
}

export interface PersonaRuntimeTransition {
  kind: 'interaction';
  emotion: PersonaEmotionPreview;
}

export interface PersonaRuntimeSnapshot {
  emotion: PersonaEmotionSnapshot;
  drives: ReturnType<PersonaDriveState['snapshot']>;
  topics: PersonaTopicEntry[];
}

type CandidateWithDrive = PersonaTopicCandidate & {
  source: ProactiveIntentSource;
  drives: PersonaDriveId[];
};

const DRIVE_EMOTION: Record<
  PersonaDriveId,
  { label: string; delivery: string; intensity: [number, number] }
> = {
  craft: { label: 'serious', delivery: 'thoughtful', intensity: [0.36, 0.52] },
  curiosity: { label: 'neutral', delivery: 'curious', intensity: [0.34, 0.5] },
  ambition: { label: 'happy', delivery: 'confident', intensity: [0.38, 0.56] },
  connection: { label: 'relaxed', delivery: 'warm', intensity: [0.34, 0.5] },
  autonomy: { label: 'neutral', delivery: 'restrained', intensity: [0.34, 0.5] },
  play: { label: 'happy', delivery: 'teasing', intensity: [0.4, 0.58] },
};

function strategyDrives(strategyId: string): PersonaDriveId[] {
  if (strategyId.includes('viewer')) return ['connection', 'curiosity', 'play'];
  if (strategyId.includes('memory')) return ['curiosity', 'connection', 'craft'];
  if (strategyId.includes('quiet')) return ['connection', 'autonomy', 'play'];
  return ['craft', 'ambition', 'autonomy', 'play', 'curiosity'];
}

function strategySources(strategyId: string): ProactiveIntentSource[] {
  if (strategyId.includes('viewer')) return ['audience', 'room'];
  if (strategyId.includes('memory')) return ['memory'];
  if (strategyId.includes('quiet')) return ['room', 'audience'];
  return ['self_goal', 'interface'];
}

function memoryCandidate(memory: EmptyRoomMemoryCue): CandidateWithDrive {
  const text = `${memory.title} ${memory.content}`;
  return {
    topicFamily: inferTopicFamily(text, `memory:${memory.id}`),
    entities: inferTopicEntities(text),
    source: 'memory',
    sourceRef: `${memory.title}：${memory.content}`.slice(0, 180),
    mustAdvance: '从这条记忆生出一个新的当下判断，不复述档案，也不把道具当成人格本身',
    drives: ['curiosity', 'connection', 'craft'],
  };
}

function candidatesFor(
  context: EmptyRoomAwarenessContext,
  drive: PersonaDriveId,
  driveGoal: string,
): CandidateWithDrive[] {
  const candidates: CandidateWithDrive[] = [
    {
      topicFamily: `self_goal:${drive}`,
      entities: [drive],
      source: 'self_goal',
      sourceRef: driveGoal,
      mustAdvance: `说出一个与“${driveGoal}”有关的具体判断、进展或小矛盾，让这件事比上一轮前进一步`,
      drives: [drive],
    },
    {
      topicFamily: 'room_presence',
      entities: ['room_presence'],
      source: 'room',
      mustAdvance: '表达此刻对安静或陪伴的真实态度，但不抱怨没人，也不催促回应',
      drives: ['connection', 'autonomy', 'play'],
    },
  ];
  if (context.audiencePresent) {
    candidates.push({
      topicFamily: 'audience_presence',
      entities: ['audience_presence'],
      source: 'audience',
      mustAdvance: '给在场的人一个具体而低门槛的接话点，不点名施压，不假装熟悉',
      drives: ['connection', 'curiosity', 'play'],
    });
  }
  if (context.interfaceContext.trim()) {
    const text = context.interfaceContext.trim();
    candidates.push({
      topicFamily: inferTopicFamily(text, 'live_craft'),
      entities: inferTopicEntities(text),
      source: 'interface',
      sourceRef: text.slice(0, 180),
      mustAdvance: '只使用可确认的当前状态形成观察，不念界面字段，不虚构屏幕之外的细节',
      drives: ['craft', 'curiosity'],
    });
  }
  candidates.push(...context.memoryCues.slice(0, 4).map(memoryCandidate));
  return candidates;
}

function uniqueRecentTopics(entries: PersonaTopicEntry[]) {
  return [...new Set(entries.slice(-6).map((entry) => entry.topicFamily))];
}

export class PersonaRuntimeState {
  private readonly emotion = new PersonaEmotionStateMachine();
  private readonly drives = new PersonaDriveState();
  private readonly topics = new PersonaTopicLedger();

  snapshot(at = Date.now()): PersonaRuntimeSnapshot {
    return {
      emotion: this.emotion.snapshot(at),
      drives: this.drives.snapshot(),
      topics: this.topics.snapshot(),
    };
  }

  prepareInteraction(
    plan: PersonaInteractionPlanV1,
    at = Date.now(),
    target?: string,
  ): { plan: PersonaInteractionPlanV1; transition: PersonaRuntimeTransition } {
    const preview = this.emotion.preview(plan, at, target);
    return {
      plan: {
        ...plan,
        deliveryTarget: {
          ...plan.deliveryTarget,
          intensity: preview.intensity,
          prosody: preview.prosody,
        },
      },
      transition: { kind: 'interaction', emotion: preview },
    };
  }

  planProactive(
    context: EmptyRoomAwarenessContext,
    strategyId: string,
    at = Date.now(),
  ): ProactiveIntentPlanV1 {
    const allowedDrives = strategyDrives(strategyId);
    const drive = this.drives.select(allowedDrives, at) ?? this.drives.select(undefined, at)!;
    const allCandidates = candidatesFor(context, drive.id, drive.goal);
    const compatible = allCandidates.filter((candidate) =>
      candidate.drives.includes(drive.id),
    );
    const preferredSources = strategySources(strategyId);
    const ranked = (compatible.length ? compatible : allCandidates).sort(
      (left, right) =>
        this.topics.score(right, at) +
        (preferredSources.includes(right.source) ? 200 : 0) -
        this.topics.score(left, at) -
        (preferredSources.includes(left.source) ? 200 : 0),
    );
    const candidate = ranked[0];
    const emotion = DRIVE_EMOTION[drive.id];
    const currentTopics = this.topics.snapshot();
    return {
      version: 1,
      drive: drive.id,
      driveGoal: drive.goal,
      topicFamily: candidate.topicFamily,
      entities: candidate.entities,
      source: candidate.source,
      sourceRef: candidate.sourceRef,
      continuity: 'new',
      mustAdvance: candidate.mustAdvance,
      mustAvoidTopics: uniqueRecentTopics(currentTopics),
      emotion: {
        ...emotion,
        socialMask:
          drive.id === 'play'
            ? 'teasing'
            : drive.id === 'connection'
              ? 'open'
              : 'restrained',
      },
      reasonCode: `drive_${drive.id}:${candidate.source}`,
    };
  }

  commitInteraction(transition: PersonaRuntimeTransition) {
    this.emotion.commit(transition.emotion);
  }

  commitProactive(plan: ProactiveIntentPlanV1, at = Date.now()) {
    this.drives.commit(plan.drive, at);
    this.topics.commit({
      topicFamily: plan.topicFamily,
      entities: plan.entities,
      drive: plan.drive,
      source: plan.source,
      continuity: plan.continuity,
      spokenAt: at,
      audienceResponded: false,
    });
  }
}

export function formatProactiveIntent(plan: ProactiveIntentPlanV1) {
  const source = plan.sourceRef ? `；依据=${plan.sourceRef}` : '';
  return `<proactive_persona_intent version="1">
人格动力：${plan.drive}（${plan.driveGoal}）
主题族：${plan.topicFamily}；来源=${plan.source}；连续性=${plan.continuity}${source}
这一轮必须推进：${plan.mustAdvance}
近期冷却主题：${plan.mustAvoidTopics.join('、') || '无'}。不得换句式重复这些主题；除非观众主动重开，否则不要延续。
情绪表达：emotion=${plan.emotion.label}；delivery=${plan.emotion.delivery}；强度=${plan.emotion.intensity.join('-')}；表达遮罩=${plan.emotion.socialMask}
只选择上述一个主来源，不拼接其他记忆，不把杯子、饮料或其他道具当作人格内容引擎。
</proactive_persona_intent>`;
}
