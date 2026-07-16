import { describe, expect, it } from 'vitest';
import {
  ROOM_ACTOR_ID,
  applyConversationDeliveryOutcome,
  appendConversationHistoryScopeQuery,
  classifyLegacyMemoryMigration,
  classifyLegacyRelationshipMigration,
  conversationHistoryScopeFromSearchParams,
  isConversationDeliveryOutcome,
  isRetrievableConversationHistoryRecord,
  normalizeConversationHistoryScope,
  type ConversationHistoryScope,
} from '../../examples/react-purupuru-app/src/lib/conversationHistory';

const scope: ConversationHistoryScope = {
  personaId: 'linglan-queen',
  platform: 'bilibili',
  roomId: 'room-7',
  sessionId: 'session-8',
  actorId: 'viewer-9',
  viewerId: 'viewer-9',
};

describe('conversation history delivery semantics', () => {
  it('requires every identity dimension in a scope', () => {
    expect(normalizeConversationHistoryScope(scope)).toEqual(scope);
    expect(
      normalizeConversationHistoryScope({ ...scope, sessionId: '' }),
    ).toBeUndefined();
    expect(
      normalizeConversationHistoryScope({ ...scope, actorId: undefined }),
    ).toBeUndefined();
  });

  it('round-trips the complete scope through a short-term query', () => {
    const params = appendConversationHistoryScopeQuery(
      new URLSearchParams({ shortTerm: '1' }),
      scope,
    );
    expect(conversationHistoryScopeFromSearchParams(params)).toEqual(scope);
  });

  it('retrieves only spoken or partial records from the exact actor scope', () => {
    const base = { at: 100, scope };
    expect(
      isRetrievableConversationHistoryRecord(
        { ...base, deliveryStatus: 'spoken' },
        scope,
        100,
      ),
    ).toBe(true);
    expect(
      isRetrievableConversationHistoryRecord(
        { ...base, deliveryStatus: 'partial', partialTextVerified: true },
        scope,
      ),
    ).toBe(true);
    expect(
      isRetrievableConversationHistoryRecord(
        { ...base, deliveryStatus: 'partial' },
        scope,
      ),
    ).toBe(false);
    for (const deliveryStatus of [
      'generated',
      'failed',
      'interrupted',
      'skipped',
      undefined,
    ]) {
      expect(
        isRetrievableConversationHistoryRecord(
          { ...base, deliveryStatus },
          scope,
        ),
      ).toBe(false);
    }
    expect(
      isRetrievableConversationHistoryRecord(
        {
          ...base,
          deliveryStatus: 'spoken',
          scope: {
            ...scope,
            actorId: 'other-viewer',
            viewerId: 'other-viewer',
          },
        },
        scope,
      ),
    ).toBe(false);
  });

  it('accepts only terminal delivery outcomes for PATCH', () => {
    expect(isConversationDeliveryOutcome('spoken')).toBe(true);
    expect(isConversationDeliveryOutcome('partial')).toBe(true);
    expect(isConversationDeliveryOutcome('generated')).toBe(false);
  });

  it('patches only the matching event inside the exact scope', () => {
    const record = {
      eventId: 'event-1',
      scope,
      deliveryStatus: 'generated',
      ttsStartAt: 20,
    };
    expect(
      applyConversationDeliveryOutcome(record, 'event-1', scope, {
        deliveryStatus: 'partial',
        deliveryUpdatedAt: 30,
        deliveredFraction: 0.5,
        deliveredReply: 'actually heard',
        partialTextVerified: true,
        ttsEndAt: 40,
      }),
    ).toMatchObject({
      deliveryStatus: 'partial',
      deliveredFraction: 0.5,
      reply: 'actually heard',
      partialTextVerified: true,
      ttsStartAt: 20,
      ttsEndAt: 40,
    });
    expect(
      applyConversationDeliveryOutcome(
        record,
        'event-1',
        { ...scope, viewerId: 'other', actorId: 'other' },
        { deliveryStatus: 'failed', deliveryUpdatedAt: 30 },
      ),
    ).toBeUndefined();
  });

  it('does not let late failures erase stronger playback evidence', () => {
    const spoken = {
      eventId: 'event-1',
      scope,
      deliveryStatus: 'spoken',
      deliveryUpdatedAt: 30,
    };
    expect(
      applyConversationDeliveryOutcome(spoken, 'event-1', scope, {
        deliveryStatus: 'failed',
        deliveryUpdatedAt: 40,
      }),
    ).toEqual(spoken);

    const partial = { ...spoken, deliveryStatus: 'partial' };
    expect(
      applyConversationDeliveryOutcome(partial, 'event-1', scope, {
        deliveryStatus: 'interrupted',
        deliveryUpdatedAt: 40,
      }),
    ).toEqual(partial);
    expect(
      applyConversationDeliveryOutcome(partial, 'event-1', scope, {
        deliveryStatus: 'spoken',
        deliveryUpdatedAt: 50,
      }),
    ).toMatchObject({ deliveryStatus: 'spoken', deliveryUpdatedAt: 50 });
  });

  it('uses an explicit room actor for non-viewer speech', () => {
    expect(ROOM_ACTOR_ID).toBe('__room__');
  });
});

describe('legacy migration provenance', () => {
  it('admits only persona, platform and viewer matched live records', () => {
    expect(
      classifyLegacyMemoryMigration(
        {
          digitalHumanId: 'linglan-queen',
          subjectType: 'viewer',
          subjectId: 'bilibili:viewer-9',
          sourceType: 'live_event',
        },
        scope,
      ),
    ).toEqual({ disposition: 'projection-seed', viewerId: 'viewer-9' });
    expect(
      classifyLegacyMemoryMigration(
        {
          digitalHumanId: 'linglan-queen',
          subjectType: 'viewer',
          subjectId: 'youtube:viewer-9',
          sourceType: 'live_event',
        },
        scope,
      ),
    ).toEqual({ disposition: 'quarantine-audit', reason: 'platform-unproven' });
    expect(
      classifyLegacyMemoryMigration(
        {
          digitalHumanId: 'linglan-queen',
          subjectType: 'self',
          sourceType: 'migration',
        },
        scope,
      ),
    ).toEqual({ disposition: 'quarantine-audit', reason: 'viewer-unproven' });
  });

  it('quarantines relationship keys from another or unknown platform', () => {
    expect(
      classifyLegacyRelationshipMigration('bilibili:v1', 'bilibili'),
    ).toEqual({ disposition: 'projection-seed', viewerId: 'v1' });
    expect(
      classifyLegacyRelationshipMigration('unknown:v1', 'bilibili'),
    ).toEqual({
      disposition: 'quarantine-audit',
      reason: 'platform-unproven',
    });
  });
});
