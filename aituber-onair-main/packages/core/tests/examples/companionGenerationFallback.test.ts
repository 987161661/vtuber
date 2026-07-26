import { describe, expect, it } from 'vitest';
import { buildCompanionGenerationFallback } from '../../examples/react-purupuru-app/src/lib/companionGenerationFallback';

describe('companion generation fallback', () => {
  it('acknowledges a viewer weather observation without inventing new facts', () => {
    expect(
      buildCompanionGenerationFallback({
        text: '深圳已经出太阳了',
        viewerName: '超高级狗肉',
      }),
    ).toBe(
      '@超高级狗肉，收到，你那边已经出太阳了。天气变化快，出门前再看一眼临近预报。',
    );
  });

  it('does not fabricate an answer to a question during provider failure', () => {
    const reply = buildCompanionGenerationFallback({
      text: '这个台风会去哪里？',
      viewerName: '小明',
    });

    expect(reply).toContain('@小明');
    expect(reply).toContain('不瞎编');
  });
});
