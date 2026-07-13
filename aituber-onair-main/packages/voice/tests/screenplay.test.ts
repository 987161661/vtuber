import { describe, expect, it } from 'vitest';
import {
  screenplayToText,
  textsToScreenplay,
  textToScreenplay,
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
