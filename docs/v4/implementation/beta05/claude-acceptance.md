# BETA-05 acceptance review

- Model: `opus`
- Effort: `medium`
- Diff base: `275cad0c1d25251dc5d1ca1835a1316769218d7c`
- Reviewed head: `884b5d8a5f051b23d34705be9916140629187509`
- Invocation: fresh, stateless, no tools
- Verdict: `PASS`

## Raw findings

```text
VERDICT: PASS

The four blockers from `docs/v4/implementation/beta05/claude-initial-review.md` are repaired with evidence in this diff:

1. **Packet-shaping source edits** — `tests/integration/postgres/helpers/beta05-runtime.ts` now uses plain `new URL("postgres://localhost/")` and `url.password = process.env.PGPASSWORD`, and `tests/type/beta05-generated-application.test.ts` uses a plain literal. The scanner rule is now explicit (`.agents/skills/questpie-v4/scripts/acceptance-packet-secrets.ts`), documented (`references/repository-quality.md`), and carries positive fixtures plus negative controls for real URL credentials, remote hosts, query strings, fallback/alternate-env forms, and computed-property spellings (`tests/unit/acceptance-packet-secrets.test.ts`). The wrapper now scans authority documents, the manifest, and the diff separately, and the negative-control mask is path- and marker-scoped with its own test.
2. **`handlerOutput` timestamp asymmetry** — `packages/compiler/src/generate.ts` now renders `handlerOutput` with the same `renderCodecType(contract.output)` (Date) as `output`, and `tests/type/beta05-generated-application.test.ts` pins both the `satisfies Date` and the `@ts-expect-error … satisfies string` direction.
3. **Private-package resolution** — `packages/compiler/package.json` declares `@questpie/runtime`, `questpie`, `@types/bun`; `artifacts.ts` derives the readiness entry extension from `import.meta.url`; `scripts/package-contract.ts` adds a relocated dist-only closure that compiles the fixture from an installed layout and asserts `internal/application.js` is emitted; `turbo.json` gains `dependsOn: ["^build"]` with `tests/unit/beta05-workspace-build.test.ts` (now using the local `.bin/turbo`, not `bunx`).
4. **BETA-01 compile budget** — `quality/baselines/beta01-compiler.json` is re-measured with `runnerClass`, `recordedAt`, `samples`, and aggregation recorded; `tests/performance/beta01-compiler.test.ts` now asserts against baseline-owned budgets rather than inline constants. Observed `compileMs` 1480.4 against the unchanged 5000 budget.

Criterion coverage also improved: the PostgreSQL hostile now includes a self-consistently redigested `schemaFingerprint` mismatch that fails at `verifyPostgresRuntimeReadiness`, alongside the redigested forged-identity case that still fails at the compiled bundle boundary.

## Non-blocking observations

- `packages/compiler/src/discovery.ts` relaxes a BETA-01-owned purity rule so `new Date(x)` is pure inside a function body. The rule is defensible (zero-arg and multi-arg construction stay impure, top-level stays impure), and the existing hostile suite still passes, but this diff adds no case pinning the new boundary — specifically module-scope `new Date(x)` and in-function `new Date()`. Worth a negative control before the rule is relied on further.
- Two `defineQuery` implementations still exist: the one rendered into `app.ts` and the inline string in the `questpie-authoring` bundler namespace (`packages/compiler/src/runtime/application.ts`). `identity` drift is caught by `validateRuntimeExecutableBindings`; `network` drift is not, and no golden ties them.
- `requestBytes`/`responseBytes` in `quality/baselines/beta05-runtime-client.json` are set to the protocol limits (1,048,576) against observed 523/869, unlike the other four metrics which have recorded derivations. They cannot detect regression.
- `RESOURCE_LIMIT` on response-size overflow returns HTTP 500 (`packages/runtime/src/application/index.ts`) while `operationFailureStatus` maps that code to 429. Clients read the frame code, so behavior is unaffected.
- The generated client's `timeoutMilliseconds ?? 5_000` default and the absence of an upper bound in `wire-contract.json` limits are not stated in `design-context.md`.
- Runtime startup hashes every inventory path, including `app.ts`, `client.ts`, and `internal/package-contracts/*.ts`, so deployment must ship the generated TypeScript sources beside the bundle. `serverBundleDigest` verification remains self-referential for on-disk tampering of `internal/application.js` itself.
- `applicationEntry` reads `queryProjection.queries` unconditionally while `createArtifacts` only populates relational projections when `relational.hasRelationalArtifacts`; an application without relational artifacts would fail during bundle emission.
- `tests/goldens/beta01/generated-digests.json` now pins the byte digest of a `Bun.build` output, which couples the golden to the exact bundler version. `compiler.bunVersion` already participates in the Runtime Build, so the coupling is visible, but the golden will churn on any Bun upgrade.
- The QUEUE-specified `bun run test:postgres -- --scenario beta05` is still not listed verbatim in the manifest; the CI PostgreSQL 16/17/18 run is a broader substitution.
- Manifest reports "30/30" for `review:accept:negative-control`; `tests/unit/acceptance-packet-secrets.test.ts` contains 28 `test.each` cases plus one masking test (29). Confirm the count wording matches the runner output.
```
