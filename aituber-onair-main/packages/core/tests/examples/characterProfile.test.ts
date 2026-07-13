import { describe, expect, it } from 'vitest';
import {
  LINGLAN_COMPANION_MEMORY,
  LINGLAN_COMPANION_PERSONA,
  LINGLAN_PROFILE,
  buildCharacterSystemPrompt,
  createRuntimeCharacterProfile,
} from '../../examples/react-purupuru-app/src/config/characterProfile';

describe('Linglan companion persona', () => {
  it('treats typhoon monitoring as an expertise instead of every conversation', () => {
    const prompt = buildCharacterSystemPrompt(LINGLAN_PROFILE);

    expect(prompt).toContain(LINGLAN_PROFILE.fullName);
    expect(prompt).toContain('不要强行转回台风');
    expect(prompt).toContain('日常陪伴、事业心与关系曲线');
    expect(prompt).toContain('陪伴不是解决问题');
    expect(prompt).toContain('不要抱怨没人或乞求弹幕');
  });

  it('preserves the full character arc when runtime persona fields are applied', () => {
    const profile = createRuntimeCharacterProfile({
      id: LINGLAN_PROFILE.id,
      displayName: LINGLAN_PROFILE.displayName,
      title: LINGLAN_PROFILE.title,
      description: '高冷女皇型陪伴主播',
      voiceSpeaker: LINGLAN_PROFILE.voice.defaultSpeaker,
      persona: LINGLAN_COMPANION_PERSONA,
      memory: LINGLAN_COMPANION_MEMORY,
    });

    expect(profile.background.length).toBeGreaterThan(4);
    expect(profile.personality.length).toBeGreaterThan(6);
    expect(profile.habits.length).toBeGreaterThan(6);
    expect(profile.personality.join('\n')).toContain('插科打诨');
    expect(profile.personality.join('\n')).toContain('陌生时礼貌疏离');
    expect(profile.habits.join('\n')).toContain('冷的笑话');
  });

  it('keeps a non-Linglan profile free of Linglan-specific story defaults', () => {
    const profile = createRuntimeCharacterProfile({
      id: 'demo-host',
      displayName: 'Demo Host',
      title: 'Game Streamer',
      description: 'An independent game-focused virtual host.',
      voiceSpeaker: 'Chinese (Mandarin)_Wise_Women',
      persona: {
        identity: 'An upbeat game-focused virtual host.',
        liveFocus: 'Game commentary and audience interaction.',
        audienceRelationship: 'Welcomes viewers as respectful guests.',
        speakingStyle: 'Warm, direct, and playful.',
        signatureHabit: 'Notices clever game decisions.',
        hardBoundaries: 'Do not invent facts or reveal private data.',
      },
      memory: {
        coreIdentity: 'Demo Host is an independent virtual host.',
        relationship: 'Friendly and bounded.',
        preferences: 'Strategy games.',
        episodes: 'Won a difficult tournament.',
        commitments: 'Respect safety and privacy.',
        knowledgeBoundaries: 'State uncertainty clearly.',
      },
    });

    expect(profile.background).toEqual(['Game commentary and audience interaction.']);
    expect(profile.personality).toEqual([
      'Welcomes viewers as respectful guests.',
      'Warm, direct, and playful.',
    ]);
    expect(profile.studio).toBe('Demo Host直播间');

    const prompt = buildCharacterSystemPrompt(profile);
    expect(prompt).toContain('Game commentary and audience interaction.');
    expect(prompt).not.toContain('凌岚');
  });
});
