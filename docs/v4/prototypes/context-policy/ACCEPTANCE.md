# P2 trusted Context and relational Policy acceptance packet

- Status: accepted by one fresh focused Opus-medium review
- Proof parent:
  `713485a64bcc4795d960d576fea51da56bc4dcdd`
- Proof commits:
  `52c482c61b10e28b22192672c083e318ea448b06` and
  `e517fe5eb8360e76f7a021a7b04263d887721931`;
- Evidence-packet commit: `b78ffa73`;
- Review-repair commit: `75bfd5a8`;
- Scope: P2 trusted Context Resolution and relational Collection Policy only
- Toolchain: Bun 1.3.14, TypeScript 5.9.2, PostgreSQL 17.10
- Host: Linux x64, AMD Ryzen 5 5600G, 12 logical CPUs

This packet does not accept or implement P3 Query, Mutation, Collection
Operation, transaction, or lifecycle semantics. It does not implement a
production compiler or Runtime. The foundational proof at `d03358b7`, ADR-0009,
and P1 head `713485a6` remain fixed inputs.

## Candidate contract proven

1. `defineContext({ input, resolve })` owns one transport-neutral application
   Context input and one exact resolved result. The input names no Request,
   header, URL, worker payload, or protocol encoding.
2. Every root Execution is constructed explicitly, resolves once, coalesces
   concurrent consumers, freezes Principal/Tenant/Authority/resolved values,
   propagates the same values into nested work, and disposes memoized Services
   in reverse order after success or failure.
3. Context failure occurs before Policy or an operation handler. Bootstrap
   exposes only bounded read-only `get` by exact key and selection, with row,
   read, selection, concurrency, duration, cancellation, and deadline bounds.
   It exposes no raw SQL, database, all-Collection map, Queue, Service, write,
   or System capability.
4. Generated client `withContext(input)` returns independent immutable scopes.
   Direct `app.execution(...)` accepts the same exact Context input and ordinary
   Principal, but no ordinary Authority option. Route transitions, realtime
   recomputations, workers, and Studio deliberately create new roots; nested
   work inherits the parent.
5. `definePolicy(collection, body)` and
   `policy.exists(collection, predicate)` receive exact bounded Collection row
   types from their first arguments. The four-hop
   Message -> Channel -> Space -> Company -> Membership graph compiles without
   an ambient registry, whole-app recursive type, ORM type, manual generic, or
   `any`.
6. Policy fixes admission, SQL row scope, sparse supplied caller-Field paths,
   selected-output omission, current stored row, and complete candidate-row
   phases. Policy decides only; it never supplies or rewrites a value.
7. Evidence reads are compiler-authored boolean-only correlated `EXISTS`
   predicates. They do not recursively apply the target disclosure Policy and
   cannot return target rows. Ordinary disclosure still applies target row and
   Field Policy. Membership has its own deny-ordinary disclosure Policy; the
   evidence expression has only a boolean type and ordinary disclosure runs the
   target Policy.
8. Framework-owned SQL intersects Policy scope before caller filters, counts,
   cursor boundaries, `first + 1` sentinels, ordering, locking, and output.
   There is no JavaScript post-filter fallback. One lowering function consumes
   the canonical Policy AST for artifacts, reads, update lock/recheck, and
   candidate checks; a differential fixture compares interpreter and SQL.
9. Missing and Policy-invisible keyed rows have the same result. Missing and
   invisible references share one normalized result. Database constraint detail
   is not disclosed. Cursor scope mismatch fails before SQL or disclosure.
10. A writer that waits for a row lock performs an explicit in-transaction
    current-evidence recheck. The PostgreSQL concurrency proof revokes the
    moderator membership while the contender waits; the lock completes, the
    recheck affects zero rows, and the message remains unchanged.
11. Membership role/status/scope changes are canonical Context-bootstrap and
    Policy dependencies. A stale resolved convenience role does not authorize a
    read after current membership revocation.
12. Equivalent facts produce the same decision through direct, network,
    nested, recompute, Route transition, worker, and Studio surfaces. System
    Authority requires an unforgeable trusted Runtime capability and still does
    not create an ambient Policy bypass.
13. The materially different Archive/Record/ResearchPermit domain uses a
    composite natural key, has no `id` requirement, and authorizes through
    permit evidence without a Tenant-equality shortcut.
14. P2 emits no RLS. The PostgreSQL schema contains zero RLS-enabled tables and
    zero policies; the canonical artifact reports `derivedRls: notEmitted` with
    a null claim. Policy-enforced framework SQL is the only claim.

## Required P2 evidence

