# BETA-12 backend closure

## Current judgment

The beta.1 release candidate is complete: one checked tarball cleanly installs,
builds the archive application without workspace compiler/runtime imports, and
drives both collaboration and archive connected tracers against local
PostgreSQL 17. The identical packed scenario also passes against a remote CNPG
PostgreSQL 18 direct endpoint. Package retry, checksum mismatch, negative
imports, migration drift inherited by both tracers, clean install, graceful
Runtime shutdown, and the aggregate performance ownership gate are executable.

The selected managed profile is Supabase PostgreSQL. This checkout has no
managed connection credential, so `managed-conformance.json` is `WITHHELD` with
`MISSING_CREDENTIAL`; it is deliberately not `PASS`. The owner ruled that the
named Supabase run is useful provider evidence but is not a BETA-12 blocker.
`cnpg18-direct-conformance.json` records the available remote production-shaped
database evidence instead; it does not relabel CNPG as Supabase. The same
`scripts/beta12-conformance.ts` command runs the identical packed BETA-12
scenario when standard PostgreSQL connection variables are supplied.

The available CNPG PgBouncer endpoint uses transaction pooling. BETA-12 proves
the release candidate against the direct endpoint; it does not claim a pooler
compatibility result that was not executed. The current generated Runtime uses
one Bun SQL pool for query, mutation, durable, and periodic realtime
reconciliation work. It does not yet implement the `listenNotify` wake declared
by its live-query artifact, so external changes can wait for the ten-second
reconciliation tick. Production connection routing and immediate cross-instance
realtime therefore remain a separate inherited Runtime closure: normal traffic
may use a transaction pool, while migrations and the future notification
listener require a direct or session-affine connection.

The tagged stable-runner `quality:release` result and actual tag publication
remain release-environment gates, not locally fabricated successes.

## What would change the judgment

A Supabase PASS requires that target to run both packed tracers without
changing application Definitions, package bytes, migrations, or test
selection. A credential alone does not overturn WITHHELD; only the written PASS
report produced after the full scenario does. It would strengthen provider
coverage but, under the owner decision above, would not change BETA-12
acceptance. A transaction-pool result only changes the pooler judgment when the
same packed Runtime scenario is actually executed through that endpoint.
Implementing `LISTEN/NOTIFY` must add a cross-instance latency proof and retain
periodic ledger reconciliation as recovery; it cannot be inferred from the
artifact constant. Any tarball, declaration, migration, or generated-artifact
checksum change invalidates the candidate until its manifest is deliberately
regenerated and every release gate repeats.
