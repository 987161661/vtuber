import type {
  MemoryDetailValue,
  MemoryRecordInput,
  StreamerMemoryRecord,
} from '../types/memory';

const DAY_MS = 86_400_000;
const DEFAULT_DUE_SOON_DAYS = 7;

export type CommitmentUrgency =
  | 'overdue'
  | 'due-soon'
  | 'active'
  | 'unscheduled'
  | 'completed';

export interface CommitmentRadarItem {
  id: string;
  digitalHumanId: string;
  title: string;
  content: string;
  beneficiary: string;
  progress: string;
  deadline: string;
  deadlineAt?: number;
  daysUntilDue?: number;
  remindAfter?: number;
  isSnoozed: boolean;
  nextAction: string;
  completionEvidence: string;
  urgency: CommitmentUrgency;
  importance: number;
  updatedAt: number;
}

export interface CommitmentRadar {
  summary: {
    total: number;
    open: number;
    overdue: number;
    dueSoon: number;
    attention: number;
    snoozed: number;
    completed: number;
  };
  items: CommitmentRadarItem[];
}

export interface CommitmentDraft {
  digitalHumanId: string;
  title: string;
  beneficiary: string;
  progress: string;
  deadline: string;
  nextAction: string;
  completionEvidence: string;
  content: string;
  visibility: StreamerMemoryRecord['visibility'];
  importance: number;
}

export type CommitmentDraftErrors = Partial<
  Record<'title' | 'beneficiary' | 'deadline' | 'nextAction', string>
>;

export type CommitmentMutationPlan =
  | {
      ok: true;
      mutation:
        | { kind: 'create'; input: MemoryRecordInput }
        | {
            kind: 'revise';
            id: string;
            update: Partial<StreamerMemoryRecord>;
          };
    }
  | { ok: false; errors: CommitmentDraftErrors };

export type CommitmentBroadcastPlan =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export type CommitmentReminderPlan =
  | { ok: true; update: Partial<StreamerMemoryRecord>; remindAfter?: number }
  | { ok: false; reason: string };

interface CommitmentRadarOptions {
  now?: number;
  dueSoonDays?: number;
}

const urgencyOrder: Record<CommitmentUrgency, number> = {
  overdue: 0,
  'due-soon': 1,
  active: 2,
  unscheduled: 3,
  completed: 4,
};

function detailText(value: MemoryDetailValue | undefined): string {
  if (Array.isArray(value)) return value.join('、');
  if (value === undefined) return '';
  return String(value).trim();
}

function detailTimestamp(
  value: MemoryDetailValue | undefined,
): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function withoutReminder(
  details: StreamerMemoryRecord['details'],
): StreamerMemoryRecord['details'] {
  const next = { ...details };
  delete next.remindAfter;
  return next;
}

function isCompleted(progress: string): boolean {
  const normalized = progress.toLowerCase().replace(/\s+/g, '');
  return (
    normalized === '完成' ||
    normalized.includes('已完成') ||
    normalized === 'done' ||
    normalized === 'completed'
  );
}

function parseDeadline(
  value: MemoryDetailValue | undefined,
): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const deadline = value.trim();
  const dateOnly = deadline.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      23,
      59,
      59,
      999,
    );
    if (
      parsed.getFullYear() !== Number(year) ||
      parsed.getMonth() !== Number(month) - 1 ||
      parsed.getDate() !== Number(day)
    ) {
      return undefined;
    }
    return parsed.getTime();
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(deadline)) return undefined;
  const timestamp = Date.parse(deadline);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function isValidDateOnly(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);
  return (
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() === Number(month) - 1 &&
    parsed.getDate() === Number(day)
  );
}

function classifyUrgency(
  completed: boolean,
  deadlineAt: number | undefined,
  now: number,
  dueSoonDays: number,
): CommitmentUrgency {
  if (completed) return 'completed';
  if (deadlineAt === undefined) return 'unscheduled';
  if (deadlineAt < now) return 'overdue';
  if (deadlineAt <= now + dueSoonDays * DAY_MS) return 'due-soon';
  return 'active';
}

