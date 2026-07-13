import { describe, expect, it } from 'vitest';
import { sanitizeSpeechText } from '../src/utils/sanitizeSpeechText';

describe('sanitizeSpeechText', () => {
  it('removes a complete model-internal audience block', () => {
    expect(
      sanitizeSpeechText(`<audience_low_engagement>
新进来的观众可能还在观望，问候或自我介绍可能有用。
</audience_low_engagement>`),
    ).toBe('');
  });

  it('preserves viewer-facing speech around an internal block', () => {
    expect(
      sanitizeSpeechText(
        '别慌。<live_director>先观察观众反应。</live_director>去关窗。',
      ),
    ).toBe('别慌。 去关窗。');
  });

  it('suppresses an unfinished block during streaming', () => {
    expect(
      sanitizeSpeechText('先关窗。<audience_low_engagement>新观众可能还在观望'),
    ).toBe('先关窗。');
  });

  it('does not remove ordinary comparison symbols', () => {
    expect(sanitizeSpeechText('风速 < 10 米每秒，浪高 > 2 米。')).toBe(
      '风速 < 10 米每秒，浪高 > 2 米。',
    );
  });

  it('removes leaked terminal control fragments at the end of speech', () => {
    expect(sanitizeSpeechText('想走随时退，不想走就坐好。[e~[')).toBe(
      '想走随时退，不想走就坐好。',
    );
  });

  it('removes a long repeated terminal-fragment chain', () => {
    const leaked = Array.from({ length: 50 }, () => '[e~[').join(' ');
    expect(sanitizeSpeechText(`先看官方预警。${leaked}`)).toBe(
      '先看官方预警。',
    );
  });

  it('removes terminal fragments in the middle while preserving Bilibili emoji', () => {
    expect(sanitizeSpeechText('收到[dog] [e~[ 继续看数据。')).toBe(
      '收到[dog] 继续看数据。',
    );
  });

  it('removes ANSI and C0 control characters', () => {
    expect(sanitizeSpeechText('\u001b[31m红色\u001b[0m\u0007提醒')).toBe(
      '红色 提醒',
    );
  });

  it('extracts text from a valid structured response envelope', () => {
    expect(
      sanitizeSpeechText(
        '{"text":"先看官方预警。","emotion":"neutral","motion":"serious_report"}',
      ),
    ).toBe('先看官方预警。');
  });
});
