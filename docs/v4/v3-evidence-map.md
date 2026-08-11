# QUESTPIE v3 evidence map

- Baseline commit: `11617485f2a8f86efa0781b7e38cf47ae4343689`
- Baseline date: 2026-08-09
- Baseline subject: `chore: release (#246)`
- Repository: `https://github.com/questpie/questpie`
- Role: behavior, failure, fixture, and budget evidence only

The v4 branch does not carry the v3 implementation. Use `git show` or a separate
v3 worktree at the pinned commit. Do not treat current `main` as a stable oracle.

## Evidence inventory

| V4 guarantee           | Pinned v3 evidence area                                                                | Use                                         | Do not preserve                           |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| PostgreSQL transaction | `packages/questpie/test/collection/`, `test/integration/`                              | Atomicity, nesting, locks, failure cases    | Public Drizzle types                      |
| Policy                 | access, field-output, tenancy, and authorization tests under `packages/questpie/test/` | Fail-closed behavior and output filtering   | V3 builder shape                          |
| Durable dispatch       | queue dispatch, envelope, lease, retry, and idempotency tests                          | Crash and duplicate-delivery cases          | Adapter matrix                            |
| Realtime               | txid, replay, cursor, authorization fence, reconciliation, and recovery tests          | Commit visibility and recovery oracles      | V3 topic and module architecture          |
| Schema lifecycle       | migration and seed tests, generated migration fixtures                                 | Failure classes and deterministic artifacts | `push` as an unrecorded path              |
| Generated contract     | built-consumer, import-direction, generated-layer, and type tests                      | Cycle and declaration gates                 | Ambient registries and recursive builders |
| Domain tracer          | `examples/tanstack-barbershop/` and selected City Portal fixtures                      | Domain language and acceptance cases        | Generated source architecture             |
| Performance            | committed type, size, `any`, clone, dead-module, and export budgets                    | Initial baselines and regression ideas      | V3 package count as a target              |

## Retrieval examples

```bash
git show 11617485f2a8f86efa0781b7e38cf47ae4343689:packages/questpie/test/units/queue-dispatch-envelope.test.ts
git ls-tree -r --name-only 11617485f2a8f86efa0781b7e38cf47ae4343689 packages/questpie/test
git worktree add ../questpie-v3-evidence 11617485f2a8f86efa0781b7e38cf47ae4343689
```

## Port status vocabulary

- `candidate`: the v3 asset may express a required guarantee;
- `ported`: a v4 test expresses the guarantee through the v4 public path;
- `rejected`: the behavior or mechanism conflicts with the v4 specification;
- `replaced`: a new v4 proof covers the same risk with different semantics.

Do not copy a v3 test before classifying the guarantee and the mechanism
separately.
