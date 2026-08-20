# BETA-09 backend closure

BETA-09 closes the maintenance compatibility gaps and nothing more. BETA-08
shipped the maintenance transitions and audit, but evaluated no maintenance
Authority, accepted no reason on two commands, and persisted no maintenance
reason. ADR-0024
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
identity (`packages/runtime/src/durable/postgres-maintenance.ts:107`–`:126`,
`:276`–`:342`). A denied caller is read without `FOR UPDATE`; a known target is
audited, but the caller receives `AUTHORITY_DENIED` with null state and version.
An unknown target returns the same shape and command identity, so denial is not
a run-existence oracle. The unknown target cannot produce an audit row because
the audit has a run foreign key. This ordering matters: a caller that is not
allowed to touch a run must neither learn its state nor hold its row lock and
delay an authorized operator.

Reason bounds are computed before the host decision, but the decision remains
the first externally visible outcome. The authorizer receives only actor,
command, and run identity—not the reason—and still runs for malformed input.
That is deliberate: returning `REASON_INVALID` first would let an unauthorized
caller distinguish validation paths from Authority denial. This judgment would
change if the accepted disclosure contract explicitly allowed validation
results before Authority, or if invalid attempts no longer had to be audited.

All three durable commands require a reason of 1–256 characters
(`postgres-maintenance.ts:78`–`:103`, `:276`–`:285`). Runtime
and PostgreSQL both count Unicode characters rather than JavaScript UTF-16 code
units. Invalid input is a typed, audited `REASON_INVALID` result rather than a
raw database error. "Before mutation" means before mutating the target run or
effect: the append-only audit `INSERT` is the required record of the rejected
attempt, not an applied maintenance transition. Every audit row carries the
actor, transition, rejection and reason (`:235`–`:273`), and an
expected-version loser receives the settled run version it can use for a safe
retry (`:259`–`:273`). This interpretation would change only if accepted
authority explicitly made invalid attempts unaudited.

The generated Runtime Build declares `questpie.internal.v5`
(`packages/compiler/src/runtime/index.ts:411`), while the artifact decoder
accepts both v4 and v5 builds
(`packages/runtime/src/application/artifacts.ts:28`–`:29`, `:340`–`:341`). The
v5 migration adds the bounded nullable reason to the existing append-only audit
catalog. Nullable is required for the v4 upgrade path; new calls cannot omit a
reason at the generated or runtime API. The decoder's retained v4 path and its
unsupported-protocol refusal are exercised directly
(`tests/unit/beta05-runtime-artifacts.test.ts:55`–`:81`).

The generated protocol catalog groups columns by table while deliberately
preserving their existing and appended order within each table. PostgreSQL
catalog verification compares that order to `attnum`; sorting column names
would make the generated catalog deterministic but wrong. The table-only stable
sort is therefore intentional
(`packages/compiler/src/schema/postgres/internal-protocol-v5.ts:47`–`:72`).
The catalog is not trusted as a transcription: the repository tool snapshots a
live v4 catalog, derives the live v5 delta, formats it, and compares it byte for
byte with the committed module
(`scripts/internal-protocol-catalog.ts:33`–`:228`). The PostgreSQL scenario
runs that producer through the real v4-to-v5 transition.

## Evidence

The PostgreSQL scenario has three protocol tests and six maintenance tests. It
proves fresh-v5 and v4-to-v5 convergence, same-version checksum refusal,
byte-identical live-catalog derivation,
Authority denial before a row lock for all three commands with positive
controls, audited denial, winner-version recovery, guard re-arming, invalid
reasons on all three commands, Unicode-bound parity, and an authorized success
(`tests/integration/postgres/beta09-internal-protocol.test.ts:56`–`:160`,
`tests/integration/postgres/beta09-maintenance-compatibility.test.ts:23`–`:89`,
`:145`–`:323`).

The reference-local microbenchmark executes 20 fenced maintenance commands and
scopes the audit count to those exact runs. The committed baseline is the median
71.591 ms sample; the repaired head's dedicated pre-acceptance sample was
84.076 ms against a 400 ms budget, with 20 audit rows, 58,711 public declaration
bytes, and 21,037 TypeScript instantiations.

The first acceptance review found an unverified 240-line catalog generator, a
test-only marker export in the published runtime, and audit SQL compressed to
win bundle bytes. The generator was initially removed, but the later two-axis
review correctly rejected a generated module with no reproducible producer. A
smaller producer is now exercised byte-for-byte against live PostgreSQL. The
unmark statement remains in the hostile test that owns it, and the SQL formatting
is restored. After a code-level maintenance preflight refactor, the complete
generated BETA-07 application bundle is 524,274 bytes against its unchanged
524,288-byte budget: 14 bytes of measured headroom, without cosmetic SQL
compression.

Acceptance invocations on heads `610379e2` and `46b11c39` each returned terminal
`NO_RESULT` after the reviewer transport timed out and wrote no review artifact;
neither is a verdict. The current materially changed head additionally closes
the reproducible-catalog and Unicode-bound findings before requesting a fresh
review.

## Deliberate limits

- No Studio application, mount, projection, inspection model, or browser
  maintenance client is part of beta.1.
- No network maintenance route is created. The capability remains
  server-internal and the deployment owns its authorization decision.
- No ambient Admin/System Principal is introduced.
- `drainRuntime` remains a Runtime lifecycle operation. This slice does not add
  it to the three-command durable maintenance object. BETA-10 owns its
  multi-instance fencing evidence
  (`docs/v4/prototypes/implementation-collapse-p16/QUEUE.json:491`–`:512`);
  BETA-09 does not claim that later gate complete.
- The public guide retains the accepted Runtime limit, failure, retention, and
  backpressure contract. Removing Studio does not descope those clauses.

The judgment changes only if accepted authority changes: ADR-0024 could restore
Studio to beta.1, or a new accepted contract could define the privileged
Principal, disclosure rules, and transport for the future administration
surface. Neither is implied by completing this backend slice.
