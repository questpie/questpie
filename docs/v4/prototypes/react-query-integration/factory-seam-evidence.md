# Public factory seam evidence

Construction evidence, 2026-09-08. No production export, Accepted authority,
formal review, package installation, or release verdict.

The consumer imports `createQueryAdapter` from `questpie/react-query` and passes
its generated scope and native QueryClient. The type test resolves that proposed
specifier to the isolated candidate through its owned temporary tsconfig. No
generated sibling adapter or application DTO/key mapping is involved.

`factory-seam-contract.ts` attaches one frozen, non-enumerable, versioned symbol
capability before the generated scope is frozen. A separate type-only brand
carries the exact generated contract into the generic factory. The generated
module exports neither ClientProjection nor getClientProjection; canonicalScope
is not a public scope member. Symbol reflection is possible: this is internal
compatibility plumbing, not a same-realm JavaScript security boundary.

`factory-seam.ts` privately reads the capability and calls the existing
bindProjection. It adds no identity, cache, transport, invalidation, or Mutation
lifetime algorithm. Independently built browser bundles each contain their own
copy of the neutral bridge and still interoperate; correctness does not depend
on sharing a module-local registration WeakMap.

## Verified scope

- Four runtime tests / 27 assertions: separate client/factory browser bundles;
  real local HTTP Query and native MutationObserver success/declared failure;
  decoded Date values; opaque public exports and non-enumerable capability;
  missing and incompatible scope rejection before work; root/client browser
  builds whose resolver rejects every React or TanStack runtime dependency.
- Strict TypeScript: native Query and Suspense Query; Mutation inputs/results,
  declared-error predicate and inferred onMutate callback context; forward
  infinite and Suspense infinite options; native tagged cache results; negative
  unknown-operation, raw-timestamp, cursor-override, handler-pagination,
  unguarded-error, public-descriptor and handwritten-lookalike-scope cases.
- Six changed TypeScript files pass repository formatting and lint. Diff check
  passes. No shared generated output, adapter, production, or Start file changed.

From this prototype directory:

```sh
bun run test:factory
```

The package script first prepares the full-source pagination fixture, then runs
the runtime and strict-type checks. Run it sequentially with Start builds.
The isolated runner renders a Task client from the existing normalized compiler fixture.
For forward types it reads existing full-source Support Desk compiler artifacts
and feeds their public Operation contracts, Context codec, and root forward
cursor parameter into the real client renderer. It does not rerun application
compilation. Both runners use task-owned disk-backed `factory-seam-output-*`
directories here and remove those exact directories in finally blocks; no /tmp,
dependency, parent generated-directory, or database mutation is needed.

The TDD sequence first rejected an incompatible scope with the wrong sentinel
error, then passed with the contract check. The separate-bundle positive test
next failed CLIENT_PROJECTION_INCOMPATIBLE before the generated capability was
attached, then passed after attachment. An intermediate HTTP fixture response
omitted the generated wire's required JSON charset and failed
PROTOCOL_UNSUPPORTED; fixing that external peer header required no client change.

## Peer and extraction limits

The factory has no runtime React or TanStack import: QueryClient is supplied by
the host and its library imports are type-only. Its actual library runtime
dependency is @noble/hashes. Importing this factory alone therefore does not
establish missing-React/Query import failure. A production peer contract must
govern compatible installation, type resolution, and native consumer use; do
not add a decorative side-effect import to inherit the old thin-hook failure
clause. Root and generated-client optional-dependency isolation are tested by
rejecting resolution, not by installing a package without peers.

The symbol and scope protocol identifiers remain prototype-only. The renderer
composes the existing instrumentation and applies exact, guarded replacements
to remove public descriptor exports and attach the capability. Production must
replace this scaffolding with direct compiler lowering, not ship string
rewrites, a public descriptor getter, or compatibility with prototype versions.
No raw key/DTO registry, optional DB integration, or framework optimism is added.

Production package/export/declaration and relocated packed-consumer gates,
full-source production generation, consumer migration, broader lifetime/browser
regressions, and the focused architecture decision remain separate obligations.
