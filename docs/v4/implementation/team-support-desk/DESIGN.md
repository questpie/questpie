# Team Support Desk application design

- Status: implemented reference application
- Date: 2026-08-26
- Classification: Product tracer over Accepted v4 Kernels; any discovered
  declaration/runtime correctness defect is split into the smallest Kernel fix
- Consumer: `fixtures/team-support-desk`

## Product journey

Team Support Desk is a multi-tenant browser Operator App. A customer opens a
ticket and comments on it. An agent filters and pages the queue, opens a detail
view with team, requester, assignee, comments, and labels, edits and assigns the
ticket, then closes or reopens it. Better Auth owns email/password identity and
the durable browser session; an application Service resolves that session to a
Principal. Context selects one Organization, and current Membership evidence
remains the authorization truth.

An inbound integration posts a signed webhook to create a ticket through a raw
Route and an explicit application Execution. An agent may invoke one Action
that sends a ticket summary to an actual HTTP notification receiver. Ticket
activity accepts an immediate Job in its Mutation transaction. A server caller
also accepts a delayed SLA Job with `notBefore`; the tracer proves ordinary
retry, cancellation, lease expiry, and hard-restart recovery.

## Deep modules

| Module                | Small interface                                                                                                 | Hidden implementation and invariant                                                                                                                                                                             | Seam and test surface                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Support domain        | Six Collection Definitions: Organization, Membership, Team, Ticket, Comment, Label                              | keys, Relations, B-tree Indexes, lifecycle Fields, explicit server-owned timestamps, and migration/Seed artifacts                                                                                               | public Collection/Relation interface; compile, migrate, seed, generated data types                                         |
| Tenant authorization  | one Better Auth Service, one credential resolver, one Context Definition, and one default Policy per Collection | standard Better Auth sessions, webhook integration credentials, tenant selection, active Membership evidence, customer/agent/admin role rules, row scope, Field authority, nondisclosure, and lock-time recheck | Service/Route/credential/Context/Policy interface; direct, network, Route transition, Query, Mutation, Job attempts        |
| Ticket operations     | generated Query/Mutation/Action maps                                                                            | list/detail/reference search, filters, cursor pages, nested `toOne` Relations, create/comment/edit/assign/close/reopen transitions, explicit lifecycle writes, exact errors, and idempotent calls               | generated Operation interface shared by direct and browser callers                                                         |
| Inbound webhook       | `POST /webhooks/support/inbound`                                                                                | application credential resolution, bounded body, HMAC verification, replay identity, explicit same-Principal `ctx.execution`, and server-only Mutation                                                          | generated Route direct member and mounted `app.fetch`                                                                      |
| Notification delivery | one `notification.sendTicketSummary` Action                                                                     | Query composition, Runtime-owned Effect Identity, execution-lifetime external Service, cancellable HTTP POST, declared rejection/ambiguity, semantic limits                                                     | generated direct and Wire v3 Action callers; HTTP receiver is an external test target, not a second framework adapter seam |
| SLA work              | one `ticket.slaFollowUp` Job and its generated `accept` capability                                              | caller run-as, immutable accepted ticket snapshot, bounded retry, heartbeat, due-time wait, durable result, fencing and recovery                                                                                | direct and Mutation-owned Job acceptance; generated worker and server `inspect`/`events`/cancel surface                    |
| Browser desk          | one generated-client-backed page                                                                                | persona session, filters, reference search, cursor paging, queue/detail state, forms, optimistic busy/error states, and accessible responsive layout                                                            | browser DOM and generated client; Firefox is the acceptance adapter                                                        |

The deletion test is deliberate: deleting Tenant authorization would duplicate
membership/role conditions across every Operation; deleting Ticket operations
would spread transaction ordering and lifecycle writes through Route, Job, and
browser code; deleting SLA work would move retry/recovery state into process
memory. The modules therefore earn depth and locality rather than forwarding
calls.

## Domain and authority

- `organizations`: tenant root.
- `memberships`: `(organizationId, principalId)` membership, role
  `customer | agent | admin`, and active/suspended status.
- `teams`: organization-owned routing group with routing state used by the Job
  retry journey.
- `tickets`: organization/team/requester/optional assignee Relations, stable
  human reference, priority, status, summary, description, lifecycle times,
  and last SLA/routing facts.
- `comments`: ticket and author Relations, body, kind, and server-owned time.
- `labels`: organization and ticket Relations, name, color, and server-owned
  time. In v1 a Label row is a ticket label assignment; no hidden join
  Collection is synthesized.

All six Collections use database-derived `randomUuid` primary keys. Callers do
not supply them. Insert-only schema defaults remain visible in the generated
schema, while authored Collection Operations use transaction-stable
`operationTime` for every returned `createdAt` and every Mutation-owned
`updatedAt`/closed time.

Customers see and mutate only their own tickets. Agents see their tenant queue,
comment, edit, assign, close, and reopen. Admins additionally manage labels.
Policy uses current Membership rows, never `ctx.values.role`, for permission;
the resolved role is presentation/convenience only.

