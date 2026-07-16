import type { LiveComment } from '@aituber-onair/comment-intelligence';

export type LiveEventStage =
  | 'received'
  | 'deduplicated'
  | 'queued'
  | 'selected'
  | 'generated'
  | 'speaking'
  | 'done'
  | 'dropped';

export type LiveDropReason =
  | 'duplicate_id'
  | 'duplicate_text'
  | 'low_information'
  | 'merged'
  | 'overflow_merged'
  | 'expired'
  | 'analysis_filtered'
  | 'audience_cooldown'
  | 'processing_error';

export interface LiveLifecycleTransition {
  eventId: string;
  stage: LiveEventStage;
  at: number;
  commentAt: number;
  receivedAt: number;
  queuedAt?: number;
  selectedAt?: number;
  dropReason?: LiveDropReason;
  fingerprint: string;
  text: string;
  viewerId?: string;
  viewerName?: string;
  sourcesSeen: string[];
  queueDepth: number;
  oldestQueueAgeMs: number;
}

export interface ScheduledLiveComment {
  eventId: string;
  comment: LiveComment;
  commentAt: number;
  receivedAt: number;
  queuedAt: number;
  selectedAt: number;
  fingerprint: string;
  sourcesSeen: string[];
  mergedCount: number;
  catchup: boolean;
}

interface QueueGroup {
  eventId: string;
  comments: LiveComment[];
  commentAt: number;
  receivedAt: number;
  queuedAt: number;
  fingerprint: string;
  topicKey: string;
  lane: ResponseLane;
  sourcesSeen: Set<string>;
}

type ResponseLane =
  | 'urgent'
  | 'weather'
  | 'engagement'
  | 'boundary'
  | 'conversation';

interface SchedulerOptions {
  now?: () => number;
  onTransition?: (transition: LiveLifecycleTransition) => void;
  maxGroups?: number;
  mergeWindowMs?: number;
  staleAfterMs?: number;
  expireAfterMs?: number;
  dedupeWindowMs?: number;
  settleWindowMs?: number;
  burstGroupThreshold?: number;
}

const LOW_INFORMATION =
  /^(?:主播[?？]?|在吗[?？]?|谢谢(?:了)?|感谢|好的?|收到|对哦|[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]+)$/u;

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function topicKey(text: string): string {
  return normalizeText(text)
    .replace(
      /(?:主播|请问|现在|当前|大概|这边|那边|会不会|有没有|怎么样|影响|呢|啊|吗|吧)/g,
      '',
    )
    .replace(/[，。！？、,.!?()[\]（）]/g, '');
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function isSimilarTopic(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left))
    return true;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (!leftPairs.size || !rightPairs.size) return false;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return overlap / Math.max(leftPairs.size, rightPairs.size) >= 0.6;
}

function sourceOf(comment: LiveComment): string {
  return String(
    comment.metadata?.platformId ||
      comment.metadata?.sourcePlatform ||
      comment.metadata?.source ||
      comment.metadata?.command ||
      comment.platform ||
      'unknown',
  );
}

