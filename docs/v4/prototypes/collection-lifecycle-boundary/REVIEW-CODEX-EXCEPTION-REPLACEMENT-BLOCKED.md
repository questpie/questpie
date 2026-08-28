# Human-authorized GPT-5.6-sol replacement acceptance review

- Candidate: `2236f3b2479151f22a903a8b5ce853a3b24b07ab`
- Diff base: `a2ea015d081d2abb95985f1c3db9cbe2a59a3cd6`
- Manifest: `docs/v4/prototypes/collection-lifecycle-boundary/acceptance-manifest.json`
- Packet digest: `4f9ca0d63a85f632c26b6c429076a2003b951d349b70551f13f028d3294787d3`
- Reviewer: GPT-5.6-sol high
- Date: 2026-08-28
- Verdict: **BLOCKED**

This is the exact result of the one human-authorized replacement review of the
finding-only repair candidate. It is non-authoritative, is not an Opus v2
artifact, must not be passed to `review:accept:verify`, and does not accept
ADR-0031.

## Verbatim review

VERDICT: BLOCKED

Reviewed head: `2236f3b2479151f22a903a8b5ce853a3b24b07ab`  
Packet digest: `4f9ca0d63a85f632c26b6c429076a2003b951d349b70551f13f028d3294787d3`  
Reviewer: GPT-5.6-sol high

Blocking findings:

1. `compiler-artifact/compiler.ts` does not exactly decode or independently bind the complete artifact identity set.
   - `validateArtifact` accepts arrays for `fields`, `issues`, and `capabilities`; a recomputed canonical artifact with array bindings loads successfully.
   - `decodeArtifact` independently checks only Runtime Build, schema, Collection, and interpreter. A recomputed artifact can replace both a declared issue and its `throwIssue` instruction with `issue:other/stolen` and still load under the original expected Collection.
   - This leaves the prior Field/issue/Operation/Job binding blocker open.

   Required repair: require exact plain binding-map shapes and bind every Field, issue, Operation, and Job identity against independent expected contract data or an independently trusted manifest digest. Add recomputed-digest hostiles for cross-Field, cross-issue, cross-Operation, cross-Job, malformed-map, and array-map substitution.

2. `compiler-artifact/compiler.ts` does not implement the complete admitted Lifecycle Program v1 semantics.
   - Optional chaining is lowered only onto a member node; `input.name?.trim()` with an absent `name` reaches `stringMethod` and throws instead of returning `undefined`.
   - Computed values are not kept inside the admitted finite-number domain: `input.count / 0` returns `Infinity`.
   - String-method arity and result-domain closure are not validated.
   - Therefore the proof passes syntax that its interpreter does not execute with the stated ordinary-TypeScript semantics.

   Required repair: encode optional-chain short-circuiting explicitly, enforce exact method signatures and closed runtime value domains after every relevant operation, and add execution—not parse-only—tests for every admitted optional-chain, operator, scalar-method, and failure edge.

3. Bounded capability execution, cancellation, and re-entry are not executable guarantees.
   - Every read result is marked “bounded” solely because its capability kind is `read`; no explicit `first`, maximum rows, or cardinality binding exists.
   - `executePhase` has no statement, row, dependency, duration, deadline, or cancellation owner.
   - The artifact’s `reentryLimit` is encoded but never consumed by `executePhase`.
   - The PostgreSQL simulator separately enforces one statement counter and a hand-written recursion counter, so it does not prove that interpreted lifecycle work shares all outer Mutation budgets.

   Required repair: bind read cardinality into the capability artifact, reject unbounded list/loop sources, and execute through an outer budget/cancellation/re-entry owner that spends statement, row, dependency, duration and cancellation budgets across nested interpreted calls. Add hostiles for each budget and cancellation during nested/loop work.

4. `operation-transaction/proof-kernel.ts` does not enforce the payloadless Operation-level mapping boundary.
   - `compileIssueCapability` receives `declaredErrors: string[]`; it cannot distinguish a payloadless error from a declared payload-bearing error.
   - Runtime `issueMappings` is an arbitrary `Map<IssueIdentity, string>`, so the PostgreSQL proof is not tied to the compiler-admitted declared-error contract.

   Required repair: carry exact declared-error metadata through reachability compilation, reject a payload-bearing target with `QP-COMPOSE-027 invalidIssueMapping`, and execute only the compiler-produced admitted mapping. Add direct/wire tests showing that no mapped payload can be synthesized or borrowed.

5. The compiler and PostgreSQL proofs remain disconnected hand-written models.
   - The PostgreSQL proof never imports or executes the canonical Artifact/interpreter.
   - Its `normalize`, `validate`, candidate Policy, `check`, and `afterWrite` behavior consists of hand-written branches and trace strings.
   - `check` performs no real Policy-aware PostgreSQL read, so same-transaction Policy/selection authority is not proved.
   - Consequently the tests cannot detect divergence between lowered programs and transaction behavior.

   Required repair: run the compiled lifecycle Artifact through a narrow Operation adapter backed by the same PostgreSQL client and outer transaction, including a real Policy-aware `check` read and interpreted nested write/Job acceptance. Keep this proof-only; no production lifecycle implementation is required.

6. `authority-projection.json` contains public examples and wording that the candidate proof contradicts.
   - The projected `normalize` example always emits `reference` and `summary`, violating the rule that absent sparse paths cannot be added; its optional method calls also hit finding 2.
   - The projected `check` example cannot lower because `key` and `select` are forced through current-Collection Field identity lookup.
   - The projected `afterWrite` example similarly uses structural `values`, `select`, `input`, and `idempotencyKey` objects that the lowerer cannot represent.
   - It uses `ctx.callId`, which the approved Deep-DX direction gives to `afterWrite`, but `publicMembers`/`phaseRoots` omit it and the lowerer rejects it.
   - The staged `SPEC.md` says both `normalize` and `validate` are “capability-free”; the ratified criterion is effect-free with no generated effect capability, since `validate` receives generated issue factories.

   Required repair: make the exact projected examples executable tests of the same lowerer/interpreter, preserve sparse paths, represent generated Operation/Job argument objects structurally, restore immutable `ctx.callId` to `afterWrite`, and use the precise effect-free wording. Do not remove `ctx.callId` or simplify the accepted kernel call shapes, as that would diverge from the already approved direction.

Non-blocking observations:

- Acceptance staging is otherwise correct: ADR-0031 remains `Proposed`; the live ADR index, SPEC, CONTEXT, public docs, and HANDOFF do not project acceptance.
- The previous typed `ConstraintViolation` overclaim is removed, and lifecycle/compiler delta attribution is staged.
- The prior BLOCKED record is preserved verbatim; no production lifecycle implementation is present.
- The packet dry-run independently reproduced the expected digest. Compiler tests passed 9/9; focused formatting, lint, strict TypeScript, architecture, and range `git diff --check` passed.
- The review made no repository or Git changes; the worktree remains clean.