| Collection   | Read row scope                                     | Create                                                                    | Update/delete and Field authority                                                                        | Candidate/reference invariants                                                                                   |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Organization | active Membership in that Organization             | none                                                                      | none                                                                                                     | n/a                                                                                                              |
| Membership   | self, or tenant agent/admin                        | none in this tracer                                                       | admin may change role/status; no delete                                                                  | Organization and Principal identities are immutable; role/status are closed literals                             |
| Team         | any active tenant Membership                       | none in this tracer                                                       | agent/admin may change routing/name; no delete                                                           | Organization is immutable and equals Tenant                                                                      |
| Ticket       | customer requester row; agent/admin any tenant row | any active tenant Membership; requester is current Principal's Membership | requester may edit summary/description while open; agent/admin may edit, assign, close/reopen; no delete | Organization is immutable; Team and optional Assignee are active same-tenant rows; status transitions are closed |
| Comment      | readable parent Ticket only                        | active Membership allowed by parent Ticket scope                          | none                                                                                                     | Ticket and Author Membership are readable/active and in the same Tenant                                          |
| Label        | readable parent Ticket only                        | admin                                                                     | admin may edit/delete name/color assignment                                                              | Organization and parent Ticket are immutable and in the same Tenant                                              |

Ticket writes use the accepted Collection update owner. It scopes and locks the
target, then rechecks current Membership and candidate Policy inside the owning
transaction. The concurrency tracer races two close transitions: the winner
changes `open -> closed`; after waiting on the same row lock, the loser sees the
new current state and receives the same nondisclosing rejection instead of
overwriting it. No raw lock or SQL handle enters application code.

## Query and browser shape

- `tickets.list`: tenant/Policy-scoped unfiltered cursor page selecting nested
  Team and Assignee Relations.
- `tickets.listByStatus`, `tickets.listByTeam`, and
  `tickets.listByStatusAndTeam`: the same page with exact scalar filters. The
  production implementation currently exposes no authored scalar-list or
  nullable-filter parameter despite the Accepted foundational contract, so the
  app keeps four ordinary Query Resources and records that duplication.
- `tickets.detail`: exact ticket id with nested Team, Requester, Assignee, and
  the bounded newest-first Comment array.
- `tickets.searchByReference`: exact stable reference lookup under the same
  Policy. Foundational v1 has no `like`/full-text operator; that material DX
  gap is recorded rather than hidden behind raw SQL.
- `labels.page`: cursor page for the selected ticket. Comments have no second
  Operation: the ticket detail Query projects them structurally through the
  Comment Collection's bounded inverse `list`.
- `teams.list`: authorized routing choices for the current Organization.

The browser composes those generated Queries into one useful desk: filterable
queue on the left, selected detail/activity on the right, forms and transition
controls in context, explicit loading/empty/error states, keyboard labels, and
responsive single-column fallback. Its detail actions include “Send summary,”
which invokes `notification.sendTicketSummary` through the generated browser
client and Wire v3; the Firefox tracer verifies the receiver receipt, stable
Effect Identity material, exact success type, and a declared provider error.

## Durable and external-effect journeys

1. `ticket.addComment` writes the Comment and accepts `ticket.slaFollowUp`
   immediately in the same Mutation transaction. Its Job input is an immutable
   ticket reference, summary, SLA due time, and Organization id from the
   Policy-authorized Ticket snapshot already read by the Mutation; current
   ordinary `JobContext` exposes no data or generated Operation callers.
2. A direct server execution accepts the same Job with an absolute
   `notBefore`; the worker proves it cannot run early.
3. For the retry case, a direct acceptance intentionally omits `notBefore` for
   a still-future SLA due time. The handler waits cooperatively on `ctx.signal`;
   the first bounded attempt deadline wins, normal Job retry waits past the due
   time, and a fresh Context/Policy root then succeeds. There is no retry-only
   domain flag.
4. For hard restart, a separately accepted run has a future SLA due time and a
   longer attempt deadline. The tracer observes a running, heartbeating attempt
   through generated `app.durable.inspect`/`events`, hard-kills the host, waits
   for lease expiry, restarts the exact generated Runtime, and observes a later
   fenced attempt settle the same Durable Run. `notBefore` is not used to claim
   that a Physical Attempt exists, and there is no `restartProbe` input.
5. A separately delayed run is cancelled before claim and remains cancelled
   across restart.
6. `notification.sendTicketSummary` performs one real HTTP POST with
   `effect.id` as provider idempotency material. It never runs inside a
   Mutation or Job retry and is never automatically retried.

## Evidence and slices

1. Domain/Policy/data model, committed migration and Seeds, type truth.
2. Queries and Mutations through generated server capabilities, including the
   row-lock race and Mutation-owned Job acceptance.
3. signed Route, HTTP Action, direct/delayed Job, retry/cancel/restart.
4. generated browser client, usable UI, PostgreSQL 17 + Firefox tracer.
5. consolidated DX evidence, focused verification, release gates, then one
   final Standards review and one final Spec review over the complete vertical.

Every application workaround or blocker is recorded in `DX-EVIDENCE.md`.
Fixture code may supply disposable PostgreSQL, receiver, session, and crash
orchestration, but it may not bind a Principal internally, access framework
tables for application behavior, invoke raw SQL from Definitions, or call a
Runtime binder.

The application credential resolver asks the Better Auth Service to validate a
browser session or recognizes a dedicated integration credential header, then
returns the corresponding Principal. Organization, Membership, and role fields
stored with the Better Auth user are routing hints only; Context reloads the
current Membership before Policy executes. Public credential-free QUESTPIE
Routes delegate `GET` and `POST /api/auth/*` to Better Auth's standard handler.
The webhook Route declares
`credentials: "application"` and authenticated admission; it then verifies the
body HMAC and replay/event identity before entering
`ctx.execution({ principal: ctx.principal, context: { organizationId, membershipId } }, ...)`.
It never upgrades an anonymous Principal in the handler. The verified webhook
event id is the server-only create Mutation's stable `callId`, so a valid
duplicate recovers the same committed result.
