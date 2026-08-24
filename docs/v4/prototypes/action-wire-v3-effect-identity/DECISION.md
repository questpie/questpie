# Effect Identity and Operation Wire v3 candidate

- Status: executable candidate for joint Action Kernel acceptance
- Proof/diff base: `c68309f3`
- Required canonical prerequisite: `c68309f3`
- Limits proof integrated as commit `8525b903` (source `66bb1cc6`)
- Projection status: no public docs, Accepted ADR, compiler, Runtime, generated, or
  release projection is authorized before a fresh formal PASS

## Selected contract

An Action caller supplies a required validated `effectKey`. It is stable caller
material, not an Effect Identity and not an idempotency promise. The derived
`effect.id`, not the key, is provider-facing.
Runtime derives the UUID-shaped identity from its already canonical full
`application:*` and `action:*` Resource Identities, raw tenant and principal
facts, principal kind, and `effectKey`. Domain input and Mutation `callId` are
excluded. Input changes under the same key therefore retain the identity; in
the absence of a receipt ledger Runtime neither invents a conflict nor claims
exactly-once. Each admitted duplicate may execute, with the same derived ID.

The common SHA-256-to-UUID materializer preserves the durable ledger vector
`application:collaboration` / run `018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0` /
effect `deliver` as `64a789a4-c319-5d2b-ac27-520d9808a941`. Ordinary Actions
use the disjoint `questpie.effect-identity.action.v1` domain, so they retain the
existing UUID grammar/storage without colliding with durable Reaction/Job
effects. The handler sees only Runtime-scoped `effect.id`; it cannot recover
`effectKey`. Framework-owned outcome metadata and framework failures never add
the key or UUID. An authored output or declared-error codec may deliberately
return `effect.id`; Runtime does not corrupt application data with a secret
scrubber and therefore makes no generic domain-payload nondisclosure claim.

Wire v3 is a full additive successor of the exact retained collaboration Wire
v2 artifact. Query and Mutation retain their v2 request/response keys and
execution. Action has one exact additional request member, `effectKey`; v1/v2
Action is rejected before Context, Service, or handler work. The carrier media
type and carrier protocol remain v1. The imported v2 digest and the derived v3
digest are checked from canonical bytes, and recomputed hostile digests do not
authorize semantic mutation.

After Action dispatch begins, fetch rejection, lost or truncated response,
malformed content type, invalid JSON, unknown or miscorrelated frames, and a
cancellation/response race fail closed as non-retryable
`ACTION_OUTCOME_AMBIGUOUS`. A valid pre-execution rejection proves zero Action
work and remains an ordinary rejection. Authored `outcomeUnknown` remains a
declared provider outcome, not a framework transport error. No path retries
automatically. The ambiguity payload returns only `callId` correlation;
framework errors never echo the caller-owned `effectKey`.

The request carries only remaining duration, never a wall-clock or cross-process
monotonic instant. Direct and network adapters both take the earlier declared
Action duration or remaining root budget, then convert that duration to a local
monotonic deadline. The proof uses distinct caller and Runtime clocks and
requires identical remaining budgets and outcome bytes.

The sibling limits candidate is part of this joint head. Oversized success or
declared-error payload after handler settlement is non-retryable post-handler
`RESOURCE_LIMIT`; it does not prove provider nonacceptance and authorizes no
replay. That includes an oversized authored `outcomeUnknown` payload. This
explicit wire meaning closes the limits/ambiguity seam without inventing a
second limit or identity grammar.

## Material alternatives rejected

1. Caller-provided `effectId`: transfers Runtime namespace ownership and allows
   forgery.
2. Mutation `callId`: aliases receipt/correlation identity with provider effect
   identity and makes retries change the wrong owner.
3. `idempotencyKey`: overclaims provider honor. `effectKey` names material only.
4. Canonical input digest in derivation: lets changed input under the same key
   mint a fresh identity and bypass the collision the caller intended.
5. Random/default key: destroys caller-stable replay behavior.
6. `qpe_<sha256>`: creates a second grammar incompatible with the accepted UUID
   durable ledger and future Job `step.action` reuse.
7. Generic `PROTOCOL_UNSUPPORTED` after dispatch: incorrectly resembles a
   pre-execution rejection and can induce unsafe replay.
8. Process-local duplicate coalescing or automatic retry: overclaims
   exactly-once and changes direct/network behavior under process loss.
9. A deployment salt: adds operator-authored identity material absent from the
   Accepted scope and makes equivalent Runtime facts differ by deployment.
   Environment/provider-account isolation remains an operator boundary; adding
   salt would require a separate public decision, not an implicit proof default.

## Ownership map

| Concern                                         | Owner                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Stable material                                 | caller `effectKey`                                                                                             |
| Application, tenant, principal, Action identity | trusted Runtime facts                                                                                          |
| Final Effect Identity and lifetime              | Runtime Action scope                                                                                           |
| Provider acceptance/rejection/outcomeUnknown    | authored Service/provider                                                                                      |
| Transport ambiguity after dispatch              | Wire v3 client framework                                                                                       |
| Duplicate/exactly-once semantics                | provider/application; not invented by Runtime                                                                  |
| Cancellation before dispatch                    | caller-owned exact reason, zero Action work                                                                    |
| Cancellation after dispatch                     | known valid outcome wins; otherwise framework ambiguity                                                        |
| Transaction semantics                           | none added by ordinary Action                                                                                  |
| Identity visibility                             | handler `effect.id`; absent from framework metadata/failures; authored codec payloads remain application-owned |

This proof deliberately stops before public projection. Formal acceptance must
bind this combined Effect/Wire/limits head and prerequisite `c68309f3`; only a
fresh pinned PASS may authorize ADR/public/compiler/Runtime implementation.
