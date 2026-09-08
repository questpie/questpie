# Collaboration native consumer evidence

This checkpoint tests the proposed adapter against the existing Collaboration
Runtime and PostgreSQL 17. It does not accept the adapter architecture or mark
beta.2 ready. Construction started from `9ec8524ba` on 2026-09-08; concurrent
Start and factory work belongs to separate checkpoints.

The runner creates a disposable PostgreSQL 17 container with an automatically
allocated loopback-only port and the repository CI locale. It verifies that the
test endpoint belongs to that exact container. It discards inherited PostgreSQL
configuration and never resets a shared database. The fixture is copied without
its generated output or dependencies; its private package shim and compiler
output live beneath a task-owned temporary directory.

The test applies the fixture's committed migrations and compiles the full
application. It uses the real generated Runtime behind a loopback HTTP server,
the generated HTTP/SSE client, and native QueryClient/QueryObserver/
MutationObserver. Prototype client instrumentation lives outside the immutable
Runtime artifact. No production source, authored fixture, adapter or database
kernel was changed to make these tests pass.

## What passed

Two tests pass with 39 assertions:

- A local native Mutation invalidates both `messages.page` and `channels.detail`
  in a one-shot server-mode binding. Both explicit subsequent native reads see
  the published message. A second binding with equal Context is untouched.
  This tests two public families, not two modes of one family; active-refetch
  behavior remains covered by `invalidation.test.ts`.
- A browser-mode binding observes two `messages.page` windows with distinct
  limits and the inverse `channels.detail` result through one SSE stream.
  Losing a real Mutation response after execution produces one request and one
  message despite native client defaults requesting three retries. The live
  result still receives that committed write, without an HTTP Query refresh or
  reopening its stream.
- While reconnection is held at the external transport boundary, a message is
  published and an existing row deleted. Releasing reconnection gives both
  families complete current results: the new row appears once, the deleted row
  disappears, and the small window retains its limit. There is one replacement
  stream and no fallback one-shot Query request.
- Changing the real PostgreSQL membership role removes `body` from every live
  window and the inverse result. The test first establishes that the Field was
  present. Deactivating that membership then clears attached native Query data;
  retained options cannot reopen those retired Queries. Explicit binding disposal
  clears its remaining native cache. Membership is restored during cleanup.

The two cases use independent channels. Test cleanup closes native owners, the
HTTP server and Runtime, database connections, the exact owned container and its
temporary directory. The final cleanup audit found no `questpie-r5-*` container
or generated temporary fixture left behind.

## Construction failures retained

The first setup failed because the image's default locale did not match the
committed provider profile. A later startup attempt reached PostgreSQL's
temporary initialization server and lost its connection; readiness now checks
TCP, not that temporary Unix-socket server. Both were harness repairs.

Instrumenting `client.ts` inside the generated artifact correctly failed Runtime
digest verification. Moving the prototype-only client outside that artifact
preserved verification; no manifest or digest was rewritten. The native behavior
tests then passed without an adapter change. These setup failures are not claimed
as red/green evidence of a repaired product defect.

Run from this prototype directory:

```sh
bun run test:collaboration
bun run types:collaboration
```

Both commands pass. Changed-file formatting, lint and `git diff --check` also
pass. The TypeScript check covers this dynamic harness; generated consumer
inference remains the responsibility of the separate typed projects.

Independent review required an exact small-window member after reconnection,
nonempty small/inverse results after Field omission, and cleanup that attempts
all owners even when one close fails. Those checks are now explicit; cleanup
uses the existing `CleanupStack` and nested runner `finally`. The review also
found a local trust-URL spelling rejected by the acceptance packet scanner.
Constructing the same validated local URL through the approved source form
passes that unchanged scanner. The runner also removes inherited
`SQL_DATABASE_URL`. A misplaced new assertion briefly referenced `gap` before
its declaration; moving it to the reconnect phase repaired that harness typo.
The subsequent complete runner and strict typecheck pass. These are proof
repairs, not new Runtime defects or authority changes.

## Boundaries that stay separate

This is an actual PostgreSQL/HTTP/SSE native-observer test, not a Firefox or
TanStack Start test. Start/browser credential switching has its own consumer.
The disconnect case proves complete-result replacement; it does not force
retention-token expiry or retest Change Ledger reconciliation. Those are existing
core guarantees in the PostgreSQL retention/reconciliation suites.

Separate Mutation invocations still receive separate Call IDs. This adapter does
not deduplicate an application's command nonce or replace its durable outbox.
Same-call response-loss and concurrent replay remain covered by
`tests/integration/postgres/beta06-publish-mutation.test.ts`. The two observed
windows are independent complete Queries, not an automatically joined contiguous
conversation window or an atomic cross-Query snapshot.

No framework optimistic layers, causal commit-observation fence, pending Mutation
retirement through PostgreSQL, precise dependency graph, or release acceptance
is established by this checkpoint.