function isVisibleCommitment(record: StreamerMemoryRecord): boolean {
  return (
    (record.dimension === 'commitment' || record.kind === 'commitment') &&
    record.status !== 'archived' &&
    record.status !== 'suppressed' &&
    record.phase !== 'forgotten'
  );
}

export function projectCommitmentRadar(
  records: StreamerMemoryRecord[],
  options: CommitmentRadarOptions = {},
): CommitmentRadar {
  const now = options.now ?? Date.now();
  const dueSoonDays = Math.max(0, options.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS);
  const items = records
    .filter(isVisibleCommitment)
    .map((record): CommitmentRadarItem => {
      const progress = detailText(record.details.progress);
      const deadline = detailText(record.details.deadline);
      const deadlineAt = parseDeadline(record.details.deadline);
      const remindAfter = detailTimestamp(record.details.remindAfter);
      const urgency = classifyUrgency(
        isCompleted(progress),
        deadlineAt,
        now,
        dueSoonDays,
      );
      const isSnoozed = urgency !== 'completed' && (remindAfter ?? 0) > now;
      return {
        id: record.id,
        digitalHumanId: record.digitalHumanId,
        title: record.title,
        content: record.content,
        beneficiary: detailText(record.details.beneficiary),
        progress: progress || '待确认',
        deadline,
        deadlineAt,
        daysUntilDue:
          deadlineAt === undefined
            ? undefined
            : Math.max(0, Math.ceil((deadlineAt - now) / DAY_MS)),
        remindAfter,
        isSnoozed,
        nextAction:
          detailText(record.details.nextAction) ||
          record.content ||
          '确认下一步行动',
        completionEvidence: detailText(record.details.completionEvidence),
        urgency,
        importance: record.importance,
        updatedAt: record.updatedAt,
      };
    })
    .sort((left, right) => {
      const leftAttentionRank =
        left.urgency === 'completed' ? 2 : left.isSnoozed ? 1 : 0;
      const rightAttentionRank =
        right.urgency === 'completed' ? 2 : right.isSnoozed ? 1 : 0;
      if (leftAttentionRank !== rightAttentionRank) {
        return leftAttentionRank - rightAttentionRank;
      }
      const urgencyDifference =
        urgencyOrder[left.urgency] - urgencyOrder[right.urgency];
      if (urgencyDifference !== 0) return urgencyDifference;

      const leftDeadline = left.deadlineAt ?? Number.POSITIVE_INFINITY;
      const rightDeadline = right.deadlineAt ?? Number.POSITIVE_INFINITY;
      if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
      if (left.importance !== right.importance) {
        return right.importance - left.importance;
      }
      return right.updatedAt - left.updatedAt;
    });

  const completed = items.filter(
    ({ urgency }) => urgency === 'completed',
  ).length;
  const snoozed = items.filter(({ isSnoozed }) => isSnoozed).length;
  return {
    summary: {
      total: items.length,
      open: items.length - completed,
      overdue: items.filter(({ urgency }) => urgency === 'overdue').length,
      dueSoon: items.filter(({ urgency }) => urgency === 'due-soon').length,
      attention: items.filter(
        ({ urgency, isSnoozed }) =>
          !isSnoozed && (urgency === 'overdue' || urgency === 'due-soon'),
      ).length,
      snoozed,
      completed,
    },
    items,
  };
}

export function buildCommitmentCompletionUpdate(
  record: StreamerMemoryRecord,
  completedAt = Date.now(),
): Partial<StreamerMemoryRecord> {
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(completedAt);
  return {
    status: record.status === 'candidate' ? 'confirmed' : record.status,
    lastConfirmedAt: completedAt,
    details: {
      ...withoutReminder(record.details),
      progress: '已完成',
      completionEvidence:
        detailText(record.details.completionEvidence) ||
        `运营者于 ${dateLabel} 确认完成`,
    },
  };
}

