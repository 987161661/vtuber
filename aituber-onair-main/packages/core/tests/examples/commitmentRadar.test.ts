import { describe, expect, it } from 'vitest';
import { createMemoryRecord } from '../../examples/react-purupuru-app/src/config/memoryArchiveSeed';
import {
  buildCommitmentCompletionUpdate,
  commitmentDraftFromRecord,
  planCommitmentBroadcast,
  planCommitmentMutation,
  projectCommitmentRadar,
} from '../../examples/react-purupuru-app/src/lib/commitmentRadar';
import type { StreamerMemoryRecord } from '../../examples/react-purupuru-app/src/types/memory';

function commitment(
  id: string,
  details: StreamerMemoryRecord['details'],
  update: Partial<StreamerMemoryRecord> = {},
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
      importance: 0.7,
      confidence: 0.9,
      temporalScope: 'state',
      visibility: 'internal',
    }),
    id,
    createdAt: 1,
    updatedAt: 1,
    ...update,
  };
}

describe('commitment radar', () => {
  it('classifies commitments and filters inactive or unrelated memories', () => {
    const now = new Date(2026, 6, 23, 12).getTime();
    const records = [
      commitment('overdue', {
        progress: '进行中',
        deadline: '2026-07-22',
      }),
      commitment('due-soon', {
        progress: '待处理',
        deadline: '2026-07-25',
      }),
      commitment('active', {
        progress: '已开始',
        deadline: '2026-08-20',
      }),
      commitment('unscheduled', {
        progress: '待安排',
        deadline: '长期有效',
      }),
      commitment('completed', {
        progress: '已完成',
        deadline: '2026-07-01',
      }),
      commitment(
        'archived',
        { progress: '进行中', deadline: '2026-07-20' },
        { status: 'archived' },
      ),
      commitment(
        'unrelated',
        { progress: '进行中', deadline: '2026-07-20' },
        { dimension: 'episode', kind: 'event' },
      ),
    ];

    const radar = projectCommitmentRadar(records, { now, dueSoonDays: 7 });

    expect(radar.items.map(({ id, urgency }) => [id, urgency])).toEqual([
      ['overdue', 'overdue'],
      ['due-soon', 'due-soon'],
      ['active', 'active'],
      ['unscheduled', 'unscheduled'],
      ['completed', 'completed'],
    ]);
    expect(radar.summary).toEqual({
      total: 5,
      open: 4,
      overdue: 1,
      dueSoon: 1,
      attention: 2,
      snoozed: 0,
      completed: 1,
    });
  });

  it('treats a date-only deadline as the end of the local day', () => {
    const now = new Date(2026, 6, 23, 12).getTime();
    const radar = projectCommitmentRadar(
      [
        commitment('today', {
          progress: '进行中',
          deadline: '2026-07-23',
        }),
      ],
      { now },
    );

    expect(radar.items[0]?.urgency).toBe('due-soon');
    expect(radar.items[0]?.daysUntilDue).toBe(1);
  });

  it('does not classify an impossible legacy date as a real deadline', () => {
    const radar = projectCommitmentRadar(
      [
        commitment('invalid-date', {
          progress: '进行中',
          deadline: '2026-02-31',
        }),
      ],
      { now: new Date(2026, 0, 1).getTime() },
    );

    expect(radar.items[0]?.urgency).toBe('unscheduled');
    expect(radar.items[0]?.deadlineAt).toBeUndefined();
  });

  it('builds a completion revision without discarding existing details', () => {
    const completedAt = new Date(2026, 6, 23, 16).getTime();
    const record = commitment(
      'deliver-demo',
      {
        beneficiary: '观众',
        progress: '进行中',
        nextAction: '完成最终检查',
      },
      { status: 'candidate' },
    );

    const update = buildCommitmentCompletionUpdate(record, completedAt);

    expect(update.status).toBe('confirmed');
    expect(update.lastConfirmedAt).toBe(completedAt);
    expect(update.details).toMatchObject({
      beneficiary: '观众',
      progress: '已完成',
      nextAction: '完成最终检查',
    });
    expect(update.details?.completionEvidence).toContain('2026');
  });

  it('validates a structured draft and maps it to one memory record', () => {
    const invalid = planCommitmentMutation({
      digitalHumanId: 'linglan',
      title: ' ',
      beneficiary: '',
      progress: '进行中',
      deadline: '2026-02-31',
      nextAction: '',
      completionEvidence: '',
      content: '',
      visibility: 'internal',
      importance: 7,
    });

    expect(invalid).toEqual({
      ok: false,
      errors: {
        title: '请填写承诺标题',
        beneficiary: '请填写承诺对象',
        deadline: '请输入有效日期，或使用“长期有效”等文字说明',
        nextAction: '请填写下一步行动',
      },
    });

    const valid = planCommitmentMutation({
      digitalHumanId: 'linglan',
      title: '完成夏季直播预告',
      beneficiary: '观众',
      progress: '进行中',
      deadline: '2026-07-30',
      nextAction: '确认最终剪辑',
      completionEvidence: '预告片已发布',
      content: '',
      visibility: 'public',
      importance: 8,
    });

    expect(valid).toMatchObject({
      ok: true,
      mutation: {
        kind: 'create',
        input: {
          digitalHumanId: 'linglan',
          dimension: 'commitment',
          title: '完成夏季直播预告',
          subjectName: '观众',
          content: '确认最终剪辑',
          visibility: 'public',
          details: {
            beneficiary: '观众',
            progress: '进行中',
            deadline: '2026-07-30',
            nextAction: '确认最终剪辑',
            completionEvidence: '预告片已发布',
          },
        },
      },
    });
  });

  it('plans a revision that preserves unrelated commitment details', () => {
    const record = commitment(
      'existing',
      {
        beneficiary: '观众',
        progress: '待开始',
        deadline: '长期有效',
        nextAction: '列出主题',
        completionEvidence: '',
        externalReference: 'campaign-42',
      },
      { visibility: 'internal' },
    );
    const draft = {
      ...commitmentDraftFromRecord(record),
      progress: '进行中',
      nextAction: '完成第一版',
    };

    const result = planCommitmentMutation(draft, record);

    expect(result).toMatchObject({
      ok: true,
      mutation: {
        kind: 'revise',
        id: 'existing',
        update: {
          details: {
            progress: '进行中',
            nextAction: '完成第一版',
            externalReference: 'campaign-42',
          },
        },
      },
    });
  });

  it('only creates broadcast copy for explicit public, unfinished commitments', () => {
    const internal = commitment('internal', {
      beneficiary: '运营组',
      progress: '进行中',
      nextAction: '检查清单',
    });
    const publicRecord = commitment(
      'public',
      {
        beneficiary: '观众',
        progress: '进行中',
        deadline: '2026-07-30',
        nextAction: '发布预告片',
      },
      { title: '夏季特别直播', visibility: 'public' },
    );
    const completed = {
      ...publicRecord,
      details: { ...publicRecord.details, progress: '已完成' },
    };

    expect(planCommitmentBroadcast(internal)).toEqual({
      ok: false,
      reason: '仅可公开承诺能够加入播报队列',
    });
    expect(planCommitmentBroadcast(completed)).toEqual({
      ok: false,
      reason: '已完成承诺无需再次播报',
    });
    expect(planCommitmentBroadcast(publicRecord)).toEqual({
      ok: true,
      text: '关于对观众的承诺“夏季特别直播”：下一步是发布预告片，计划在2026-07-30前完成。',
    });
  });
});
