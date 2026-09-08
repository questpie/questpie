# Native lifetime and Start implementation review

This ordinary review covers NRQ-02 and NRQ-03, not architecture acceptance or
the aggregate beta.2 release. NRQ-02 was reviewed from `1071be5df` through
`0b1b015da`; NRQ-03 from that point through `740f2f460`. Each axis used an
independent reviewer who had not authored the files being reviewed.

## Standards

NRQ-02: `golden_native_audit` found no documented-standard breach or actionable
heuristic finding. The GC control owns its timer and cleanup; the PostgreSQL
window follows authored ordering; the public retention paragraph preserves
terminal lifetime without inventing a bound or recovery API.

NRQ-03: `nrq02_exit_audit` found one timeout-ownership gap. The integration
parent could terminate its build runner at 120 seconds before the runner's
own cleanup executed. A nested Vite process could retain pipes or scratch files.
The repair must give the supervising parent ownership of temporary storage and
descendant termination, with an executable short-timeout control. Raising the
deadline alone does not address ownership.

## Spec

NRQ-02: `start_migration_audit` found no missing requirement, scope expansion
or incorrect implementation. The native GC control proves retained-option reuse
through live transport; exact descending windows retain omission and replay-gap
checks. Public guidance agrees with the terminal failed-key owner.

NRQ-03: `golden_native_audit` found one isolation-evidence gap. Two identical
unauthenticated SSR requests with different identity seeds cannot exclude a
shared native cache containing another user's results. The actual Start host
needs concurrent distinct-cookie requests with equal Context and distinct
protected result markers. Each complete response must exclude the other
request's markers. Existing explicitly separate-cache tests do not substitute
for that host-composition control.

Neither NRQ-03 finding identifies a production adapter defect or calls for a
new interface.

## Combined deterministic checkpoint

The clean pre-repair head passes `bun run quality:release`: **1,209 pass,
197 gated skips, zero failures**, 1,406 tests across 318 files. The separate
React control passes 3 tests / 15 assertions. Architecture, format, lint,
nine workspace typechecks, six builds, strict Knip, docs, skills and package
checks pass. Packed OTel isolation passes 1 / 2,393; packed CLI telemetry
passes 1 / 24. `git diff --check` passes.

The gate validates 19 performance manifests; that is not tagged stable-runner
workload evidence. PostgreSQL and Firefox remain the separately executed
controls recorded in the two slice evidence files. This checkpoint closes the
combined pre-review gate, not final release readiness.

## Repair verification and closure

The timeout control first reproduced a descendant outliving parent-only
termination. A narrow Start supervisor now owns the enclosing temporary tree,
the detached process group and bounded TERM/KILL escalation. Both cooperative
and TERM-ignoring descendant cases pass, including removed scratch and stopped
process assertions. `start_migration_audit`, who did not author this repair,
reviewed it independently and found no remaining Standards issue.

The actual Start test now overlaps two equal-Context, distinct-cookie SSR
requests and checks complete documents for own and foreign result markers.
A temporary shared-QueryClient control failed the foreign-data assertion while
retaining different bootstrap seeds. The test host was restored immediately.
Original Spec reviewer `golden_native_audit` confirmed the focused repair and
found no remaining issue.

The final actual Start command passes build/strict types, 50 baseline assertions,
45 fault assertions, 26 credential-switch assertions and three all-mode readiness
scenarios. The parent build passes 1 / 1; both timeout controls pass 2 / 12.
Changed-scope format/lint, questpie types and `git diff --check` pass. Strict
TypeScript also checks the added supervisor/test files.

Standards: zero open findings. Spec: zero open findings. NRQ-02 and NRQ-03 are
complete; NRQ-04 can proceed. These ordinary reviews do not create a formal
acceptance record. The final integrated beta.2 candidate still needs its own
complete release gates.
