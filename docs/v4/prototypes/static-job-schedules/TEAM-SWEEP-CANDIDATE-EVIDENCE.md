# Team Support Desk sweep candidate

This is an isolated Proposed ADR-0043 proof, not Accepted behavior or a shipping
claim. The fixture source is based on integrated candidate `ab944a884`.

The beginner shape is one minute Job, one named Mutation checkpoint, and an
ordinary service Principal with an active agent membership. The Mutation scans
at most ten open, scheduled tickets in due-time/id order, locks each selected
ticket through the existing Collection get, rechecks its current due time, and
advances that ticket by one hour. The existing ticket afterWrite accepts the
ordinary follow-up Job in the same Mutation transaction.

Only one nullable server-owned timestamp and one supporting index are added by
`000004_schedule-ticket-sla-sweep`. Existing Migration and Seed receipts remain
unchanged; a new additive identity Seed gives the sweep its ordinary membership.
New ticket.create calls initialize the due time from ctx.now. Existing null dues
remain unscheduled and are explicitly excluded, so they cannot starve the page.

Two existing limits were observed rather than broadened:

- Query parameter lowering does not admit a timestamp Codec. The fixture orders
  non-null candidates and compares the locked row with ctx.now; it does not claim
  general timestamp filtering support.
- Adding a required timestamp with the dynamic default now produces a blocked
  Migration Plan. The nullable additive field avoids rewriting fixture history.

The actual PostgreSQL/Firefox tracer currently remains RED. It successfully
creates a UUID-owned PostgreSQL 17 database, builds the real fixture, applies the
four Migrations and additive Seed, creates ten due tickets through ordinary
Mutations, and proves startup worker polling does not activate a schedule. Real
Firefox signs in with Better Auth and renders the existing authorized live detail
with “Last SLA follow-up: Not yet”. The verified CLI activation and existing
worker producer then accept exactly one scheduled Job.

That Job reaches the checkpoint Mutation but fails because the generated
MutationData type advertises tickets.list while Runtime
createCollectionMutationData installs only get/create/update. The existing
transaction-bound Query owner is already available to lifecycle list execution;
no new Query kernel, raw SQL application shortcut, or unrelated lifecycle trigger
has been added to circumvent the missing Mutation list member.

The test intentionally expects the final successful consumer and browser update,
so it preserves this failure instead of relabeling partial evidence as a pass.
All created databases, Firefox profiles, sessions, and local servers were closed
and removed after each run. The shared PostgreSQL container and preview were not
changed.

Checks at this checkpoint: actual fixture compile 1 test / 2 assertions; real
PG17/Firefox reached 21 assertions before the missing member failure; focused
fixture TypeScript, lint, formatting, architecture, and git diff --check passed.
