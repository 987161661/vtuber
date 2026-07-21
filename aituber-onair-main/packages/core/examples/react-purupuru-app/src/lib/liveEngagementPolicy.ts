export type LiveEngagementAction =
  | 'none'
  | 'invite-paid-support'
  | 'invite-free-engagement';

export type LiveEngagementDecisionV1 = {
  version: 1;
  decisionId: string;
  eventId: string;
  action: LiveEngagementAction;
  target: 'room';
  reasonCode: string;
  eligibleAt: number;
  snapshot: {
    paidInRollingHour: number;
    nonPaidDeliveredSincePaid: number;
    lastPaidDeliveredAt?: number;
    lastFreeDeliveredAt?: number;
  };
};

export type DeliveredEngagementRecordV1 = {
  decisionId: string;
  eventId: string;
  action: LiveEngagementAction;
  deliveredAt: number;
  deliveryStatus: 'spoken' | 'partial';
};

export type SupportAssociationV1 = {
  eventId: string;
  kind: 'gift' | 'superchat' | 'guard';
  occurredAt: number;
  amount?: number;
  associatedDecisionId?: string;
};

export type LiveEngagementLedgerV1 = {
  version: 1;
  deliveries: DeliveredEngagementRecordV1[];
  supportAssociations: SupportAssociationV1[];
};

export type LiveEngagementPolicyInput = {
  eventId: string;
  now: number;
  isLive: boolean;
  hasVerifiedAudience: boolean;
  isProactive: boolean;
  text: string;
  routeMode?: string;
  routeIntent?: string;
  sourceLabel?: string;
  isCityReport?: boolean;
  engagementSignals?: Array<'follow' | 'like' | 'gift' | 'superchat' | 'guard'>;
};

const HOUR_MS = 60 * 60_000;
const PAID_COOLDOWN_MS = 12 * 60_000;
const FREE_COOLDOWN_MS = 15 * 60_000;
const SUPPORT_ASSOCIATION_WINDOW_MS = 10 * 60_000;
const MAX_PAID_PER_HOUR = 3;
const MIN_NON_PAID_BETWEEN_PAID = 3;

const PAID_INVITATION =
  /(?:要不|顺手|喜欢.{0,6}就|想支持.{0,6}(?:可以|就)|来|给|帮).{0,14}(?:投.{0,3}蕉|送.{0,4}(?:礼物|辣条)|上舰|开舰|充电)|(?:投个蕉|送份礼物|上舰支持岚台|开个舰|充个电)/u;
const FREE_INVITATION =
  /(?:扣|发|丢|来).{0,8}(?:表情|弹幕)|(?:点|来).{0,6}(?:关注|点赞)|关注一下|点个赞/u;
const SENSITIVE_TURN =
  /(?:不理我|忽略我|没回我|答偏了|说错了|不是这个|难过|失恋|去世|离世|葬礼|抑郁|想死|自杀|被困|受伤|救命|撤离|报警|危险|紧急避险)/u;

function finiteAmount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 100) / 100
    : undefined;
}

function rollingDeliveries(
  ledger: LiveEngagementLedgerV1,
  now: number,
): DeliveredEngagementRecordV1[] {
  return ledger.deliveries.filter(
    (record) => now - record.deliveredAt <= HOUR_MS,
  );
}

function decision(
  input: LiveEngagementPolicyInput,
  action: LiveEngagementAction,
  reasonCode: string,
  eligibleAt: number,
  snapshot: LiveEngagementDecisionV1['snapshot'],
): LiveEngagementDecisionV1 {
  return {
    version: 1,
    decisionId: `engagement:${input.eventId}`,
    eventId: input.eventId,
    action,
    target: 'room',
    reasonCode,
    eligibleAt,
    snapshot,
  };
}

export function createLiveEngagementLedger(): LiveEngagementLedgerV1 {
  return { version: 1, deliveries: [], supportAssociations: [] };
}

