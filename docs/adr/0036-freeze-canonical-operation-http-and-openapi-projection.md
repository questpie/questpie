# ADR-0036: Freeze canonical Operation HTTP and OpenAPI projection

- Status: Accepted
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

## Decision

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
wire grammar, diagnostics, disclosure, retry, cancellation, and collision
semantics are owned by
[`CANONICAL-HTTP-CONTRACT.md`](../v4/implementation/beta2-execution-breadth/CANONICAL-HTTP-CONTRACT.md).
The compiler-owned documentation projection and explain semantics are owned by
[`HTTP-OPENAPI-PROPOSAL.md`](../v4/implementation/beta2-execution-breadth/HTTP-OPENAPI-PROPOSAL.md).

This decision adds no OpenAPI-specific descriptive authoring surface. ADR-0040
now owns the separate projection-neutral summary, description, example,
artifact, and digest contract. Custom groups remain absent.

## Supersession ledger

The sole detailed supersession boundary is the linked Kernel contract's
“Sole supersession and ratification boundary.” This ADR accepts exactly that
boundary and no other. ADR-0015 raw Route behavior remains unchanged; OpenAPI
remains the separate linked Product projection.

## Acceptance

The exact candidate at
`33ff02a07fd28a0dd6ef4b4fbbbaf9a41c484a09` received a protocol-v2 `PASS`.
The generated review record is committed at `4cfe81dda` and verifies without
model credentials. The retained first review remains the immutable `BLOCKED`
record for the repaired metadata-ownership and credential-outcome findings.

Production wiring and deletion begin only after this authority projection.
