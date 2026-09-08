# Published-package behavior probes

These isolated research probes test TanStack package behavior, not a QUESTPIE
adapter or authorization implementation. They use synthetic rows and controlled
promises, without a database, browser or application server.

Copy this directory outside a Bun monorepo before installing. Then run its
package scripts with the pinned lockfile:

```sh
bun install --ignore-scripts --frozen-lockfile
bun run probe
```

The run used Bun 1.3.14. Exact dependencies and integrity hashes are in
`package.json` and `bun.lock`. No QUESTPIE workspace dependency changes are needed.
`results.json` records the successful run; an assertion failure produces a
nonzero exit. Source inspection also covered query-db-collection, but the
executable cases directly exercise DB and Query Core.

The cleanup case deliberately asserts the surprising upstream behavior: a
pending successful direct transaction repopulates a cleaned collection. It is
not a desired QUESTPIE contract. The later guard case demonstrates only that a
local post-await retirement check blocks this specific path; it is not proof of
a complete secure adapter.

The queued-receipt case observes that application waits on the pending handler,
then releases that handler. It does not intentionally hang a process to prove
the circular-wait consequence. Every gate is released and fixture cleanup is
awaited.

The streamed-query case ends its controlled stream after checking that first
data is visible while fetch remains pending. A stream can therefore be useful
with Query, but using it unmodified does not provide finite live prefetch.
