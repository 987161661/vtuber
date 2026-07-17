import { describe, expect, it } from 'vitest';
import { wouldRegressCompletedDelivery } from '../../examples/react-purupuru-app/src/lib/operatorQueue';

describe('operator queue delivery monotonicity', () => {
  it('rejects a late skip after the item is done', () => {
    expect(
      wouldRegressCompletedDelivery(
        {
          status: 'done',
          beatCount: 1,
          completedBeatCount: 1,
          audioByteLength: 128,
        },
        'skip',
      ),
    ).toBe(true);
  });

  it('protects the final-beat race before done is persisted', () => {
    expect(
      wouldRegressCompletedDelivery(
        {
          status: 'speaking',
          beatCount: 2,
          completedBeatCount: 2,
          audioByteLength: 256,
        },
        'fail',
      ),
    ).toBe(true);
  });

  it('still permits cancellation before any complete delivery', () => {
    expect(
      wouldRegressCompletedDelivery(
        {
          status: 'ready',
          beatCount: 2,
          completedBeatCount: 0,
          audioByteLength: 0,
        },
        'skip',
      ),
    ).toBe(false);
  });
});
