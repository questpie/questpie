# ADR 0023: Freeze the Post-Commit Operation Outcome

- Status: Accepted
- Date: 2026-08-16
- Supersedes: the incomplete post-commit outcome edge of ADR-0014 and its
  retained-pair execution rule for Wire v1 Mutations only

## Context

ADR-0011 requires cancellation or response loss after Mutation commit to
report `COMMITTED_RESULT_UNAVAILABLE` with the stable call and transaction
identity. Direct and wire entry must agree on transaction outcomes. Accepted
ADR-0014 Operation Wire v1 cannot express that result: its closed framework
failure set omits the code and its exact failure detail has only `code` and
`retryable`. Mapping the outcome to `INTERNAL` loses the recovery identity.

## Decision

QUESTPIE accepts the sibling `P6R1/PostCommitOutcome` contract.

- Accepted Operation Wire v1 and digest
  `d9c28927d2ced07aaecc8d2cd8caf0f94327232b33d8466535642c2af1c9115c`
  remain byte-for-byte historical authority. They are never reinterpreted.
- Operation Wire v2 adds `COMMITTED_RESULT_UNAVAILABLE` as a framework
  transaction outcome, not an authored declared error. The correlated failure
  keeps the v1 top-level keys. Its exact error detail is
  `{ code, retryable, transactionId }`; top-level `callId` supplies the stable
  call identity.
- The HTTP status is `500`: producing the result failed after the Mutation
  committed. It never claims rollback. `retryable: true` means only that the
  caller may replay the exact Mutation with the same scoped call identity to
  recover the receipt. The generated transport performs no automatic Mutation
  retry.
- Direct and generated-client calls expose the same
  `CommittedResultUnavailable` disposition with literal code,
  `retryable: true`, and a frozen `{ callId, transactionId }` payload. Cause,
  PostgreSQL detail, and stack information never cross the wire. Constructor
  identity across server and generated-client bundles is not promised.
- The carrier protocol and media type remain version 1. The required
  `wireDigest` selects the exact Operation Wire contract. A retained v1 Query
  pair may still execute and return v1 frames. A v1 Mutation receives a
  v1-readable uncorrelated `CLIENT_OUTDATED` rejection before Context
  Resolution or Operation execution, including when the pair was previously
  retained. A v1 Mutation is never executed and then answered with a v2-only
  frame. This intentionally narrows ADR-0014's retained-pair execution rule for
  Mutations, while preserving it for Queries.
- Wire v2 carries forward all three v1 result kinds and the accepted
  operation-specialized `IDEMPOTENCY_CONFLICT` declared error. Its `callId`
  payload uses the same general validated Call Identity text as the request;
  no declared error is added or removed by the revision.
- Caller-supplied `callId` is validated text, not UUID-only: 1 through 256
  Unicode scalar values, valid Unicode, already NFC, no U+0000, and no more
  than 1,024 UTF-8 bytes. Runtime rejects rather than normalizes. Equality is
  exact UTF-8 after validation. `crypto.randomUUID()` is only the default when
  a caller omits the identity.
- `transactionId` is canonical nonzero PostgreSQL `xid8` decimal text no
  greater than `18446744073709551615`. Clients carry it as an opaque identity.

Every other framework failure retains its v1 error detail and discloses no
transaction identity. Unknown failures remain sanitized `INTERNAL`.

## Consequences

Clients can distinguish a committed Mutation whose result is unavailable from
an unknown internal failure, preserve both recovery identities, and replay the
exact call without an automatic retry loop. Wire v1 Mutation clients must
upgrade before execution; retained Wire v1 Query clients continue to run. This
is a deliberate rolling-upgrade constraint for Mutations. The revision adds no
authoring grammar, database schema, provider seam, host adapter, or public
transaction handle.

Production compiler and Runtime code still require their normal TDD and review
gates. This ADR authorizes only the bounded v2 projection proved by
`P6R1/PostCommitOutcome`.

## Rejected alternatives

- Mapping to `INTERNAL`, because it violates ADR-0011 transaction-outcome
  parity and removes transaction identity.
- An operation-specialized declared error, because application authors do not
  own a framework post-commit outcome.
- Silent wire v1 expansion, because its exact bytes and digest are Accepted.
- Automatic Mutation replay, a new frame kind, or duplicated top-level
  transaction state, because none is required for recovery.
