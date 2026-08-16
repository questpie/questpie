# P22R1 decision: provider-contingent acceptance

## Problem

The accepted protocol distinguishes a failed transport from a verdict, but it
has exactly one transport. This made provider billing availability a permanent
queue lock after all BETA-07 correctness and CI evidence had passed.

## Accepted candidate

Keep Opus-medium primary. When and only when it produces `NO_RESULT`, run one
closed pair of pinned GPT-5.6-sol medium reviewers over identical packet bytes:
Spec and Standards. Both must pass. No user-selectable provider, arbitrary
prompt, tool-using run, or single-axis shortcut exists.

Packet preparation and record verification are separate from remote execution.
The manifest closes authority paths and digests. The packet is built once from
the exact clean commit. The record stores only sanitized primary disposition,
packet/head/base binding, independent invocation identities, raw findings, and
the aggregate. CI re-derives and verifies it.

## Ownership

- ADR-0024 owns the prospective protocol transition.
- `acceptance-review-packet.ts` owns canonical packet construction.
- `acceptance-review-protocol.ts` owns the closed contingency state machine.
- `codex-acceptance-reviewer.ts` owns the one pinned fallback transport.
- `acceptance-review-record.ts` owns aggregate-record validation.
- `acceptance-review.ts` orchestrates the primary and contingency paths.
- `verify-acceptance-review.ts` is the credential-free CI verification seam.

These are repository-quality internals. They do not create a production
provider interface or public QUESTPIE API.

## Bootstrap and projection

The maintainer explicitly authorized continuing without the unavailable Claude
transport. Because v1 cannot approve its replacement in that state, #317 is a
one-time bootstrap revision. It must receive the same deterministic gates and
two independent GPT axes it introduces. After unanimous PASS and CI, ADR-0024
may become Accepted and the proof may merge. BETA-07 then rebases on that merge
and receives a normal v2 review; #317 evidence cannot be reused as #294 review.
