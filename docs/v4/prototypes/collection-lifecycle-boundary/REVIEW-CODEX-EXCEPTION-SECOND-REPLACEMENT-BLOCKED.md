# Human-authorized GPT-5.6-sol second replacement acceptance review

- Candidate: `e646f9d03443eb48be2152cce2c8d6952b5e3599`
- Diff base: `a2ea015d081d2abb95985f1c3db9cbe2a59a3cd6`
- Manifest: `docs/v4/prototypes/collection-lifecycle-boundary/acceptance-manifest.json`
- Packet digest: `70e07e25b9e446a687bf363ae98223b1aa9858e01d7c2f323b389a489a3b2994`
- Reviewer: GPT-5.6-sol high
- Date: 2026-08-28
- Verdict: **BLOCKED**

This is the exact substantive result of the human-authorized finding-only
review of the second repair candidate. It is non-authoritative, is not an Opus
v2 artifact, must not be passed to `review:accept:verify`, and does not accept
ADR-0031.

## Verbatim review

VERDICT: BLOCKED

Reviewed head: `e646f9d03443eb48be2152cce2c8d6952b5e3599`

Packet digest: `70e07e25b9e446a687bf363ae98223b1aa9858e01d7c2f323b389a489a3b2994`

Reviewer: GPT-5.6-sol high

Blocking findings:

1. `compiler-artifact/compiler.ts` still does not preserve exact ordinary-TypeScript optional-chain semantics.

   The lowerer marks the whole string-method chain optional using `ts.isOptionalChain`. Consequently:
   - `input?.name.trim()` with `input === null` correctly returns `undefined`.
   - The same expression with `input === {}` also returns `undefined`, while native TypeScript/JavaScript throws because only `input` was optional and `name.trim()` remains required.

   The new tests cover the null root but omit the present-root/missing-member hostile. This leaves the prior exact Lifecycle Program v1 semantics finding open.

   Required repair: represent optional short-circuit with an internal sentinel distinct from an ordinary missing member, propagate it only through the syntactically covered chain, and add paired execution tests for `input?.name.trim()`, `input?.name?.trim()`, and `input.name?.trim()` across null root, missing member, null member, and present string.

2. `compiler-artifact/compiler.ts` still admits values outside ADR-0031’s closed runtime domain.

   `finiteDomain` accepts every object prototype after recursively inspecting `Object.values`. A Policy-aware read adapter can return a `Map` containing a `Symbol`, and `executePhase` accepts it as a lifecycle local. `Date`, `Map`, `Set`, class instances, proxies, and other host objects are therefore not distinguished from exact objects or timestamps. It also treats ordinary `undefined` as a general admitted value although ADR-0031 lists null, boolean, finite number, string, timestamp, exact object, and bounded array values.

   Required repair: validate exact plain-object/array shapes, define and validate the timestamp representation explicitly, reject host/prototype objects and inadmissible nested values, and keep optional-chain absence as an interpreter-internal sentinel rather than a public value. Add capability-result and computed-result hostiles for `Map`, `Set`, class instances, invalid timestamps, symbols, functions, nested `undefined`, and non-finite numbers.

3. The exact reviewed diff fails the claimed whitespace gate.

   `git diff --check a2ea015d081d2abb95985f1c3db9cbe2a59a3cd6..e646f9d03443eb48be2152cce2c8d6952b5e3599` reports trailing whitespace in `REVIEW-CODEX-EXCEPTION-REPLACEMENT-BLOCKED.md:20-21`. The manifest records bare `git diff --check` as PASS, but at a clean committed head that checks only the empty working-tree diff and cannot validate the packet’s committed range.

   Required repair: remove or losslessly encode the two Markdown hard-break spaces, add the replacement review record to formatting coverage, and record a non-vacuous committed-range command such as `git diff --check <diffBase>..HEAD`.

Non-blocking observations:

- The packet digest independently reproduces exactly.
- ADR-0031 remains `Proposed`; no live authority or public documentation projects acceptance.
- Prior identity-binding, payloadless mapping, shared-budget, PostgreSQL connection, `ctx.callId`, structural capability-argument, sparse-normalize, and projection-wording findings are materially repaired.
- Compiler tests pass 12/12; strict TypeScript and lint pass.
- The PostgreSQL proof now executes the canonical artifact through the same transaction adapter and includes a real visibility-filtered check read, nested work, Job acceptance, and rollback evidence.
- No production lifecycle implementation or unrelated authority change is present.
- The review made no repository or Git changes; the worktree remains clean.
