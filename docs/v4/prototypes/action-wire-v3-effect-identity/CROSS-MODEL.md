# Stateless cross-model falsification record

Two independent read-only `claude -p` lanes received the same pre-prerequisite
fixed base `79b56b6e8adae5c9e32b231bf22193b8b829713e` and the same authority paths. One
was asked for materially distinct KISS designs; the other was asked only to
falsify ownership, retry, ambiguity, cancellation, compatibility, and parity.
Neither received the other's output or the candidate conclusion.

The design lane preferred a single top-level stable-material field, handler-only
derived identity, retained carrier protocol/media type, one-hop v3→v2 sibling
verification, Action-only pre-work compatibility rejection, and no automatic
retry. The authority adjudication subsequently pinned the spelling `effectKey`,
required/no-default behavior, UUID grammar shared with the durable ledger, and
exclusion of input and `callId`.

The falsification lane found the risks now made executable here: post-handler
retryable limit failure, cancellation without a disposition, delimiter-based
scope collision, version-blind retained pairs, self-referential sibling bytes,
sorted-key insertion, direct/network omission asymmetry, and domain input named
`effectKey`. It also proposed a deployment salt. That proposal is not selected:
it is new operator-owned identity material outside the Accepted derivation tuple
and would require its own public Kernel decision.

Both lanes inspected the repository read-only and made no edits. Their output is
advisory evidence only; deterministic checks and the future pinned formal review
remain the acceptance authority.

The final combined proof was subsequently replayed onto prerequisite
`c68309f3`; that commit is the formal diff base, while the stateless prompts stay
bound to the historical bytes they actually inspected.
