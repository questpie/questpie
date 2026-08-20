# ADR 0024: Descope Minimal Studio from Beta.1

- Status: Accepted
- Date: 2026-08-20
- Supersedes: ADR-0004 and ADR-0021 only where they require a minimal Studio
  path or Studio parity in the first tracer and `4.0.0-beta.1`

## Context

ADR-0021 put a minimal same-origin Studio in beta.1 so the connected tracer
would exercise an inspection surface. BETA-09 implemented safe backend
inspection projections and a static artifact catalog, but the browser could
not inspect Collection rows, invoke an Operation, or observe a running
application. Completing its asset pipeline would ship a second presentation of
generated JSON already available as files and CLI output.

That surface has no material developer job. Treating it as a release milestone
would add UI dependencies, packaging and compatibility obligations without
delivering the administration product developers expect.

## Decision

`4.0.0-beta.1` no longer includes a Studio application or a Studio parity gate.
The release still compiles, migrates, runs, calls, watches, recovers and restarts
the connected PostgreSQL tracer through direct, Fetch/client and worker paths.

BETA-09 is re-scoped as a backend-only maintenance-compatibility slice. It may
retain only behavior independently required by the accepted
Runtime and durable contracts: bounded maintenance reasons, evaluated
maintenance Authority with typed denial, expected-version fencing with a typed
winner, append-only audit, and internal-protocol compatibility. It owns no
browser mount, Studio projection, inspection read model or UI package.

The future Studio is a separate vertical. Its intended product job is a
system-privileged administration surface over one application: inspect
Collection rows, execute authorized Queries, Mutations and Actions, and later
inspect stored logs, activity and traces. Before implementation it requires an
Accepted contract for its privileged Principal, Policy/Authority decisions and
application/operational-data disclosure. This ADR does not grant ambient
Admin/System authority and does not design that contract.

## Consequences

- BETA-10 depends on the re-scoped BETA-09, not on a Studio `PASS`.
- `apps/studio`, its same-origin mount, static artifact projection, UI tests and
  UI performance baselines are not beta.1 release artifacts.
- Safe inspection experiments on the unaccepted BETA-09 branch remain
  historical evidence and are not merged by sunk cost.
- ADR-0003 and ADR-0014 still describe the long-term Studio boundary. This ADR
  changes release scheduling, not their prohibition on raw SQL, private data
  paths or ambient authority.

## Rejected alternatives

- Shipping an artifact-only viewer, because generated files and CLI output
  already answer that job with less surface.
- Expanding BETA-09 into the intended admin product, because its privileged
  Principal and disclosure contract are not accepted and the work would delay
  the functional backend release.
- Silently unblocking BETA-10 while ADR-0021 still required Studio, because
  that would make the issue queue contradict Accepted authority.
