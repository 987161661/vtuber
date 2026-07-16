# @aituber-onair/soul

`@aituber-onair/soul` is a model-agnostic causal cognition kernel for AI
characters. It keeps goals, affect, relationships, decisions, delivery
outcomes, and memory provenance in deterministic application code. Language
models may propose semantic evidence and dialogue, but cannot mutate state or
write memories directly.

The package intentionally contains no network client, platform integration,
persona-specific dialogue, or renderer behavior. Inject a model transport and
connect `SoulDecisionV1` to a host coordinator in the consuming application.

Restore a runtime with `restoreSoulRuntime({ snapshot, ledger, constitution,
profile, scope })`. `createSoulRuntime` also accepts the same `snapshot` option,
but mutation remains gated until the supplied ledger checkpoint has been
verified. Snapshot hash, protocol, scope, profile, and constitution mismatches
all fail closed.

Slow-model output is committed only through
`runtime.commitReflection({ proposal, allowedEvidenceEventIds, approval,
occurredAt })`. The caller must provide a policy approval that names each
existing goal and falsifiable mutable belief it authorizes. The runtime clamps
each goal-weight delta to the profile limit, records every approved and
rejected item, and binds the review to pre/post state hashes. Canon proposals
are always rejected by this API and must use the separate canon review flow.

## Design invariants

- A platform event is evidence about a goal; it is never mapped directly to an
  emotion.
- State transitions are scoped, idempotent, replayable, and hashable.
- Speech-side effects are reserved first and committed only after a delivery
  outcome.
- Silence, support invitations, and jealousy-like expression pass deterministic
  anti-manipulation constraints.
- Canon remains versioned and retractable. Claims about real viewers require
  production evidence.
- A constitution is deep-frozen and never appears in a model-writable patch.
- Reflection proposals cannot add goal families, write world facts or identity
  fields, or mutate state without observed allowlisted evidence and an explicit
  policy approval.

State and chain hashes are deterministic integrity checks for replay and
accidental corruption, not cryptographic signatures. Persist the ledger head in
a trusted service or sign it externally when adversarial tamper resistance is
required.
