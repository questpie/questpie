# Contributing to QUESTPIE v4

This repository is currently specification-first. Do not port v3 code or
publish new framework syntax unless the current tracer requires it.

Before a change:

1. Read `SPEC.md`, `CONTEXT.md`, and `docs/adr/README.md`.
2. State which accepted guarantee the change proves.
3. Prefer deleting an unnecessary abstraction to adding a general extension
   point.
4. Keep one source of truth. Public docs project accepted decisions; they do
   not create a second specification.

For documentation changes, run:

```bash
bun install
bun run check-types
bun run build
bun run format:check
bun run lint
```

The first implementation must be the Barbershop tracer defined in `SPEC.md`.
It must pass the gates in `docs/v4/implementation-gates.md` before broader
product areas enter the runtime.