| P2 gate                  | Executable evidence                                                                                                                     | Result |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Once-per-root resolution | Three concurrent consumers share one promise, one resolver call, and one bootstrap read                                                 | PASS   |
| Failure order            | Unknown and anonymous Context roots fail without incrementing Policy or handler counters                                                | PASS   |
| Bootstrap bounds         | Exact key/selection typing and runtime capability/limit/cancellation/deadline assertions                                                | PASS   |
| Immutable propagation    | Frozen root facts, nested object identity, independent generated-client scopes                                                          | PASS   |
| Service lifetime         | One instance per name; reverse-order cleanup after success and handler failure                                                          | PASS   |
| Four-hop inference       | Exact Message, Channel, Space, Company, and Membership operands plus negative cross-row/codec/target tests                              | PASS   |
| Generated projection     | Type-level equality links inferred Context input/resolved types and Policy target to exact emitted declarations                         | PASS   |
| Admission and phases     | Canonical fail-closed phase order for Context, read, create, update, delete, Field, candidate, validation, and normalized Constraints   | PASS   |
| SQL pushdown             | One AST lowering feeds canonical artifacts and PostgreSQL count/page/key/sentinel/lock/candidate statements; JS/SQL differential agrees | PASS   |
| Selected output          | One SQL statement returns a permission bit and guarded value; encoder omits a denied property, never null-masks it                      | PASS   |
| Sparse input/candidate   | Only supplied segment-array paths are checked; denied path and unauthorized candidate move have distinct fail-closed results            | PASS   |
| Evidence/disclosure      | Boolean-only evidence authorizes 1,002 Messages; ordinary Membership disclosure applies its own Policy and returns zero rows            | PASS   |
| Nondisclosure            | Missing and inaccessible keyed rows each return zero rows; normalized artifact fixes safe error equivalence                             | PASS   |
| Cursor/sentinel          | Cursor binds Policy digest plus used Principal/Tenant/Authority; populated and one-row boundary pages use identical scope               | PASS   |
| Lock recheck             | Real concurrent PostgreSQL wait followed by explicit in-transaction evidence recheck affects zero rows after revocation                 | PASS   |
| Dependencies             | Canonical evidence graph and dependency projection include membership create/delete/role/status/scope changes                           | PASS   |
| Surface parity           | Direct/network/nested/recompute/Route transition/worker/Studio all return the same decision                                             | PASS   |
| System boundary          | Ordinary roots reject Authority input; trusted capability is required; current Policy evidence still applies                            | PASS   |
| Second domain            | Archive record composite key and permit evidence succeed with no `id` or Tenant-equality assumption                                     | PASS   |
| RLS boundary             | Zero PostgreSQL RLS objects and an explicit no-claim canonical projection                                                               | PASS   |

## Canonical proof digests

| Artifact                             | Digest                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| Context projection                   | `fa8142f732af3c4c45ba6bcc008b63496cd75588d9cde417c1106dd774d4f1a5` |
| Context bootstrap plan               | `1f5bf9b40d4b3c797a0fc07f8473dc497ae21cdb0fdbeea87e979795150b963a` |
| Message Policy program               | `972c05336c129b4f4aaabe5f20aee46019497008920d6e02f3193d6353d63bcb` |
| Membership Policy program            | `1e6013e7f682862d5c6a91a6666c4512a267353e37c58db419fa1399c8b92b1c` |
| Archive Policy program               | `9e331e56f4db891bf77201b2da46a13e2786bb02d69ec3c18982526daacf9f74` |
| Policy evidence graph                | `3ab4bf1b4da85ae2102038e75f2e254baa2e8cc856e45edf1370ca57ce495e9e` |
| Policy dependency projection         | `a582e4c1c8abaf43babec1e95ad722bcd55db8c72dcf4b3c2a38d0abd3635099` |
| SQL lowering                         | `a62df02bbf789b7eca994b1afd64a9cc6754fcd14b56541b199ad07181834dc7` |
| Nondisclosure and error precedence   | `c2423f0ea51bad046c7ccfa07d69519b03ef197d72a4067ebb1c3ca22de94e7e` |
| Execution-surface parity             | `6a0a1499103819123298b3a68143ee2f0c48a7665fe2c60cf7ae077f74e54ea6` |
| `questpie explain policy` projection | `9fb23aea897a3722ea801d784ed46d05b13aa202acf6b7ecdba2586696d0b20e` |

The fixed input digests remain:

- Schema Projection:
  `9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033`;
- Data Contract Projection:
  `0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f`;
- structural Query Template:
  `a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1`;
- P1 executable Manifest projection:
  `c806791a7522305ed2f2554613eb06fc331528501c31fc5e5f106753b2a0a644`;
- P1 generated App Contract:
  `d6052edc32d5a9218f242d724c7b47dd0ea543857d57fe5f47bc625fb307b7ca`;
- P1 Runtime Build:
  `ff060e1cf02fb28830e8fee2aa89a90bfe777468e7e84bbbe6a31b81cea3db19`.

## TypeScript and editor measurements

TypeScript reports 948 lines in the connected 8-file fixture. The full
generated app and client declaration surface is 2,562 bytes.

