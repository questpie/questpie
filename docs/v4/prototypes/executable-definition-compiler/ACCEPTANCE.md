# P1 executable Definition compiler acceptance packet

- Status: proof complete; awaiting the one fresh focused Opus-medium review
- Proof parent: `d03358b749c4c8efb769d1c0fed50e8fbf983fb0`
- Proof commit: `3d2b6e3899ff4d554926d80be2858b9ce7fa9fd4`
- Scope: P1 compiler mechanics only
- Toolchain: Bun 1.3.14 and TypeScript 5.9.2
- Host: Linux x64, AMD Ryzen 5 5600G, 12 logical CPUs

This packet does not accept or implement Query, Mutation, Context, Policy,
realtime, durable-work, or production Runtime semantics. The foundational
Schema, Data Contract, and structural Query proof at `d03358b7` remains fixed.

## Candidate contract proven

1. Only `defineAction`, `defineJob`, `defineMutation`, `defineQuery`,
   `defineReaction`, and `defineRoute` are allowlisted current-virtual value
   exports from `#questpie/app`. Structural builders remain in `questpie`.
   Generated Runtime values such as `createApp` and private bindings are
   rejected.
2. The compiler current-virtual contract is authoritative for sync, check, and
   build. The last disk declaration is editor evidence only. Before first sync,
   stock TypeScript reports the missing module and QUESTPIE reports
   `bunx questpie sync`; no broad placeholder exists.
3. One exported Definition owns one built-in executable slot. Inline and
   ordinary imported handlers produce the same structural slot contract.
   Handler source and lexical dependencies enter only the Runtime graph.
   Shared impure structural captures fail.
4. Local output inference proceeds in deterministic current-build rounds.
   Acyclic same-build output references resolve without repetition. A recursive
   output component requires one explicit codec pin and never uses a previous
   compile or a widened placeholder.
5. A closed Collection Operation Set is a compile-time Resource Set, not a
   Resource or dispatcher. Its literal members expand before collision
   resolution into ordinary Query and Mutation Resources. Every child has its
   own identity, Owner, member Origin, structural digest, inventory entry,
   canonical exact-key member, and client alias.
6. The application Context root uses fixed compiler identity `context:app`.
   Zero roots generate empty Context input, one root owns the singleton, and
   two roots fail with both Origins. P2 owns resolver and runtime semantics.
7. A default Collection Policy remains a separate Policy Resource. Where a
   generated data operation needs an implicit default, zero candidates fail,
   one exact target succeeds, and two candidates fail with both Origins. P2
   owns Policy behavior and lowering.
8. Executable bodies and private static bindings live in one versioned Runtime
   Build paired to exact Build Input, executable projection, App Contract,
   runtime graphs, toolchain, and server bundle bytes. Startup refuses missing,
   duplicate, stale, wrong-kind, and cross-build bindings.
9. Fixed Packages compile against their own generated `#questpie/package`
   surface, emit nameable declarations, activate into a structurally wider
   host, and cannot name host-only Resources.

## Required P1 evidence

| P1 gate                         | Executable evidence                                                                                                                                                                 | Result                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| First sync, no generated output | `typescript-harness.mjs` removes the disk authority, resolves the exact current virtual module, and reports the recovery when the generated module is absent                        | PASS, zero current-virtual diagnostics |
| Stale disk rejection            | A physical stale declaration includes `legacy`; raw TypeScript accepts it and the current virtual check rejects it                                                                  | PASS                                   |
| Six-value evaluator allowlist   | `p1-goldens.mjs` substitutes exactly six frozen factory values and rejects `createApp` and `runtimeBindings`                                                                        | PASS                                   |
| Inline/imported slicing         | Equal structural slot digest, distinct Runtime graphs, preserved lexical dependencies, no handler initializer during structural evaluation, and an impure shared-capture diagnostic | PASS                                   |
| Body-only artifact boundary     | Changed handler body changes Runtime Build only; executable projection, public App Contract, and fixed foundational digests remain equal                                            | PASS                                   |
| Inferred output and equal pin   | Return-shape change changes executable projection, App Contract, and Runtime Build; an equal explicit pin preserves output-codec bytes                                              | PASS                                   |
| Output rounds and cycle         | `reports.companyDigest` resolves after `companies.summary`; an unpinned two-node cycle fails with both Origins and a one-node pin resolves it                                       | PASS                                   |
| Operation Set expansion         | `messages.list/get/create/update/delete` become five ordinary Resources with exact identities, Owners, Origins, inventory entries, aliases, and collision behavior                  | PASS                                   |
| Context and Policy ownership    | Zero/one/two Context roots and zero/one/two default Policies have deterministic results and structured diagnostics                                                                  | PASS                                   |
| Runtime Build pairing           | Valid pair loads; missing, duplicate, stale, wrong-kind, and cross-build variants refuse                                                                                            | PASS                                   |
| Package isolation               | Package declaration emit is nameable; wider-host type proof passes; `messages` remains a negative Package completion                                                                | PASS                                   |
| Determinism and relocation      | Reverse discovery and a different absolute checkout preserve semantic, Origin, generated, and Runtime bytes; a logical source move changes Build Input and Origin only              | PASS                                   |

