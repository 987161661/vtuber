import { describe, expect, it, vi } from 'vitest';
import { createTyphoonRadarQueryAdapter } from '../../examples/react-purupuru-app/server/typhoonRadarQueryAdapter';

describe('typhoon radar query adapter', () => {
  it('loads the query module once and reuses it across requests', async () => {
    const queryTyphoonRadar = vi
      .fn()
      .mockResolvedValue({ requiredAnswer: '\u53f0\u98ce\u4e2d\u5fc3\u5728\u60e0\u5dde\u3002' });
    const loadModule = vi.fn().mockResolvedValue({ queryTyphoonRadar });
    const query = createTyphoonRadarQueryAdapter({
      loadModule,
      root: 'D:/typhoon boss radar',
      baseUrl: 'http://127.0.0.1:3038',
    });

    await expect(query('\u53f0\u98ce\u5230\u54ea\u4e86')).resolves.toBe(
      JSON.stringify({ requiredAnswer: '\u53f0\u98ce\u4e2d\u5fc3\u5728\u60e0\u5dde\u3002' }),
    );
    await expect(query('\u73b0\u5728\u4f4d\u7f6e')).resolves.toContain(
      '\u60e0\u5dde',
    );

    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(queryTyphoonRadar).toHaveBeenNthCalledWith(
      1,
      '\u53f0\u98ce\u5230\u54ea\u4e86',
      {
        root: 'D:/typhoon boss radar',
        baseUrl: 'http://127.0.0.1:3038',
      },
    );
  });
});
