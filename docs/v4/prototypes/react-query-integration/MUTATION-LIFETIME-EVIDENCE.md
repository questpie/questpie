# Native Mutation retirement evidence

This Proposed prototype clears attached native Mutation state on scope disposal
and fences responses which arrive after that disposal. It does not change
production exports, accept a public architecture or prove PostgreSQL behavior.
The [candidate](MUTATION-LIFETIME-CANDIDATE.md) states the boundary.

## Reproduced failures and repair

The external HTTP peer holds a generated Mutation response while native
`MutationObserver` consumers dispose their scope. Removing the native cache
entry alone left both the observer and original Promise able to expose the
late result. Resetting the observer hid its data but still disclosed the result
through the options callback and Promise.

The adapter now resets attached observers, removes owned Mutation entries and
checks retirement before handing the generated outcome to native execution.
Each invocation uses one generated Call Identity. A late success becomes a
local `SCOPE_RETIRED` error with a committed disposition and no domain result.
An actual decoded post-commit failure retains its validated transaction ID.
A decoded declared rejection and an unknown transport outcome remain distinct.
Neither scope disposal nor a missing response proves rollback.

One throwing native subscriber initially prevented cleanup of the next
observer. The candidate attempts all owned Mutation resets and removals,
performs its Query cleanup, then reports the subscriber failure. Other scopes
remain untouched. This does not promise cancellation of arbitrary JavaScript
or make application-held copies erasable.

Independent adversarial review found that public error classes and structural
error predicates do not prove decoder provenance. A transport could throw a
publicly constructed `CommittedResultUnavailable` with an unvalidated private
string as its transaction ID, or imitate a declared error. Both new regressions
failed before the repair: nine tests passed, two failed, 42 assertions ran.

Private generated decoder metadata now records only the validated disposition,
Operation and Call Identity at the error construction site. Public constructors
cannot register it. The descriptor checks the Operation; the lifetime owner
checks this invocation's Call Identity. Metadata is frozen and weakly owned by
the decoded exception. Replaying a genuine decoded failure from another call
therefore produces an unknown outcome, not that other call's commit identity.
The existing structural `isError` remains a typing helper only.

The private descriptor is v3. Its version spelling has one renderer input;
older descriptors and the replaced `liveReady` option fail closed. There is no
second lifecycle kernel or compatibility path.

## Checks

With the prototype's pinned dependencies, from this directory:

```sh
bun run test:mutation-lifetime
bun run diagnose:retirement
bun run types:generated
```

On this host, prefix generation and compiler commands with
`TMPDIR=/home/drepkovsky/code/questpie-react-infinite-tmp.KuKz4Y`; `/tmp`
reports `EDQUOT`. Generation must not overlap a Start build.

The focused Mutation suite passes 12 tests with 51 assertions. It includes
completed and pending state, real post-commit recovery identity, forged
exceptions, cross-call replay, late declared/unknown failures, other-scope
isolation and throwing native subscribers. The real ReactDOM consumer also
checks that the completed Mutation title disappears after disposal.

The diagnostic remains explicitly non-acceptance evidence. Candidate disposal
exposes no late observer or Promise result and invokes no late success callback.
Native cache removal alone exposes both; reset-plus-removal hides the observer
but still invokes the success callback and resolves the Promise with its result.

Independent finding-scoped review reran 11 tests with 48 assertions before the
cross-call regression was committed to the test file, and separately executed
that replay probe. It found the provenance blocker closed and no new findings.
This is ordinary review, not a formal architecture PASS.

## Final combined checkpoint

After the provenance repair and formatting, the following parent command
passes 57 tests with 226 assertions:

```sh
bun test live-options.test.ts generated-client.test.ts query-adapter.test.ts generation.test.ts generated-live.test.ts hydration-identity.test.ts infinite-query.test.ts pagination-source.test.ts renamed-pagination.test.ts react-suspense.test.ts mutation-lifetime.test.ts
bun test react-dom.test.ts
bun run types:generated
bun run types:infinite
bun run types:react-errors
bun run types:generation
bun run types:renamed
bun run types:check
bun run diagnose-retirement.ts
```

The separate DOM process passes two tests with 12 assertions, and all six strict
TypeScript projects pass. The Start app was rebuilt after client regeneration;
its types, 37 baseline Firefox assertions and 45 fault assertions pass again.
The exact browser commands and limitations are in
[SSR-LIFETIME-EVIDENCE.md](SSR-LIFETIME-EVIDENCE.md). Changed-file formatting,
lint and `git diff --check` pass. This is not `quality:release`, a release
dry-run or a formal acceptance result.

## Deliberate limits

A native callback that already received an active result may continue after
disposal, and its Promise may resolve with that already-disclosed result.
The detached observer stays idle and its cache entry stays removed. The test
holds an asynchronous `onSuccess` across disposal to demonstrate this limit.
Unattached native handles and application-owned copies are outside cleanup.

This slice does not add optimism, post-commit observation, invalidation, a
retry loop or automatic receipt recovery. Full credential-switch consumers,
production migration and the focused architecture acceptance remain open.
