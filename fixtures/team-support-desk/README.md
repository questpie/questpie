# Team Support Desk

Team Support Desk is the production-like QUESTPIE v4 reference application. It
keeps application declarations, generated artifacts, the Bun host, and the
Firefox tracer visibly separate so a reader can follow one request without
fixture-only shortcuts leaking into application code.

## Module map

- `src/{organizations,memberships,teams,tickets,comments,labels}.ts` own the six
  Collection schemas and relations.
- `src/<domain>/policy.ts` and `src/<domain>/operations.ts` keep authorization
  and Collection lifecycle next to the domain they govern.
- `src/{tickets,comments,labels,teams}/queries.ts` and adjacent query-plan files
  own network Queries, pagination, filters, and nested relation selection.
- `src/ticket-mutations.ts`, `src/ticket-sla-follow-up-job.ts`,
  `src/notification-action.ts`, and `src/inbound-webhook-route.ts` own ticket
  commands and execution-boundary effects.
- `src/execution.ts` resolves the tenant-aware execution context;
  `src/{identity-seed,demo-seed}.ts` provide deterministic public seed data.
- `tracer/host.ts` serves static assets and fixture-control endpoints, runs the
  durable worker, and delegates every framework request to `application.fetch`.
- `tracer/browser/main.tsx` bootstraps React 19. `browser/app.tsx` coordinates
  local UI state, while `browser/tickets/*` owns queue, detail, and dialogs.
  `browser/questpie.ts` is the only application-data transport boundary.

Generated output lives under `.questpie/`; migrations and seeds committed for
the fixture live under `questpie/`.

## Execution flow

The host issues a signed local persona cookie. The browser reads that persona
through the explicitly fixture-only `browser/fixture-control.ts`, creates a
context-scoped generated client, and sends every application Query, Mutation,
and Action through `#questpie/client`. The generated client calls
`/_questpie/operation`; the host delegates it unchanged to `application.fetch`.
Mutations use Policy-authorized Collection operations, comments enqueue their
immediate SLA Job, and the Action performs the external notification request.
The same host polls durable work so delayed, retrying, cancelled, and recovered
runs exercise the PostgreSQL-backed runtime.

## Commands

Run these from this directory with a PostgreSQL 17 connection URL:

```sh
export DATABASE_URL=postgres://postgres:questpie@127.0.0.1:55432/questpie
bunx questpie build
bunx questpie migration apply
bunx questpie seed apply
bun tracer/host.ts --port=43120
```

The host compiles all React source into one minified `/desk.js` browser bundle.
Typecheck the fixture from the repository root:

```sh
bunx tsc -p fixtures/team-support-desk/tsconfig.json --noEmit
```

Run the complete PostgreSQL 17 and Firefox tracer from the repository root:

```sh
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres \
PGPASSWORD=questpie PGDATABASE=questpie QUESTPIE_POSTGRES_MAJOR=17 \
FIREFOX_BIN=/usr/bin/firefox \
bun test tests/integration/postgres/team-support-desk.test.ts
```