export function evaluateLiveEngagement(
  ledger: LiveEngagementLedgerV1,
  input: LiveEngagementPolicyInput,
): LiveEngagementDecisionV1 {
  const recent = rollingDeliveries(ledger, input.now);
  const paid = recent.filter(
    (record) => record.action === 'invite-paid-support',
  );
  const lastPaid = [...paid].sort(
    (left, right) => right.deliveredAt - left.deliveredAt,
  )[0];
  const lastFree = [...recent]
    .filter((record) => record.action === 'invite-free-engagement')
    .sort((left, right) => right.deliveredAt - left.deliveredAt)[0];
  const nonPaidDeliveredSincePaid = recent.filter(
    (record) =>
      record.action !== 'invite-paid-support' &&
      (!lastPaid || record.deliveredAt > lastPaid.deliveredAt),
  ).length;
  const snapshot = {
    paidInRollingHour: paid.length,
    nonPaidDeliveredSincePaid,
    lastPaidDeliveredAt: lastPaid?.deliveredAt,
    lastFreeDeliveredAt: lastFree?.deliveredAt,
  };
  const paidEligibleAt = Math.max(
    lastPaid ? lastPaid.deliveredAt + PAID_COOLDOWN_MS : input.now,
    input.now,
  );

  if (!input.isLive) {
    return decision(input, 'none', 'room-not-live', paidEligibleAt, snapshot);
  }
  if (!input.hasVerifiedAudience) {
    return decision(
      input,
      'none',
      'audience-unverified',
      paidEligibleAt,
      snapshot,
    );
  }
  if (
    input.isCityReport ||
    input.routeMode === 'urgent' ||
    input.routeIntent === 'safety' ||
    SENSITIVE_TURN.test(input.text)
  ) {
    return decision(input, 'none', 'sensitive-turn', paidEligibleAt, snapshot);
  }
  if (
    input.engagementSignals?.some((signal) =>
      ['gift', 'superchat', 'guard'].includes(signal),
    )
  ) {
    return decision(
      input,
      'none',
      'paid-support-thank-only',
      paidEligibleAt,
      snapshot,
    );
  }

  const cooldownSatisfied =
    !lastPaid || input.now - lastPaid.deliveredAt >= PAID_COOLDOWN_MS;
  const spacingSatisfied =
    nonPaidDeliveredSincePaid >= MIN_NON_PAID_BETWEEN_PAID;
  if (
    paid.length < MAX_PAID_PER_HOUR &&
    cooldownSatisfied &&
    spacingSatisfied
  ) {
    return decision(
      input,
      'invite-paid-support',
      'paid-slot-ready',
      input.now,
      snapshot,
    );
  }

  const freeEligible =
    input.isProactive &&
    (!lastFree || input.now - lastFree.deliveredAt >= FREE_COOLDOWN_MS) &&
    recent.at(-1)?.action !== 'invite-free-engagement';
  if (freeEligible) {
    return decision(
      input,
      'invite-free-engagement',
      'quiet-room-free-invitation',
      input.now,
      snapshot,
    );
  }

  const reasonCode =
    paid.length >= MAX_PAID_PER_HOUR
      ? 'paid-hourly-cap'
      : !cooldownSatisfied
        ? 'paid-cooldown'
        : !spacingSatisfied
          ? 'paid-spacing'
          : 'free-cooldown';
  return decision(input, 'none', reasonCode, paidEligibleAt, snapshot);
}

export function containsPaidSupportInvitation(text: string): boolean {
  return PAID_INVITATION.test(text.normalize('NFKC'));
}

export function containsFreeEngagementInvitation(text: string): boolean {
  return FREE_INVITATION.test(text.normalize('NFKC'));
}

function pick(values: readonly string[], key: string, salt: number): string {
  let hash = salt;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return values[hash % values.length];
}

export function composePaidSupportInvitation(decisionId: string): string {
  const hooks = ['喜欢这段', '岚台要继续运转', '这段要是把你留住了'] as const;
  const support = ['投个蕉', '送份礼物', '上舰支持岚台'] as const;
  const endings = [
    '让我重启一下。',
    '今晚就靠你们养着了。',
    '我会把后面的节目接着做好。',
  ] as const;
  return `${pick(hooks, decisionId, 7)}，${pick(support, decisionId, 17)}，${pick(endings, decisionId, 29)}`;
}

function stripUnscheduledFreeInvitation(text: string): string {
  const retained = text
    .split(/(?<=[。！？!?])/u)
    .map((part) => part.trim())
    .filter((part) => part && !containsFreeEngagementInvitation(part));
  return retained.join('').trim();
}

