# Product and wayfinder decisions

1. Read `SPEC.md`, `CONTEXT.md`, and `docs/adr/README.md`; then read every
   relevant Accepted ADR and the complete current decision map. Treat v3 as
   behavioral evidence only.
2. Work on one bounded ticket. Audit the useful product job before selecting a
   v4 mechanism. Name the owners of identity, Authority, lifetime,
   transaction, retry, cancellation, durable state, generated types, and
   operational visibility.
3. Where authority does not force the answer, compare materially different
   KISS interfaces. Prefer one deep kernel with capability-scoped projections;
   reject universal builders that expose invalid combinations.
4. Exercise hostile, multi-instance, direct/network/worker/Studio, and
   TypeScript-inference cases that apply. Create a focused proof when paper
   reasoning cannot settle the choice.
5. Record the answer and newly discovered blocking edges before moving to the
   next ticket. Project ADR, terms, public docs, gates, and tracker state only
   after the proof branch's acceptance protocol returns `PASS`.

Keep `CONTEXT.md` glossary-only. Preserve the B-tree-only Index contract,
PostgreSQL as durable truth, and Policy as the sole authored authorization
model. A deferred feature retains a named compatible seam. Reject a v3 job only
with a concrete v4 invariant or failure case.
