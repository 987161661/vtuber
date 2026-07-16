import { describe, expect, it } from 'vitest';
import {
  discardRuntimeCredentialsForBrowser,
  hasRawRuntimeCredential,
  mergeBrowserOnlyCredentialsAfterPublish,
  redactRuntimeSettingsForAudit,
  resolveBrowserCredential,
  sanitizeRuntimeSettingsForBrowser,
  sanitizeRuntimeSettingsForBrowserStorage,
  SERVER_MANAGED_CREDENTIAL,
  summarizeRuntimeSettingsForAudit,
} from '../../examples/react-purupuru-app/src/lib/runtimeSettingsSecurity';

const settings = {
  llm: {
    provider: 'openai-compatible',
    model: 'MiniMax-M3',
    endpoint: 'https://api.minimaxi.com/v1/chat/completions',
    apiKeys: {
      openai: 'openai-secret',
      'openai-compatible': 'minimax-secret',
    },
  },
  tts: {
    engine: 'minimax',
    minimaxApiKey: 'tts-secret',
    elevenLabsApiKey: 'eleven-secret',
    speaker: 'voice-id',
  },
  stream: { youtubeApiKey: 'youtube-secret', platform: 'youtube' },
};

describe('runtime settings security', () => {
  it('publishes gateway markers without returning raw credentials', () => {
    const result = sanitizeRuntimeSettingsForBrowser(
      settings,
      'http://127.0.0.1:5173/',
    ) as typeof settings;

    expect(result.llm.endpoint).toBe(
      'http://127.0.0.1:5173/api/minimax-chat',
    );
    expect(result.llm.apiKeys['openai-compatible']).toBe(
      SERVER_MANAGED_CREDENTIAL,
    );
    expect(result.llm.apiKeys.openai).toBe('');
    expect(result.tts.minimaxApiKey).toBe(SERVER_MANAGED_CREDENTIAL);
    expect(result.tts.elevenLabsApiKey).toBe('');
    expect(result.stream.youtubeApiKey).toBe('');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('does not create a gateway marker for unrelated endpoints', () => {
    const result = sanitizeRuntimeSettingsForBrowser(
      {
        ...settings,
        llm: {
          ...settings.llm,
          endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        },
      },
      'http://127.0.0.1:5173',
    ) as typeof settings;

    expect(result.llm.endpoint).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
    expect(result.llm.apiKeys['openai-compatible']).toBe('');
  });

  it('publishes one server-held MiniMax key to both chat and TTS gateways', () => {
    const result = sanitizeRuntimeSettingsForBrowser(
      {
        ...settings,
        tts: { ...settings.tts, minimaxApiKey: '' },
      },
      'http://127.0.0.1:5173',
    ) as typeof settings;

    expect(result.llm.apiKeys['openai-compatible']).toBe(
      SERVER_MANAGED_CREDENTIAL,
    );
    expect(result.tts.minimaxApiKey).toBe(SERVER_MANAGED_CREDENTIAL);
  });

  it('keeps server-managed markers stable without treating them as raw keys', () => {
    const managed = sanitizeRuntimeSettingsForBrowser(
      {
        ...settings,
        llm: {
          ...settings.llm,
          endpoint: 'http://127.0.0.1:5173/api/minimax-chat',
          apiKeys: {
            ...settings.llm.apiKeys,
            'openai-compatible': SERVER_MANAGED_CREDENTIAL,
          },
        },
        tts: {
          ...settings.tts,
          minimaxApiKey: SERVER_MANAGED_CREDENTIAL,
        },
      },
      'http://127.0.0.1:5173',
    ) as typeof settings;

    expect(managed.llm.apiKeys['openai-compatible']).toBe(
      SERVER_MANAGED_CREDENTIAL,
    );
    expect(managed.tts.minimaxApiKey).toBe(SERVER_MANAGED_CREDENTIAL);
    expect(resolveBrowserCredential(SERVER_MANAGED_CREDENTIAL)).toBe('');
    expect(hasRawRuntimeCredential(managed)).toBe(false);

    const stored = sanitizeRuntimeSettingsForBrowserStorage(
      managed,
      'http://127.0.0.1:5173',
    );
    expect(stored.llm.apiKeys['openai-compatible']).toBe(
      SERVER_MANAGED_CREDENTIAL,
    );
    expect(stored.tts.minimaxApiKey).toBe(SERVER_MANAGED_CREDENTIAL);
  });

  it('creates a browser-storage snapshot with no raw credentials', () => {
    const stored = sanitizeRuntimeSettingsForBrowserStorage(
      settings,
      'http://127.0.0.1:5173',
    ) as typeof settings;
    const serialized = JSON.stringify(stored);

    expect(serialized).not.toContain('secret');
    expect(stored.llm.apiKeys.openai).toBe('');
    expect(stored.llm.apiKeys['openai-compatible']).toBe('');
    expect(stored.tts.minimaxApiKey).toBe('');
    expect(hasRawRuntimeCredential(settings)).toBe(true);
    expect(hasRawRuntimeCredential(stored)).toBe(false);
  });

  it('does not manufacture managed status when a private handoff fails', () => {
    const discarded = discardRuntimeCredentialsForBrowser(settings) as typeof settings;

    expect(discarded.llm.apiKeys['openai-compatible']).toBe('');
    expect(discarded.tts.minimaxApiKey).toBe('');
    expect(JSON.stringify(discarded)).not.toContain('secret');
  });

  it('drops server-managed raw keys but retains browser-only keys in memory', () => {
    const published = sanitizeRuntimeSettingsForBrowser(
      settings,
      'http://127.0.0.1:5173',
    ) as typeof settings;
    const browserState = mergeBrowserOnlyCredentialsAfterPublish(
      published,
      settings,
    );

    expect(browserState.llm.apiKeys['openai-compatible']).toBe(
      SERVER_MANAGED_CREDENTIAL,
    );
    expect(browserState.tts.minimaxApiKey).toBe(SERVER_MANAGED_CREDENTIAL);
    expect(browserState.llm.apiKeys.openai).toBe('openai-secret');
    expect(browserState.tts.elevenLabsApiKey).toBe('eleven-secret');
  });

  it('redacts audit snapshots recursively', () => {
    const result = redactRuntimeSettingsForAudit(settings);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('minimax-secret');
    expect(serialized).not.toContain('youtube-secret');
    expect(serialized).toContain('[configured]');
  });

  it('reduces audit settings to a bounded non-secret summary', () => {
    const result = summarizeRuntimeSettingsForAudit({
      ...settings,
      digitalHumans: {
        activeId: 'linglan',
        profiles: [{ id: 'linglan', systemPrompt: 'x'.repeat(100_000) }],
      },
      soul: { runtimeMode: 'shadow' },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      llm: {
        provider: 'openai-compatible',
        model: 'MiniMax-M3',
        endpointHost: 'api.minimaxi.com',
        credentialConfigured: true,
      },
      digitalHuman: { activeId: 'linglan', profileCount: 1 },
      soulRuntimeMode: 'shadow',
    });
    expect(serialized.length).toBeLessThan(1_000);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('systemPrompt');
  });
});
