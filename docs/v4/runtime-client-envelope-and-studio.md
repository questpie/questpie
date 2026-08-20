# Runtime, client, Execution Envelope, and minimal Studio

> ADR-0026 supersedes forward Workflow references. Job owns checkpoint history
> and the generated browser client exposes no generic durable control plane.

Status: accepted by ADR-0014 and proof head
`94c237c9aa910a60a332b1ef97473f34fe89d65b`, with the focused post-commit
outcome revision accepted by ADR-0023 and `P6R1/PostCommitOutcome`.

## Accepted contract

P6 converges exact P4 head `05fc96f3d07c70beaf7f654d79d6cfb46f427f92`
and P5 head `3f8618613bde1bdd7e13863970eb1c140e201c6f`
through no-fast-forward commit `a3fba116e9719c1859842ddea75c5312d6dc7e80`.
It consumes the accepted P1 Manifest, App Contract, Runtime Build, Package
Inventory, P3 Operation codecs, P4 Change Ledger/resume, and P5 durable
compatibility digests without changing those artifacts.

The normal path is `questpie build`, reviewed migration apply, and
`questpie start`. Build publishes one immutable 12-file bundle with checksums
and atomic complete-directory pointer replacement. Structural verification
evaluates no handler; Runtime load evaluates the statically bound executable
module once.

The generated App has `fetch`, `execution`, and idempotent `close`. ADR-0015
later adds its compiler-owned `routes` direct-invocation projection; raw Routes
remain outside the generated client. Generated clients use immutable
`withContext` scopes and the exact Fetch wire. Direct, Fetch, generated client,
nested work, recomputation, worker attempts, and Studio converge on one
Execution engine.

The wire has closed result, declared-error, framework-failure, and rejection
frames. The accepted declared error is operation-specialized
`IDEMPOTENCY_CONFLICT`; network admission preserves retryable
`RESOURCE_LIMIT` and `RUNTIME_UNAVAILABLE`. Reaction slots are not network
operations. Mutation response loss reuses stable call identity and does not
authorize automatic retry.

Operation Wire v1 remains byte-for-byte fixed. Wire v2 adds the framework
transaction outcome `COMMITTED_RESULT_UNAVAILABLE`. Its correlated failure
keeps the ordinary top-level `callId` and carries the committed PostgreSQL
transaction identity in exact error detail. HTTP `500` reports that result
production failed after commit; `retryable: true` permits only caller-controlled
exact replay with the same scoped Call Identity. Generated transport never
automatically retries a Mutation. A retained v1 Query pair remains executable;
a v1 Mutation is rejected with a v1-readable `CLIENT_OUTDATED` result before
Context Resolution or execution. This is the Mutation-only compatibility
narrowing accepted by ADR-0023.

Wire v2 also carries forward the three v1 result kinds and every accepted v1
declared error. `IDEMPOTENCY_CONFLICT` remains operation-specialized and its
`callId` payload follows the same general Call Identity text contract.

A caller-supplied Call Identity is general validated text, not a UUID contract:
1–256 Unicode scalar values, already NFC, no lone surrogate or U+0000, and at
most 1,024 UTF-8 bytes. Runtime rejects rather than rewrites it. Generated
clients use `crypto.randomUUID()` only when the caller omits the identity.

Startup rejects mismatched bundle, ABI, application, schema, migration,
executable, wire, Change Ledger, resume, and durable-compatibility facts. No
root or claim starts before readiness. Drain stops new work, resets watches,
waits bounded owned work, aborts remaining roots, fences attempts, disposes
resources after cleanup, and stops. The accepted role is the combined `all`
role.

Schema, wire, Policy/Context, realtime, executable, and internal-protocol
compatibility are separate decisions. A retained Resume Token or nonterminal
Durable Run can prevent artifact retirement.

The Execution Envelope and its event union are closed and append-only. Studio
application data uses generated Operations and ordinary Policy. Maintenance is
limited to `acknowledgeAmbiguity`, `cancelRun`, `drainRuntime`, and `retryRun`;
each command requires maintenance Authority, exact identity, bounded reason,
idempotency, expected-version fencing, a typed winner, and append-only audit.

## Fixed canonical digests

| Artifact                 | Digest                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Runtime bundle           | `9773e0147b5a227bc68b4cb9629fb2692f3d73a82d9c675949885e2400d4c712` |
| deployment compatibility | `1806bd17a8348f7093f6fa203f57e9a6eff7c9d315cab1e273ee91d67c34aeb7` |
| Execution Envelope       | `8f40863f884a6913f943544ce044b3681ab81ed4389d455934691fb84677899f` |
| Execution events         | `ec38b77532b329a2ef39b799d7a7cb8cad01e12d95c7c487293a4c930b903638` |
| Runtime executables      | `bb24f52e4d3580d4ed7f6e1574cc4defceb624135dccd6da8b5fbcee7a644b46` |
| Runtime lifecycle        | `e8417f2a1eaf3fcc87d0df04a686ec14bb3ca3991a524c17d071deec1d46404a` |
| Runtime/Studio limits    | `65a1ea826cfb36956f4fb4021372d56066f5313d7e57c3ea2eff4a0816369438` |
| committed migrations     | `9f4b140e9ac19dfed3fcf421753c74f5709922466438b16cbc78d4191a69e250` |
| Origin Map               | `3592e04e84927d0573ad5183b9ee3f3b5814c2db012ea5292ea07cdd3452f514` |
| Runtime Build            | `f638d2def0f05df397600d6c0073425c042fae1be625e6bc8a51273e47c92e6e` |
| schema binding           | `5cb2f6fa1ef7544fb073091e2e21e865ee55e994b221a6060ae04b7d9db5dd48` |
| minimal Studio           | `a52bc427d7f1a327340ed11899ca1b74418685b6693bd9a467458fe59841ac1b` |
| operation wire v1        | `d9c28927d2ced07aaecc8d2cd8caf0f94327232b33d8466535642c2af1c9115c` |

The P6R1 proof records the separate Operation Wire v2 digest without changing
the v1 row.

## Evidence and boundaries

The proof uses Bun 1.3.14, TypeScript 5.9.2, local PostgreSQL 17.10, and
managed Supabase PostgreSQL 17.6. It measures 2,424 TypeScript types, 2,351
instantiations, 7,889 public declaration bytes, 64 active roots per Principal,
128-watch fanout, and 12 B-tree indexes. It reports zero partial or expression
indexes, zero RLS-enabled tables, and no RLS claim.

The focused P6 review first returned FAIL for two wire defects. Repair commit
`6100fc8f7e45ed9979bdc677fbe37c775939cccf` closed them. A replacement fresh
Opus-medium review returned PASS, followed by a separate connected-tracer
Opus-medium PASS. The accepted head records both outcomes.

## Remaining gates

P6 does not accept production code, split Runtime roles, streaming drain,
remote/fleet Studio, host/provider SPIs, raw SQL authority, non-B-tree Index
authoring, RLS, complete migration execution, Package Augmentation through the
Runtime, or complete Route, Action, Auth, Files, Search, Job, and Workflow
contracts. If implementation needs any of those surfaces, it stops for the
named focused gate.
