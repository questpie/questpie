# OpenTelemetry boundary adversarial review ledger

Status: candidate evidence for Proposed ADR-0033; not an acceptance record

This ledger records independent design audits. It cannot accept ADR-0033 and
must not be confused with the manifest-bound repository acceptance record.

## Initial authority audit

Verdict: BLOCKED, repaired in the candidate

- The first draft exposed a structural provider-shaped interface. The repaired
  boundary accepts one opaque official handle, keeps the neutral interface
  private, and explicitly rejects a general provider SPI.
- The signal projection was descriptive rather than exact. `SIGNALS.md` now
  freezes the scope, Semantic Conventions binding, Resource allowlist, graph,
  names, kinds, status, attributes, events, metrics, units, boundaries, and
  dimensions.
- Reaction acceptance had no durable trace-link rule. The repaired decision
  gives Job and Reaction acceptance the same first-successful-acceptance rule.
- Envelope v2 identity was incomplete. Runtime-instance generation, both
  counters, IDs, clock encoding, neutral trace bytes, exhaustion, and ordering
  are now explicit.
- A second package was presented as though an Accepted ADR required it. It is
  now an explicit additive candidate release decision and its post-PASS
  repository-routing projection is part of the review surface.

## Initial Runtime audit

Verdict: BLOCKED, repaired in the candidate

- The first interface could not keep active context across `await`.
  `ObservationScopeV1.run` now owns exactly-once callback entry, async context,
  and same-layer suppression.
- Extraction, streaming response lifetime, and instrumentation suppression were
  implicit. `BOUNDARY.md` now fixes their inputs, failure behavior, and owners.
- Mixed protocol-v7/v8 operation was incompatible with the exact catalog
  verifier. ADR-0033 now requires an explicit non-rolling cutover and refuses
  both mixed directions.
- Startup failure and shutdown cleanup were underspecified. The candidate now
  defines nested ownership, primary-error preservation, idempotent concurrent
  close, fail-open post-start behavior, and a 30-second upper bound.

## Initial beginner-DX audit

Verdict: BLOCKED, repaired in the candidate

- The setup sample could leak the adapter when App creation failed. All samples
  now use nested cleanup and close the App before telemetry.
- Options and CLI behavior were vague. The candidate now gives the exact option
  object, supported environment subset, CLI flag, resolution root, and
  `QP-START-004` startup diagnostic.
- Queue, flush, and protocol-cutover behavior were hidden. The public draft and
  normative boundary now state them directly, including an effective batch
  default of `min(512, queue size)`.

## Required final audits

A continuation audit initially treated `events` as public. The later exact-head
authority audit found that generated `CreateAppInput` has no such member: it is
a private Runtime/test seam. The repaired boundary advances only that private
type atomically to `ExecutionEventV2`, forbids dual emission and adapter
reconstruction from the callback, keeps generated App input eventless, and
makes callback failure disable only that lossy consumer.

After all executable proofs and deterministic gates pass, fresh independent
authority, Runtime/compiler, beginner-DX, and deletion audits must review the
same committed candidate head. Their findings and repairs belong here. Formal
acceptance still occurs exactly once through the pinned manifest-driven review.

## Fable 5 high signal-contract audit

Verdict: BLOCKED, repaired in the candidate. This was a fresh read-only
adversarial design review, not formal acceptance.

- The frozen neutral start/event/end interface did not structurally carry all
  facts required by the 14-span projection. The repaired exact unions now
  distinguish generated and unmatched Fetch, matched Route, normalized method,
  scheme and status; carry SQL verb plus statement identity, Execution entry,
  Resource and optional operational IDs; require durable attempt/link facts;
  and carry retry and terminal event payloads. Ingress Principal is null until
  the child Execution starts after Context Resolution. The executable proof
  constructs every projected span-start shape plus Runtime lifecycle.
- `extract` returned `tracestate`, but the original start shape had no channel
  for it and the prototype omitted extraction. The repaired trace plan carries
  one complete frozen extraction result as `remote-parent`; restart and durable
  attempts use explicit `root-with-links`. The kernel now executes and validates
  extraction without an object-identity side channel.
- The pinned artifact named three span-status values outside the closed outcome
  vocabulary. The repaired artifact classifies only `framework_error` as
  `ERROR`; all seven other outcomes remain `UNSET`. Projection and config
  digests were regenerated from the changed canonical bytes.
- The audit also found unbounded unmatched HTTP method names, an undefined Job
  queue-delay origin, and conflicting drop ownership. The projection now binds
  the normalized method set with `_OTHER`, measures delay from
  `max(acceptedAt, notBefore)` to successful claim, and separates SDK queue
  diagnostics, QUESTPIE event/adapter drops, and Envelope-limit diagnostics.
- The hostile audit found late nested Envelope emission could recreate deleted
  counter state. The repaired kernel marks ended Execution identity in a
  `WeakSet` and returns an inert scope for late nested work. Pre-entry adapter
  failure now drops adapter context while preserving core-owned same-layer
  suppression.

Fresh independent authority, Runtime/compiler, beginner-DX, and deletion audits
still review the eventual committed candidate head. This repair does not alter
the one manifest-bound acceptance rule.

The fresh Fable 5 high re-review returned `PASS (design-readiness)`: all three
blockers and the cardinality, queue-delay, drop-ownership, cleanup, and
suppression findings were closed without a new design contradiction. Its two
residual wording/hostile notes were repaired before staging: Fetch/Route now
require null Execution identity, every other semantic scope requires its local
owner, pre-existing nested scopes cannot recreate Envelope counters after root
end, and the ADR no longer conditions `envelope_limit` diagnostics on adapter
presence. This PASS is adversarial evidence only, never the acceptance verdict.

