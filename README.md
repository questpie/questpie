# QUESTPIE v4

This branch is a docs-first clean slate for QUESTPIE v4.

QUESTPIE v4 is being designed as an open, self-hostable, PostgreSQL-native
application compiler and runtime. It is not an incremental port of the v3
module, adapter, or Admin architecture.

No v4 runtime is implemented yet. The specification is the source of truth for
the implementation that follows.

## Read first

- [`SPEC.md`](./SPEC.md) defines the product and architecture.
- [`CONTEXT.md`](./CONTEXT.md) defines the canonical language.
- [`docs/adr/`](./docs/adr/) contains the current accepted decisions.
- [`HANDOFF.md`](./HANDOFF.md) explains the next work session.
- [`docs/v4/research/`](./docs/v4/research/) preserves supporting evidence.

## Documentation workspace

```bash
bun install
bun run dev
bun run check-types
bun run build
```

The public documentation app is in `apps/docs`. Its root redirects to the v4
documentation. There is no product landing page in this branch.
