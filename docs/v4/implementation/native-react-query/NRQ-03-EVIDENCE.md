# NRQ-03 native Start browser delivery

The production `questpie/react-query` export now runs through an actual TanStack
Start client/server build and headless Firefox. The fixture lives under
`tests/support/native-start`; `native-start-run.ts` owns compilation, strict
types, browser processes and disposable files. No prototype adapter or generated
source instrumentation participates.

## Execution and proof boundary

Run from the repository root with a writable task-owned `TMPDIR`:

```sh
bun tests/support/native-start-run.ts all
bun run check:changed -- --test tests/integration/native-start.test.ts --typecheck questpie
```

The runner also accepts `build`, `baseline`, `faults`, `credentials` and
`readiness`. The ordinary integration test builds and typechecks; it does not
silently claim browser coverage. The explicit `all` command runs Firefox.

Live and infinite consumers compile the complete Support Desk source. The
ordinary browser control separately uses the existing production compiler-IR
renderer. Current source-authored Queries in this fixture are watchable, even a
pure Date echo: calling that control ordinary would test the wrong branch.
The runner verifies the ordinary control exposes no `.watch`. Both generated
clients share one native QueryClient and the exact first-document Promise.
Their two identity bootstraps travel through the same official Router hydration
payload. This partition is test instrumentation, not a recommended two-client
application structure or proof of a non-live source authoring API.

The peer returns generated-contract-typed protocol results and exercises the
real generated decoder, HTTP/SSE client and native cache. It is not PostgreSQL
Policy evidence; [NRQ-02](NRQ-02-EVIDENCE.md) owns that separate control.

## Verified browser behavior

The final complete run passes the production build and strict TypeScript, then:

- Baseline: 37 assertions for finite server calls, request isolation, Date
  hydration, pending Suspense streaming, future server timestamps, interactive
  browser controls, shared live handoff and full null replacement.
- Faults: four scenarios, 45 assertions, for truncated and errored streams,
  failed modules and navigation during pending delivery.
- Credential replacement: 26 assertions for equal Context on the same native
  cache, old Query/Mutation option fencing, late hydration removal and suppressed
  late Mutation data with preserved known-commit disposition.
- Readiness: three scenarios for ordinary, infinite and live execution held
  together; successful resumption, cancellation before release and retirement
  before release all pass.

The readiness control first verifies the actual route serves SSR content. It
resets the peer's document-completion witness before Firefox's separate request.
While an asset holds document readiness, all three native fetch states must be
`fetching`, hydrated Dates must remain usable and no browser Operation or SSE
may dispatch. This prevents disabled observers or fresh server timestamps from
making the gate assertions vacuous.

After release, real React handlers fetch nonempty pages through native
`useInfiniteQuery` and `useSuspenseInfiniteQuery`. `maxPages: 2` retains pages
two and three; a terminal fetch adds no request; refetch begins from the retained
anchor. Exact observed cursors are `null`, first, second, first, second.
Cancellation and retirement produce no delayed old dispatch. Retired ordinary,
infinite and live options fail; a fresh scope succeeds.

The initial readiness test failed on the missing route. Its next failure showed
that native `refetchQueries` skips disabled observers; explicit invalidation plus
`fetchQuery`/`fetchInfiniteQuery` now proves pending work despite clock skew.
The watchable Date echo then exposed the ordinary-control partition above.
None of these test repairs changes the production adapter or adds a fallback.

## Limits and cleanup

Document `load` is an ordering signal, not an integrity check. In the interrupted
stream cases it still fires, allowing the existing live transport to replace
results; the test does not label those streams successfully hydrated. Failed
modules leave static SSR content and open no watch. A document that never
settles can keep readiness pending indefinitely. Manually replayed scripts,
persistence restore and bfcache recovery remain outside the guarantee.

The runner uses owned compiler and Vite scratch directories. Each Firefox
scenario removes its profile and stops its loopback server; graceful browser
termination has a bounded kill escalation. The runner removes its entire owned
temporary root on success or failure. Existing dependencies are symlinked,
not modified. The three root devDependencies select versions already present
in the lockfile; no package version was upgraded for this tracer.

The changed-scope command passes one build test / one assertion, format, lint,
the questpie typecheck and `git diff --check`. Combined quality/release and
independent Standards/Spec review still follow this focused evidence. Golden
consumer migration, packed/docs/skills closure and aggregate beta.2 acceptance
remain separate successor work.
