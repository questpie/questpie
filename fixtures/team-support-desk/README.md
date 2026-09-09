# Team Support Desk

Team Support Desk is the QUESTPIE v4 reference application for a tenant-aware
support queue. Follow a browser interaction through generated Operations,
Policy, PostgreSQL writes, and Live Query updates.

## Recommended application layout

Group source by the business domain that changes together. This tree is an
application convention, not a compiler requirement: `questpie.json` selects
`src` for Definition discovery, while explicit Resource names own identity.

```text
src/
  demo-ids.ts                   public fixture Resource and actor identifiers
  execution.ts                  application Context
  tickets/
    index.ts                    Ticket Collection and lifecycle
    policy.ts                   Ticket authorization
    operations.ts               Collection Operation declarations
    queries.ts, query-plans.ts   named and structural Queries
    mutations.ts                ticket commands
    sla-sweep.ts, sla-follow-up.ts
    inbound-webhook.ts
  organizations/, memberships/, teams/, comments/, labels/
  auth/                         credentials, Routes, auth Service
  notifications/                notification Action and Service
web/
  main.tsx, app.tsx              product UI entry and composition
  auth/                         auth gate and credential-owned subtree lifetime
  tickets/                      native Query/Mutation controls and pending intent
  questpie.ts                   generated scope, QueryClient, adapter and inferred types
  shared/format.ts              formatting used by several components
runtime/                        external deployment adapters
questpie/                       committed migrations and immutable Seeds
tracer/                         local host, receiver, and test automation
.questpie/                      compiler output
```

Each domain's `index.ts` contains its Collection declaration; it is not a
pass-through barrel. Keep named Operations and local helpers beside that
Collection. Add a shared helper only after real consumers need it. Source moves
retain Resource names but change Origins and executable artifacts: rebuild and
review the generated diff after a move. Do not rewrite migration or Seed
history to match the folder layout.

Useful entrypoints:

- [Ticket schema and lifecycle](src/tickets/index.ts),
  [Policy](src/tickets/policy.ts), and [commands](src/tickets/mutations.ts).
- [Context](src/execution.ts) and [credential resolution](src/auth/credentials.ts).
- [Web app](web/app.tsx), [selected ticket](web/tickets/selected.tsx), and
  [generated client boundary](web/questpie.ts).
- [Credential-owned subtree lifetime](web/auth/desk-session.tsx) and its
  [session/Context key](web/auth/gate.tsx).
- [Runtime adapters](runtime/) and [committed database artifacts](questpie/).
- [Tracer host](tracer/host.ts) and [browser tracer entry](tracer/browser/main.tsx).

## Application and tracer boundaries

The browser signs in with the Better Auth React client. QUESTPIE Routes delegate
`/api/auth/*` to Better Auth, and credential resolution produces a user
Principal. Session Organization, Membership, and role values are routing hints;
Context reads the current Membership and Policy controls each Operation.
All application data uses `#questpie/client`. `questpie/react-query` supplies
native options for TanStack's `useQuery` and `useMutation`. One credential-owned
subtree owns the QueryClient, generated scope and Query Adapter. A changed auth
session or Context replaces that subtree; cleanup retires its adapter and clears
its cache. Equal Context does not make two credential sessions interchangeable.
Watchable Queries deliver complete results into that same native cache.
Exact-reference search and the summary Action use the generated scope directly;
they do not create another displayed-result cache.

[SelectedTicket](web/tickets/selected.tsx) is the typed pending-intent recipe.
Its comment Mutation infers input and `onMutate` context from generated options.
The UI renders the pending comment beside the successful ticket result without
inserting it into cached comments. It hides the intent if the ticket becomes
unavailable and never restores a saved cache on failure. Mutation completion
can precede the next watch snapshot, so the pending line can disappear before
the committed comment arrives. This is application-owned presentation, not a
framework rollback or no-flicker guarantee.

The normal `web/main.tsx` bundle contains no tracer reporting or automatic
journey. The separate tracer entry imports that same web app, signs in through
its auth client, selects views through the DOM, and exercises generated
Operations. Fixture reporting lives only under `tracer/`.

The local host serves web assets, OpenAPI, and Scalar, runs the existing durable
worker, and delegates framework requests to `application.fetch`. It also
starts a loopback test notification receiver on port 43121. Its permissive
fixture maintenance authorizer and fixed test realtime key are test controls;
this host is not a production deployment template.

## Run locally

From this directory, provide the database connection and Better Auth secret
through the environment. Use PostgreSQL 17 for the checked tracer. Keep real
credentials out of source and shell history. The auth deployment adapter reads
`DATABASE_URL` and `BETTER_AUTH_SECRET`; `BETTER_AUTH_TRUSTED_HOST` is optional
for an authorized tailnet HTTPS hostname.
The local fixture adapter uses a built-in demo signing key if no secret is
supplied. That default is only for disposable local testing, not deployment.

Check that the chosen app port and the receiver's fixed port 43121 are free.
The example uses app port 43122; choose another free port with `--port` if
needed. Preserve existing processes rather than stopping them to free a port.