export function commitmentDraftFromRecord(
  record: StreamerMemoryRecord,
): CommitmentDraft {
  return {
    digitalHumanId: record.digitalHumanId,
    title: record.title,
    beneficiary: detailText(record.details.beneficiary) || record.subjectName,
    progress: detailText(record.details.progress) || '待开始',
    deadline: detailText(record.details.deadline),
    nextAction: detailText(record.details.nextAction) || record.content || '',
    completionEvidence: detailText(record.details.completionEvidence),
    content: record.content,
    visibility: record.visibility,
    importance: record.importance,
  };
}

function validateCommitmentDraft(
  draft: CommitmentDraft,
): CommitmentDraftErrors {
  const errors: CommitmentDraftErrors = {};
  if (!draft.title.trim()) errors.title = '请填写承诺标题';
  if (!draft.beneficiary.trim()) errors.beneficiary = '请填写承诺对象';
  if (!draft.nextAction.trim()) errors.nextAction = '请填写下一步行动';

  const deadline = draft.deadline.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline) && !isValidDateOnly(deadline)) {
    errors.deadline = '请输入有效日期，或使用“长期有效”等文字说明';
  }
  return errors;
}

export function planCommitmentMutation(
  draft: CommitmentDraft,
  current?: StreamerMemoryRecord,
): CommitmentMutationPlan {
  const errors = validateCommitmentDraft(draft);
  if (Object.keys(errors).length) return { ok: false, errors };

  const title = draft.title.trim();
  const beneficiary = draft.beneficiary.trim();
  const nextAction = draft.nextAction.trim();
  const details: StreamerMemoryRecord['details'] = {
    ...(current?.details ?? {}),
    beneficiary,
    progress: draft.progress.trim() || '待开始',
    deadline: draft.deadline.trim(),
    nextAction,
    completionEvidence: draft.completionEvidence.trim(),
  };
  if (isCompleted(detailText(details.progress))) {
    delete details.remindAfter;
  }
  const shared = {
    title,
    subjectName: beneficiary,
    content: draft.content.trim() || nextAction,
    details,
    importance: Math.min(10, Math.max(1, draft.importance)),
    visibility: draft.visibility,
    temporalScope: 'state' as const,
  };

  if (current) {
    return {
      ok: true,
      mutation: {
        kind: 'revise',
        id: current.id,
        update: shared,
      },
    };
  }

  return {
    ok: true,
    mutation: {
      kind: 'create',
      input: {
        ...shared,
        digitalHumanId: draft.digitalHumanId,
        dimension: 'commitment',
        layer: 'fact',
        status: 'confirmed',
        subjectType: 'topic',
        confidence: 1,
        sourceType: 'manual',
        reinforcement: 1,
      },
    },
  };
}

export function planCommitmentBroadcast(
  record: StreamerMemoryRecord,
): CommitmentBroadcastPlan {
  if (record.visibility !== 'public') {
    return { ok: false, reason: '仅可公开承诺能够加入播报队列' };
  }
  if (isCompleted(detailText(record.details.progress))) {
    return { ok: false, reason: '已完成承诺无需再次播报' };
  }

  const beneficiary =
    detailText(record.details.beneficiary) || record.subjectName;
  const nextAction =
    detailText(record.details.nextAction) || record.content || '继续推进';
  const deadline = detailText(record.details.deadline);
  return {
    ok: true,
    text: `关于对${beneficiary}的承诺“${record.title}”：下一步是${nextAction}${
      deadline ? `，计划在${deadline}前完成` : ''
    }。`,
  };
}

export function planCommitmentReminder(
  record: StreamerMemoryRecord,
  action: 'tomorrow' | 'resume',
  now = Date.now(),
): CommitmentReminderPlan {
  if (action === 'resume') {
    return {
      ok: true,
      update: { details: withoutReminder(record.details) },
    };
  }
  if (isCompleted(detailText(record.details.progress))) {
    return { ok: false, reason: '已完成承诺无需设置提醒' };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const remindAfter = tomorrow.getTime();
  return {
    ok: true,
    remindAfter,
    update: {
      details: {
        ...record.details,
        remindAfter,
      },
    },
  };
}
