# BETA-09 implementation records

Entry point for BETA-09 (#296), "Inspect the connected tracer through minimal
Studio." These records decide the slice before it is built. None of them opens
a slice branch, and none changes an ADR, a public projection, a gate, or
tracker state; those projections move only after the acceptance protocol
returns `PASS`.

Base for every record: `feat/v4` at
`8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## Reading order

1. **[design-context.md](./design-context.md)** — the boundary against BETA-08,
   the identities, what changed underneath the Studio research, and the
   evidence discipline. Start here.
2. **[studio-purpose.md](./studio-purpose.md)** — what Studio is for, decided
   by adversarial review. "Explain, then act": identity-first address space,
   decision-first destinations, one bounded run worklist as a panel.
3. **[inspection-contract.md](./inspection-contract.md)** — what the inspection
   Operations return, the disclosure finding in the shipped reads, and how the
   red test is driven and falsified.
4. **[maintenance-decisions.md](./maintenance-decisions.md)** — the reason
   contract, read versus maintenance Authority, retry safety, fence conflict
   disclosure, `drainRuntime`, and the design-system gap.
5. **[internal-protocol-v5.md](./internal-protocol-v5.md)** — the one schema
   change this slice owns, and the two edges that decide its shape.
6. **[freshness-and-provenance.md](./freshness-and-provenance.md)** — why the
   freshness tile cannot be built honestly, and what replaces it.
7. **[hostile-cases.md](./hostile-cases.md)** — the six hostile cases and the
   assertion each must fail on before it passes.
8. **[acceptance-shape.md](./acceptance-shape.md)** — the protocol v2 manifest
   shape and the acceptance criteria.

## What this slice decided

- **Three gaps against the accepted maintenance contract**, not the one BETA-08
  disclosed. Maintenance Authority is unevaluated; `drainRuntime` exists in the
  contract and not in the code; and the bounded reason has nowhere to live,
  which no BETA-08 review round surfaced.
- **The prescribed red test already passes on the shipped surface.**
  `inspect()` returns the Reaction result unfiltered and `effects()` returns
  the provider receipt raw. Both become presence rather than bytes.
- **`relational-nondisclosure.json` is produced and never consumed.** It joins
  the artifacts verified at startup, and the operational lane gets an
  equivalent.
- **`drainRuntime` corrects the projection, not the code.** Its seven required
  properties are run-scoped and cannot apply to a process.
- **No global freshness header.** Per-answer provenance instead, because four
  of the handoff's five sources cannot honestly populate a staleness figure.
- **Purpose is job-first, address space is identity-first.** The operational
  lane has exactly one durable symptom source, so a symptom-first entrance
  would be a filtered view of one table.

## Records this slice corrects in place

Concurrent work ticks wrote these documents in parallel, and several findings
landed after the records they contradict. Rather than leave both versions
standing, the earlier record is corrected and points at the later authority:

- `design-context.md` no longer claims BETA-07 made Live Query reset history
  observable, and no longer claims keying durable views on Tenant is free —
  `tenant_id` is in no index.
- `maintenance-decisions.md` defers the v5 column shape to
  `internal-protocol-v5.md`, which shows the nullability is forced, and records
  that the rejection union gains two members rather than one.
- `inspection-contract.md` is itself a merge of two ticks that reached the same
  file; `freshness-and-provenance.md` absorbed a second freshness record
  written under a different name.

## Still open

Nothing in these records is waiting on a decision. What remains is
implementation, which no record here begins:

- The maintenance Authority evaluation itself.
- The `operational-nondisclosure.json` producer and the runtime verification
  that `relational-nondisclosure.json` joins.
- Internal protocol v5, and the local-database consequence that
  `ensureInternalProtocol` refuses a same-version different-checksum install.
- The Studio bundle, on the shadcn and Base UI primitives already in
  `apps/docs`, whose gaps `maintenance-decisions.md` names.
