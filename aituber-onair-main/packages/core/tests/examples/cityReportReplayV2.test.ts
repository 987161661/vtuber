import { describe, expect, it } from 'vitest';
import {
  composeDeterministicCityReply,
  type CityReportPayloadV2,
  validateCityReportBinding,
} from '../../examples/react-purupuru-app/src/lib/cityReportIsolation';
import {
  createTurnEnvelopeV2,
  matchesTurnAttempt,
} from '../../examples/react-purupuru-app/src/lib/turnEnvelope';

const cities = ['北京', '南京', '安顺', '青岛', '成都', '广州', '杭州', '武汉'];
const viewers = [
  '小雨',
  '阿明',
  '云朵',
  '北辰',
  '青禾',
  '木木',
  '海风',
  '南星',
];

function payloadAt(index: number): CityReportPayloadV2 {
  const city = cities[index % cities.length];
  const viewerName = viewers[index % viewers.length];
  const temperature = String(18 + (index % 12));
  return {
    version: 2,
    eventId: `city-engagement:${index}`,
    viewerId: `viewer-${index % viewers.length}`,
    viewerName,
    city,
    factsText: `实况多云，气温${temperature}℃`,
    sourceNames: ['fixed-replay'],
    viewerQuestion: `${city}现在天气怎样？`,
    allowedNumbers: [temperature],
  };
}

describe('TurnEnvelopeV2 100-turn interleaved replay', () => {
  it('keeps viewer, city and facts bound when callbacks return in reverse order', () => {
    const turns = Array.from({ length: 100 }, (_, index) => {
      const payload = payloadAt(index);
      return {
        payload,
        envelope: createTurnEnvelopeV2({
          eventId: payload.eventId,
          attemptId: `${payload.eventId}:attempt:1`,
          source: 'fixed-replay',
          viewerId: payload.viewerId,
          viewerName: payload.viewerName,
          text: payload.viewerQuestion ?? '',
          intent: 'city-report',
          createdAt: index * 137,
        }),
      };
    });

    let bindingErrors = 0;
    for (const returned of [...turns].reverse()) {
      const reply = composeDeterministicCityReply(returned.payload);
      if (!validateCityReportBinding(reply, returned.payload).valid) {
        bindingErrors += 1;
      }
      expect(
        matchesTurnAttempt(
          returned.envelope,
          returned.payload.eventId,
          returned.envelope.attemptId,
        ),
      ).toBe(true);
    }
    expect(bindingErrors).toBe(0);
  });

  it('rejects every callback shifted onto the following event', () => {
    const payloads = Array.from({ length: 100 }, (_, index) =>
      payloadAt(index),
    );
    const rejected = payloads.filter((payload, index) => {
      const wrongReply = composeDeterministicCityReply(
        payloads[(index + 1) % payloads.length],
      );
      return !validateCityReportBinding(wrongReply, payload, {
        forbiddenViewerNames: viewers.filter(
          (name) => name !== payload.viewerName,
        ),
        forbiddenCities: cities.filter((city) => city !== payload.city),
      }).valid;
    });
    expect(rejected).toHaveLength(100);
  });
});
