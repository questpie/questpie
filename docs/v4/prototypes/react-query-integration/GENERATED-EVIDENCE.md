# Generated native options: R1 construction evidence

This records the generated Query/Mutation experiment on 2026-09-08, not a
finished adapter or an acceptance PASS. R1 remains partial.

The Task contract is written once as normalized compiler IR in
[task-contract.fixture.ts](task-contract.fixture.ts). The production client
renderer emits the baseline client, then a throwaway instrumentation step adds
a lazy scope accessor and generates a sibling that binds native Query options.
Input/output types refer to the existing generated methods. Error payload types
are projected from the same declared-error contract. No client DTO or key
registry is authored separately.

## Measured behavior

`test:generated` passes nine tests and 38 assertions with Query Core 5.102.8.
The generated client performs codec validation, named Query GET and Mutation
POST construction, response correlation and decoding. A synthetic Fetch peer
supplies responses; no server or PostgreSQL runs in this slice.

- Equivalent encoded Date inputs share a key; separate scopes with equal
  Context values do not. Keys contain no raw input or Context values.
- Mutating the caller's Date after options creation does not change the request.
- Concurrent native Mutation calls with the same variables object receive
  distinct call IDs. Automatic retry is disabled.
- A generated predicate narrows `unknown` to the exact declared error payload.
  An arbitrary transport Error remains the same object and does not narrow.
  Invalid declared payloads are rejected by the existing decoder.
- Retiring a binding clears retained Query observers, preserves another scope,
  and prevents old Query/Mutation options from reopening transport. This does
  not prove retirement of a Mutation already in flight.
- The instrumented client bundles for a browser with no React or TanStack
  runtime dependency. Instrumentation rejects a changed renderer seam.

The strict compile-only consumer verifies Date input/output, native cache result
inference, exact declared error narrowing, and rejection of missing Operations
and unimplemented Actions. Generator source and generated consumer use separate
typecheck projects. The existing watch experiment still passes ten tests and
32 assertions; it has not yet been connected to these generated descriptors.

The idempotent-binding assertion failed before the binding registry was added.
The baseline Mutation response fixture initially read the Query call-ID header
and was rejected with `PROTOCOL_UNSUPPORTED`; correcting the fixture to use
`Idempotency-Key` fixed that test without changing production transport.
Formatting moved one negative type assertion away from its offending property;
placing the directive on the property restored the typecheck. The later
retirement and browser-bundle checks passed on first execution and are coverage,
not claimed red/green repairs.

## Opus consultation and adjudication

A tools-disabled, stateless `claude -p --model opus --effort high` design
consultation succeeded in 228,499 ms. Transport metadata reported
`claude-opus-5` and auxiliary `claude-haiku-4-5-20251001`. This was not a formal
acceptance invocation. Prompt SHA-256:
`19359dea618b48c687a1fddd49665a19e2ad479eff6dc8c50429b89228287fce`.
The local prompt and response are retained in the owned
`questpie-react-descriptor-consult.luArMO` directory outside the repository.

The candidate adopts the generated sibling and lazy scope accessor. It rejects
the suggested canonical-input keys because they expose input values, and the
per-module counter identity because separate generated client copies can
collide. It also rejects a new unknown-error wrapper: native `unknown` plus a
generated predicate preserves the actual transport contract. Declared errors
have `code`, `status` and `payload`, not an invented `retryable` field. Lazy
registration adds a WeakMap entry; the result is not described as zero-cost.

## Reproduction and remaining blockers

From this directory in a repository checkout with repository dependencies and
the prototype's pinned dependencies installed:

```sh
bun run test:generated
bun run types:generation
bun run types:generated
bun run test
bun run types:check
```

Unlike the standalone watch proof, generation imports the repository compiler.
The fixture is normalized IR, not an application passed through source discovery
and compilation. The HTTP/client digest strings are synthetic fixture inputs,
not verified artifact bindings. No full compiler or direct/server parity is
claimed. Generated output is ignored and recreated by `generate:proof`.

The provisional 128-entry capture table has no reclamation on native cache
eviction or abandoned render options. It must not become a production lifetime
cap by accident. Reserved option overrides, complete credential retirement
across pending Mutations, declared live failure translation, actual watch
transport integration, generation cost at larger application sizes, React,
PostgreSQL causal observation, inferred invalidation and optimistic layers
remain blocking work in the [decision map](../../research/react-tanstack-integration-2026-09-08/DECISION-MAP.md).
No public authority, package export, release scope or Autopilot code changed.