```sh
bunx questpie build
bunx questpie migration apply
bunx questpie seed apply
bun run auth:migrate
bun run auth:seed
bunx questpie schedule activate --expect-revision 0
bun tracer/host.ts --port=43122
```

The auth seed creates the customer, agent, and admin personas offered by the
login form. Their public fixture values are defined in
[demo identities](src/auth/demo-identities.ts). A normal launch does not run
browser automation. URLs with tracer parameters select a separate instrumented
bundle for the automated tests.

The activation above is for a database with no previous activation. For later
deployments, deliberately supply the revision you intend to replace. Booting
the host never activates or restores schedules. The
[scheduled Job guide](../../apps/docs/content/docs/v4/scheduled-jobs.mdx) uses
this application's exact Seed and sweep Definitions and explains activation,
response-loss recovery, and checkpoint replay.

An existing protocol-v8 database needs
`--allow-non-rolling-protocol-v9` on `questpie migration apply`. Supported v6/v7
installations need both `--allow-non-rolling-protocol-v8` and
`--allow-non-rolling-protocol-v9`. Stop incompatible Runtimes first; each upgrade
commits separately. Follow the
[protocol upgrade procedure](../../apps/docs/content/docs/v4/runtime-and-studio.mdx#upgrade-the-internal-protocol)
before running the remaining setup commands. Fresh databases need no flags.

## Manual review

| Try in the web app                                       | Framework behavior visible to the reviewer           |
| -------------------------------------------------------- | ---------------------------------------------------- |
| Sign in, reload, sign out; switch personas               | Auth session and role-dependent UI                   |
| Filter by status/team, paginate, find an exact reference | Generated Queries and bounded pages                  |
| Open ticket detail and comments                          | Relations, inverse selection, conditional disclosure |
| Create, edit, assign, comment, close, reopen             | Named Mutations, lifecycle, server values, Policy    |
| Observe another session's edits                          | Live Query snapshots in the native QueryClient       |
| Submit a comment while its request is pending            | Pending intent beside the authorized conversation    |
| Send summary                                             | Action through the local HTTP provider               |
| Observe Last SLA follow-up after an activated sweep      | Job-driven Mutation and Live Query result            |

Open `/api-reference` for Scalar or `/openapi.json` for the generated document.
Sign in first. Scalar fills the three compiler compatibility headers; supply
canonical base64url Context for the signed-in user's matching organization and
Membership. Replace Scalar's Context placeholder `Value` before sending a
request; it fails validation. The regular generated client
encodes Context automatically.

MCP is enabled at `POST /_questpie/mcp`; see the
[MCP guide](../../apps/docs/content/docs/v4/basic-mcp.mdx) for its protocol and
request metadata. There is no separate MCP UI.

Job inspection, retry/cancellation, schedule activation, signed webhook input,
and telemetry require their server/CLI/test surfaces. This UI has no general
admin editor for Memberships, teams, or labels. Crash recovery, competing
workers, receipt corruption, rollback races, and authority-revocation guarantees
are automated evidence, not claims established by clicking the app. Other
fixtures cover Reaction and Package composition; absent framework capabilities
such as Files, Search, and Studio are not implied by this example.

The native component tests drive the actual session and ticket components in
JSDOM with an in-process HTTP/SSE peer, without a database or real browser.
They cover credential replacement during a pending
write, overlapping success/rejection, Field and row omission, and known or
unknown commit outcomes without cache rollback. The PostgreSQL/Firefox journey
separately checks the real auth, generated Operations, native UI controls,
durable work, webhook and telemetry paths. Neither suite replaces manual review
of the app's layout and usability.

## Verify

From the repository root, build the public package first: its built subpaths and
CLI are prerequisites for the fixture checks. Then run the structural and
application-contract checks:

```sh
bunx turbo run build --filter questpie
bun test tests/integration/team-support-structure.test.ts
bunx tsc -p fixtures/team-support-desk/tsconfig.json --noEmit
```

With Docker and Firefox available, run the owned PostgreSQL 17/Firefox journey
from the repository root. Set `FIREFOX_BIN` if Firefox is not at
`/usr/bin/firefox`:

```sh
bun run tests/support/native-react-query-postgres-run.ts desk
```

The runner creates a fresh loopback PostgreSQL container and removes it afterward.
It refuses an occupied receiver port 43121 without stopping its owner; the app
uses an available ephemeral port. Set `TMPDIR` to a writable directory for any
of these checks if the system temporary directory is full.
Never point the underlying test at a shared database: it drops its test schemas,
auth tables and test role. The source-mode journey builds the OTel package, so
run it separately from package builds.

The focused native component tests remain in
[the browser test entry](tracer/browser/query-resource-react.test.tsx), alongside
the old-hook controls until their package export is removed. Run them from this
fixture directory:

```sh
bun test tracer/browser/query-resource-react.test.tsx
```

For authorized tailnet review, keep the host on loopback. Inspect listening
ports and `tailscale serve status` before choosing a free HTTPS port and adding
a mapping to this session's app port. Historical examples using local port
43120 or HTTPS port 8444 do not establish ownership: preserve existing mappings
and their target processes. Record the mapping created for this session and
remove only that mapping afterward. Use no Funnel.
