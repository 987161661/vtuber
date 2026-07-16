import { describe, expect, it } from 'vitest';
import {
  buildViewerEntryWelcomePrompt,
  shouldWelcomeViewerEntry,
  SMALL_ROOM_WELCOME_MAX_AUDIENCE,
} from '../../examples/react-purupuru-app/src/lib/viewerEntryWelcome';

describe('viewer entry welcome', () => {
  it('welcomes only a newly observed viewer while the room is small', () => {
    expect(
      shouldWelcomeViewerEntry({
        isNewPresence: true,
        estimatedAudience: SMALL_ROOM_WELCOME_MAX_AUDIENCE,
        recentEntryCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldWelcomeViewerEntry({
        isNewPresence: true,
        estimatedAudience: SMALL_ROOM_WELCOME_MAX_AUDIENCE + 1,
        recentEntryCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldWelcomeViewerEntry({
        isNewPresence: false,
        estimatedAudience: 2,
        recentEntryCount: 1,
      }),
    ).toBe(false);
  });

  it('builds a viewer-specific happy welcome intent without canned copy', () => {
    const prompt = buildViewerEntryWelcomePrompt({
      viewerName: '@小雨',
      platform: 'bilibili',
      estimatedAudience: 3,
    });

    expect(prompt).toContain('<viewer_entry_welcome>');
    expect(prompt).toContain('@小雨');
    expect(prompt).not.toContain('@@小雨');
    expect(prompt).toContain('emotion_intensity 建议 0.6–0.8');
    expect(prompt).toContain('不得假定对方第一次来');
    expect(prompt).not.toContain('欢迎光临');
    expect(prompt?.length).toBeLessThanOrEqual(500);
  });

  it('does not fabricate a target when the platform has no display name', () => {
    expect(
      buildViewerEntryWelcomePrompt({
        viewerName: '   ',
        platform: 'bilibili',
        estimatedAudience: 1,
      }),
    ).toBeNull();
  });
});
