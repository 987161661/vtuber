const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNITS = ['', '十', '百', '千'];

function integerToChinese(value: number): string {
  if (value === 0) return DIGITS[0];
  if (!Number.isSafeInteger(value) || value > 9_999) {
    return String(value)
      .split('')
      .map((digit) => DIGITS[Number(digit)] || digit)
      .join('');
  }
  let remaining = value;
  let unitIndex = 0;
  let output = '';
  let needsZero = false;
  while (remaining > 0) {
    const digit = remaining % 10;
    if (digit === 0) {
      if (output) needsZero = true;
    } else {
      output = `${digit === 1 && unitIndex === 1 && remaining === 1 ? '' : DIGITS[digit]}${UNITS[unitIndex]}${needsZero ? DIGITS[0] : ''}${output}`;
      needsZero = false;
    }
    remaining = Math.floor(remaining / 10);
    unitIndex += 1;
  }
  return output;
}

function numberToChinese(raw: string): string {
  const negative = raw.startsWith('-');
  const [integerPart, decimalPart] = (negative ? raw.slice(1) : raw).split('.');
  const integer = Number(integerPart);
  if (!Number.isFinite(integer)) return raw;
  const decimal = decimalPart
    ? `点${decimalPart
        .split('')
        .map((digit) => DIGITS[Number(digit)] || digit)
        .join('')}`
    : '';
  return `${negative ? '负' : ''}${integerToChinese(integer)}${decimal}`;
}

function spokenTime(hours: string, minutes: string): string {
  const hour = numberToChinese(String(Number(hours)));
  const minuteValue = Number(minutes);
  if (minuteValue === 0) return `${hour}点整`;
  return `${hour}点${numberToChinese(String(minuteValue))}分`;
}

/** Convert notation-heavy factual text into a Mandarin broadcast script for TTS. */
export function formatTtsSpeechScript(input: string): string {
  let text = input;
  text = text.replace(
    /(\d{4})-(\d{1,2})-(\d{1,2})/g,
    (_match, year, month, day) =>
      `${numberToChinese(year)}年${numberToChinese(month)}月${numberToChinese(day)}日`,
  );
  text = text.replace(
    /(\d{1,2})\/(\d{1,2})(?=\s+\d{1,2}:\d{2})/g,
    (_match, month, day) =>
      `${numberToChinese(month)}月${numberToChinese(day)}日`,
  );
  text = text.replace(/(\d{1,2}):(\d{2})/g, (_match, hour, minute) =>
    spokenTime(hour, minute),
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*°?\s*([NS])/gi,
    (_match, value, hemisphere) =>
      `${hemisphere.toUpperCase() === 'N' ? '北纬' : '南纬'}${numberToChinese(value)}度`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*°?\s*([EW])/gi,
    (_match, value, hemisphere) =>
      `${hemisphere.toUpperCase() === 'E' ? '东经' : '西经'}${numberToChinese(value)}度`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*°C/gi,
    (_match, value) => `摄氏${numberToChinese(value)}度`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*%/g,
    (_match, value) => `百分之${numberToChinese(value)}`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*m\/s/gi,
    (_match, value) => `每秒${numberToChinese(value)}米`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*km\/h/gi,
    (_match, value) => `每小时${numberToChinese(value)}千米`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*hPa/gi,
    (_match, value) => `${numberToChinese(value)}百帕`,
  );
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*km\b/gi,
    (_match, value) => `${numberToChinese(value)}千米`,
  );
  text = text.replace(/\bBJT\b/gi, '北京时间');
  text = text.replace(/\bUTC\b/gi, '协调世界时');
  text = text.replace(/\bGFS\b/g, 'G F S');
  text = text.replace(/\bECMWF\b/g, 'E C M W F');
  text = text.replace(/\bNOAA\b/g, '诺阿');
  text = text.replace(
    /(-?\d+(?:\.\d+)?)\s*(?:-|~|至)\s*(-?\d+(?:\.\d+)?)/g,
    (_match, start, end) =>
      `${numberToChinese(start)}到${numberToChinese(end)}`,
  );
  text = text.replace(/\//g, '，');
  text = text.replace(
    /(?<![\d一二三四五六七八九十])(-|—)(?![\d一二三四五六七八九十])/g,
    '到',
  );
  text = text.replace(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g, (value) =>
    numberToChinese(value),
  );
  return text.replace(/\s+/g, ' ').trim();
}
