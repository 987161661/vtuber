import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../../examples/react-purupuru-app/src/types/settings';
import { createImprovementExperimentContext } from '../../examples/react-purupuru-app/src/lib/improvementExperimentContext';

function settings(): AppSettings {
  return {
    digitalHumans: {
      activeId: 'persona-1',
      profiles: [
        {
          id: 'persona-1',
          displayName: '灵澜',
          title: '主播',
          description: '测试角色',
          voiceSpeaker: 'speaker-a',
          avatarLabel: 'avatar-a',
          enabled: true,
          persona: {
            identity: '可靠的主播',
            liveFocus: '回应观众',
            audienceRelationship: '朋友',
            speakingStyle: '简洁',
            signatureHabit: '先给结论',
            hardBoundaries: '不编造',
          },
          memory: {
            coreIdentity: '',
            relationship: '',
            preferences: '',
            episodes: '',
            commitments: '',
            knowledgeBoundaries: '',
          },
          installedSkillIds: ['weather', 'qa'],
        },
      ],
    },
    soul: { runtimeMode: 'primary' },
    llm: {
      provider: 'openai',
      model: 'gpt-5',
      apiKeys: { openai: 'secret-a' },
    },
    tts: {
      engine: 'openai',
      speaker: 'speaker-a',
    },
    visual: {
      backgroundMode: 'default',
      layoutMode: 'chat',
      showInputInBroadcast: true,
      idleMotionEnabled: true,
      avatarViewX: 0,
      avatarViewY: 0,
      avatarViewScale: 1,
    },
    screenVision: {
      deviceId: '',
      prompt: '描述屏幕',
      autoIntervalMs: 30_000,
      enabled: false,
    },
    stream: {
      platform: 'bilibili',
      youtubeApiKey: '',
      youtubeLiveId: '',
      youtubeEnabled: false,
      youtubeCommentIntervalMs: 1_000,
      twitchClientId: '',
      twitchAccessToken: '',
      twitchChannel: '',
      twitchEnabled: false,
      twitchCommentIntervalMs: 1_000,
      bilibiliEnabled: true,
      bilibiliReplyEnabled: true,
      bilibiliGatewayUrl: 'http://127.0.0.1:8080',
      customSseEndpoint: '',
      customSseEnabled: false,
    },
    socialStream: {
      enabled: false,
      sessionId: '',
      serverUrl: '',
      platforms: [],
    },
    liveConnectors: {
      schemaVersion: 1,
      ordinaryRoad: {
        enabled: true,
        gatewayUrl: 'http://127.0.0.1:8080',
        platforms: {
          bilibili: {
            enabled: true,
            roomId: '1001',
            outbound: {
              viewerReplies: true,
              proactiveSpeech: false,
              operatorBroadcasts: true,
            },
          },
        },
      },
      socialStreamNinja: {
        enabled: false,
        sessionId: '',
        serverUrl: '',
        platforms: {},
      },
    },
    commentIntelligence: {
      enabled: true,
      mode: 'rules',
      useSameLLMSettings: true,
      streamTopic: '',
      streamTitle: '',
      topicFilter: 'off',
      maxCommentsPerBatch: 20,
      analysisIntervalMs: 10_000,
      minCommentsForLLMAnalysis: 5,
      blockHighRiskViewers: true,
      viewerBlockDurationMs: 60_000,
    },
    manneri: {
      enabled: true,
      similarityThreshold: 0.9,
      lookbackWindow: 10,
      interventionCooldownMs: 60_000,
      minMessageLength: 6,
    },
    emptyRoomAwareness: {
      enabled: true,
      audiencePolicy: 'any',
      scheduleEnabled: false,
      scheduleStartHour: 0,
      scheduleEndHour: 0,
      minIntervalMs: 30_000,
      maxIntervalMs: 60_000,
      proactiveCooldownMs: 30_000,
      maxProactiveTurns: 3,
      maxSentences: 2,
      behaviorStrategies: [
        {
          id: 'memory',
          name: '回忆',
          prompt: '分享一段回忆',
          probability: 1,
          enabled: true,
        },
      ],
      interfaceWeight: 1,
      memoryWeight: 1,
      inspirationWeight: 1,
      audienceWeight: 1,
    },
  };
}

const scope = {
  personaId: 'persona-1',
  platform: 'bilibili',
  roomId: '1001',
};

describe('improvement experiment context', () => {
  it('is stable across credentials and presentation-only changes', () => {
    const current = settings();
    const changed = structuredClone(current);
    changed.llm.apiKeys.openai = 'secret-b';
    changed.visual.backgroundMode = 'green';
    changed.visual.avatarViewScale = 1.5;

    expect(
      createImprovementExperimentContext({
        settings: current,
        scope,
        autoBroadcastEnabled: true,
      }),
    ).toEqual(
      createImprovementExperimentContext({
        settings: changed,
        scope,
        autoBroadcastEnabled: true,
      }),
    );
  });

  it('changes when a behaviorally material runtime choice changes', () => {
    const current = settings();
    const changedModel = structuredClone(current);
    changedModel.llm.model = 'gpt-5.1';
    const changedPersona = structuredClone(current);
    changedPersona.digitalHumans.profiles[0].persona.speakingStyle = '活泼';

    const baseline = createImprovementExperimentContext({
      settings: current,
      scope,
      autoBroadcastEnabled: true,
    });

    expect(
      createImprovementExperimentContext({
        settings: changedModel,
        scope,
        autoBroadcastEnabled: true,
      }).id,
    ).not.toBe(baseline.id);
    expect(
      createImprovementExperimentContext({
        settings: changedPersona,
        scope,
        autoBroadcastEnabled: true,
      }).id,
    ).not.toBe(baseline.id);
    expect(
      createImprovementExperimentContext({
        settings: current,
        scope,
        autoBroadcastEnabled: false,
      }).id,
    ).not.toBe(baseline.id);
    expect(baseline.label).toContain('gpt-5');
    expect(baseline.label).toContain('自动播出');
  });
});
