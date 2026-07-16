import { describe, expect, it } from 'vitest';
import {
  InMemorySoulLedger,
  SoulSnapshotRestoreError,
  createInitialSoulState,
  createSoulRuntime,
  createSoulSnapshot,
  hashSoulState,
  restoreSoulRuntime,
} from '../src/index.js';
import {
  constitution,
  makeEvent,
  makeProposal,
  profile,
  scope,
} from './fixtures.js';

describe('soul snapshot restore', () => {
  it('restores state and pending decisions from a verified ledger checkpoint', async () => {
    let now = 1_000;
    const original = createSoulRuntime({
      constitution,
      profile,
      scope,
      now: () => now,
    });
    const event = makeEvent();
    const proposal = makeProposal(event);
    await original.observe(event, proposal);
    now = 2_100;
    const decision = await original.decide(event, proposal);
    now = 2_200;
    await original.reserve(decision);
    const checkpoint = await original.snapshot(2_300);

    const restored = await restoreSoulRuntime({
      constitution,
      profile,
      scope,
      ledger: original.getLedger(),
      snapshot: checkpoint,
      now: () => 3_000,
    });

    expect(hashSoulState(restored.getState())).toBe(checkpoint.stateHash);
    expect(
      restored.getState().delivery.reservations[decision.id],
    ).toBeDefined();

    await restored.applyOutcome({
      protocolVersion: '1.0',
      id: 'restored-spoken',
      decisionId: decision.id,
      scope,
      occurredAt: 3_100,
      status: 'spoken',
    });
    const afterOutcome = restored.getState();
    expect(afterOutcome.delivery.committedDecisionIds).toContain(decision.id);
    expect(hashSoulState(await restored.replay())).toBe(
      hashSoulState(afterOutcome),
    );
  });

  it('replays reservation and outcome entries written after the checkpoint', async () => {
    const original = createSoulRuntime({ constitution, profile, scope });
    const event = makeEvent({ id: 'tail-event' });
    const proposal = makeProposal(event);
    await original.observe(event, proposal);
    const decision = await original.decide(event, proposal, 2_100);
    const checkpoint = await original.snapshot(2_150);
    await original.reserve(decision, 2_200);
    await original.applyOutcome({
      protocolVersion: '1.0',
      id: 'tail-spoken',
      decisionId: decision.id,
      scope,
      occurredAt: 3_000,
      status: 'spoken',
    });
    const expected = original.getState();

    const restored = await restoreSoulRuntime({
      constitution,
      profile,
      scope,
      ledger: original.getLedger(),
      snapshot: checkpoint,
    });

    expect(hashSoulState(restored.getState())).toBe(hashSoulState(expected));
    expect(restored.getState().delivery.committedDecisionIds).toContain(
      decision.id,
    );
  });

  it('rejects a snapshot with a modified state hash', () => {
    const runtime = createSoulRuntime({ constitution, profile, scope });
    const state = runtime.getState();
    const snapshot = createSoulSnapshot(state, 0, 'genesis', 2_000);
    const corrupted = structuredClone(snapshot);
    corrupted.state.selfEsteem = 0;

    expect(() =>
      createSoulRuntime({
        constitution,
        profile,
        scope,
        ledger: new InMemorySoulLedger(),
        snapshot: corrupted,
      }),
    ).toThrow(SoulSnapshotRestoreError);
  });

  it('rejects a valid snapshot from a different room or session scope', () => {
    const otherScope = {
      ...scope,
      roomId: 'room-b',
      sessionId: 'session-b',
    };
    const otherState = createInitialSoulState(
      constitution,
      profile,
      otherScope,
      1_000,
    );
    const snapshot = createSoulSnapshot(otherState, 0, 'genesis', 2_000);

    expect(() =>
      createSoulRuntime({
        constitution,
        profile,
        scope,
        ledger: new InMemorySoulLedger(),
        snapshot,
      }),
    ).toThrow(/snapshot roomId/);
  });

  it('rejects constitution and profile drift even when ids look compatible', () => {
    const state = createInitialSoulState(constitution, profile, scope, 1_000);
    const snapshot = createSoulSnapshot(state, 0, 'genesis', 2_000);
    const changedConstitution = {
      ...constitution,
      privacyRules: [...constitution.privacyRules, 'A newly changed rule.'],
    };
    const changedProfile = {
      ...profile,
      temperament: {
        ...profile.temperament,
        noveltySeeking: 0.1,
      },
    };

    expect(() =>
      createSoulRuntime({
        constitution: changedConstitution,
        profile,
        scope,
        ledger: new InMemorySoulLedger(),
        snapshot,
      }),
    ).toThrow(/constitution hash/);
    expect(() =>
      createSoulRuntime({
        constitution,
        profile: changedProfile,
        scope,
        ledger: new InMemorySoulLedger(),
        snapshot,
      }),
    ).toThrow(/profile hash/);
  });

  it('requires the checkpoint ledger and fails closed when its prefix is missing', async () => {
    const original = createSoulRuntime({ constitution, profile, scope });
    const event = makeEvent();
    await original.observe(event, makeProposal(event));
    const snapshot = await original.snapshot();

    expect(() =>
      createSoulRuntime({ constitution, profile, scope, snapshot }),
    ).toThrow(/requires its append-only ledger/);
    await expect(
      restoreSoulRuntime({
        constitution,
        profile,
        scope,
        ledger: new InMemorySoulLedger(),
        snapshot,
      }),
    ).rejects.toThrow(/checkpoint is missing/);
  });

  it('rejects a ledger whose checkpoint sequence has a different head hash', async () => {
    const original = createSoulRuntime({ constitution, profile, scope });
    const event = makeEvent();
    await original.observe(event, makeProposal(event));
    const snapshot = await original.snapshot();
    const wrongLedger = new InMemorySoulLedger();
    const wrongEvent = makeEvent({ id: 'wrong-event' });
    await wrongLedger.append({
      id: 'wrong-1',
      kind: 'event',
      scope,
      occurredAt: wrongEvent.occurredAt,
      payload: wrongEvent,
    });
    await wrongLedger.append({
      id: 'wrong-2',
      kind: 'reflection',
      scope,
      occurredAt: 2_100,
      payload: { summary: 'unrelated ledger content' },
    });

    await expect(
      restoreSoulRuntime({
        constitution,
        profile,
        scope,
        ledger: wrongLedger,
        snapshot,
      }),
    ).rejects.toThrow(/ledger head does not match/);
  });
});