## First committed-head final audits

Verdict: BLOCKED, repaired in the replacement candidate. These audits reviewed
the first committed Proposed head independently; none is a formal acceptance
record.

The authority and beginner-DX audits found that the draft still described the
private Runtime `events` seam as generated/public in isolated places, used UUID
language for PostgreSQL transaction identity, omitted affected documentation
and navigation from the post-PASS projection, left the per-scope event/outcome
matrix partly descriptive, and did not give operators a complete supported
`OTEL_*`, diagnostic, direct/network/worker, or non-audit contract. The repair
keeps generated `CreateAppInput` eventless, binds canonical nonzero PostgreSQL
`xid8` text, makes the matrices exact, expands the manifest-bound projection,
and rewrites the public draft around exact-version installation, configuration,
recovery, parity, and authority ownership.

The Runtime/compiler/deletion audit found that the durable proof modeled a toy
catalog rather than production protocol v7, structural clones could reopen an
Execution, saved adapter entry and hostile context getters escaped containment,
host abort could leave a streaming Fetch scope open, Envelope events omitted
safe lifecycle facts, and the v1 deletion inventory was incomplete. The repair
imports the production v7 catalog and acceptance identity seam, proves the exact
three-column/check v8 delta on PostgreSQL 17, makes Execution identity nominal
and single-use, closes delayed/getter/abort hostiles, carries the exact redacted
start/event/end facts, and names every production v1 owner to delete atomically.

Fresh replacement audits must review the resulting clean repair head. A PASS
there remains ordinary adversarial evidence; only the later manifest-bound
repository reviewer can accept ADR-0033.

## Replacement-head audits at `3ca53ace8`

Verdict: BLOCKED, repaired in the next candidate. These were read-only
adversarial reviews, not formal acceptance.

The exact-head authority/spec audit found three staging and ownership defects.
The projection would have published install instructions immediately after
acceptance even though the draft itself required a passing implementation
tracer. It omitted the current durable public guide whose v6-to-v7 operator
instruction must gain the distinct v7-to-v8 cutover. It also failed to name the
owner and import direction of the nominal `QuestpieObservability` type, leaving
generated declarations at risk of importing an absent optional package. The
repair keeps all `apps/docs` publication in an explicit post-implementation-
tracer set, binds `durable-reactions.mdx`, and makes `questpie` own and export
the opaque type that the optional exact-peer adapter implements.

The fresh Fable 5 high review found two exact contract gaps. Durable attempts
required a creation-time link even though old rows and no-adapter acceptance
persist null. They now always start a root, use exactly one link only for a
non-null first-acceptance context, and use zero links without fabricating an
identity otherwise. The sampler table required an argument for the ratio
sampler but did not decide what a supplied argument meant for the two non-ratio
samplers. The repaired contract rejects that combination as invalid
configuration.

The exact-head Runtime/compiler/deletion audit found five executable gaps. The
kernel did not validate optional operational UUIDs or the closed durable
terminal payload, and its public nested entry could open a second Execution for
one issued identity. The artifact duplicated event-owner and end-outcome maps
instead of binding the Runtime values. The PostgreSQL proof compared only the
three Durable tables rather than the complete live production catalog. Finally,
the breaking inventory omitted the production protocol-v7 compiler, migration,
CLI, readiness, and test owners. The repair adds hostile payload and duplicate-
Execution tests, derives the artifact maps from the exported Runtime constants,
installs the real bootstrap-through-v7 chain and compares all 21 live v7/v8
tables, columns, constraints, and indexes, and binds every atomic v8 replacement
owner without a compatibility path.

The replacement continuation also required the already intended operational
edges to become mechanically reviewable: the 1..64 printable-ASCII
`deploymentEnvironment` bound, exact embedded and CLI diagnostic reasons,
SIGINT/SIGTERM close order and primary-failure rule, and the complete production
protocol-v7 compiler, migration, CLI, readiness, and test owner inventory. The
authority projection now hashes those unchanged owners and requires their
atomic v8 replacement without aliases or mixed-version compatibility.

Fresh read-only replacement reviews must evaluate the next clean committed
head. No finding in this section is an acceptance verdict.

## Runtime replacement audit at `d3c43670`

Verdict: BLOCKED, repaired in the next candidate. This exact-head review was
adversarial evidence, not formal acceptance.

The Runtime review found that hostile structurally open start and end objects
could cross the supposedly closed observation boundary even though event
payloads already rejected extra keys. The executable repair must apply the same
exact-key rejection to every start and end variant and prove both with hostile
inputs before a replacement head is eligible for acceptance.

The same review found two omitted production protocol owners:
`packages/runtime/src/bundle-core-types.d.ts` still fixes bundle readiness to
protocol version 7, and
`tests/unit/pb05-runtime-bundle-completeness.test.ts` still asserts
`readiness.protocol.v7` and version 7. The projection now hashes both unchanged
files and requires their atomic v8 replacement with no v7 field, alias, or
compatibility assertion.

The earlier Fable 5 high design-readiness PASS remains useful adversarial,
nonformal evidence only. Its residual Runtime note is superseded by the concrete
open-start/open-end hostile evidence above and cannot waive the executable
repair or the later manifest-bound acceptance review.
