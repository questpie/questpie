# Team Support Desk sweep candidate

This is an isolated Proposed ADR-0043 proof, not Accepted behavior or a shipping
claim. The fixture source is based on integrated candidate `ab944a884`.

The beginner shape is one minute Job, one named Mutation checkpoint, and an
ordinary service Principal with an active agent membership. The Mutation scans
at most one open, scheduled ticket in due-time/id order, locks the selected
ticket through the existing Collection get, rechecks its current due time, and
advances that ticket by one hour. The existing ticket afterWrite accepts the
ordinary follow-up Job in the same Mutation transaction.

Only one nullable server-owned timestamp and one supporting index are added by
`000004_schedule-ticket-sla-sweep`. Existing Migration and Seed receipts remain
unchanged; a new additive identity Seed gives the sweep its ordinary membership.
New ticket.create calls initialize the due time from ctx.now. Existing null dues
remain unscheduled and are explicitly excluded, so they cannot starve the page.

Existing limits were observed rather than broadened:

- Query parameter lowering does not admit a timestamp Codec. The fixture orders
  non-null candidates and compares the locked row with ctx.now; it does not claim
  general timestamp filtering support.
- Adding a required timestamp with the dynamic default now produces a blocked
  Migration Plan. The nullable additive field avoids rewriting fixture history.
- Ten-ticket and two-ticket batches exceed the existing 20-statement Collection
  budget with this fixture's Policy, validation reads, lifecycle and Job
  acceptance. The one-ticket batch passes without changing the 20-statement or
  100-row limits. This is a beginner consumer bound, not a throughput claim.

The actual PostgreSQL/Firefox tracer passes. It successfully
creates a UUID-owned PostgreSQL 17 database, builds the real fixture, applies the
four Migrations and additive Seed, creates a due ticket through an ordinary
Mutations, and proves startup worker polling does not activate a schedule. Real
Firefox signs in with Better Auth and renders the existing authorized live detail
with “Last SLA follow-up: Not yet”. The verified CLI activation and existing
worker producer then accept exactly one scheduled Job.

The initial RED exposed an advertised Mutation Collection.list member missing
from Runtime. Candidate fix `3bd65eb48` installs it through the existing
transaction-bound, Policy-aware Query owner. Its independent generated Mutation
PostgreSQL regression passes 15 assertions for the exact page shape, cursor,
Policy-before-limit, uncommitted-write visibility, unknown parameters, and
caught budget exhaustion rolling back writes. No new Query kernel or raw SQL
application shortcut was added.

The structural list definition also initially omitted its ordered timestamp
from select. Runtime refused that malformed cursor projection; selecting the
existing order Field fixes the fixture. The missing compiler validation is now
closed in the existing Query normalizer with `QP-DATA-008`, preserving the
source Origin and Field path. The focused test evaluates real authored source
before normalization and proves rejection plus the valid selected counterpart.
The original gap was at `fixtures/team-support-desk/src/tickets/sla-query.ts`,
export `dueTickets`; it was not an arbitrary Mutation request.

The scheduled Job completes its named Mutation checkpoint, advances the due time,
and accepts the ordinary follow-up Job in that transaction. Firefox observes the
live detail change from “Not yet” to the exact committed timestamp without Job
controls. A separately accepted sweep run rechecks the now-future due row and
does not advance it or accept another follow-up Job. An old null-due ticket is
unchanged. Startup still does not activate schedules: activation is an explicit
verified CLI compare-and-swap, and production is through the existing worker.

All created databases, Firefox profiles, sessions, and local servers were closed
and removed after each run. The shared PostgreSQL container and preview were not
changed.

Checks: real PostgreSQL 17 and Firefox, 1 test / 32 assertions; actual fixture
compile, 1 test / 2 assertions. Focused fixture TypeScript, lint, formatting,
architecture, and git diff --check pass. Proposed ADR-0043 remains Proposed;
this evidence does not authorize an Accepted projection or publication.
