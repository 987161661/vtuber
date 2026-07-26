import { describe, expect, it } from 'vitest';
import { createMemoryRecord } from '../../examples/react-purupuru-app/src/config/memoryArchiveSeed';
import {
  buildCommitmentCompletionUpdate,
  planCommitmentReminder,
  projectCommitmentRadar,
} from '../../examples/react-purupuru-app/src/lib/commitmentRadar';
import type { StreamerMemoryRecord } from '../../examples/react-purupuru-app/src/types/memory';

function commitment(
  id: string,
  details: StreamerMemoryRecord['details'],
): StreamerMemoryRecord {
  return {
    ...createMemoryRecord({
      digitalHumanId: 'linglan',
      dimension: 'commitment',
      layer: 'fact',
      status: 'confirmed',
      title: id,
      subjectType: 'operator',
      subjectName: '运营者',
      content: `${id} 的承诺内容`,
      details,
      importance: 7,
      confidence: 1,
      temporalScope: 'state',
      visibility: 'internal',
    }),
    id,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('commitment reminders', () => {
  it('keeps urgency while moving snoozed commitments out of attention', () => {
    const now = new Date(2026, 6, 23, 12).getTime();
    const snoozedUntil = new Date(2026, 6, 24, 9).getTime();
    const radar = projectCommitmentRadar(
      [
        commitment('snoozed-overdue', {
          progress: '进行中',
          deadline: '2026-07-20',
          remindAfter: snoozedUntil,
        }),
        commitment('active-due-soon', {
          progress: '进行中',
          deadline: '2026-07-24',
        }),
        commitment('expired-snooze', {
          progress: '进行中',
          deadline: '2026-07-21',
          remindAfter: now - 1,
        }),
      ],
      { now },
    );

    expect(radar.items.map(({ id }) => id)).toEqual([
      'expired-snooze',
      'active-due-soon',
      'snoozed-overdue',
    ]);
    expect(radar.items[2]).toMatchObject({
      urgency: 'overdue',
      isSnoozed: true,
      remindAfter: snoozedUntil,
    });
    expect(radar.summary).toMatchObject({
      attention: 2,
      snoozed: 1,
    });
  });

  it('plans tomorrow and resume transitions through record details', () => {
    const now = new Date(2026, 6, 23, 16, 30).getTime();
    const record = commitment('reminder', {
      progress: '进行中',
      nextAction: '准备素材',
      externalReference: 'campaign-42',
    });

    const snooze = planCommitmentReminder(record, 'tomorrow', now);
    expect(snooze).toMatchObject({
      ok: true,
      update: {
        details: {
          externalReference: 'campaign-42',
          remindAfter: new Date(2026, 6, 24, 9).getTime(),
        },
      },
    });

    const snoozedRecord = {
      ...record,
      details:
        snooze.ok && snooze.update.details
          ? snooze.update.details
          : record.details,
    };
    const resumed = planCommitmentReminder(snoozedRecord, 'resume', now);
    expect(resumed).toMatchObject({ ok: true });
    expect(
      resumed.ok ? resumed.update.details?.remindAfter : 'failed',
    ).toBeUndefined();
    expect(resumed.ok ? resumed.update.details?.externalReference : '').toBe(
      'campaign-42',
    );
  });

  it('clears a pending reminder when a commitment is completed', () => {
    const record = commitment('complete-reminder', {
      progress: '进行中',
      remindAfter: new Date(2026, 6, 24, 9).getTime(),
    });

    const update = buildCommitmentCompletionUpdate(record);

    expect(update.details?.progress).toBe('已完成');
    expect(update.details?.remindAfter).toBeUndefined();
    expect(
      planCommitmentReminder({ ...record, ...update }, 'tomorrow'),
    ).toEqual({
      ok: false,
      reason: '已完成承诺无需设置提醒',
    });
  });
});
