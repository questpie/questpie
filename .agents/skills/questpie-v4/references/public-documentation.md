# Public-documentation projection

1. Read the relevant Accepted ADR/workbench, `SPEC.md`, `CONTEXT.md`, and
   `docs/agents/product-documentation.md`. Read `docs/v4/DELIVERY-FLOW.md` when
   the page belongs to the current tracer.
2. Write finished-product prose under `apps/docs/content/docs/v4/`. Keep
   decisions, proof history, open work, and rejected alternatives out of public
   pages and in their canonical internal homes.
3. Use one canonical concept name, present tense, active voice, exact imports,
   complete Barbershop examples, inferred types, limits, diagnostics, and a
   supported recovery path. Public docs project accepted behavior; they do not
   create it.
4. Update navigation and link targets. Run the docs typecheck/build plus
   changed-scope format/lint and `git diff --check`. Documentation projection is
   ordinary Product work: deterministic checks and normal review are its
   acceptance unless the change also creates a new public Kernel/architecture
   decision.
