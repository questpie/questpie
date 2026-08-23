# Implementation through TDD and review

1. Read `docs/v4/DELIVERY-FLOW.md`, the target public page, its Accepted ADRs,
   `SPEC.md` current tracer, and `docs/v4/implementation-gates.md`. Confirm the
   issue is pulled by the runnable tracer, is unblocked, and names exact
   artifacts, fixture, non-goals, hostile cases, budgets, and verification
   commands. Classify the changed guarantee as Kernel, Product, or a narrow
   Kernel claim inside a Product slice.
2. Start with one relevant failing test. Run the seconds-long changed-scope
   loop while iterating:

   ```sh
   bun run check:changed -- --test path/to/test.ts --typecheck <workspace>
   ```

   Omit `--typecheck` only when the change cannot affect TypeScript. Keep slow
   PostgreSQL, managed-provider, concurrency, load, soak, and hostile matrices
   out of the red-green loop.

3. Implement the smallest tracer bullet through the accepted public seam. Keep
   generated output compiler-owned and update goldens deliberately.
   When module topology changes, read `codebase.md`, keep one domain seam, and
   run `bun run architecture:check`.
4. Run the issue's verification commands and affected hostile cases. Before
   review, run `bun run quality:full`; release-sensitive changes also run
   `bun run quality:release`. Always run `git diff --check`.
5. Review standards and specification against the exact issue authority.
   Preserve unrelated changes and report any deferred edge by owner. Ordinary
   Product and tracer implementation ends here; it does not create proof heads,
   digest tables, acceptance manifests, or formal model reviews. Route a new
   public Kernel/architecture decision to the proof branch.
