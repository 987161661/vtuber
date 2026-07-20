import { describe, expect, it } from 'vitest';
import {
  buildViewerEntryWelcomePrompt,
  shouldWelcomeViewerEntry,
  SMALL_ROOM_WELCOME_MAX_AUDIENCE,
} from '../../examples/react-purupuru-app/src/lib/viewerEntryWelcome';

describe('viewer entry welcome', () => {
  it('welcomes every newly observed named viewer regardless of room size', () => {
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
    ).toBe(true);
    expect(
      shouldWelcomeViewerEntry({
        isNewPresence: false,
        estimatedAudience: 2,
        recentEntryCount: 1,
      }),
    ).toBe(false);
  });

  it('builds a viewer-specific nickname-and-banter welcome intent', () => {
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
    expect(prompt).toContain('欢迎 + 昵称化称呼 + 轻度调侃');
    expect(prompt).toContain('没有地域事实，不得猜测 IP');
    expect(prompt).not.toContain('欢迎光临');
    expect(prompt?.length).toBeLessThanOrEqual(1_200);
  });

  it('allows only a supplied platform location to ground regional banter', () => {
    const prompt = buildViewerEntryWelcomePrompt({
      viewerName: '渴死的鱼',
      platform: 'bilibili',
      estimatedAudience: 2,
      viewerLocation: '北京',
    });

    expect(prompt).toContain('平台提供的地域标签：北京');
    expect(prompt).toContain('不能凭城市刻板印象编天气');
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
