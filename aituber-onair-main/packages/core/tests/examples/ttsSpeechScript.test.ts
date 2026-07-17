import { describe, expect, it } from 'vitest';
import { formatTtsSpeechScript } from '../../examples/react-purupuru-app/src/lib/ttsSpeechScript';

describe('formatTtsSpeechScript', () => {
  it('reads calendar years digit by digit while preserving ordinary quantities', () => {
    expect(formatTtsSpeechScript('海神是2026年第11号台风。')).toBe(
      '海神是二零二六年第十一号台风。',
    );
    expect(formatTtsSpeechScript('样本总数是2026个。')).toBe(
      '样本总数是二千零二十六个。',
    );
  });

  it('reads ISO-style dates as natural Mandarin calendar dates', () => {
    expect(formatTtsSpeechScript('记录日期是2026-07-14。')).toBe(
      '记录日期是二零二六年七月十四日。',
    );
  });

  it('adds the omitted spoken unit to apparent temperature', () => {
    expect(formatTtsSpeechScript('南京现在30.8度，体感36，晴间多云。')).toBe(
      '南京现在三十点八度，体感三十六度，晴间多云。',
    );
    expect(formatTtsSpeechScript('体感36℃。')).toBe('体感摄氏三十六度。');
  });

  it('turns visual dash separators into one natural pause', () => {
    expect(formatTtsSpeechScript('先说结论——南京今天晴。')).toBe(
      '先说结论，南京今天晴。',
    );
    expect(formatTtsSpeechScript('风力 6—7 级。')).toBe('风力 六到七 级。');
  });
});
