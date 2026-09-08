# Native pending-intent recipe

Candidate evidence for the owner-confirmed beta.2 optimism scope. This is not
Accepted public behavior or a framework optimistic engine. The application
renders pending intent separately from the latest successful authorized Query
result. It never saves or restores a whole Query cache snapshot.

`userland-optimism.types.ts` is the complete compile-only hook recipe. It uses
generated Query and Mutation options with native `useQuery` and `useMutation`.
The Operation owns input, result, declared-error and cache-key types. Native
`onMutate` infers the application context returned to `onSuccess`, `onError`
and `onSettled`. Negative cases reject wire strings for generated timestamps,
incorrect callback-context operations and unguarded declared-error access.

The returned UI value keeps `base` and `pendingStatus` separate. Pending status
appears only while the Mutation is pending and its row remains in the current
successful Query result. A null or failed Query hides the intent; the recipe
does not render retained Mutation input as if it were authorized Query data.
The example's matching identifier is domain UI logic, not a cache identity or
an inferred write-set.

## Executable boundary

`userland-optimism.test.ts` drives the generated Task client and native
`QueryObserver`/`MutationObserver` against an actual loopback HTTP peer. Only
the external peer controls wire outcomes. Five cases establish:

- pending input renders beside the current base, follows a newer result and
  disappears when the Query fails or its authorized result becomes null,
  even when native cache state retains the previous result after failure;
- a rejected overlapping transition cannot overwrite another successful edit;
- native callback context remains during an awaited success callback, while
  Mutation observer result data is not yet published; scope retirement clears
  retained observer state, but cannot erase an application copy already made
  by a running callback;
- a correlated `COMMITTED_RESULT_UNAVAILABLE` cannot restore an earlier base;
- an unusable HTTP outcome stays an ordinary unknown failure and cannot
  restore an earlier base or trigger a Mutation retry.

No test patches Query data, invents Operation DTOs or authors cache keys.
Native error/result state owns the pending marker's lifetime. Every test
settles its pending peer responses, stops its server, releases subscriptions,
resets observers, disposes the adapter and clears its QueryClient.

The first red case had only the authoritative base and no pending marker;
it failed the expected `pending: "done"` assertion. Reading the native pending
variables behind the current-base guard made it green. The unknown-response
probe initially expected a `code` field; inspection showed the generated
protocol failure is an Error with message `PROTOCOL_UNSUPPORTED`, so the probe
was corrected without changing the client or inventing an outcome type.

## Verification

Run from this prototype directory, using its existing generated clients:

```sh
bun test userland-optimism.test.ts
bun run types:generated
```

The runtime suite passes five tests and 41 assertions. Strict TypeScript,
changed-file repository format/lint, and `git diff --check` pass. No
regeneration, dependency changes, production edits or adapter edits were
required. The main construction lane owns descriptor v4 and invalidation.

Independent review found no scope blocker. Its test-peer finding led to an
explicit decoded-error assertion: the original `AUTHORIZATION_FAILED` response
was not a canonical Operation HTTP failure. Adding `retryable` alone still
failed. The peer now returns the canonical `UNAUTHENTICATED` / 401 failure and
the test verifies that code. This is client failure handling, not a claim to
have executed authentication or Policy in the peer.

## Limits

The HTTP peer supplies authorized-result replacement/removal; these tests do
not establish PostgreSQL Policy execution or an SSE delivery guarantee. Native
Mutation completion can precede observation of a corresponding Query snapshot.
Removing pending intent at completion can therefore expose a temporary old
base. This recipe promises neither no flicker nor causal commit observation.

It does not implement ordered optimistic layers, rollback/rebase, automatic
Mutation replay or arbitrary safe cache mutation. Query errors hide the base
instead of treating stale data as fresh authority. Application-held copies and
already-started callbacks remain application-owned after adapter retirement.
Broader consumer and release evidence remains separate.
