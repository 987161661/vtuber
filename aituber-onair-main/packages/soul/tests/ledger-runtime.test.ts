import { describe, expect, it } from 'vitest';
import {
  InMemorySoulLedger,
  applySoulEvent,
  createInitialSoulState,
  createSoulRuntime,
  createSoulSnapshot,
  hashSoulState,
  replaySoulLedger,
  verifySoulLedgerExport,
  verifySoulSnapshot,
} from '../src/index.js';
import {
  constitution,
  makeEvent,
  makeProposal,
  makeState,
  profile,
  scope,
} from './fixtures.js';

describe('append-only ledger and cohesive runtime', () => {
  it('maintains a portable append-chain integrity check', async () => {
    const ledger = new InMemorySoulLedger();
    const event = makeEvent();
    const input = {
      id: 'ledger:event:event-1',
      kind: 'event' as const,
      scope,
      occurredAt: event.occurredAt,
      payload: event,
    };

    const first = await ledger.append(input);
    const duplicate = await ledger.append(input);
    expect(duplicate).toEqual(first);
    await expect(
      ledger.append({ ...input, payload: makeEvent({ kind: 'gift' }) }),
    ).rejects.toThrow('Conflicting append');

    const exported = await ledger.export();
    expect(() => verifySoulLedgerExport(exported)).not.toThrow();
    const restored = new InMemorySoulLedger(exported);
    expect(await restored.export()).toEqual(exported);

    const tampered = structuredClone(exported);
    const entry = tampered.entries[0];
    if (entry) entry.occurredAt += 1;
    expect(() => verifySoulLedgerExport(tampered)).toThrow('hash mismatch');
  });

  it('filters records by the complete persona/platform/room/session scope', async () => {
    const ledger = new InMemorySoulLedger();
    const event = makeEvent();
    await ledger.append({
      id: 'entry-a',
      kind: 'event',
      scope,
      occurredAt: 2_000,
      payload: event,
    });
    await ledger.append({
      id: 'entry-b',
      kind: 'event',
      scope: { ...scope, platform: 'youtube', sessionId: 'session-b' },
      occurredAt: 2_100,
      payload: {
        ...event,
        id: 'event-b',
        scope: { ...scope, platform: 'youtube', sessionId: 'session-b' },
      },
    });

    const selected = await ledger.list({ scope });

    expect(selected.map((entry) => entry.id)).toEqual(['entry-a']);
  });

  it('replays persisted appraisals to the identical state hash', async () => {
    const initial = makeState();
    const event = makeEvent({
      goalEvidence: [
        {
          goalFamily: 'connection',
          direction: 1,
          magnitude: 0.5,
          confidence: 1,
          reasonCode: 'friendly-message',
        },
      ],
    });
    const proposal = makeProposal(event);
    const transition = applySoulEvent(initial, profile, event, proposal);
    const ledger = new InMemorySoulLedger();
    await ledger.append({
      id: 'event-entry',
      kind: 'event',
      scope,
      occurredAt: event.occurredAt,
      payload: event,
    });
    await ledger.append({
      id: 'appraisal-entry',
      kind: 'appraisal',
      scope,
      occurredAt: event.occurredAt,
      payload: transition.appraisal,
    });

    const replayed = replaySoulLedger(initial, profile, await ledger.list());

    expect(hashSoulState(replayed)).toBe(hashSoulState(transition.state));
  });

  it('detects snapshot tampering', () => {
    const state = makeState();
    const snapshot = createSoulSnapshot(state, 0, 'genesis', 2_000);
    expect(verifySoulSnapshot(snapshot)).toBe(true);

    const tampered = structuredClone(snapshot);
    tampered.state.selfEsteem = 0;
    expect(verifySoulSnapshot(tampered)).toBe(false);
  });

  it('runs observe, decide, reserve, outcome, snapshot, and replay as one API', async () => {
    let now = 1_000;
    const runtime = createSoulRuntime({
      constitution,
      profile,
      scope,
      now: () => now,
    });
    const event = makeEvent();
    const proposal = makeProposal(event);

    await runtime.observe(event, proposal);
    now = 2_100;
    const decision = await runtime.decide(event, proposal);
    now = 2_200;
    await runtime.reserve(decision);
    now = 3_000;
    await runtime.applyOutcome({
      protocolVersion: '1.0',
      id: 'spoken-1',
      decisionId: decision.id,
      scope,
      occurredAt: now,
      status: 'spoken',
    });
    const beforeReplay = runtime.getState();
    const snapshot = await runtime.snapshot();

    expect(snapshot.ledgerSequence).toBe(5);
    expect(snapshot.stateHash).toBe(hashSoulState(beforeReplay));
    expect(beforeReplay.delivery.committedDecisionIds).toContain(decision.id);

    const replayed = await runtime.replay();
    expect(hashSoulState(replayed)).toBe(hashSoulState(beforeReplay));
  });

  it('does not mutate caller-owned initial data while replaying', () => {
    const initial = createInitialSoulState(constitution, profile, scope, 1_000);
    const before = hashSoulState(initial);

    replaySoulLedger(initial, profile, []);

    expect(hashSoulState(initial)).toBe(before);
  });
});
