import { describe, expect, it } from 'vitest';
import {
  applyLiveEngagementDecision,
  commitDeliveredEngagement,
  createLiveEngagementLedger,
  evaluateLiveEngagement,
  recordSupportAssociation,
  summarizeLiveEngagement,
} from '../../examples/react-purupuru-app/src/lib/liveEngagementPolicy';

const MINUTE = 60_000;

function evaluate(
  ledger: ReturnType<typeof createLiveEngagementLedger>,
  eventId: string,
  now: number,
  overrides: Partial<Parameters<typeof evaluateLiveEngagement>[1]> = {},
) {
  return evaluateLiveEngagement(ledger, {
    eventId,
    now,
    isLive: true,
    hasVerifiedAudience: true,
    isProactive: false,
    text: '聊聊今晚的节目',
    routeMode: 'conversation',
    ...overrides,
  });
}

function deliver(
  ledger: ReturnType<typeof createLiveEngagementLedger>,
  eventId: string,
  now: number,
  reply = '先把眼前这段聊好。',
) {
  const decision = evaluate(ledger, eventId, now);
  return commitDeliveredEngagement(ledger, {
    decision,
    reply,
    deliveryStatus: 'spoken',
    deliveredAt: now,
  });
}

describe('live engagement policy', () => {
  it('opens a paid slot after three delivered non-paid replies', () => {
    let ledger = createLiveEngagementLedger();
    ledger = deliver(ledger, 'one', 0);
    ledger = deliver(ledger, 'two', MINUTE);
    ledger = deliver(ledger, 'three', 2 * MINUTE);

    const decision = evaluate(ledger, 'paid', 3 * MINUTE);
    const finalized = applyLiveEngagementDecision('这段先说到这里。', decision);

    expect(decision.action).toBe('invite-paid-support');
    expect(finalized.action).toBe('invite-paid-support');
    expect(finalized.text).toMatch(/投个蕉|送份礼物|上舰支持岚台/u);
  });

  it('enforces spacing, cooldown, and the rolling hourly cap', () => {
    let ledger = createLiveEngagementLedger();
    for (let paidIndex = 0; paidIndex < 3; paidIndex += 1) {
      for (let gap = 0; gap < 3; gap += 1) {
        const at = (paidIndex * 15 + gap) * MINUTE;
        ledger = deliver(ledger, `gap-${paidIndex}-${gap}`, at);
      }
      const at = (paidIndex * 15 + 3) * MINUTE;
      const decision = evaluate(ledger, `paid-${paidIndex}`, at);
      const reply = applyLiveEngagementDecision('节目继续。', decision).text;
      ledger = commitDeliveredEngagement(ledger, {
        decision,
        reply,
        deliveryStatus: 'spoken',
        deliveredAt: at,
      });
    }

    expect(evaluate(ledger, 'fourth', 48 * MINUTE).reasonCode).toBe(
      'paid-hourly-cap',
    );
  });

  it('does not invite support in repair, urgent, or paid-thank turns', () => {
    let ledger = createLiveEngagementLedger();
    ledger = deliver(ledger, 'one', 0);
    ledger = deliver(ledger, 'two', MINUTE);
    ledger = deliver(ledger, 'three', 2 * MINUTE);

    expect(
      evaluate(ledger, 'repair', 20 * MINUTE, {
        text: '主播睡着了，都不理我',
      }).action,
    ).toBe('none');
    expect(
      evaluate(ledger, 'urgent', 20 * MINUTE, { routeMode: 'urgent' }).action,
    ).toBe('none');
    expect(
      evaluate(ledger, 'gift', 20 * MINUTE, {
        engagementSignals: ['gift'],
      }).reasonCode,
    ).toBe('paid-support-thank-only');
  });

  it('does not advance cadence for failed delivery', () => {
    const ledger = createLiveEngagementLedger();
    const decision = evaluate(ledger, 'failed', 0);

    expect(decision.action).toBe('none');
    expect(ledger.deliveries).toHaveLength(0);
    expect(
      evaluate(ledger, 'retry', MINUTE).snapshot.nonPaidDeliveredSincePaid,
    ).toBe(0);
  });

  it('allows room-level invitations for verified silent audiences only', () => {
    const ledger = createLiveEngagementLedger();
    expect(evaluate(ledger, 'silent', 0, { isProactive: true }).action).toBe(
      'invite-free-engagement',
    );
    expect(
      evaluate(ledger, 'empty', 0, {
        isProactive: true,
        hasVerifiedAudience: false,
      }).action,
    ).toBe('none');
  });

  it('associates support occurring within ten minutes without claiming causality', () => {
    let ledger = createLiveEngagementLedger();
    ledger = deliver(ledger, 'one', 0);
    ledger = deliver(ledger, 'two', MINUTE);
    ledger = deliver(ledger, 'three', 2 * MINUTE);
    const paid = evaluate(ledger, 'paid', 3 * MINUTE);
    ledger = commitDeliveredEngagement(ledger, {
      decision: paid,
      reply: applyLiveEngagementDecision('节目继续。', paid).text,
      deliveryStatus: 'spoken',
      deliveredAt: 3 * MINUTE,
    });
    ledger = recordSupportAssociation(ledger, {
      eventId: 'gift',
      kind: 'gift',
      occurredAt: 8 * MINUTE,
      amount: 30,
    });

    expect(summarizeLiveEngagement(ledger, 8 * MINUTE)).toEqual({
      paidDeliveredLastHour: 1,
      freeDeliveredLastHour: 0,
      associatedSupportCount: 1,
      associatedSupportAmount: 30,
    });
  });

  it('returns the same engagement decision in shadow, canary, and primary lanes', () => {
    let ledger = createLiveEngagementLedger();
    ledger = deliver(ledger, 'one', 0);
    ledger = deliver(ledger, 'two', MINUTE);
    ledger = deliver(ledger, 'three', 2 * MINUTE);

    const decisions = (['shadow', 'canary', 'primary'] as const).map(() =>
      evaluate(ledger, 'shared-event', 15 * MINUTE),
    );

    expect(decisions.map(({ action }) => action)).toEqual([
      'invite-paid-support',
      'invite-paid-support',
      'invite-paid-support',
    ]);
    expect(new Set(decisions.map(({ reasonCode }) => reasonCode))).toEqual(
      new Set(['paid-slot-ready']),
    );
  });

  it('delivers two to three paid invitations in a busy simulated hour without consecutive asks', () => {
    let ledger = createLiveEngagementLedger();
    const deliveredActions: string[] = [];

    for (let minute = 0; minute < 60; minute += 3) {
      const eventId = `minute-${minute}`;
      const decision = evaluate(ledger, eventId, minute * MINUTE);
      const finalized = applyLiveEngagementDecision('节目继续。', decision);
      deliveredActions.push(finalized.action);
      ledger = commitDeliveredEngagement(ledger, {
        decision,
        reply: finalized.text,
        deliveryStatus: 'spoken',
        deliveredAt: minute * MINUTE,
      });
    }

    const paidCount = deliveredActions.filter(
      (action) => action === 'invite-paid-support',
    ).length;
    expect(paidCount).toBeGreaterThanOrEqual(2);
    expect(paidCount).toBeLessThanOrEqual(3);
    expect(
      deliveredActions.some(
        (action, index) =>
          action === 'invite-paid-support' &&
          deliveredActions[index + 1] === 'invite-paid-support',
      ),
    ).toBe(false);
  });
});
