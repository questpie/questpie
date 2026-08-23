# Product and wayfinder decisions

1. Read `SPEC.md`, `CONTEXT.md`, and `docs/adr/README.md`; then read every
   relevant Accepted ADR and the complete current decision map. Treat v3 as
   behavioral evidence only.
2. Read `docs/v4/DELIVERY-FLOW.md`. Work on one bounded ticket pulled by the
   runnable tracer. Audit the useful product job before selecting a v4
   mechanism. Name the owners of identity, Authority, lifetime, transaction,
   retry, cancellation, durable state, generated types, and operational
   visibility.
3. Where authority does not force the answer, compare materially different
   KISS interfaces. Prefer one deep kernel with capability-scoped projections;
   reject universal builders that expose invalid combinations.
4. Classify the changed guarantee, not the feature label. Kernel changes need
   the smallest falsifiable proof and applicable hostile, multi-instance,
   direct/network/worker, and TypeScript-inference cases. Product projections
   use tracer-led integration evidence. A feature may contain a narrow Kernel
   claim without making the whole feature a proof project.
5. Give focused Kernel proof construction two working days by default. If the
   claim remains unresolved, shrink, split, or defer it; never enlarge the
   proof to fit the contract.
6. Record the answer and newly discovered blocking edges before moving to the
   next ticket. Formal acceptance is required only for a new or superseding
   public Kernel/architecture ADR or an exceptional release semantic boundary.
   Ordinary Product and tracer decisions use deterministic evidence and normal
   review.

Keep `CONTEXT.md` glossary-only. Preserve the B-tree-only Index contract,
PostgreSQL as durable truth, and Policy as the sole authored authorization
model. A deferred feature retains a named compatible seam. Reject a v3 job only
with a concrete v4 invariant or failure case.
