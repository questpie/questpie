# QUESTPIE v4 delivery flow

ADR-0027 makes the runnable tracer the unit of delivery. This page is the
current execution guide; Accepted ADRs still own product behavior and repository
scripts remain command authority.

## 1. Classify the changed guarantee

Classify the issue before implementation:

| Tier    | Change                                                                                                                                                                                                                                         | Required evidence                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel  | Changes composition/artifact compatibility, schema lifecycle, transaction, trusted Context Resolution, Principal/Authority, Policy/nondisclosure, dispatch/Reaction, Change Ledger, or durable identity/lease/fencing/checkpoint compatibility | Focused falsifiable proof, hostile tests, affected PostgreSQL/load/soak lanes, and formal acceptance only for a new or superseding public Kernel/architecture ADR or exceptional release semantic boundary |
| Product | Projects an accepted Kernel through Route/application Auth, File, CLI, docs, Studio, client ergonomics, or another user-facing seam                                                                                                            | Tracer-led TDD, ordinary integration tests, affected repository gates, and normal review                                                                                                                   |

A feature can contain both tiers. Split out only the Kernel claim; do not make
the entire feature a formal proof project.

## 2. Pull one vertical through the runnable tracer

The current ticket first establishes a browser-runnable skeleton through:

```text
compile -> migrate -> start -> Query -> Mutation -> browser Live Query
        -> committed Reaction -> restart and recover
```

Use real generated direct, Fetch, and client paths with disposable PostgreSQL.
After this first milestone passes, keep the journey runnable as the regression
skeleton.
The next capability enters the backlog only when the tracer needs it, it removes
a concrete tracer blocker, or it supersedes an unsafe decision. Land it in the
tracer before designing the next capability.

Run the focused red-green loop while editing and the smallest affected
PostgreSQL or hostile scenario before broad quality. Shortcuts may omit Product
polish, never a Kernel guarantee.

## 3. Apply the proof budget

A new focused Kernel proof gets two working days by default. At the deadline:

- accept the falsified or established narrow claim;
- shrink or split an unresolved claim; or
- defer it with an owner and overturn condition.

Do not extend the proof contract to justify time already spent. Do not stop a
required deterministic load or soak run merely because the construction budget
expired.

Formal stateless Opus-medium acceptance is used once only for a new or
superseding public Kernel/architecture ADR, or for an exceptional release
semantic boundary that deterministic checks cannot settle. Ordinary Product
and tracer work does not invoke it. When it applies, use
`bun run review:accept:v2` and retain its generated SHA-256 bindings. Record a
`BLOCKED` result, repair on a new clean head, and run one replacement review.

## 4. Optionally measure downstream adoption

When an issue names a concrete downstream repository and owner, it may record:

- the downstream owner and duplicated responsibility;
- handwritten downstream lines before and after;
- the exact deleted files or regions; and
- any remaining compatibility shim with its deletion condition.

Count net handwritten lines removed. Do not count formatting, relocation,
vendoring, or moving equivalent behavior into generated output. Report zero
honestly when the capability improves correctness or usability without deleting
downstream code.

The mandatory delivery scorecard is:

1. runnable tracer milestone completed;
2. Kernel regression and operational budgets passed;
3. remaining abstraction and compatibility debt named.

Downstream handwritten deletion is an advisory fourth signal, not a required
scorecard row.

## 5. Run the weekly deletion review

Review abstractions against the runnable tracer, named downstream consumers,
and explicit release compatibility seams.

- Delete an unaccepted abstraction with no consumer.
- Open a focused superseding ADR for an Accepted public abstraction whose
  guarantee is no longer consumed.
- Keep a named compatibility seam only while its release decision requires it.
- Convert no-consumer backlog entries into deletion candidates rather than
  speculative implementation work.

## Documentation hygiene

New contract documents have a 300-normative-line review budget. Split by owner
or invariant when necessary. Keep types and examples for structural shape;
retain prose for authority, lifetime, failure, concurrency, and recovery.
Store measurements, transcripts, and raw proof output with test artifacts.

Do not maintain proof-head or canonical-digest ledgers in living prose. Git
commits and tags identify historical content. Runtime semantic/integrity
digests, migration checksums, schema fingerprints, executable and wire digests,
identity digests, checkpoint command digests, and generated acceptance-manifest
hashes remain required and tool-derived.
