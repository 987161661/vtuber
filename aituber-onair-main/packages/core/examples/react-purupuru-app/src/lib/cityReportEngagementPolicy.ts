export type CityReportRuntimeMode = 'legacy' | 'shadow' | 'canary' | 'primary';

export interface CityReportEngagementPayload {
  eventId: string;
  text: string;
  directReply?: string;
  viewerName?: string;
}

export interface NormalizedCityReportEngagementPayload
  extends CityReportEngagementPayload {
  isCityReportResult: boolean;
  legacySupportRequestRemoved: boolean;
}

const CITY_REPORT_EVENT_PREFIX = 'city-engagement:';
const CITY_REPORT_TAG = '<city_report_engagement>';
const LEGACY_SUPPORT_COUPLING_SIGNAL =
  /(?:请.{0,12}(?:关注|点赞|送礼|支持)|自然邀请.{0,12}(?:关注|点赞)|点个关注|谢谢关注|关注依据|followEvidence|subscribe\s+(?:now|please)|follow\s+(?:me|the\s+(?:host|channel))|like\s+(?:this|the\s+(?:stream|video)))/iu;

function boundedField(value: string | undefined, maxLength = 40): string {
  const normalized = Array.from(
    (value ?? '').normalize('NFKC').replace(/[<>]/gu, ' '),
    (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    },
  ).join('');
  return normalized.replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function fieldFromEnvelope(text: string, label: string): string {
  const match = text.match(
    new RegExp(`${label}：?\\s*([^；;\\r\\n<]{1,48})`, 'u'),
  );
  return boundedField(match?.[1]);
}

export function isCityReportEngagementPayload(input: {
  eventId: string;
  text: string;
}): boolean {
  return (
    input.eventId.startsWith(CITY_REPORT_EVENT_PREFIX) ||
    input.text.includes(CITY_REPORT_TAG)
  );
}

/**
 * City weather chat must reach Soul as evidence-backed context, never as a
 * canned ready-to-play acknowledgement. Stale CTA lines are removed without
 * discarding current weather facts or safety instructions.
 */
export function normalizeCityReportEngagementPayload(
  input: CityReportEngagementPayload,
  runtimeMode: CityReportRuntimeMode,
): NormalizedCityReportEngagementPayload {
  if (!isCityReportEngagementPayload(input)) {
    return {
      ...input,
      isCityReportResult: false,
      legacySupportRequestRemoved: false,
    };
  }

  const sourceText = `${input.text}\n${input.directReply ?? ''}`;
  const viewerName = boundedField(
    fieldFromEnvelope(sourceText, '目标观众') || input.viewerName,
  ).replace(/^@+/u, '');
  const legacySupportRequestRemoved =
    LEGACY_SUPPORT_COUPLING_SIGNAL.test(sourceText);
  const safeText = input.text
    .split(/\r?\n/u)
    .filter((line) => !LEGACY_SUPPORT_COUPLING_SIGNAL.test(line))
    .join('\n')
    .replace(/<\/city_report_engagement>/u, '行动约束：不得索取关注、点赞、礼物或其他支持。\n</city_report_engagement>');

  void runtimeMode;

  return {
    ...input,
    text: safeText,
    directReply: undefined,
    viewerName: viewerName || input.viewerName,
    isCityReportResult: true,
    legacySupportRequestRemoved,
  };
}
