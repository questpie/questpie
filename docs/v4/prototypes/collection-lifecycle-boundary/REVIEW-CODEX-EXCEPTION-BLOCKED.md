# Human-authorized GPT-5.6-sol acceptance substitution

- Candidate: `c473f9129129aa94f40c2d08639ee3c20aa273cf`
- Diff base: `a2ea015d081d2abb95985f1c3db9cbe2a59a3cd6`
- Manifest: `docs/v4/prototypes/collection-lifecycle-boundary/acceptance-manifest.json`
- Packet digest: `4713d7ef669cf3162cb9ed70a45b702f40daceda4672dd34b6b11c0e25d99b1a`
- Reviewer: GPT-5.6-sol high
- Date: 2026-08-28
- Verdict: **BLOCKED**

The repository-pinned Opus v2 reviewer previously returned terminal
`NO_RESULT` with category `transport` for the superseded candidate
`d28df9c2d` and wrote no artifact. The project owner explicitly authorized one
independent GPT-5.6-sol high reviewer for the fresh, correctly staged candidate
because delivery could not wait for the unavailable provider.

This is an honest exceptional substitution record, not a
`questpie.acceptance.v2` Opus artifact, and must not be passed to
`review:accept:verify`. It does not modify the global reviewer protocol and it
does not accept ADR-0031.

## Verbatim review

VERDICT: BLOCKED

Reviewed head: `c473f9129129aa94f40c2d08639ee3c20aa273cf`

Reviewer: GPT-5.6-sol high

1. Replace `check.ts`'s hand-authored three-instruction model with an executable
   compiler/interpreter proof covering ordinary-TypeScript parsing for all four
   phases, callback-byte disposal/non-invocation, the complete Lifecycle Program
   v1 grammar, Origin-bound `QP-COMPOSE-026` negatives, and phase-specific
   capability rejection—including captures/imports, ambient effects, Services,
   Actions, raw SQL/transactions, timers, `Promise.all`, detached work, and
   illegal async/loop forms.

2. Implement exact fail-closed artifact evidence: canonical v1 encoding, exact
   decoding, schema/Collection/Field/issue/Operation/Job identity bindings,
   interpreter-version and Runtime-Build compatibility, tamper/cross-build/
   relocation hostiles, and domain separation. The current proof's `unknown`
   operands and permissive canonicalizer are unsound: distinct admitted model
   values such as `NaN` and `null` produce identical canonical bytes and SHA-256
   digests.

3. Add executable PostgreSQL/Operation evidence for issue ownership and
   transaction semantics: validate/check-only issue creation; deterministic
   first-issue order; transaction doom surviving application catch; unknown,
   forged, malformed, and unmapped sanitization; PostgreSQL constraints
   remaining distinct; transitive nested-call reachability, complete-path
   `QP-COMPOSE-027`, and capability withholding; mapping only after rollback;
   and byte-equivalent direct/wire declared outcomes without identity, row,
   Policy, PostgreSQL, or stack disclosure.

4. Add executable lifecycle-order evidence for separate caller/trusted
   normalization with path preservation, Codec-before-validate,
   candidate-Policy-before-check, constraint/database-owned-value-before-
   afterWrite, same-transaction nested work and Job acceptance, shared budgets
   and re-entry rollback, `ctx.now`/`onUpdate` ownership,
   cancellation/deadline rollback, no automatic retry, fresh explicit retry,
   and committed-receipt replay running no lifecycle work.

5. Repair the staged public projection before replacement review. Its failure
   table projects a “typed framework constraint result” although typed
   `ConstraintViolation` remains explicitly deferred by ADR-0030 and
   `HANDOFF.md`, exceeding ADR-0031's stated supersession scope. Remove that
   claim or ratify it separately, and attribute the new lifecycle/compiler
   contract to the new ADR-0031 delta evidence rather than leaving only the
   legacy ADR-0011/ADR-0009 proof metadata.

6. Commit the repaired candidate on a fresh head, regenerate all manifest
   SHA-256 bindings, rerun every affected gate, and run one replacement review
   while ADR-0031 remains `Proposed`.
