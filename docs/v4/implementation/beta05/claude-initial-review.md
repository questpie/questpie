# BETA-05 initial implementation review

- Model: `opus`
- Effort: `medium`
- Diff base: `275cad0c1d25251dc5d1ca1835a1316769218d7c`
- Reviewed head: `a2a3c90f30d3c0845c1b2b7e6595574d89d1826f`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

````text
VERDICT: BLOCKED

## Blockers

**1. Head commits obfuscate source solely to shape the review packet**
`tests/integration/postgres/helpers/beta05-runtime.ts:31`, `tests/type/beta05-generated-application.test.ts` (consumer fixture body)

The two commits at the reviewed head (`aa655519`, `a2a3c90f`) are titled "keep review packet credential-free" / "avoid credential-like review text". Their effect in the diff is:

```ts
const url = new URL(["postgres:", "//localhost/"].join(""));
...
if (process.env.PGPASSWORD) url["password"] = process.env.PGPASSWORD;
```

and `createApp({ postgres: { url: ["postgres:", "//localhost/questpie"].join("") } })` in the generated-app type consumer.

`postgres://localhost/` contains no credential, so the stated justification does not hold; what was changed is how the text reads to an automated scan/reviewer, not what the code does. `url["password"]` computed member access in place of `url.password` is the same pattern applied to a lint/scan rule. Editing source so a gate or a reviewer sees different text is not an acceptable way to satisfy either.

Required: restore plain, readable literals (`new URL("postgres://localhost/")`, `url.password = ...`), and if a repository scanner genuinely flags them, supply the exact rule identity and a documented allowlist entry instead of in-source evasion.

**2. Generated handler contract types `timestamp` as `string` while the same pinned codec is `Codec<Date>`**
`packages/compiler/src/generate.ts` (`handlerOutput: ${renderCodecType(contract.output, "string")}`), `packages/compiler/src/runtime/client.ts` (`renderCodecType(..., timestampType)`)

`codec.timestamp()` is declared `Codec<Date>` (`packages/questpie/src/codec/index.ts`), `QueryFactory.output` is typed `Codec<GeneratedQueries[Name]["output"]>` (Date), and direct/generated-client callers receive `Date`. But the generated handler signature now requires `GeneratedQueries[Name]["handlerOutput"]`, in which every timestamp is `string`. The runtime codec accepts both (`transform(..., "runtime")` takes `Date | canonical string`), so the type contract and the runtime contract disagree, and the authored handler surface becomes a third timestamp representation.

This contradicts acceptance criterion 4 ("canonical ISO strings **only** on the raw wire") and silently narrows ADR-0011's output-pin semantics ("An explicit output pin determines and validates the contract ... and cannot cast an unsafe JavaScript value"). Nothing in `docs/v4/implementation/beta05/design-context.md` mentions `handlerOutput` or this asymmetry, and no test covers the handler-side typing.

Required: either accept `Date` on the handler surface for a `codec.timestamp()` pin, or record the divergence as an owned, documented decision in the design context with a type test pinning both surfaces.

**3. Published compiler now depends on the private runtime package and resolves `.ts` sources at run time**
`packages/compiler/package.json`, `packages/compiler/src/artifacts.ts:328-345`

```ts
const runtimeBundleEntry = fileURLToPath(import.meta.resolve("@questpie/runtime/bundle"));
...
readinessEntry: join(import.meta.dir, "runtime/postgres-readiness.ts"),
```

`@questpie/runtime` is `"private": true` and exports `"./bundle": "./src/bundle.ts"`. The compiler additionally resolves one of its own `.ts` files relative to `import.meta.dir`, which will not exist beside emitted output from the package's own `tsc` `build` script. The manifest asserts `bun run package:check` PASS, but no packed-tarball evidence is supplied for either resolution path, so the gate result does not establish the property it appears to cover.

Required: evidence that `@questpie/compiler` is itself private/unpublished, or a packed-consumer run showing both `@questpie/runtime/bundle` and `runtime/postgres-readiness.ts` resolve from an installed tarball.

