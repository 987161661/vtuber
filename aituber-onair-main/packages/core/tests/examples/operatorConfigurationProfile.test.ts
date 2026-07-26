import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '../../examples/react-purupuru-app/src/hooks/useSettings';
import {
  assessOperatorSetup,
  exportOperatorConfigurationProfile,
  importOperatorConfigurationProfile,
} from '../../examples/react-purupuru-app/src/lib/operatorConfigurationProfile';

describe('operator configuration profile', () => {
  it('projects the required first-use steps separately from optional platform setup', () => {
    const settings = getDefaultSettings();
    const assessment = assessOperatorSetup(settings);

    expect(assessment.status).toBe('needs-setup');
    expect(assessment.requiredSteps).toBe(3);
    expect(
      assessment.steps.find((step) => step.id === 'platform'),
    ).toMatchObject({
      required: false,
      status: 'ready',
    });

    settings.tts.engine = 'none';
    settings.llm.apiKeys.openai = 'configured';
    expect(assessOperatorSetup(settings)).toMatchObject({
      status: 'ready',
      readyRequiredSteps: 3,
    });
  });

  it('exports model, voice, character and platform choices without credentials', () => {
    const settings = getDefaultSettings();
    settings.llm.apiKeys['openai-compatible'] = 'llm-secret';
    settings.tts.minimaxApiKey = 'tts-secret';
    settings.stream.twitchAccessToken = 'stream-secret';
    settings.stream.platform = 'twitch';
    settings.stream.twitchChannel = 'channel-name';

    const serialized = exportOperatorConfigurationProfile(
      settings,
      '直播配置 A',
      Date.UTC(2026, 6, 23),
    );
    const profile = JSON.parse(serialized);

    expect(profile).toMatchObject({
      kind: 'aituber-operator-configuration',
      schemaVersion: 1,
      name: '直播配置 A',
      security: {
        credentialsIncluded: false,
        importPolicy: 'preserve-local-credentials',
      },
      configuration: {
        llm: {
          provider: settings.llm.provider,
          model: settings.llm.model,
        },
        tts: {
          engine: settings.tts.engine,
          speaker: settings.tts.speaker,
        },
        stream: {
          platform: 'twitch',
          twitchChannel: 'channel-name',
        },
      },
    });
    expect(serialized).not.toContain('llm-secret');
    expect(serialized).not.toContain('tts-secret');
    expect(serialized).not.toContain('stream-secret');
    expect(profile.configuration.llm.apiKeys).toBeUndefined();
    expect(profile.configuration.tts.minimaxApiKey).toBeUndefined();
    expect(profile.configuration.stream.twitchAccessToken).toBeUndefined();
  });

  it('imports portable choices while preserving every local credential', () => {
    const source = getDefaultSettings();
    source.llm.provider = 'openrouter';
    source.llm.model = 'openai/gpt-4.1-mini';
    source.tts.engine = 'none';
    source.tts.voicevoxApiUrl = 'http://voice-host.test:50021';
    source.stream.platform = 'custom-sse';
    source.stream.customSseEndpoint = 'https://events.example.test/live';
    source.digitalHumans.profiles[0].displayName = '新角色';
    source.liveConnectors.ordinaryRoad.platforms.custom = {
      enabled: true,
      roomId: 'custom-room',
      outbound: {
        viewerReplies: true,
        proactiveSpeech: false,
        operatorBroadcasts: false,
      },
    };

    const target = getDefaultSettings();
    target.llm.apiKeys.openrouter = 'local-llm-secret';
    target.tts.minimaxApiKey = 'local-tts-secret';
    target.stream.youtubeApiKey = 'local-stream-secret';

    const result = importOperatorConfigurationProfile(
      exportOperatorConfigurationProfile(source, '巡演档案'),
      target,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe('巡演档案');
    expect(result.settings.llm).toMatchObject({
      provider: 'openrouter',
      model: 'openai/gpt-4.1-mini',
    });
    expect(result.settings.tts.engine).toBe('none');
    expect(result.settings.tts.voicevoxApiUrl).toBe(
      'http://voice-host.test:50021',
    );
    expect(result.settings.stream).toMatchObject({
      platform: 'custom-sse',
      customSseEndpoint: 'https://events.example.test/live',
    });
    expect(result.settings.digitalHumans.profiles[0].displayName).toBe(
      '新角色',
    );
    expect(
      result.settings.liveConnectors.ordinaryRoad.platforms.custom,
    ).toMatchObject({
      enabled: true,
      roomId: 'custom-room',
    });
    expect(result.settings.llm.apiKeys.openrouter).toBe('local-llm-secret');
    expect(result.settings.tts.minimaxApiKey).toBe('local-tts-secret');
    expect(result.settings.stream.youtubeApiKey).toBe('local-stream-secret');
  });

  it('ignores injected secret and unknown fields instead of widening the schema', () => {
    const current = getDefaultSettings();
    current.tts.minimaxApiKey = 'keep-me';
    const serialized = exportOperatorConfigurationProfile(
      getDefaultSettings(),
      '外部档案',
    );
    const profile = JSON.parse(serialized);
    profile.configuration.tts.minimaxApiKey = 'replace-me';
    profile.configuration.tts.futureProviderFlag = true;

    const result = importOperatorConfigurationProfile(
      JSON.stringify(profile),
      current,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.tts.minimaxApiKey).toBe('keep-me');
    expect(result.settings.tts).not.toHaveProperty('futureProviderFlag');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('minimaxApiKey'),
        expect.stringContaining('futureProviderFlag'),
      ]),
    );
  });

  it('rejects unsupported versions, enum values and oversized documents', () => {
    const current = getDefaultSettings();
    const base = JSON.parse(
      exportOperatorConfigurationProfile(current, '基础档案'),
    );

    expect(
      importOperatorConfigurationProfile(
        JSON.stringify({ ...base, schemaVersion: 99 }),
        current,
      ),
    ).toMatchObject({ ok: false });

    base.configuration.llm.provider = 'unknown-provider';
    expect(
      importOperatorConfigurationProfile(JSON.stringify(base), current),
    ).toEqual({
      ok: false,
      error: '配置档案包含不支持的模型提供方',
    });

    expect(
      importOperatorConfigurationProfile(' '.repeat(1_000_001), current),
    ).toEqual({
      ok: false,
      error: '配置档案超过 1 MB，已拒绝导入',
    });
  });

  it('keeps the current role when imported role data is structurally incomplete', () => {
    const current = getDefaultSettings();
    current.digitalHumans.profiles[0].displayName = '本机角色';
    const profile = JSON.parse(
      exportOperatorConfigurationProfile(getDefaultSettings(), '损坏角色档案'),
    );
    delete profile.configuration.digitalHumans.profiles[0].persona.identity;

    const result = importOperatorConfigurationProfile(
      JSON.stringify(profile),
      current,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.digitalHumans.profiles[0].displayName).toBe(
      '本机角色',
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('没有可用角色')]),
    );
  });
});
