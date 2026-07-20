import { describe, expect, it, vi } from 'vitest';
import {
  AITuberOnAirCore,
  AITuberOnAirCoreEvent,
} from '../../src/core/AITuberOnAirCore';

const voiceSpeak = vi.hoisted(() => vi.fn());

vi.mock('@aituber-onair/chat', () => ({
  ChatServiceFactory: {
    createChatService: vi.fn(() => ({})),
  },
  ChatService: vi.fn(),
  Message: {},
  ChatServiceOptions: {},
  textToSpeechPlan: vi.fn((text: string) => ({
    version: 2,
    beats: [{ text, ttsText: text }],
  })),
  speechPlanToScreenplay: vi.fn((plan) => plan.beats),
  screenplayToText: vi.fn(() => 'hello'),
}));

vi.mock('@aituber-onair/voice', () => ({
  VoiceEngineAdapter: vi.fn(() => ({
    speakText: vi.fn(),
    speak: voiceSpeak,
    stop: vi.fn(),
    updateOptions: vi.fn(),
  })),
  VoiceService: vi.fn(),
  VoiceServiceOptions: {},
  AudioPlayOptions: {},
}));

describe('AITuberOnAirCore speech error ownership', () => {
  it('emits diagnostics and rejects so the speech owner can settle failure', async () => {
    voiceSpeak.mockRejectedValue(new Error('voice provider unavailable'));
    const core = new AITuberOnAirCore({
      apiKey: 'test-key',
      chatOptions: { systemPrompt: 'system' },
      voiceOptions: {
        engineType: 'voicevox',
        speaker: '1',
      },
    });
    const errors: unknown[] = [];
    core.on(AITuberOnAirCoreEvent.ERROR, (error) => errors.push(error));

    await expect(core.speakTextWithOptions('hello')).rejects.toThrow(
      'voice provider unavailable',
    );
    expect(errors).toHaveLength(1);
    expect(voiceSpeak).toHaveBeenCalledTimes(2);
  });
});