**4. BETA-01-owned compile budget is not re-established after adding a full `Bun.build` to every compile**
`packages/compiler/src/runtime/application.ts` (`renderApplicationBundle`), `tests/hostile/beta01-compiler-hostile.test.ts` (`setDefaultTimeout(45_000)`), `tests/type/beta01-generated-contract.test.ts` (`15_000`), `tests/unit/beta05-runtime-artifacts.test.ts` / `tests/type/beta05-generated-application.test.ts` (`30_000`)

`createArtifacts` now runs a complete `Bun.build` on every `compileApplication`. The only visible response in the diff is raising test timeouts on BETA-01-owned tests. BETA-01 owns "changed loop <= 5 s on reference machine" and a "structural compiler stable-runner budget report"; no BETA-01 baseline or performance manifest is updated here, and the BETA-05 baseline measures only Runtime cold start and wire calls, not compile time.

Required: either a re-measured BETA-01 compiler baseline showing the accepted budget still holds, or an explicit owned budget change with evidence — raising per-test timeouts is not evidence.

## Non-blocking observations

- `defineQuery` is implemented twice: once rendered into `app.ts` and once as an inline JavaScript string inside the bundler plugin (`packages/compiler/src/runtime/application.ts`, `questpie-authoring` namespace). They agree today; drift in `identity` would be caught by `validateRuntimeExecutableBindings`, drift in `network` would not. No golden ties the two.
- `tests/unit/beta05-workspace-build.test.ts` spawns `bunx turbo run types:check --dry=json` from a unit test. `bunx` can reach the network; this is a portability hazard for a `tests/unit` scenario.
- The QUEUE-required `bun run test:postgres -- --scenario beta05` is not listed verbatim in the acceptance manifest; the substituted GitHub Actions run (PostgreSQL 16/17/18) is broader but is a substitution, not the specified command.
- `requestBytes`/`responseBytes` "budgets" in `quality/baselines/beta05-runtime-client.json` are set to the protocol limits (1,048,576) against observed 523/869. These cannot detect regression and are not derived like the other four metrics.
- `RESOURCE_LIMIT` is returned with status 500 on response-size overflow (`packages/runtime/src/application/index.ts`) while `operationFailureStatus` maps it to 429. Clients read the frame code, so behavior is unaffected.
- The generated client hardcodes `timeoutMilliseconds: options.timeoutMilliseconds ?? 5_000`, and the wire contract places no upper bound on `timeoutMilliseconds`. Neither default nor cap appears in `design-context.md` or `wire-contract.json` limits.
- `serverBundleDigest` verification is self-referential: the executing `internal/application.js` reads and hashes its own path. Cross-application forgery is caught by the compiled `application` literal (proven by the postgres forged-identity case), but on-disk tampering of the bundle itself is not.
- Runtime startup reads and hashes every inventory path, including `app.ts`, `client.ts`, and `internal/package-contracts/*.ts`. Deployment therefore must ship the generated TypeScript sources next to the server bundle.
- Schema-fingerprint enforcement in `verifyPostgresRuntimeReadiness` is exercised only indirectly; the postgres hostile mutates `schemaFingerprint` without redigesting, so it fails at the Runtime Build digest check rather than at the fingerprint comparison. A self-consistently redigested fingerprint mismatch is untested.
- `applicationEntry` reads `queryProjection.queries` unconditionally, while `createArtifacts` only populates relational projections when `relational.hasRelationalArtifacts`. An application without relational artifacts would fail during bundle emission.
- Adding `codec.array`/`nullable`/`optional`/`timestamp` and removing the `{ nullable }` scalar option is a change to the stable `"questpie"` surface made inside a Runtime/client slice. It is covered by ADR-0019 authority and by `tests/unit/beta05-codec-kernel.test.ts`, but ADR-0017 assigns final public naming to a separate owner.
````
