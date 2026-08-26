# Generated client, React, transport, OpenAPI, and MCP benchmark

- Status: research input, not product authority
- Date: 2026-08-26
- Scope: generated client, reactivity, Operation transport, raw Routes,
  OpenAPI, and MCP projections
- Rule: this document compares ownership and DX. It does not freeze a public
  interface.

## Executive finding

QUESTPIE should not choose between its single Operation endpoint and "real HTTP
routing." They solve different jobs.

The exact, versioned Operation Wire is a good canonical first-party transport
for generated Query, Mutation, and Action calls. It centralizes compatibility,
Context transport, limits, declared errors, Mutation call identity, Action
effect identity, and direct/network parity. Raw Routes remain the correct owner
when HTTP itself is the application protocol: webhooks, auth callbacks, files,
streams, provider handlers, cookies, redirects, and custom media types.

The missing seam is a compiler-owned projection from one semantic Operation to
optional HTTP/OpenAPI and MCP views. Those views must call the same generated
Operation adapter and Execution/Policy engine. They must never become parallel
handlers, authorization models, or authored contract registries.

The client-side equivalent is also a projection problem. QUESTPIE already owns
exact operation identity, codecs, watchability, and invalidation evidence. A
framework-neutral generated descriptor/cache lifecycle should be considered
before a React-only API. React can then be a thin adapter, not a second client.

## Current QUESTPIE evidence

The current wire uses one `POST /_questpie/operation` endpoint and a closed
versioned request/result grammar ([Runtime wire](../../../../packages/runtime/src/operation/wire.ts)).
The generated client scopes Context immutably and calls exact Query, Mutation,
and Action members. A compiled watchable Query gains `.watch`; raw Routes stay
outside the generated client
([Runtime/client contract](../../runtime-client-envelope-and-studio.md),
[semantic surface](../../semantic-kernels-and-public-surface.md)).

The Team Support Desk proves both the value and the friction:

- all application data calls use `#questpie/client`;
- React still owns request generations, loading/error state, and post-Mutation
  refresh fan-out;
- reusable result aliases require noisy nested `Awaited<ReturnType<...>>`;
- the browser reaches every Operation through one opaque physical endpoint;
- actual HTTP integrations use raw Routes.

See [DX evidence](../../implementation/team-support-desk/DX-EVIDENCE.md) and the
[reference app map](../../../../fixtures/team-support-desk/README.md).

Accepted ADR-0018 already fixes the authority: OpenAPI, MCP, and skills are
compiler outputs of App Contract members and Origins; MCP invokes the same
Operation adapter and Policy engine
([ADR-0018](../../../adr/0018-freeze-file-search-and-contract-projections.md)).
This benchmark explores the projection shape without changing that decision.

## Best-in-class lessons

### Convex: generated references plus live results

