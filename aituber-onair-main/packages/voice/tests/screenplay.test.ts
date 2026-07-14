import { describe, expect, it } from 'vitest';
import {
  speechPlanToScreenplay,
  screenplayToText,
  textsToScreenplay,
  textToScreenplay,
  textToSpeechPlan,
} from '../src/utils/screenplay';

describe('screenplay utilities', () => {
  it('should convert text with emotion tag to chat screenplay', () => {
    expect(textToScreenplay('[happy] Hello')).toEqual({
      emotion: 'happy',
      text: 'Hello',
    });
  });

  it('should convert plain text to chat screenplay', () => {
    expect(textToScreenplay('Hello')).toEqual({
      text: 'Hello',
    });
  });

  it('extracts structured speech from a fenced JSON response', () => {
    expect(
      textToScreenplay(
        '```json\n{"text":"安徽目前主要防强降雨。","emotion":"serious"}\n```',
      ),
    ).toMatchObject({
      text: '安徽目前主要防强降雨。',
      emotion: 'neutral',
    });
  });

  it('ignores symbols appended after a structured response', () => {
    expect(
      textToScreenplay('{"text":"我会直接回答。","emotion":"happy"} ### }}}'),
    ).toMatchObject({
      text: '我会直接回答。',
      emotion: 'happy',
    });
  });

  it('should convert multiple texts to chat screenplay entries', () => {
    expect(textsToScreenplay(['[sad] Bye', 'Hello'])).toEqual([
      {
        emotion: 'sad',
        text: 'Bye',
      },
      {
        text: 'Hello',
      },
    ]);
  });

  it('should convert chat screenplay back to text', () => {
    expect(screenplayToText({ emotion: 'angry', text: 'Stop' })).toBe(
      '[angry] Stop',
    );
    expect(screenplayToText({ text: 'Hello' })).toBe('Hello');
  });
});

describe('SpeechPlanV2', () => {
  it('parses up to three independently directed beats', () => {
    const plan = textToSpeechPlan(
      JSON.stringify({
        version: 2,
        beats: [
          {
            text: '我先看一下。',
            emotion: 'neutral',
            delivery: 'natural',
            emotion_intensity: 0.4,
            motion: 'idle_cold',
            gaze: 'down',
            gesture: 'still',
            pause_after_ms: 300,
            interruptible_after: true,
          },
          {
            text: '现在能确认的是这一点。',
            emotion: 'relaxed',
            delivery: 'serious',
            emotion_intensity: 0.65,
            motion: 'serious_report',
            gaze: 'camera',
            gesture: 'subtle',
            pause_after_ms: 0,
            interruptible_after: true,
          },
        ],
      }),
    );

    expect(plan.version).toBe(2);
    expect(plan.beats).toHaveLength(2);
    expect(plan.beats[0]).toMatchObject({
      text: '我先看一下。',
      gaze: 'down',
      pauseAfterMs: 300,
      interruptibleAfter: true,
    });
    expect(speechPlanToScreenplay(plan).text).toBe(
      '我先看一下。 现在能确认的是这一点。',
    );
  });

  it('wraps legacy structured output as one interruptible beat', () => {
    const plan = textToSpeechPlan(
      '{"text":"旧格式继续工作。","emotion":"happy"}',
    );
    expect(plan).toMatchObject({
      version: 2,
      beats: [
        {
          text: '旧格式继续工作。',
          emotion: 'happy',
          interruptibleAfter: true,
        },
      ],
    });
  });

  it('falls back to legacy text when the plan exceeds three beats', () => {
    const raw = JSON.stringify({
      version: 2,
      beats: [1, 2, 3, 4].map((index) => ({ text: String(index) })),
    });
    const plan = textToSpeechPlan(raw);
    expect(plan.beats).toHaveLength(1);
    expect(plan.beats[0].text).toContain('"version":2');
  });
});
