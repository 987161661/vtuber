import { describe, expect, it, vi } from 'vitest';
import { createSingleFlightRunner } from '../../examples/react-purupuru-app/src/lib/singleFlight';

describe('single-flight runner', () => {
  it('coalesces overlapping runs and allows the next run after settlement', async () => {
    let release: (() => void) | undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const run = createSingleFlightRunner(task);

    const first = run();
    const overlapping = run();

    expect(task).toHaveBeenCalledTimes(1);
    expect(overlapping).toBe(first);

    release!();
    await first;
    const next = run();

    expect(task).toHaveBeenCalledTimes(2);
    release!();
    await next;
  });
});
