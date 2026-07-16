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

function cityFromSpokenLine(text: string): string {
  const match = text.match(
    /(?:^|[，,。.!！？?])\s*([^，,。.!！？?]{2,40}?)的战报已经展开/u,
  );
  return boundedField(match?.[1]);
}

function safeAcknowledgement(viewerName: string, cityName: string): string {
  const addressee = viewerName ? `@${viewerName.replace(/^@+/u, '')}，` : '';
  return cityName
    ? `${addressee}${cityName}的战报已经展开了。`
    : `${addressee}城市战报已经展开了。`;
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
 * Converts both current and stale radar payloads into a result event. Legacy,
 * shadow and canary retain a neutral ready-to-play acknowledgement. Primary
 * removes that bypass so Soul can evaluate the event, while the event-level
 * eligibility flag prevents this result from authorizing a CTA in the same
 * turn.
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
  const cityName =
    fieldFromEnvelope(sourceText, '已展开城市') ||
    cityFromSpokenLine(sourceText);
  const directReply = safeAcknowledgement(viewerName, cityName);
  const legacySupportRequestRemoved =
    LEGACY_SUPPORT_COUPLING_SIGNAL.test(sourceText);
  const canonicalText = `<city_report_engagement>
事件：城市战报已经成功展开。
${viewerName ? `目标观众：@${viewerName}\n` : ''}${cityName ? `已展开城市：${cityName}\n` : ''}行动约束：本事件只证明城市卡片已展开，不包含观众关系状态，也不授权在本轮索取任何支持。其他行动只能由主播运行时依据长期目标和当前状态独立决定。
</city_report_engagement>`;

  return {
    ...input,
    text: canonicalText,
    directReply: runtimeMode === 'primary' ? undefined : directReply,
    viewerName: viewerName || input.viewerName,
    isCityReportResult: true,
    legacySupportRequestRemoved,
  };
}
