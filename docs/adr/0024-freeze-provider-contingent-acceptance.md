# ADR 0024: Freeze provider-contingent acceptance

- Status: Candidate
- Date: 2026-08-16

## Context

ADR-0020 correctly makes timeout, transport failure, empty output, and malformed
output no result. Its only accepted reviewer transport is a fresh stateless
Claude Opus-medium process. A provider account spend limit therefore stranded
an otherwise green BETA-07 implementation: correctness remained intact, but no
accepted process could produce a verdict.

Replacing the unavailable command informally, counting prior exploratory GPT
reviews, or letting callers choose an arbitrary model would weaken the gate.
Requiring one provider forever makes external availability an unintended
authority over the implementation queue.

## Decision

Protocol v1 evidence and ADR-0020 remain immutable historical authority.
Prospectively, protocol v2 keeps one fresh stateless Claude Opus-medium review
with no tools as its primary disposition. A primary `PASS` or `BLOCKED` is
final. Only a mechanically recorded primary `NO_RESULT` activates one closed
contingency round.

The contingency round contains exactly two fresh `gpt-5.6-sol` reviews at
medium reasoning effort, one Spec axis and one Standards axis. Both receive the
same canonical evidence packet and packet digest in separate ephemeral empty
workspaces. The repository pins the Codex CLI version, model, effort, axes,
read-only sandbox, ignored user configuration/rules, and structured response
schema. Callers cannot choose a provider, model, effort, axis, prompt, or packet
member.

Every Codex JSON event is validated. Reasoning and one final agent message are
the only accepted item kinds. A command, MCP call, web lookup, other tool item,
unknown event, timeout, transport failure, empty response, malformed response,
binding mismatch, repeated invocation identity, or missing axis makes the whole
round no result and writes no acceptance artifact.

Unanimous contingency `PASS` is aggregate `PASS`. Either `BLOCKED` is aggregate
`BLOCKED`. A valid `BLOCKED` requires repair on a new clean head and one
replacement round; contingency cannot replace a primary verdict.

Protocol v2 also closes packet ambiguity. The committed manifest owns the exact
diff base, review output, fixed proof heads, ordered authority-document paths
and SHA-256 digests, PASS-only deterministic gates, and criteria. The wrapper
reads all bytes from the exact reviewed commit, requires a clean worktree and
ancestry, scans the authority, manifest, diff, and record for secrets, and
records the packet digest, head, base, sanitized primary disposition, both
contingency invocation identities/findings, aggregate verdict, and timestamp.
CI re-derives the packet from the reviewed commit and verifies the committed
record.

This ADR is a one-time maintainer-authorized bootstrap amendment because
protocol v1 cannot ratify its own replacement while its sole transport is
unavailable. The candidate must still pass all deterministic negative controls,
two independent protocol-v2 GPT review axes, normal CI, and review-record
verification before projection. The bootstrap does not authorize future model
changes without another reviewed decision.

## Consequences

- A single provider outage cannot permanently own the product queue.
- Historical Opus reviews remain valid and byte-identical.
- The active contingency profile is closed and pinned, not a provider matrix or
  plugin seam.
- Review provenance is an exact repository/CLI attestation, not a
  cryptographic provider signature; documentation must not call it one.
- Authenticated model calls remain a local pre-merge operation. CI verifies the
  committed packet and record without requiring model credentials.

## Rejected alternatives

- Treat existing GPT prose reviews as acceptance evidence.
- Skip acceptance because deterministic CI is green.
- Make model/provider/effort caller-configurable.
- Let one fallback reviewer replace two independent review axes.
- Permit contingency after a valid primary `BLOCKED`.
- Give the reviewer the repository worktree or accept tool-using transcripts.
- Rewrite or invalidate protocol v1 evidence.