Convex generates an `api` object whose function references drive both
imperative calls and React hooks. `useQuery` manages subscription lifetime and
rerenders when the result changes; the same client supports one-off queries.
Convex also documents a consistency guarantee across reactive query results.
Its mutation hook returns a stable callable and supports optimistic updates.
([React overview](https://docs.convex.dev/client/react/overview),
[React API](https://docs.convex.dev/api/modules/react))

Borrow:

- one generated operation reference should be useful to imperative callers,
  watchers, cache adapters, tests, and type helpers;
- React subscription lifetime should be automatic;
- loading/error/data should be an explicit state model, not `undefined` plus
  convention;
- conditional subscription needs a typed disabled state.

Reject:

- do not claim that every Query is always live; QUESTPIE watchability remains
  compiler-earned;
- do not hide Context re-resolution, Policy reauthorization, reset, deployment
  incompatibility, or PostgreSQL recovery behind a generic "always current"
  promise;
- do not make React the owner of operation identity.

### TanStack Query: a deep framework-neutral cache core

TanStack Query keys uniquely identify cached results, include all changing
inputs, and are deterministically hashed. Invalidation marks matching entries
stale and refetches active observers. Query functions receive an `AbortSignal`,
and the cache can be observed independently of React. Extracted typed query
options preserve reuse across hooks and prefetching.
([query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys),
[invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation),
[query functions](https://tanstack.com/query/latest/docs/framework/react/guides/query-functions),
[query cache](https://tanstack.com/query/latest/docs/reference/QueryCache))

Borrow:

- keep cache/subscription ownership framework-neutral;
- make cancellation a first-class call input;
- let one generated descriptor produce a key, imperative fetch, watch, and
  adapter options;
- expose precise invalidation facts that adapters can consume.

Reject:

- do not ask applications to invent string/array query keys when the compiler
  already knows operation identity, normalized input, Context partition, and
  deployment contract;
- do not reduce Change Ledger facts to manual `invalidateQueries` calls;
- do not normalize arbitrary entities client-side when an authorized Query
  result is the disclosure unit.

### tRPC: inferred procedure tree with a separate cache owner

tRPC derives a typed client and hooks from one router type, while its React
integration deliberately reuses TanStack Query's `QueryClient`. The setup shows
that transport and cache are separable, but also exposes two providers and two
client objects. ([React Query setup](https://trpc.io/docs/client/react/setup))

Borrow:

- preserve discoverable nested operation members and end-to-end inference;
- treat the reactive cache as an adapter over the core client.

Reject:

- avoid making applications wire two overlapping client lifecycles for the
  ordinary path;
- avoid importing the server's full router type as the browser contract;
  QUESTPIE's generated browser-safe artifact is the boundary.

### ts-rest, Hono, Elysia, and Fastify: HTTP is valuable when it is explicit

ts-rest makes method, path, path/query/header/body codecs, status-specific
responses, and summaries one shared HTTP contract; it can derive OpenAPI from
that contract. Hono infers a Fetch-compatible client from authored routes and
status-specific JSON responses. Elysia's Eden exposes an object-like typed
client from a real route tree. Fastify compiles request and response JSON
Schemas, and emphasizes response schemas as both performance and accidental
disclosure protection.
([ts-rest contract](https://ts-rest.com/contract/overview),
[Hono RPC](https://hono.dev/docs/guides/rpc),
[Elysia Eden](https://elysiajs.com/eden/overview),
[Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/))

Borrow:

- an HTTP projection needs explicit method/path, parameter locations,
  serialization, media types, status responses, headers, docs, and security;
- response projection must use the exact declared output/error codecs and
  fail closed rather than serialize arbitrary handler values;
- collision and path-parameter diagnostics belong at compile time.

Reject:

- do not author a second HTTP contract beside an Operation contract;
- do not infer public OpenAPI merely from TypeScript handler return types;
- do not expose raw `Response` semantics through generated semantic Operations;
- do not force webhooks, auth handlers, streams, or files through the Operation
  envelope. They remain Routes.

### Connect and gRPC transcoding: canonical RPC plus HTTP views can coexist

Connect maps unary RPCs to predictable procedure paths and JSON/protobuf bodies.
It permits deterministic GET encoding for side-effect-free RPCs so browsers,
proxies, and CDNs can cache them. Google gRPC transcoding keeps the RPC method
as semantic authority while annotations map it to resource-oriented HTTP/JSON;
Google explicitly says the default method-like POST is functional but explicit
HTTP mappings are preferable for HTTP interface design.
([Connect protocol](https://connectrpc.com/docs/protocol/),
[gRPC HTTP/JSON transcoding](https://cloud.google.com/endpoints/docs/grpc/transcoding))

Borrow:

- retain a canonical RPC transport while allowing a separately validated HTTP
  projection;
- permit GET only for compiler-proven safe reads and only with deterministic,
  bounded encoding;
- use semantic Operation identity as stable projection identity.

Reject:

- do not automatically derive REST resources from dotted operation names;
- do not assume every input codec maps cleanly to path/query strings;
- do not let HTTP status mapping erase QUESTPIE's closed framework-failure,
  declared-error, rejection, ambiguity, or post-commit outcomes.

### GraphQL: a single endpoint is not inherently bad

GraphQL deliberately uses one endpoint because its semantic model is an entity
graph rather than URL-addressed resources. POST carries queries and mutations;
GET is limited to queries and can enable caching, with URL-length constraints.
Its HTTP guidance also illustrates how protocol-native error bodies complicate
intermediary use of status codes.
([GraphQL over HTTP guidance](https://graphql.org/learn/serving-over-http/),
[draft specification](https://graphql.github.io/graphql-over-http/draft/))

Borrow:

- judge the endpoint by the semantic client job, not by REST aesthetics;
- keep safe GET/cache projection optional and bounded.

Reject:

- do not make one polymorphic OpenAPI operation the external integration story;
- do not hide Operation identity from gateways, logs, rate limits, SDK
  generators, or per-operation documentation.

### OpenAPI 3.1: each projected operation is a full HTTP contract

OpenAPI Paths describe concrete and templated endpoints; concrete paths take
precedence, identical template hierarchies are invalid, and other overlaps can
be ambiguous. Each operation may have a unique `operationId`, parameters in
path/query/header/cookie, request bodies, responses, and operation-specific
security. OpenAPI also distinguishes incoming webhooks from API operations.
([OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html))

Implications:

- an OpenAPI projection cannot honestly describe only
  `POST /_questpie/operation` with a giant `oneOf` and call the job complete;
- projection must fail on path/method collision, unsupported codec placement,
  unrepresentable error/status mapping, or ambiguous security;
- `operationId` should derive deterministically from Resource identity, while
  preserving exact identity in a vendor extension if needed;
- OpenAPI security describes credential transport, not QUESTPIE Policy. It
  cannot claim authorization scopes that the compiler cannot prove;
- raw Routes may project naturally when they declare enough HTTP schema;
  unsupported raw `Request`/`Response` behavior must be omitted diagnostically.

### MCP: tools need a model-facing contract, not an HTTP alias

MCP tools have unique names, descriptions, JSON Schema input, optional output
schema, annotations, structured content, and two distinct error layers:
protocol errors and tool-execution errors. The specification requires input
validation, access control, rate limiting, output sanitization, and recommends
human confirmation for sensitive calls. Streamable HTTP itself uses one MCP
endpoint, which reinforces that MCP transport paths are not application REST
paths. ([tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
[transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports))

Implications:

- MCP selection must be explicit; network exposure alone is insufficient;
- compiler-derived descriptions and JSON Schemas must be complete enough for a
  model to choose and call a tool safely;
- Query/Mutation/Action outcomes need deliberate mapping into structured
  content, tool-execution errors, and protocol errors;
- destructive/effectful annotations are untrusted hints, not Policy authority;
- Principal, Context, confirmation, rate limits, timeout, redaction, and audit
  remain Runtime/host responsibilities around the same Operation executor.

## Borrow/reject synthesis

### Borrow

1. One semantic Operation identity with several capability-scoped projections.
2. A small generated operation descriptor useful across imperative calls,
   watch, cache adapters, named input/output/error types, OpenAPI, and MCP.
3. A framework-neutral query/watch lifecycle with a thin React adapter.
4. Compiler-derived cache identity and invalidation facts, not handwritten keys.
5. Optional real HTTP projection with explicit method/path/placement/status.
6. Deterministic projection diagnostics and provenance.
7. MCP-specific descriptions, safety metadata, schemas, and outcome mapping.
8. One executor, Policy path, limits owner, cancellation model, and telemetry
   path for direct, Wire, HTTP, MCP, and future Studio calls.

### Reject

1. A second handler or Policy registry for OpenAPI or MCP.
2. Automatic REST paths inferred only from Resource names.
3. A universal transport builder containing combinations invalid for Routes,
   Queries, Mutations, Actions, and streams.
4. React hooks as the canonical client interface.
5. User-authored cache keys or invalidation lists where compiler facts exist.
6. Pretending a giant `oneOf` RPC endpoint is high-quality OpenAPI.
7. Projecting every network Operation to HTTP or MCP by default.
8. Mapping Policy to OAuth scopes or MCP annotations without proof.
9. Automatic retries that weaken Mutation or Action ambiguity semantics.

## Candidate ownership model, not syntax

```text
canonical App Contract + Origins
               |
       semantic Operation adapter
               |
   +-----------+-----------+-----------+-----------+
   |                       |                       |
direct/server        Operation Wire          selected views
generated calls      generated client        HTTP/OpenAPI, MCP
   |                       |                       |
   +-----------------------+-----------------------+
                           |
             one Execution + Context + Policy
             + limits + error/outcome semantics
```

Raw Routes sit beside semantic Operations, not underneath them. A Route can
enter `ctx.execution` and call generated Operations after it verifies its own
HTTP protocol. A projected HTTP Operation performs transport decoding and then
calls the same Operation adapter. Neither path owns business logic twice.

## Approval questions

These questions require an approval packet before any public interface is
implemented:

1. Is HTTP projection explicit opt-in per Operation, selected centrally by
   configuration, or both with one conflict rule?
2. Must every HTTP mapping be authored, or may the compiler offer a deliberately
   plain method-like default that is never marketed as REST?
3. Which Query codecs are safe and deterministic in GET path/query parameters,
   and when must projection use POST?
4. Can one Operation have multiple HTTP bindings? If yes, which binding owns
   canonical OpenAPI identity, deprecation, and collision diagnostics?
5. What is the exact mapping from declared errors and framework outcomes to
   status, headers, body, and retry metadata without losing replay/ambiguity
   semantics?
6. How are credential mechanisms described without pretending they represent
   Collection Policy or tenant authorization?
7. Which raw Routes are projectable, and what declaration is required before a
   raw `Request`/`Response` handler can safely enter OpenAPI?
8. Is MCP exposure a separate explicit allowlist from ordinary network
   exposure? Which Operation kinds are eligible by default, if any?
9. What model-facing description/examples/destructive hints are authored, and
   what can be derived without inventing semantics?
10. How do MCP clients supply Principal and Context, and where are user
    confirmation, rate limits, timeout, redaction, and audit enforced?
11. What is the smallest framework-neutral client descriptor that can support
    imperative calls, watch, named types, cache identity, SSR, cancellation,
    and React without freezing a React-specific kernel?
12. Does Mutation invalidation come from exact compiler/Change Ledger facts,
    conservative operation-level dependencies, live watches, or a layered
    combination?
13. What consistency guarantee can multiple React observers receive during a
    Live Query reset or deployment transition?
14. Which projection artifacts participate in compatibility digests, and can a
    deployment change HTTP/MCP presentation without changing Operation Wire?

## Recommended next research proof

Before selecting syntax, use two materially different Operations and two raw
Routes:

- a watchable paged Query with Context and declared errors;
- a Mutation with idempotency, replay, and post-commit ambiguity;
- a signed webhook Route;
- a streaming/file/auth Route that is intentionally not representable as the
  same JSON Operation shape.

Project the same pair into generated Wire, one candidate real-HTTP/OpenAPI
contract, MCP tools, and direct server calls. The proof should measure
handwritten declarations, generated surface, diagnostic quality, type
discoverability, Policy parity, error fidelity, cache behavior, and whether any
projection can execute without the canonical Operation adapter. Any candidate
that needs a second handler, Policy rule, input schema, or error catalogue is
the wrong seam.
