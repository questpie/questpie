# QUESTPIE v4 agent entry

This branch is the docs-first QUESTPIE v4 rewrite. Public documentation defines
product behavior. V3 code is evidence only; its Module, plugin, merge, builder,
and Admin architecture is not a v4 default.

## Load on demand

- **Product, architecture, roadmap, or public API:** read `SPEC.md`,
  `CONTEXT.md`, and `docs/adr/README.md`. Then read only the relevant ADRs.
- **Public documentation:** read `docs/agents/product-documentation.md`. Write
  finished-product prose in `apps/docs/content/docs/v4/`; keep decisions and
  open work in `docs/v4/`.
- **Implementation:** read the target public page and
  `docs/v4/implementation-gates.md`. Confirm that the work belongs to the
  current tracer in `SPEC.md` before implementation.
- **Issues or design tickets:** read `docs/agents/issue-tracker.md`; for labels,
  also read `docs/agents/triage-labels.md`.
- **Domain language or ADR work:** read `docs/agents/domain.md`.

`SPEC.md` outranks stale workbench pages. Research is evidence. An Accepted ADR
is authority unless `docs/adr/README.md` marks it superseded or deferred from
the current tracer.

Use Bun. Preserve unrelated work. Verify the smallest relevant scope and always
run `git diff --check`.
