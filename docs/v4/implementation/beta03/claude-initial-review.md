# BETA-03 initial implementation review

- Model: `opus`
- Effort: `medium`
- Diff base: `840eab8098bc7e448c6e42ac4ddf5eff75786be4`
- Reviewed head: `6d0c81392297964180c6032164e3d4b87814b5cc`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

```text
VERDICT: BLOCKED

## Blockers

### 1. `quality/baselines/beta03-execution.json` + `quality/performance/beta03-execution.json` — the performance gate is not a gate, and the required stable-runner report is absent

- `QUEUE.json` BETA-03 requires two evidence artifacts: a "Service lifecycle baseline measurement manifest" **and** a "BETA-03 stable-runner budget report". Only the baseline manifest and a budget *descriptor* are present. No stable-runner report appears in the diff or the acceptance manifest.
- The recorded runner is `"runnerClass": "stable-reference-local"` on `AMD Ryzen 5 5600G` — a local developer desktop, not the tagged stable runner that QUEUE.json and ADR-0021 make the authority for budget claims. The acceptance criterion "the lifecycle microbaseline is recorded on a stable reference runner" is therefore unsupported.
- `roots100Ms` budget is `1000` against an observed `4.63`; a 200× headroom threshold cannot detect regression. `applicationCreates` budget `1` is a correctness assertion, not a performance budget, so the manifest contains no binding timing gate.
- `observed.changedLoopMs: 4070` has no committed producer anywhere in the diff. `tests/performance/beta03-execution.test.ts` measures only `roots100Ms`/create counts and prints them to stdout; nothing writes, reads, or diffs the baseline file, so the recorded numbers are unverifiable hand entries.
- The acceptance manifest reports `bun run quality:release` **PASS**, but QUEUE.json assigns `quality:release` strict budgets to BETA-12 "on tagged stable runner". A local PASS is not evidence for that gate and should not be listed as one.

**Required repair/evidence:** produce the stable-runner budget report named by QUEUE.json; set `roots100Ms` (and any changed-loop budget) to a value derived from the recorded measurement rather than a placeholder; add a committed producer that emits `changedLoopMs` and reconciles `quality/baselines/beta03-execution.json` with a run, or remove the unproduced metric; drop or re-scope the `quality:release` claim.

### 2. `packages/compiler/src/typecheck.ts` / `packages/compiler/src/generate.ts` — generated `app.ts` depends on a subpath that only exists inside the compiler's synthetic program

`renderAppContract` now emits declarations of the form `(typeof import("#questpie/source/execution"))["auditConnection"]`. The `#questpie/source/*` mapping is added only to the throwaway tsconfig built in `typecheckCurrentContract`. Nothing in the diff declares that subpath in the fixture's `package.json` `imports` or its tsconfig, and `fixtures/collaboration/questpie.json` changed only its inventory digest.

Consequence: the emitted `app.ts` artifact — the deliverable behind acceptance criterion "Generated execution declarations are exact" — is resolvable only under a private mapping the application itself does not have. Every exactness assertion in `tests/type/beta03-generated-execution-context.test.ts` is produced under that private mapping, so it does not evidence the consumer-facing contract.

**Required repair/evidence:** show (or add) the application-facing `#questpie/source/*` declaration that the compiler emits/maintains for the app, plus a test that typechecks the generated `app.ts` under the fixture's own tsconfig rather than the compiler's temporary one. If the specifier is intentionally compiler-private, the generated public contract must not depend on it.

### 3. `fixtures/collaboration/src/execution.ts` — dead lifecycle scaffolding; the integration proof is not connected to the compiled fixture Definitions

`resetExecutionFixture`, `executionFixtureState`, and the module-level `lifecycle` / `applicationCreates` / `executionCreates` counters are exported but referenced by nothing in the diff. `tests/integration/beta03-execution-services.test.ts` re-declares `audit.connection`, `audit.execution`, and `app.context` inline with identical names and its own counters, and asserts only `toBeDefined()` on the two compiled projections. The lifecycle golden `tests/goldens/beta03/execution-lifecycle.json` is therefore produced from test-local objects that merely share names with the compiled fixture Definitions.

This ships mutable state and unused exports into the fixture application and leaves a misleading appearance that the fixture drives the lifecycle proof.