export function applyLiveEngagementDecision(
  text: string,
  engagement: LiveEngagementDecisionV1 | undefined,
): { text: string; action: LiveEngagementAction; rewritten: boolean } {
  const original = text.trim();
  if (!engagement) {
    return {
      text: original,
      action: containsPaidSupportInvitation(original)
        ? 'invite-paid-support'
        : containsFreeEngagementInvitation(original)
          ? 'invite-free-engagement'
          : 'none',
      rewritten: false,
    };
  }

  if (containsPaidSupportInvitation(original)) {
    return { text: original, action: 'invite-paid-support', rewritten: false };
  }
  if (engagement.action === 'invite-paid-support') {
    return {
      text: `${original}${/[。！？!?]$/u.test(original) ? '' : '。'}${composePaidSupportInvitation(engagement.decisionId)}`,
      action: 'invite-paid-support',
      rewritten: true,
    };
  }
  if (engagement.action === 'invite-free-engagement') {
    if (containsFreeEngagementInvitation(original)) {
      return {
        text: original,
        action: 'invite-free-engagement',
        rewritten: false,
      };
    }
    return {
      text: `${original}${/[。！？!?]$/u.test(original) ? '' : '。'}想接话就丢个表情，我接着聊。`,
      action: 'invite-free-engagement',
      rewritten: true,
    };
  }

  if (containsFreeEngagementInvitation(original)) {
    const stripped = stripUnscheduledFreeInvitation(original);
    return {
      text: stripped || '我先按自己的节奏把这段说完。',
      action: 'none',
      rewritten: true,
    };
  }
  return { text: original, action: 'none', rewritten: false };
}

export function commitDeliveredEngagement(
  ledger: LiveEngagementLedgerV1,
  input: {
    decision: LiveEngagementDecisionV1;
    reply: string;
    deliveryStatus: 'spoken' | 'partial';
    deliveredAt: number;
  },
): LiveEngagementLedgerV1 {
  const existing = ledger.deliveries.find(
    (record) => record.eventId === input.decision.eventId,
  );
  if (existing) return ledger;
  const action = containsPaidSupportInvitation(input.reply)
    ? 'invite-paid-support'
    : containsFreeEngagementInvitation(input.reply)
      ? 'invite-free-engagement'
      : 'none';
  return {
    ...ledger,
    deliveries: [
      ...rollingDeliveries(ledger, input.deliveredAt),
      {
        decisionId: input.decision.decisionId,
        eventId: input.decision.eventId,
        action,
        deliveredAt: input.deliveredAt,
        deliveryStatus: input.deliveryStatus,
      },
    ],
  };
}

export function recordSupportAssociation(
  ledger: LiveEngagementLedgerV1,
  input: Omit<SupportAssociationV1, 'associatedDecisionId'>,
): LiveEngagementLedgerV1 {
  if (
    ledger.supportAssociations.some(
      (record) => record.eventId === input.eventId,
    )
  ) {
    return ledger;
  }
  const paid = [...ledger.deliveries]
    .filter(
      (record) =>
        record.action === 'invite-paid-support' &&
        input.occurredAt >= record.deliveredAt &&
        input.occurredAt - record.deliveredAt <= SUPPORT_ASSOCIATION_WINDOW_MS,
    )
    .sort((left, right) => right.deliveredAt - left.deliveredAt)[0];
  return {
    ...ledger,
    supportAssociations: [
      ...ledger.supportAssociations.filter(
        (record) => input.occurredAt - record.occurredAt <= HOUR_MS,
      ),
      {
        ...input,
        amount: finiteAmount(input.amount),
        associatedDecisionId: paid?.decisionId,
      },
    ],
  };
}

export function summarizeLiveEngagement(
  ledger: LiveEngagementLedgerV1,
  now: number,
): {
  paidDeliveredLastHour: number;
  freeDeliveredLastHour: number;
  associatedSupportCount: number;
  associatedSupportAmount: number;
} {
  const deliveries = rollingDeliveries(ledger, now);
  const associations = ledger.supportAssociations.filter(
    (record) =>
      now - record.occurredAt <= HOUR_MS && record.associatedDecisionId,
  );
  return {
    paidDeliveredLastHour: deliveries.filter(
      (record) => record.action === 'invite-paid-support',
    ).length,
    freeDeliveredLastHour: deliveries.filter(
      (record) => record.action === 'invite-free-engagement',
    ).length,
    associatedSupportCount: associations.length,
    associatedSupportAmount:
      Math.round(
        associations.reduce(
          (total, record) => total + (record.amount ?? 0),
          0,
        ) * 100,
      ) / 100,
  };
}