| Measurement                       |      Result |          Ceiling |
| --------------------------------- | ----------: | ---------------: |
| Types                             |       1,883 |         reported |
| TypeScript instantiations         |       2,730 |          125,000 |
| TypeScript memory                 |  24,048 KiB |       98,304 KiB |
| cold total check                  |      0.47 s |            1.5 s |
| warm total check                  |      0.46 s |            1.5 s |
| completion p95, 100 warm requests |     0.32 ms |           100 ms |
| hover p95, 100 warm requests      |     0.40 ms |           100 ms |
| generated app declaration         | 2,146 bytes | combined ceiling |
| generated client declaration      |   416 bytes | combined ceiling |
| combined public declarations      | 2,562 bytes |    262,144 bytes |

Depth scaling from one to four `exists` hops increases instantiations from 1,022
to 1,139 (`1.114x`). Widening every one of five four-hop Collection contracts
from 10 to 50 Fields leaves the 1,139 instantiations unchanged (`1.000x`).

## PostgreSQL measurements

The proof ran on PostgreSQL 17.10. It created and removed one isolated schema.
All 12 primary-key and explicit indexes use B-tree. No expression or partial
index exists. The source and artifact expose no GIN, GiST, SP-GiST, BRIN, hash,
operator-class, raw-SQL, or generic `using` authoring authority.

The four-hop page statement over 20,004 Message rows planned in 0.791 ms and
executed in 0.670 ms on the recorded host. Its plan used the ordinary B-tree
`messages_channel_created_idx` through a bitmap index scan. The hostile lock
test waited 1,021 ms, rechecked current membership, affected zero rows, and left
the message unchanged.

These are proof-host observations, not production performance promises. If a
future Policy workload needs another PostgreSQL access method, expression,
partial predicate, operator class, or native statement, that remains a named
later contract and cannot be smuggled into the accepted foundational Index
surface through P2.

## Commands

```bash
bun docs/v4/prototypes/context-policy/run.mjs

bun node_modules/typescript/bin/tsc \
  -p docs/v4/prototypes/context-policy/types/tsconfig.json \
  --noEmit --extendedDiagnostics --pretty false

bunx oxlint docs/v4/prototypes/context-policy --deny-warnings
bunx oxfmt --check docs/v4/prototypes/context-policy
git diff --check
```

## Stop-condition audit

The proof and generated declarations contain no second Context root, mutable
Context scope, transport-specific Context key, ambient System elevation,
Service/bootstrap capability bag, whole-app registry, recursive authored App
generic, handler-selected Policy, `access`, Policy value rewrite, target
disclosure bypass, JavaScript row post-filter, N+1 Field check, raw SQL,
unaccepted Index authoring authority, or RLS claim.

## Deferred seams

P3 owns full Operation codecs and execution, Query snapshot boundaries,
Mutation transaction ownership, server values, validation/Constraint execution,
write application, automatic retry, cancellation, call identity, and exact
network error bytes. P4 owns observed dependency capture and realtime refresh;
P2 establishes only the Policy/Context dependency facts P4 must observe. P5
owns durable run-as persistence and attempts; P2 establishes the fresh-root and
no-worker-elevation invariant. P6 owns the connected Fetch/client protocol,
production Runtime lifecycle, Execution Envelope, and Studio implementation.

Broad RLS, maintenance/System APIs, recursive Policy graphs beyond the bounded
contract, advanced joins, typed JSON-interior Policy, and non-B-tree/native SQL
performance contracts remain later seams. No authority document, canonical
term, public page, gate, map, handoff, or ticket should move until the one fresh
focused Opus-medium review returns `PASS`.

## Acceptance review

The one fresh focused Claude Opus review at medium effort ran after every
blocking repair was committed. It independently read the authority workspace,
inspected every P2 proof file, and ran the complete Bun proof, stock TypeScript
diagnostic command, lint, format check, `git diff --check`, and clean-status
check. It returned `PASS`.

The review independently confirmed the real Membership disclosure Policy,
boolean-only evidence type, one AST-to-SQL lowering used by canonical and
PostgreSQL paths, interpreter/SQL differential, populated and final-page cursor
sentinels, positive/negative candidate SQL controls, exact nested parity,
compile-time authored/generated projection equality, real lock-wait revocation,
B-tree-only indexes, and absence of RLS and P3 claims.

Its non-blocking implementation notes remain explicit:

- production lowering must reject or fully support multi-segment operands; P2
  uses only accepted single-Field paths and typed JSON interior Policy remains
  deferred;
- the separate Archive SQL fixture should later route through the same lowering
  even though P2 does not claim that second domain as a lowering proof;
- create-candidate SQL remains P3 work; P2 proves its Policy phase and executes
  the update current/candidate boundary;
- production bootstrap must enforce concurrent-read, result-row, and elapsed
  duration limits in addition to the proof's read-count, selected-path,
  cancellation, and deadline checks;
- production owns the trusted System capability and must include candidate
  authority in the transaction-owned lock/recheck sequence;
- the post-acceptance handoff records the final self-referential review commit.
