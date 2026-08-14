# API-GATE: ergonomic factories, nested Operation access, and capability ownership

Tracker: [#301](https://github.com/questpie/questpie/issues/301)

This gate follows accepted BETA-01 and blocks BETA-02 without counting as one
of the beta implementation slices. It proves:

1. named `defineKind` versus `define.*` across stable, generated App, and
   isolated Package imports;
2. exact canonical Operation identity with nested-only generated handler calls;
3. deterministic same-kind leaf/prefix rejection with both Origins and no
   cross-kind false positive;
4. distinct Job, Reaction, and Workflow authoring over one durable kernel; and
5. a permanent v4 work-ownership map without restoring legacy hooks.

Required evidence is a complete TypeScript app and Package fixture, generated
declaration/editor evidence, hostile collisions and invalid capability
combinations, relocation, deterministic digests, and measured budgets. The
focused runner must remain under 5 seconds warm, generated declarations under
262,144 bytes, TypeScript instantiations under 125,000, and autocomplete and
hover p95 under 100 ms.

Production Runtime behavior, identity changes, a second kernel, a general hook
catalogue, and progress toward the beta issue count are non-goals.
