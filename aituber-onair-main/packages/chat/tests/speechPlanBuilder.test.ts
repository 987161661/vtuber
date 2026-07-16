import { describe, expect, it } from 'vitest';
import { buildSpeechPlanV2 } from '../src/utils/speechPlanBuilder';

const unsafeMarkup = /<\/?[a-z]|```|\*\*|__|~~|\[e~\[/i;

describe('buildSpeechPlanV2', () => {
  it('builds a complete one-beat plan from plain text', () => {
    expect(buildSpeechPlanV2('Hello, everyone.')).toEqual({
      version: 2,
      beats: [
        {
          text: 'Hello, everyone.',
          ttsText: 'Hello, everyone.',
          emotion: 'neutral',
          delivery: 'natural',
          emotionIntensity: 0.5,
          prosody: undefined,
          pauseAfterMs: 0,
          motion: 'idle_cold',
          gaze: 'camera',
          gesture: 'subtle',
          interruptibleAfter: true,
        },
      ],
    });
  });

  it('splits Chinese punctuation into safe interruptible beats', () => {
    const plan = buildSpeechPlanV2('你们来了。我还挺开心的！那就多坐一会儿？', {
      emotion: 'happy',
      delivery: 'warm',
    });

    expect(plan.beats.map((beat) => beat.text)).toEqual([
      '你们来了。',
      '我还挺开心的！',
      '那就多坐一会儿？',
    ]);
    expect(plan.beats.every((beat) => beat.interruptibleAfter)).toBe(true);
    expect(plan.beats.map((beat) => beat.pauseAfterMs)).toEqual([180, 180, 0]);
  });

  it('splits English sentences without splitting decimal numbers', () => {
    const plan = buildSpeechPlanV2(
      'Wind is 3.14 meters per second. Stay inside! Are you ready?',
    );

    expect(plan.beats.map((beat) => beat.text)).toEqual([
      'Wind is 3.14 meters per second.',
      'Stay inside!',
      'Are you ready?',
    ]);
  });

  it('bounds oversized text to three beats and marks truncation', () => {
    const plan = buildSpeechPlanV2('很长'.repeat(300));
    const combined = plan.beats.map((beat) => beat.text).join('');

    expect(plan.beats).toHaveLength(3);
    expect([...combined]).toHaveLength(360);
    expect(combined.endsWith('…')).toBe(true);
    expect(plan.beats.every((beat) => [...beat.text].length <= 120)).toBe(true);
  });

  it('removes control markup and substitutes safe content when none remains', () => {
    const mixed = buildSpeechPlanV2(
      '<thinking>never speak this</thinking> **你好** [链接](https://example.com) ```',
    );
    const empty = buildSpeechPlanV2(
      '<director>private plan</director><reasoning>secret</reasoning>',
    );

    expect(mixed.beats[0].text).toBe('你好 链接');
    expect(mixed.beats[0].ttsText).toBe('你好 链接');
    expect(unsafeMarkup.test(mixed.beats[0].text)).toBe(false);
    expect(empty.beats[0].text).toBe('…');
    expect(buildSpeechPlanV2('   ').beats[0].text).toBe('…');
  });

  it('rejects structured model envelopes instead of trusting their text', () => {
    const plan = buildSpeechPlanV2(
      '{"version":2,"beats":[{"text":"model-controlled"}]}',
    );

    expect(plan.beats).toHaveLength(1);
    expect(plan.beats[0].text).toBe('…');
  });

  it('allowlists enums and clamps numeric hints', () => {
    const plan = buildSpeechPlanV2('测试。', {
      emotion: 'ecstatic',
      delivery: 'shouting',
      emotionIntensity: 3,
      prosody: {
        pace: -5,
        pitch: 5,
        volume: Number.NaN,
        warmth: 0.4,
        unknown: 1,
      },
      pauseAfterMs: 3000.4,
      motion: 'spin_forever',
      gaze: 'behind',
      gesture: 'chaotic',
    });

    expect(plan.beats[0]).toMatchObject({
      emotion: 'neutral',
      delivery: 'natural',
      emotionIntensity: 1,
      prosody: { pace: -1, pitch: 1, warmth: 0.4 },
      pauseAfterMs: 2500,
      motion: 'idle_cold',
      gaze: 'camera',
      gesture: 'subtle',
    });
    expect(plan.beats[0].prosody).not.toHaveProperty('volume');
    expect(plan.beats[0].prosody).not.toHaveProperty('unknown');
  });

  it('never emits more than three beats for many short sentences', () => {
    const plan = buildSpeechPlanV2('一。二。三。四。五。六。七。八。九。十。');

    expect(plan.beats).toHaveLength(3);
    expect(plan.beats.map((beat) => beat.text).join('')).toBe(
      '一。二。三。四。五。六。七。八。九。十。',
    );
  });

  it('is deterministic for identical text and hints', () => {
    const hints = {
      emotion: 'serious',
      delivery: 'calm',
      prosody: { pace: -0.2, tension: 0.4 },
      motion: 'serious_report',
    };
    const text = '先听我说完。Then make your choice.';

    expect(buildSpeechPlanV2(text, hints)).toEqual(
      buildSpeechPlanV2(text, hints),
    );
  });
});
