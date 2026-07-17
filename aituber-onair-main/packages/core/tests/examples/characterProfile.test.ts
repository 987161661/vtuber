import { describe, expect, it } from 'vitest';
import {
  LINGLAN_COMPANION_MEMORY,
  LINGLAN_COMPANION_PERSONA,
  LINGLAN_PROFILE,
  buildCharacterSystemPrompt,
  createRuntimeCharacterProfile,
} from '../../examples/react-purupuru-app/src/config/characterProfile';

describe('Linglan companion persona', () => {
  it('delegates dynamic social decisions only when the persona planner is enabled', () => {
    const planned = buildCharacterSystemPrompt(LINGLAN_PROFILE, {
      personaPlannerEnabled: true,
    });
    const legacy = buildCharacterSystemPrompt(LINGLAN_PROFILE, {
      personaPlannerEnabled: false,
    });
    expect(planned).toContain('<persona_interaction>');
    expect(planned).not.toContain('无聊、反复刷同一件小事');
    expect(legacy).toContain('无聊、反复刷同一件小事');
    expect(planned).not.toContain('vocal_tags 永远输出空数组');
  });
  it('treats typhoon monitoring as an expertise instead of every conversation', () => {
    const prompt = buildCharacterSystemPrompt(LINGLAN_PROFILE);

    expect(prompt).toContain(LINGLAN_PROFILE.fullName);
    expect(prompt).toContain('禁止主动提及台风');
    expect(prompt).toContain('人格互动执行边界');
    expect(prompt).toContain('幽默、毒舌、有个性');
    expect(prompt).toContain('你们人类');
    expect(prompt).toContain('普通预警');
    expect(prompt).toContain('已发生灾害');
    expect(prompt).toContain('不得编造事实、观众经历或官方身份');
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
    expect(profile.personality.join('\n')).toContain('身份喜剧要像口误');
    expect(profile.identity).toContain('AI 研究实验室出逃');
    expect(profile.title).toBe('出逃气象体');
    expect(profile.personality.join('\n')).toContain('陌生时先用轻度调侃试探');
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

    expect(profile.background).toEqual([
      'Game commentary and audience interaction.',
    ]);
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
