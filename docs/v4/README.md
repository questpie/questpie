# Internal document map

For framework use, start with the [public documentation](../../apps/docs/content/docs/v4/index.mdx)
and [public agent skill](../../skills/questpie/SKILL.md). This directory contains
architecture workbenches and development evidence, not a second public guide.

- **Current work:** [HANDOFF](../../HANDOFF.md), [beta.2 scope](beta2-release-scope.md)
  and [manual release procedure](implementation/beta2-closure/MANUAL-RELEASE.md).
- **Product authority:** [SPEC](../../SPEC.md), [CONTEXT](../../CONTEXT.md) and
  [Accepted ADRs](../adr/README.md). Root workbenches elaborate those contracts;
  they do not override them.
- **Contributor procedure:** [delivery flow](DELIVERY-FLOW.md) and
  [repository skill](../../.agents/skills/questpie-v4/SKILL.md).
- **Evidence on demand:** `implementation/` records completed slices and their
  failures/reviews; `prototypes/` retains executable proofs and acceptance
  bindings; `research/` retains investigations and rejected directions.
  Read a specific slice when tracing a guarantee or a regression, not as a
  prerequisite for every task.
- **Historical planning:** beta.1 plans and `design-fiction/` describe earlier
  checkpoints. They are not the current implementation queue or shipped API.

Acceptance records and proof inputs remain at their existing paths because
verification depends on them. Superseded narrative can be recovered from Git
history; it need not be duplicated into new archive documents.
