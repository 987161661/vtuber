import type { LiveComment } from '@aituber-onair/comment-intelligence';

export type RoomConflictLevel = 'calm' | 'friction' | 'escalating' | 'attack';

export type RoomInteractionSample = {
  id: string;
  viewerId: string;
  viewerName: string;
  text: string;
  at: number;
  hostile: boolean;
  threat: boolean;
  targetViewerId?: string;
};

export type RoomBatchContext = {
  totalCount: number;
  participantCount: number;
  catchup: boolean;
  mergedCount: number;
  laneCounts: Record<string, number>;
  samples: RoomInteractionSample[];
};

export type RoomInteractionSnapshot = RoomBatchContext & {
  conflictLevel: RoomConflictLevel;
  ambiguous: boolean;
  clearOffenderIds: string[];
  observedAt: number;
  /** Platform-reported or locally estimated audience; never assumed exact. */
  platformAudienceEstimate?: number;
  participantCountIsExact?: boolean;
  audienceActivityMode?: 'empty' | 'active' | 'passive' | 'likely-resting';
  activeAudienceCount?: number;
  engageableAudienceCount?: number;
  likelyRestingAudienceCount?: number;
};

const HOSTILE = /(?:滚|闭嘴|垃圾|废物|恶心|骗子|傻逼|蠢货|找打|去死)/u;
const THREAT = /(?:弄死|打死|杀了|宰了|线下找你|砍死|弄你全家|曝光你|人肉你|手机号|身份证|家庭住址)/u;
const PLAYFUL = /(?:哈哈|笑死|开玩笑|逗你|狗头|hhh|233|[～~])/iu;

function viewerIdOf(comment: LiveComment): string {
  return String(comment.author.id || comment.author.name || 'anonymous');
}

function viewerNameOf(comment: LiveComment): string {
  return String(comment.author.displayName || comment.author.name || viewerIdOf(comment));
}

function laneOf(text: string): string {
  if (THREAT.test(text)) return 'boundary';
  if (/(?:预警|撤离|危险|求助|被困|受伤)/u.test(text)) return 'urgent';
  if (/(?:台风|天气|雷达|风力|暴雨|路径)/u.test(text)) return 'weather';
  if (HOSTILE.test(text)) return 'boundary';
  return 'conversation';
}

export class RoomInteractionTracker {
  private readonly events: RoomInteractionSample[] = [];
  private readonly now: () => number;
  private conflictLevel: RoomConflictLevel = 'calm';
  private lastConflictAt = 0;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  observe(comments: LiveComment[]): void {
    const names = new Map<string, string>();
    for (const event of this.events) names.set(event.viewerName, event.viewerId);
    for (const comment of comments) names.set(viewerNameOf(comment), viewerIdOf(comment));
    for (const comment of comments) {
      const text = comment.text.normalize('NFKC').slice(0, 240);
      const target = [...names.entries()].find(
        ([name, id]) => id !== viewerIdOf(comment) && text.includes(`@${name}`),
      );
      this.events.push({
        id: comment.id,
        viewerId: viewerIdOf(comment),
        viewerName: viewerNameOf(comment),
        text,
        at: Number(comment.timestamp) || this.now(),
        hostile: HOSTILE.test(text) && !PLAYFUL.test(text),
        threat: THREAT.test(text),
        targetViewerId: target?.[1],
      });
    }
    this.prune();
  }

  snapshot(batch?: Partial<RoomBatchContext>): RoomInteractionSnapshot {
    this.prune();
    const now = this.now();
    const active = this.events.filter((event) => now - event.at <= 20_000);
    const hostile = active.filter((event) => event.hostile || event.threat);
    const hostileViewers = new Set(hostile.map((event) => event.viewerId));
    const directed = hostile.filter((event) => event.targetViewerId);
    const mutual = directed.some((event) =>
      directed.some(
        (candidate) =>
          candidate.viewerId === event.targetViewerId &&
          candidate.targetViewerId === event.viewerId,
      ),
    );
    const isMultiViewerConflict = hostileViewers.size >= 2 && (directed.length > 0 || hostile.length >= 2);
    const detectedLevel: RoomConflictLevel = !isMultiViewerConflict
      ? 'calm'
      : hostile.some((event) => event.threat)
        ? 'attack'
        : mutual || hostile.length >= 3
          ? 'escalating'
          : 'friction';
    if (detectedLevel !== 'calm') {
      this.conflictLevel = detectedLevel;
      this.lastConflictAt = now;
    } else if (
      this.conflictLevel !== 'calm' &&
      now - this.lastConflictAt >= 30_000
    ) {
      this.conflictLevel =
        this.conflictLevel === 'attack'
          ? 'escalating'
          : this.conflictLevel === 'escalating'
            ? 'friction'
            : 'calm';
      this.lastConflictAt = now;
    }
    const conflictLevel = this.conflictLevel;
    // A scheduler batch describes what is being answered, not the whole room.
    // Merge it with the rolling observation window so a single selected
    // comment cannot erase another viewer who interacted seconds earlier.
    const samples = [
      ...new Map(
        [...active, ...(batch?.samples ?? [])].map((sample) => [
          sample.id,
          sample,
        ]),
      ).values(),
    ].slice(-12);
    const participants = new Set(samples.map((event) => event.viewerId));
    const laneCounts = { ...(batch?.laneCounts ?? {}) };
    if (!batch?.laneCounts) {
      for (const event of samples) {
        const lane = laneOf(event.text);
        laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
      }
    }
    return {
      totalCount: Math.max(batch?.totalCount ?? 0, samples.length),
      participantCount: Math.max(
        batch?.participantCount ?? 0,
        participants.size,
      ),
      catchup: batch?.catchup ?? false,
      mergedCount: batch?.mergedCount ?? samples.length,
      laneCounts,
      samples,
      conflictLevel,
      ambiguous:
        conflictLevel === 'friction' ||
        (hostileViewers.size >= 2 && directed.length === 0),
      clearOffenderIds: [
        ...new Set(hostile.filter((event) => event.threat).map((event) => event.viewerId)),
      ],
      observedAt: now,
    };
  }

  private prune(): void {
    const cutoff = this.now() - 30_000;
    while (this.events.length && this.events[0].at < cutoff) this.events.shift();
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }
}

export function roomBatchFromComments(
  comments: LiveComment[],
  catchup = false,
  mergedCount = comments.length,
): RoomBatchContext {
  const samples = comments.slice(0, 12).map((comment) => {
    const text = comment.text.normalize('NFKC').slice(0, 240);
    return {
      id: comment.id,
      viewerId: viewerIdOf(comment),
      viewerName: viewerNameOf(comment),
      text,
      at: Number(comment.timestamp) || Date.now(),
      hostile: HOSTILE.test(text) && !PLAYFUL.test(text),
      threat: THREAT.test(text),
    };
  });
  const laneCounts: Record<string, number> = {};
  for (const comment of comments) {
    const lane = laneOf(comment.text);
    laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
  }
  return {
    totalCount: Math.max(comments.length, mergedCount),
    participantCount: new Set(comments.map(viewerIdOf)).size,
    catchup,
    mergedCount,
    laneCounts,
    samples,
  };
}
