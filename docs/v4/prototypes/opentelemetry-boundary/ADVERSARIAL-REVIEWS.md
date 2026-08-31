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