## Canonical proof digests

| Artifact                             | Digest                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| executable Manifest projection       | `c806791a7522305ed2f2554613eb06fc331528501c31fc5e5f106753b2a0a644` |
| generated App Contract projection    | `d6052edc32d5a9218f242d724c7b47dd0ea543857d57fe5f47bc625fb307b7ca` |
| Runtime Build                        | `ff060e1cf02fb28830e8fee2aa89a90bfe777468e7e84bbbe6a31b81cea3db19` |
| Package Inventory                    | `ab70ed96877f03aef868ebbed7503138cbd33503b935bbfeaa022f4e1164d71b` |
| `questpie explain --json` projection | `3224211500c7a38bc639a7e3d1cc3001129d6e498ccae3a89512e146d359a499` |

The fixed foundational digests remain:

- Schema Projection: `9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033`;
- Data Contract Projection: `0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f`;
- structural Query Template: `a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1`.

## P1 budgets

Measured on the host above with the complete connected fixture:

| Measurement                       |      Result |          Ceiling |
| --------------------------------- | ----------: | ---------------: |
| Types                             |       1,852 |         reported |
| TypeScript instantiations         |       3,901 |          125,000 |
| TypeScript memory                 |  24,222 KiB |       98,304 KiB |
| TypeScript total time             |      0.43 s |            1.5 s |
| completion p95, 100 warm requests |     0.30 ms |           100 ms |
| hover p95, 100 warm requests      |     0.43 ms |           100 ms |
| generated public `app.d.ts`       | 4,932 bytes | combined ceiling |
| generated public `client.d.ts`    |   748 bytes | combined ceiling |
| combined public declarations      | 5,680 bytes |    262,144 bytes |
| maximum private binding record    |   219 bytes |      4,096 bytes |

Scaling from 8 to 32 repeated executable Resources produced 3,241 to 11,761
instantiations (`3.629x`) and 10,505 to 19,667 public declaration bytes
(`1.872x`). Both remain below the `5x` ceiling.

The minified Bun bundle witness reports a 53-byte raw/73-byte gzip baseline.
One added Resource kind costs:

| Kind     | Raw bundle | Gzip bundle | Raw delta | Gzip delta |
| -------- | ---------: | ----------: | --------: | ---------: |
| Query    |        120 |         129 |        67 |         56 |
| Mutation |        126 |         130 |        73 |         57 |
| Action   |        122 |         127 |        69 |         54 |
| Route    |        120 |         129 |        67 |         56 |
| Reaction |        126 |         130 |        73 |         57 |
| Job      |        116 |         127 |        63 |         54 |

## Commands

```bash
bun docs/v4/prototypes/executable-definition-compiler/run.mjs

bun node_modules/typescript/bin/tsc \
  -p docs/v4/prototypes/executable-definition-compiler/types/tsconfig.json \
  --noEmit --extendedDiagnostics --pretty false

git diff --check
```

## Stop-condition audit

The proof and emitted declarations contain no widened handler context, ambient
application registry, recursive authored App generic, compiler-previous-build
authority, handler registry, required paired handler file, repeated handler
name, per-operation Collection capability map, runtime discovery, runtime
Operation Set expansion, hidden CRUD dispatcher, import-order winner, source
path identity, or warning-only Runtime mismatch.

The source-owned type-only binder remains the documented fallback. P1 does not
need it because the current-virtual six-factory isolation passes.

## Deferred seams

P2 still owns Context Resolution, Principal/Tenant/Authority construction,
relational Policy programs, nondisclosure, SQL lowering, runtime enforcement,
and optional RLS. P3 owns Operation codecs and execution semantics,
transactions, Collection-operation lifecycle, errors, cancellation, and call
identity. P4-P6 retain realtime, durable execution, connected Runtime/client,
Execution Envelope, and Studio. This proof authorizes none of that runtime
behavior and does not authorize a disconnected production compiler preview.
