# BETA-09 backend closure

BETA-09 closes the maintenance compatibility gap and nothing more. ADR-0024
removed Studio from beta.1 because the implemented browser surface could only
repeat generated files; it could not inspect application data, execute an
Operation, or observe a running application. Shipping it would create UI and
packaging obligations without giving developers an administration tool.

The useful future Studio remains a separate product vertical: a
system-privileged administration surface over one application. That vertical
needs an accepted privileged Principal and disclosure contract before it can
inspect Collection rows, execute Operations, or expose logs and traces. BETA-09
does not invent ambient Admin/System authority to get there early.

## What this slice implements

The generated App now requires the host to provide
`maintenance.authorize`; omission is a type error
(`packages/compiler/src/generate.ts:423`–`:427`). The generated application
passes that decision into the durable maintenance surface
(`packages/compiler/src/runtime/application.ts:410`–`:412`). There is no
default allow and no browser or Operation-Wire transport.

The runtime evaluates that decision for the trusted Principal, command, and run
identity (`packages/runtime/src/durable/postgres-maintenance.ts:90`–`:109`,
`:199`–`:213`). A denied caller is read without `FOR UPDATE` and receives an
audited `AUTHORITY_DENIED` result (`:123`–`:185`). This ordering matters: a
caller that is not allowed to touch a run must not be able to hold its row lock
and delay an authorized operator.

All three durable commands require a reason of 1–256 characters
(`postgres-maintenance.ts:61`–`:86`, `:150`–`:160`). Invalid input is a typed,
audited `REASON_INVALID` result rather than a raw database error. Every audit
row carries the actor, transition, rejection and reason (`:236`–`:280`), and an
expected-version loser receives the settled run version it can use for a safe
retry (`:269`–`:281`).

The generated Runtime Build declares `questpie.internal.v5`
(`packages/compiler/src/runtime/index.ts:411`), while the artifact decoder
accepts both v4 and v5 builds
(`packages/runtime/src/application/artifacts.ts:28`–`:29`, `:340`–`:341`). The
v5 migration adds the bounded nullable reason to the existing append-only audit
catalog. Nullable is required for the v4 upgrade path; new calls cannot omit a
reason at the generated or runtime API.

## Evidence

The PostgreSQL scenario has two protocol tests and six maintenance tests. It
proves fresh-v5 and v4-to-v5 convergence, same-version checksum refusal,
Authority denial before a row lock with a positive control, audited denial,
winner-version recovery, guard re-arming, invalid reasons on all three commands,
and an authorized success
(`tests/integration/postgres/beta09-internal-protocol.test.ts:37`–`:114`,
`tests/integration/postgres/beta09-maintenance-compatibility.test.ts:21`–`:71`,
`:115`–`:279`).

The reference-local microbenchmark executes 20 fenced maintenance commands.
The final pre-acceptance sample was 84.986 ms against a 400 ms budget, with 20
audit rows, 58,496 public declaration bytes, and 21,008 TypeScript
instantiations. `bun run quality:full` also passes without raising BETA-07's
bundle budget.

## Deliberate limits

- No Studio application, mount, projection, inspection model, or browser
  maintenance client is part of beta.1.
- No network maintenance route is created. The capability remains
  server-internal and the deployment owns its authorization decision.
- No ambient Admin/System Principal is introduced.
- `drain` remains Runtime lifecycle, not a fourth durable maintenance command.
- This slice does not claim Runtime size, retention, telemetry queue, or Studio
  pagination limits that no implementation enforces.

The judgment changes only if accepted authority changes: ADR-0024 could restore
Studio to beta.1, or a new accepted contract could define the privileged
Principal, disclosure rules, and transport for the future administration
surface. Neither is implied by completing this backend slice.
