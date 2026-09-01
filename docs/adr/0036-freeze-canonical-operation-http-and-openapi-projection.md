# ADR-0036: Freeze canonical Operation HTTP and OpenAPI projection

- Status: Proposed
- Date: 2026-09-01
- Owners: Product architecture, compiler, Runtime
- Scope: narrow Operation Wire supersession and compiler-owned OpenAPI Product
  projection

## Context

The Accepted Operation Wire uses one polymorphic `POST /_questpie/operation`
endpoint. It preserves semantic parity, but hides Operation identity in browser
tools and makes an honest ordinary HTTP/OpenAPI projection impossible without
restating codec-owned facts. Network exposure, canonical codecs, typed Context,
Policy, execution, result/error envelopes, and generated clients already exist.
The missing decision is only their deterministic transport projection.

## Proposed decision

Every `network: true` Query, Mutation, and Action has exactly one endpoint:

- Query: `GET /_questpie/query/<qualified-name>`;
- Mutation: `POST /_questpie/mutation/<qualified-name>`;
- Action: `POST /_questpie/action/<qualified-name>`.

There is no `http` authoring member and no custom Operation method or path.
Generated clients use these endpoints; the polymorphic endpoint is deleted with
no fallback. Query input is codec-derived URL data and GET has no body. Query
Context uses the reserved `Questpie-Context` header as unpadded base64url of its
canonical JSON wire value. Mutation and Action use the exact codec-derived body
`{input, context}`. Credential resolution remains the separate source of
Principal. Mutation Idempotency-Key and Action Effect-Key preserve their
Accepted identities.

OpenAPI is selected only by exact `questpie.json` member
`{ "projections": { "openapi": true } }`. The compiler emits one path per
network Operation from the same App Contract and codec metadata used by types,
clients, declarations, and future MCP. Authors never restate parameters,
schemas, nullability, validation, results, or errors. Raw Routes retain explicit
external-protocol method/path behavior and are omitted with Origins. The exact
grammar, diagnostics, disclosure, retry, cancellation, collision, and explain
semantics are normative in
`docs/v4/implementation/beta2-execution-breadth/HTTP-OPENAPI-PROPOSAL.md`.

## Supersession ledger

This proposal supersedes only the fixed-path/polymorphic portions of ADR-0011's
Operation Wire and generated-client transport. It preserves Operation identity,
exposure, codecs, Context, Principal, Policy, Execution, Call and Effect
Identity, envelopes, limits, transactions, receipts, errors, cancellation,
nondisclosure, observability, and direct/network semantic parity. ADR-0015 raw
Route behavior is unchanged. OpenAPI remains a Product projection.

## Acceptance staging

This ADR remains Proposed and is not authority until a committed protocol-v2
PASS record exists. No ADR index, SPEC, CONTEXT, public documentation, or
HANDOFF projection may call it Accepted before that record. Production wiring
and deletion begin only after authority projection.
