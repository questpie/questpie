# Current v3 operation parity: runnable adapter experiment

**Result:** one JSON route already supplies the same tool name, input/output contract, successful result, product access decision and verified actor/workload context to human HTTP, human MCP and Agent workload MCP. Exact native error parity and flat custom context propagation remain framework gaps. This is partial proof of the owner's target.

The target is **one product operation set with identical input, result, errors and product access**. Only verified actor kind/provenance differs. Divergent MCP product contracts are migration debt; the earlier design note's compatibility discussion is not the destination.

## Run and evidence

```sh
bun run packages/mcp/bench/operation-parity-prototype.ts
```

The script asserts 14 groups and emits JSON: raw replies, catalogs, handler observations, workload authorization requests and resolved module paths. Captured evidence: [operation-parity-experiment.raw.json](./operation-parity-experiment.raw.json). Assertion failure exits nonzero. Known-gap assertions deliberately pin current behavior; exit zero does not establish full error parity.

Framework source: **82fca046befe9cc487962ebdb49efa46e2d9ff09**, branch `t3/operation-catalog-design`. Run: Bun **1.4.2**, MCP SDK **1.32.1**, Zod **4.6.2**. Bun differs from pinned 1.3.13; this is not release certification. Existing dependencies were reused through local ignored symlinks, including SDK 1.32.1 from Autopilot. No install, database, listener, production-source edit or other-checkout mutation.

A parent rerun on the aggregate research checkout also passed all 14 groups
with the same two gaps. Reused dependencies must resolve `questpie` to this
checkout's workspace package: pointing it at another checkout loads separate
`ApiError` class identities and invalidates the HTTP error comparison. The
committed raw evidence above is the original pinned-source run.

The fixture supplies app services, authentication/context derivation, membership policy and an in-memory versioned task/receipt map. It does **not** prove credential cryptography, database CAS/rollback/concurrency, tenant isolation, OAuth consent or actual Autopilot domain migration. Its purpose is adapter/context parity. Body input cannot supply fixture authority.

## Actual execution paths

Exactly one `route().post().schema(inputSchema).outputSchema(outputSchema).access(...)` definition calls one domain executor. Input is `{companyId, taskId, expectedVersion, idempotencyKey, title}`. No actor/run fields. Both MCP catalogs publish `tasks.rename`.

- Human HTTP uses real `createFetchHandler`: matching, parsing, context resolution, access, executor and response serialization [1,2]. The session resolver is controlled.
- Human MCP uses real `createMcpServer`, SDK Client and `InMemoryTransport.createLinkedPair()` [3]. Context is controlled; route execution is real.
- Agent MCP uses real `createWorkloadMcpServer`, an opaque authorizer envelope, context binder and SDK transport [3,4]. Discovery/calls authorize the same named capability. Product policy can still refuse a capability-authorized call.

The same membership predicate runs in route access and domain execution. MCP exposure/capability configuration admits a transport; it does not redefine product permissions.

## Results and gaps

**Catalog/results:** both MCP catalogs have identical JSON input and structured output schemas. Comparisons normalize JSON because in-memory transport preserves object prototypes. Strict runtime validation rejects injected `actor`/`requesterRunId` before domain execution. Schema diet removes some catalog-only constraints; runtime rejection is independently exercised [5].

Each lane starts at version 1. The same input returns `{taskId:"task-1",title:"After",version:2,replayed:false}`. A repeat returns that task/version with `replayed:true`. A fresh key with stale expectedVersion conflicts without changing version 2. Denial/injection never invokes the domain. Receipt identity includes company and actor; no cross-actor replay promise is implied.

**Actor/run:** human identity survives both human paths. Agent kind, subject, issuer, credential identifier, expiry and scopes survive; so does standard `workload:{type:"agent-run",id:"run-1"}`. These are fixture-verified facts, not body fields.

**Gap 1 — native errors:** the same thrown `ApiError.conflict("Task version changed")` becomes HTTP 409/`CONFLICT`, but both MCP paths emit `isError:true` with `_meta["questpie/error"].code:"internal"`. HTTP recognizes ApiError; MCP classifies unrecognized exceptions as internal [6,7]. Product denial blocks consistently, but HTTP reports 403/`FORBIDDEN` and MCP `access_denied`. Invalid input is HTTP 400/`VALIDATION_ERROR` versus SDK `-32602` text. Raw evidence is retained without normalizing away these differences. Canonical product-error projection remains necessary; no LIVE/query compiler is needed to reproduce it.

**Gap 2 — flat custom context:** the binder asserts `requesterRunId === "run-1"` before returning context. The handler receives it in `~contextExtensions`, while flat `requesterRunId` is missing. `toRequestContext` selects standard fields and preserves the bundle; route execution does not re-flatten it for handler arguments [2,8]. Standard actor/workload works. Flat Autopilot requester-run extensions need a focused fix/proof before migration; no fallback was added here.

## Handoff and verification

An application-level shared schema/executor extraction can proceed independently of live projections. First define the canonical product-error contract and resolve custom-context propagation; retain domain authorization, CAS and receipt ordering. The experiment changes no production code and implements no LIVE queries.

Standalone experiment and focused Oxlint pass. A bounded standalone TypeScript check fails in imported, unmodified framework sources (SDK/Zod schema types and missing generated field/context registrations); it reports no diagnostic in the new prototype. This is incomplete type-contract proof, not a green package check. No full suite/build was run. Patterns came from `packages/mcp/test/{mcp-route-auth,workload-authorization,execution-transports}.test.ts`.

Primary sources at the tested SHA:

1. [HTTP dispatcher](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/questpie/src/server/adapters/http.ts)
2. [JSON route executor](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/questpie/src/server/routes/execute.ts)
3. [MCP server construction](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/mcp/src/server/create-server.ts)
4. [Route-backed MCP invocation](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/mcp/src/server/route-tools.ts)
5. [Schema compatibility/diet](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/mcp/src/server/zod-json-schema.ts)
6. [HTTP error translation](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/questpie/src/server/adapters/utils/response.ts)
7. [MCP error classification](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/mcp/src/server/execution-boundary.ts)
8. [MCP context projection](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/mcp/src/server/runtime.ts)