**Required repair/evidence:** either import the fixture Definitions into the integration proof (using `resetExecutionFixture`/`executionFixtureState` as the trace source), or delete the unused counters and both exported functions so the fixture carries only what the projections consume.

### 4. `packages/compiler/src/diagnostic.ts` — renaming an already-accepted diagnostic class without cited authority

`QP-COMPOSE-004` changes class from `unresolvedReference` to `unknownReference`, forcing edits to `packages/compiler/src/data/relations.ts` and to the previously accepted `tests/type/beta02-generated-relations.test.ts` expectation. Neither the acceptance criteria nor the cited authority (ADR-0010/0015/0019/0021) covers a diagnostic-surface rename, and the acceptance manifest does not disclose it. This is an observable change to a prior slice's contract carried inside BETA-03.

**Required repair/evidence:** cite the authority that permits renaming the `QP-COMPOSE-004` class and record it in the acceptance manifest, or revert the rename and use `unresolvedReference` in the new `packages/compiler/src/composition/*` code.

## Non-blocking observations

- `packages/compiler/src/composition/index.ts:projectExecutionComposition` emits `context.resolution.nested: "inheritExactResolvedContext"` and `concurrentConsumers: "coalesced"`. Nested roots and concurrent-consumer coalescing of Context Resolution are not implemented or exercised anywhere in this slice (`resolve` is called exactly once per root from a single site). These are contract restatements, not projections of demonstrated behavior; consider gating them on the slice that implements them.
- `packages/runtime/src/execution/index.ts` imports `ContextBootstrap`, `ContextDefinition`, `ContextInputOf`, `ContextResolvedOf`, `Principal`, `ServiceDefinition`, `ServiceDependencyMap`, `ServiceEffect`, `ServiceInstance`, and `ServiceLifetime` as value imports while only `Authority` is marked `type`. This survives only because the transpiler elides type-only uses; it breaks under `verbatimModuleSyntax`.
- `createApplicationRuntime`'s dependency guard validates unknown dependencies, lifetime edges, and effect edges but not cycles. A cyclic program reaches `getService` and deadlocks on a self-awaiting cell instead of throwing, unlike the compiler's `QP-COMPOSE-013` cycle diagnostic. Partial guards that hang are worse than none.
- Disposal failures are silently swallowed on the retained-response abort path (`retainResponseLifetime.onAbort` ends in `.catch(() => undefined)`), and `close()` only `allSettled`s root scopes, so a failing execution-Service `dispose` lets `close()` resolve as clean. The `SuppressedError` chaining in `disposeOwned` is therefore unobservable on those paths.
- `packages/runtime/src/execution/context-input.ts` hand-rolls decode rules (NFC text, safe-integer, UUID pattern, exact object keys) keyed on `codec.kind`. Nothing asserts these agree with the `codec.*` kernel that produced the descriptor. ADR-0019 accepts one scalar/codec kernel; a parity test between descriptor and runtime decoder should land before BETA-05 widens the wire.
- `projectExecutionComposition` calls `canonicalBytes(serviceProjection)` and `canonicalBytes(contextProjection)` and discards both results. If this is a canonicality assertion, it should be explicit; otherwise it is dead work on every compile.
- The `@ts-expect-error` assertions in `tests/type/beta03-generated-execution-context.test.ts` and `tests/type/beta03-service-context-authoring.test.ts` carry no negative control. If the written consumer file ever falls out of the typecheck program, every assertion passes vacuously. One deliberate `@ts-expect-error` on an expression that must *not* error would pin this.
- Generated `ExecutionServices` is a `Readonly` record over all application-owned Services (including application-lifetime ones), while the runtime kernel exposes lazy `service(definition)`. The two shapes are not yet reconciled; whoever wires `createApp()` in BETA-05 must implement the record lazily to preserve ADR-0015's lazy/coalesced creation.
- `renderAppContract` makes generated `app.ts` type-depend on application source modules. Any module that both exports a Service/Context and imports `#questpie/app` will create a circular type reference. The current fixture avoids this only because `src/execution.ts` imports nothing generated.
- An application with zero Context yields `AppContextInput = never`, making `app.execution` uncallable rather than producing a diagnostic. Worth an explicit decision before BETA-05.
```
