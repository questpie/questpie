# QUESTPIE v4 developer testkit

- Status: selected research direction; not an Accepted public API
- Scope: reusable application and scenario testing for QUESTPIE developers
- Current implementation: `packages/testkit` is a private, empty workspace
  placeholder

## Decision boundary

QUESTPIE should provide a reusable testing kit. It should let application
authors test through the same generated contracts and lifecycle that production
uses, without exposing Runtime catalogs, branded SQL statements, or privileged
test-only mutation paths.

The repository's own hostile proof machinery is a different product. Artifact
re-signing, catalog corruption, backend PID inspection, lock injection, and
direct `questpie_internal` assertions remain private repository tools.

The future userland surface should normally be a dev-only subpath of the single
published `questpie` package, such as `questpie/test`, rather than publishing the
private `@questpie/testkit` workspace package. The final name and exports are not
ratified by this record.

## Evidence from v3

V3's `@questpie/testing` package established useful developer jobs:

- create and dispose an isolated application;
- execute as a typed actor rather than bypassing authorization;
- own a disposable PostgreSQL database safely;
- start, stop, and restart the production server;
- drive HTTP with bounded evidence and redaction;
- drain asynchronous work without returning on a transient empty observation;
- interrupt and restore realtime transport; and
- clean up in reverse order while retaining every teardown failure.

Those are behavioral requirements, not an implementation architecture to copy.
In particular, v3's PGlite-first in-process layer is insufficient as the default
v4 fidelity boundary. V4 behavior depends on PostgreSQL catalogs, multiple
connections, transaction isolation, row and relation locks, cancellation,
`LISTEN`/`NOTIFY`, and commit uncertainty.

## Three testing altitudes

### 1. Generated application harness

The primary developer harness should construct the developer's generated
application against an isolated real PostgreSQL database, apply committed
migrations and Seeds, wait for readiness, and close through the public
application lifecycle.

It should provide typed helpers for:

- anonymous and authenticated Principals;
- explicit Context input;
- direct generated Query, Mutation, and Durable calls;
- Operation Wire calls when wire behavior matters;
- deterministic call identities and clocks where the public contract permits
  injection; and
- assertions over declared errors, nondisclosure, cancellation, and idempotent
  replay.

Arrangement may use an explicit privileged fixture seam, but assertions should
run through an ordinary Principal. A helper that makes every assertion as a
system caller would prove little about Policy.

### 2. Production scenario harness

The scenario layer should own a disposable database and the built server
process. It should expose bounded lifecycle, HTTP, realtime interruption,
restart, evidence, and cleanup controls. This is the required altitude for
pooling, lock contention, backend cancellation, process signals, reconnect,
deployment-wide realtime, and commit-unknown behavior.

Missing PostgreSQL or server prerequisites must be an explicit failure or an
explicitly selected skip policy. A default silent skip is not evidence.

### 3. Repository proof kit

The internal layer may expose stronger controls needed by QUESTPIE itself:

- Runtime Build and artifact tampering;
- direct internal-protocol setup and inspection;
- exact `PostgresStatement` fault injection;
- backend PID, `pg_locks`, and `pg_stat_activity` witnesses;
- listener rotation and lost-wake controls; and
- generated bundle and package checksum derivation.

This layer remains private. Userland code must not become coupled to internal
table names or migration protocol versions.

## First reusable primitives

The first extraction should be driven by two real repository callers and remain
private until its public contract is proved. The likely order is:

1. idempotent reverse-order cleanup with aggregated failures;
2. bounded, secret-redacted evidence capture;
3. disposable PostgreSQL ownership with exact target validation;
4. generated application setup/readiness/close;
5. typed Principal and Context execution helpers; and
6. production server, HTTP, realtime, and asynchronous-drain controls.

Each primitive must make ownership explicit, use one absolute cleanup deadline,
and retain the primary failure plus cleanup failures. Test helpers must never
invent a second database Pool beside the generated application.

## Public promotion gate

A helper is eligible for a public dev-only subpath only when:

- at least two application-facing tests use the same interface;
- one hostile test proves setup failure cleanup;
- repeated and concurrent disposal share one result;
- resource ownership and deadline behavior are explicit;
- secrets are redacted before bounded evidence is retained;
- the helper imports only public/generated contracts;
- package tests prove it does not enter production bundles; and
- public documentation states the exact fidelity boundary.

Until then, `packages/testkit` remains private and may host only reusable proof
infrastructure, not an implied stable public API.

## Overturn conditions

Reconsider real PostgreSQL as the primary harness if a substitute proves the
same catalog, transaction, cancellation, realtime, and lifecycle behavior for a
declared test class. Reconsider the single-package subpath if the release ADR is
superseded. Reconsider the three-layer split if a public use case genuinely
requires internal-protocol fault injection rather than observable application
behavior.
