# P22 repository-foundation proof

This proof closes atlas ticket #22 without implementing production QUESTPIE
Runtime. It measures the repository-owned agent router, quality lanes,
TypeScript baseline, Knip classification, PostgreSQL CI, benchmark/load/soak
architecture, release guard, and stateless Claude acceptance wrapper.

Run:

```sh
bun run check:changed -- --test tests/integration/postgres/connectivity.test.ts \
  --typecheck @questpie/docs
bun run quality:full
bun run quality:typescript-forward
bun run knip:strict
bun run knip:negative-control
bun run package:check
bun run scripts/performance.ts check
bun run skill:check
bun run scripts/agent-context-check.ts
git diff --check
```
