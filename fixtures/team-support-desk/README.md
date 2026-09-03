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
- `src/{tickets,labels,teams}/queries.ts` and adjacent query-plan files own
  network Queries, pagination, filters, and nested relation selection. Ticket
  detail projects its bounded comments array in the same structural Query.
- `src/ticket-mutations.ts`, `src/ticket-sla-follow-up-job.ts`,
  `src/notification-action.ts`, and `src/inbound-webhook-route.ts` own ticket
  commands and execution-boundary effects.
- `src/execution.ts` resolves the tenant-aware execution context;
  `src/{identity-seed,demo-seed}.ts` provide deterministic public seed data.
- `src/auth/*` owns the Better Auth-backed credential Service and the public
  `/api/auth/*` Routes. `runtime/better-auth.ts` owns deployment-time auth
  configuration and its bounded PostgreSQL pool; `tracer/auth/*` owns Better
  Auth migration and idempotent local identity seed entrypoints.
- `tracer/host.ts` serves static assets and fixture-control endpoints, runs the
  durable worker, and delegates every framework request to `application.fetch`.
- `tracer/browser/main.tsx` bootstraps React 19. `browser/app.tsx` coordinates
  local UI state, while `browser/tickets/*` owns queue, detail, and dialogs.
  `browser/tickets/edit-input.ts` derives role-aware edit input from the
  generated client contract, `browser/tracer/*` owns Firefox automation,
  `browser/auth/*` owns Better Auth login/session/logout, and
  `browser/questpie.ts` is the only application-data transport boundary.

Generated output lives under `.questpie/`; migrations and seeds committed for
the fixture live under `questpie/`.

## Execution flow

The browser signs in through the Better Auth React client. Two public QUESTPIE
Routes delegate `GET` and `POST /api/auth/*` to the standard Better Auth handler;
the application credential resolver validates its session and emits a user
Principal. Session Organization, Membership, and role values are routing hints:
`src/execution.ts` re-reads the current Membership and remains tenant and Policy
authority. The browser then creates a context-scoped generated client and sends
every application Query, Mutation, and Action through `#questpie/client`. The
generated client calls
kind-specific `/_questpie/query/<name>`, `/_questpie/mutation/<name>`, and
`/_questpie/action/<name>` endpoints; the host delegates them unchanged to
`application.fetch`.
Mutations use Policy-authorized Collection operations, comments enqueue their
immediate SLA Job, and the Action performs the external notification request.
The same host polls durable work so delayed, retrying, cancelled, and recovered
runs exercise the PostgreSQL-backed runtime. The sole manual browser `fetch`
posts Firefox progress to the clearly fixture-only report endpoint.

## Commands

Run these from this directory with a PostgreSQL 17 connection URL:

```sh
export DATABASE_URL=postgres://postgres:questpie@127.0.0.1:55432/questpie
export BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
# Optional for tailnet HTTPS, for example: devbox.example.ts.net:*
export BETTER_AUTH_TRUSTED_HOST=your-host.your-tailnet.ts.net:*
bunx questpie build
bunx questpie migration apply
bunx questpie seed apply
bun run auth:migrate
bun run auth:seed
bun tracer/host.ts --port=43120
```

The local auth seed creates three public fixture identities:

| Role     | Email                      | Password              |
| -------- | -------------------------- | --------------------- |
| Customer | `customer@support.example` | `Customer-demo-2026!` |
| Agent    | `agent@support.example`    | `Agent-demo-2026!`    |
| Admin    | `admin@support.example`    | `Admin-demo-2026!`    |

These credentials are demo data, not deployable secrets.

The host compiles all React source into one minified `/desk.js` browser bundle.
It also serves the compiler-generated OpenAPI document at `/openapi.json` and
an interactive Scalar view at `/api-reference`. Scalar is fixture-only: it
renders the same checked artifact and does not add a QUESTPIE Runtime route or
another operation registry.
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

For tailnet-only manual testing, keep the host bound to loopback and let
Tailscale terminate HTTPS on a dedicated port:

```sh
tailscale serve --bg --https=8444 http://127.0.0.1:43120
```

Open `https://<machine>.<tailnet>.ts.net:8444/` from an authorized tailnet
device. Do not use Funnel for this fixture. Inspect existing Serve mappings
before adding or removing this port so unrelated services remain untouched. To
remove only this mapping, run `tailscale serve --https=8444 off` (with `sudo`
when the local Tailscale operator policy requires it).