function canonicalAuthor(comment: LiveComment): string {
  return String(comment.author.id || comment.author.name || 'anonymous')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

function isPaid(comment: LiveComment): boolean {
  return Boolean(comment.metadata?.superChat);
}

const URGENT_SIGNAL =
  /(?:\u9884\u8b66|\u64a4\u79bb|\u907f\u9669|\u6c42\u52a9|\u5371\u9669|\u505c\u8bfe|\u505c\u5de5|\u96e8\u707e|\u6c34\u707e|\u6d2a\u6c34|\u5185\u6d9d|\u79ef\u6c34|\u5c71\u6d2a|\u6ce5\u77f3\u6d41|\u6df9\u6c34|\u5012\u704c|\u88ab\u56f0|\u53d7\u4f24)/u;
const WEATHER_SIGNAL =
  /(?:\u53f0\u98ce|\u5929\u6c14|\u96f7\u8fbe|\u98ce\u529b|\u66b4\u96e8|\u964d\u96e8|\u8def\u5f84|\u767b\u9646|\u6c14\u8c61|\u98ce\u5708)/u;
const ENGAGEMENT_SIGNAL =
  /(?:gift|like|follow|super.?chat|\u8d60\u9001|\u9001\u51fa|\u70b9\u8d5e|\u5173\u6ce8)/iu;
const BOUNDARY_SIGNAL =
  /(?:\u56de\u590d.{0,4}\u6162|\u4e3b\u64ad.{0,6}\u88c5|\u5783\u573e|\u5e9f\u7269|\u6eda|\u95ed\u5634|\u6076\u5fc3|\u9a97\u5b50)/u;

export function responseLane(comment: LiveComment): ResponseLane {
  const text = normalizeText(comment.text);
  const eventType = String(comment.metadata?.eventType || '');
  if (URGENT_SIGNAL.test(text)) return 'urgent';
  if (WEATHER_SIGNAL.test(text)) return 'weather';
  if (isPaid(comment) || ENGAGEMENT_SIGNAL.test(`${eventType} ${text}`)) {
    return 'engagement';
  }
  if (BOUNDARY_SIGNAL.test(text)) return 'boundary';
  return 'conversation';
}

export function isLowInformationComment(comment: LiveComment): boolean {
  return LOW_INFORMATION.test(comment.text.trim());
}

export class LiveResponseScheduler {
  private readonly now: () => number;
  private readonly onTransition?: SchedulerOptions['onTransition'];
  private readonly maxGroups: number;
  private readonly mergeWindowMs: number;
  private readonly staleAfterMs: number;
  private readonly expireAfterMs: number;
  private readonly dedupeWindowMs: number;
  private readonly settleWindowMs: number;
  private readonly burstGroupThreshold: number;
  private readonly groups: QueueGroup[] = [];
  private readonly overflow: QueueGroup[] = [];
  private readonly seenIds = new Map<string, number>();
  private readonly seenText = new Map<string, number>();

  constructor(options: SchedulerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onTransition = options.onTransition;
    this.maxGroups = options.maxGroups ?? 12;
    this.mergeWindowMs = options.mergeWindowMs ?? 8_000;
    this.staleAfterMs = options.staleAfterMs ?? 20_000;
    this.expireAfterMs = options.expireAfterMs ?? 30_000;
    this.dedupeWindowMs = options.dedupeWindowMs ?? 90_000;
    this.settleWindowMs = options.settleWindowMs ?? 1_500;
    this.burstGroupThreshold = options.burstGroupThreshold ?? 3;
  }

  get size(): number {
    return this.groups.length + (this.overflow.length ? 1 : 0);
  }

  get oldestAgeMs(): number {
    const oldest = [...this.groups, ...this.overflow].reduce(
      (value, group) => Math.min(value, group.commentAt),
      Number.POSITIVE_INFINITY,
    );
    return Number.isFinite(oldest) ? Math.max(0, this.now() - oldest) : 0;
  }

  enqueue(comments: LiveComment[]): void {
    const now = this.now();
    this.pruneSeen(now);
    for (const comment of comments) this.enqueueOne(comment, now);
    this.compactOverflow(now);
  }

  dequeue(): ScheduledLiveComment | undefined {
    const now = this.now();
    this.dropLowInformationWhenBusy(now);
    this.dropExpired(now);

    const urgentIndex = this.groups.findIndex(
      (group) => group.lane === 'urgent',
    );
    if (urgentIndex >= 0) return this.selectAt(urgentIndex, now, false);

    const paidIndex = this.groups.findIndex((group) =>
      group.comments.some(isPaid),
    );
    if (paidIndex >= 0) return this.selectAt(paidIndex, now, false);

    // Let a short burst settle before choosing a spokesperson. This turns a
    // room wave into one host response instead of a serial help-desk queue.
    const newestAt = this.groups.reduce(
      (latest, group) => Math.max(latest, group.receivedAt),
      0,
    );
    if (now - newestAt < this.settleWindowMs) return undefined;

    if (this.groups.length >= this.burstGroupThreshold) {
      const catchup = this.catchupCandidates(this.groups, 5);
      if (catchup.length >= 2) return this.selectCatchup(catchup, now);
    }

    const stale = [...this.overflow, ...this.groups].filter(
      (group) => now - group.commentAt >= this.staleAfterMs,
    );
    if (stale.length >= 2 || this.overflow.length > 0) {
      const catchup = this.catchupCandidates(stale, 5);
      if (catchup.length >= 2) return this.selectCatchup(catchup, now);
      if (this.overflow.length > 0) return this.selectOldest(now);
    }

    if (!this.groups.length) return undefined;
    return this.selectOldest(now);
  }

  mark(
    event: ScheduledLiveComment,
    stage: LiveEventStage,
    dropReason?: LiveDropReason,
  ): void {
    this.emitGroup(
      {
        eventId: event.eventId,
        comments: [event.comment],
        commentAt: event.commentAt,
        receivedAt: event.receivedAt,
        queuedAt: event.queuedAt,
        fingerprint: event.fingerprint,
        topicKey: topicKey(event.comment.text),
        lane: responseLane(event.comment),
        sourcesSeen: new Set(event.sourcesSeen),
      },
      stage,
      this.now(),
      { selectedAt: event.selectedAt, dropReason },
    );
  }

  private enqueueOne(comment: LiveComment, now: number): void {
    const normalized = normalizeText(comment.text);
    if (!normalized) return;
    const receivedAt = Number(comment.metadata?.receivedAt) || now;
    const fingerprint = `${comment.metadata?.eventType || 'comment'}:${canonicalAuthor(comment)}:${normalized}`;
    const base = this.makeGroup(comment, receivedAt, now, fingerprint);
    this.emitGroup(base, 'received', now);

    if (this.seenIds.has(comment.id)) {
      this.emitGroup(base, 'deduplicated', now, { dropReason: 'duplicate_id' });
      return;
    }
    const textSeenAt = this.seenText.get(fingerprint) || 0;
    if (now - textSeenAt < this.dedupeWindowMs) {
      this.emitGroup(base, 'deduplicated', now, {
        dropReason: 'duplicate_text',
      });
      return;
    }
    this.seenIds.set(comment.id, now);
    this.seenText.set(fingerprint, now);

    const mergeTarget = this.groups.find(
      (group) =>
        group.lane === base.lane &&
        Math.abs(comment.timestamp - group.commentAt) <= this.mergeWindowMs &&
        isSimilarTopic(group.topicKey, base.topicKey),
    );
    if (mergeTarget && !isPaid(comment)) {
      mergeTarget.comments.push(comment);
      mergeTarget.commentAt = Math.min(
        mergeTarget.commentAt,
        comment.timestamp,
      );
      mergeTarget.receivedAt = Math.min(mergeTarget.receivedAt, receivedAt);
      mergeTarget.sourcesSeen.add(sourceOf(comment));
      this.emitGroup(base, 'deduplicated', now, { dropReason: 'merged' });
      return;
    }

    this.groups.push(base);
    this.emitGroup(base, 'queued', now);
  }

  private makeGroup(
    comment: LiveComment,
    receivedAt: number,
    queuedAt: number,
    fingerprint: string,
  ): QueueGroup {
    return {
      eventId: comment.id,
      comments: [comment],
      commentAt: comment.timestamp,
      receivedAt,
      queuedAt,
      fingerprint,
      topicKey: topicKey(comment.text),
      lane: responseLane(comment),
      sourcesSeen: new Set([sourceOf(comment)]),
    };
  }

  private dropLowInformationWhenBusy(now: number): void {
    if (
      !this.groups.some((group) => !isLowInformationComment(group.comments[0]))
    )
      return;
    for (let index = this.groups.length - 1; index >= 0; index -= 1) {
      const group = this.groups[index];
      if (!isLowInformationComment(group.comments[0])) continue;
      this.groups.splice(index, 1);
      this.emitGroup(group, 'dropped', now, {
        dropReason: 'low_information',
      });
    }
  }

  private dropExpired(now: number): void {
    const expired = this.groups.filter(
      (group) =>
        now - group.commentAt >= this.expireAfterMs &&
        isLowInformationComment(group.comments[0]),
    );
    for (const group of expired) {
      this.groups.splice(this.groups.indexOf(group), 1);
      this.emitGroup(group, 'dropped', now, { dropReason: 'expired' });
    }
  }

  private compactOverflow(now: number): void {
    while (
      this.groups.length + (this.overflow.length ? 1 : 0) >
      this.maxGroups
    ) {
      const index = this.groups.findIndex(
        (group) => !group.comments.some(isPaid),
      );
      if (index < 0) break;
      const [group] = this.groups.splice(index, 1);
      this.overflow.push(group);
      this.emitGroup(group, 'dropped', now, {
        dropReason: 'overflow_merged',
      });
    }
  }

  private selectAt(
    index: number,
    now: number,
    catchup: boolean,
  ): ScheduledLiveComment {
    const [group] = this.groups.splice(index, 1);
    return this.toSelection(group, now, catchup);
  }

  private selectOldest(now: number): ScheduledLiveComment | undefined {
    const candidates = [...this.groups, ...this.overflow];
    if (!candidates.length) return undefined;
    const oldest = candidates.reduce((current, group) =>
      group.commentAt < current.commentAt ? group : current,
    );
    const groupIndex = this.groups.indexOf(oldest);
    if (groupIndex >= 0) this.groups.splice(groupIndex, 1);
    const overflowIndex = this.overflow.indexOf(oldest);
    if (overflowIndex >= 0) this.overflow.splice(overflowIndex, 1);
    return this.toSelection(oldest, now, false);
  }

  private catchupCandidates(
    candidates: QueueGroup[],
    limit: number,
  ): QueueGroup[] {
    const lanes = new Map<ResponseLane, QueueGroup[]>();
    for (const group of candidates) {
      // Safety-critical messages are always answered individually. Other
      // lanes may be summarized, but only with messages from the same domain.
      if (group.lane === 'urgent') continue;
      const lane = lanes.get(group.lane) ?? [];
      lane.push(group);
      lanes.set(group.lane, lane);
    }
    return (
      [...lanes.values()]
        .sort((left, right) => {
          if (right.length !== left.length) return right.length - left.length;
          return left[0].commentAt - right[0].commentAt;
        })[0]
        ?.slice(0, limit) ?? []
    );
  }

  private selectCatchup(
    staleGroups: QueueGroup[],
    now: number,
  ): ScheduledLiveComment | undefined {
    const unique = [...new Set(staleGroups)].slice(0, 5);
    if (!unique.length) return undefined;
    for (const group of unique) {
      const index = this.groups.indexOf(group);
      if (index >= 0) this.groups.splice(index, 1);
      const overflowIndex = this.overflow.indexOf(group);
      if (overflowIndex >= 0) this.overflow.splice(overflowIndex, 1);
      this.emitGroup(group, 'dropped', now, { dropReason: 'merged' });
    }
    const first = unique[0];
    const text = unique
      .map((group) => group.comments[0].text.trim())
      .filter(Boolean)
      .join('；')
      .slice(0, 240);
    const comment: LiveComment = {
      ...first.comments[0],
      id: `catchup:${first.eventId}:${now}`,
      text: `直播间刚才还有这些问题：${text}`,
      timestamp: first.commentAt,
      author: {
        id: 'live-room-catchup',
        name: '多位观众',
        displayName: '多位观众',
      },
      metadata: {
        ...first.comments[0].metadata,
        catchup: true,
        mergedCount: unique.length,
      },
    };
    const combined: QueueGroup = {
      ...first,
      eventId: comment.id,
      comments: [comment],
      sourcesSeen: new Set(unique.flatMap((group) => [...group.sourcesSeen])),
    };
    return this.toSelection(combined, now, true, unique.length);
  }

  private toSelection(
    group: QueueGroup,
    now: number,
    catchup: boolean,
    mergedCount = group.comments.length,
  ): ScheduledLiveComment {
    const primary = group.comments[0];
    const comment =
      group.comments.length <= 1
        ? primary
        : {
            ...primary,
            text: group.comments
              .map((item) => item.text.trim())
              .filter(Boolean)
              .join('；')
              .slice(0, 240),
            metadata: {
              ...primary.metadata,
              mergedCount: group.comments.length,
            },
          };
    const selection = {
      eventId: group.eventId,
      comment,
      commentAt: group.commentAt,
      receivedAt: group.receivedAt,
      queuedAt: group.queuedAt,
      selectedAt: now,
      fingerprint: group.fingerprint,
      sourcesSeen: [...group.sourcesSeen],
      mergedCount,
      catchup,
    };
    this.emitGroup(group, 'selected', now, { selectedAt: now });
    return selection;
  }

  private emitGroup(
    group: QueueGroup,
    stage: LiveEventStage,
    at: number,
    extra: {
      selectedAt?: number;
      dropReason?: LiveDropReason;
    } = {},
  ): void {
    const comment = group.comments[0];
    this.onTransition?.({
      eventId: group.eventId,
      stage,
      at,
      commentAt: group.commentAt,
      receivedAt: group.receivedAt,
      queuedAt: group.queuedAt,
      selectedAt: extra.selectedAt,
      dropReason: extra.dropReason,
      fingerprint: group.fingerprint,
      text: comment.text,
      viewerId: comment.author.id,
      viewerName: comment.author.displayName ?? comment.author.name,
      sourcesSeen: [...group.sourcesSeen],
      queueDepth: this.size,
      oldestQueueAgeMs: this.oldestAgeMs,
    });
  }

  private pruneSeen(now: number): void {
    for (const [id, seenAt] of this.seenIds) {
      if (now - seenAt > this.dedupeWindowMs) this.seenIds.delete(id);
    }
    for (const [fingerprint, seenAt] of this.seenText) {
      if (now - seenAt > this.dedupeWindowMs) {
        this.seenText.delete(fingerprint);
      }
    }
  }
}
