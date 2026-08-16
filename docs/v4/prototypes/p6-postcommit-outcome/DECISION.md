# P6 post-commit outcome authority revision candidate

This proof proposes the sibling authority record `P6R1/PostCommitOutcome`.
It preserves the Accepted P6 head, `OperationWireV1` source bytes, artifact
digest, and behavior. It does not relabel or silently mutate wire v1.

## Conflict being closed

Accepted P3 requires cancellation or response loss after commit to report
`COMMITTED_RESULT_UNAVAILABLE` with stable call and transaction identity, and
requires direct/wire parity for transaction outcomes. Accepted P6 wire v1
cannot represent that outcome: its closed failure-code set omits the code and
its exact framework-failure detail has only `code` and `retryable`. Mapping the
outcome to `INTERNAL` loses recovery identity and is not P3 parity.

## Proposed bounded revision

- `OperationWireV1` remains byte-for-byte historical authority with digest
  `d9c28927d2ced07aaecc8d2cd8caf0f94327232b33d8466535642c2af1c9115c`.
- `OperationWireV2` adds one framework transaction-outcome failure,
  `COMMITTED_RESULT_UNAVAILABLE`. It is not an authored declared error.
  Its canonical digest is
  `2f4cd0631be02ff8a979a0aaa22d0fd393d3638db55e4cc9bbb2db6d9a5ade28`.
- Wire v2 carries forward every v1 result kind and declared error. The accepted
  `IDEMPOTENCY_CONFLICT` remains operation-specialized; its `callId` payload
  uses the same general validated Call Identity text as the request.
- The correlated failure frame keeps the v1 top-level keys. Its exact error
  detail is `{ code, retryable, transactionId }`; the already correlated
  top-level `callId` supplies the stable call identity without duplication.
- HTTP status is `500`. The status reports failure to produce the committed
  result, never transaction rollback. `retryable: true` means only that an
  exact replay with the same scoped call identity is a supported recovery
  attempt. Generated transport still performs zero automatic Mutation retries.
- Direct and generated-client callers receive the same public
  `CommittedResultUnavailable` disposition with literal code, `retryable: true`,
  and frozen `{ callId, transactionId }` payload. Cross-bundle constructor
  identity is not promised.
- The carrier protocol and media type remain version 1; the required
  `wireDigest` selects the exact wire contract. A retained v1 Query pair remains
  executable. A v1 Mutation is rejected with a v1-readable uncorrelated
  `CLIENT_OUTDATED` frame before Context Resolution or Operation execution,
  including when its pair was previously retained. This deliberately narrows
  ADR-0014's retained-pair rule for Mutations only. The server never executes a
  v1 Mutation and then emits a v2-only failure.
- A caller-supplied `callId` is general validated text, not UUID-only: 1–256
  Unicode scalar values, valid Unicode, already NFC, no U+0000, at most 1,024
  UTF-8 bytes. Runtime rejects instead of normalizing. Equality is exact UTF-8
  after validation. `crypto.randomUUID()` is only the default when absent.
- Wire transaction identity is the canonical nonzero decimal text of
  PostgreSQL `xid8`, bounded by the unsigned 64-bit maximum, and remains opaque
  to clients.

## Why this is the smallest repair

The result and ordinary failure frames do not change. The new detail is present
only for the new code. No application error grammar, Operation authoring,
database table, retry loop, provider seam, or client backdoor is added. Generic
unknown failures remain sanitized `INTERNAL` and disclose no transaction ID.

The candidate projection is retained as ancestor commit `823d199e` and removed
from the reviewed candidate by exact revert `64e7cf11`. Its raw diff digest is
bound by `REVISION.json`, so review and CI do not depend on a loose local Git
object. Only after a fresh stateless Opus-medium `PASS` may that exact
projection be restored to ADR/public guidance and the BETA-06 design context.
Production compiler and Runtime changes remain a separate TDD implementation
step.
