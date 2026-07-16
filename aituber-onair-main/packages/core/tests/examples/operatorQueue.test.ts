import { describe, expect, it } from 'vitest';
import {
  type OperatorQueueItem,
  isStaleReadyReply,
} from '../../examples/react-purupuru-app/src/lib/operatorQueue';

function queueItem(input: Partial<OperatorQueueItem> = {}): OperatorQueueItem {
  return {
    eventId: 'event-1',
    text: '观众问题',
    source: 'bilibili',
    sourcesSeen: ['bilibili'],
    createdAt: 1_000,
    updatedAt: 1_000,
    order: 1,
    status: 'ready',
    preparedReply: '主播回复',
    skills: [],
    ...input,
  };
}

describe('isStaleReadyReply', () => {
  it('drops an old generated reply before it reaches speech', () => {
    expect(isStaleReadyReply(queueItem(), 46_001)).toBe(true);
  });

  it('keeps a fresh generated reply', () => {
    expect(isStaleReadyReply(queueItem(), 46_000)).toBe(false);
  });

  it('never expires an explicit operator broadcast', () => {
    expect(
      isStaleReadyReply(
        queueItem({ source: 'operator-manual' }),
        Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(false);
  });

  it('only evaluates items that are ready to speak', () => {
    expect(isStaleReadyReply(queueItem({ status: 'preparing' }), 100_000)).toBe(
      false,
    );
  });
});
