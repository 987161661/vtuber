import { describe, expect, it } from 'vitest';
import { enrichWithHostExtensions } from '../../examples/react-purupuru-app/src/host-extensions/types';

describe('host extensions', () => {
  it('composes independent enrichment results without knowing their product names', async () => {
    const result = await enrichWithHostExtensions(
      [
        {
          id: 'weather',
          enrich: async () => ({
            context: 'weather context',
            skills: ['weather'],
            isDomainSensitive: true,
          }),
        },
        {
          id: 'trivia',
          enrich: async () => ({ context: 'trivia context', skills: ['trivia'] }),
        },
      ],
      { query: 'hello', inheritedSkillIds: [] },
    );

    expect(result.context).toBe('weather context\n\ntrivia context');
    expect(result.skills).toEqual(['weather', 'trivia']);
    expect(result.isDomainSensitive).toBe(true);
  });
});
