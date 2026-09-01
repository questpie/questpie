# OpenAPI Operation projection

- Status: Proposed Product projection; not Accepted authority
- Owner: compiler Product projection and public documentation
- Scope: optional OpenAPI emission from canonical network Operations
- Kernel dependency:
  [CANONICAL-HTTP-CONTRACT.md](./CANONICAL-HTTP-CONTRACT.md)
- Excluded: custom paths or methods, authored request/response schemas, raw-Route
  OpenAPI, security schemes, MCP, skills, new descriptive-metadata authoring,
  multiple bindings, a second handler or Policy model, and production
  implementation

This document adds no wire or supersession. The linked Kernel contract solely
owns canonical HTTP execution, carriers, cancellation, disclosure, raw-Route
collisions, diagnostics, and the narrow ADR-0011 supersession boundary.

## Reconciled authority

ADR-0011 owns Operation identity, codecs, Policy, limits, Call Identity, errors,
cancellation, nondisclosure, transaction outcomes, and direct/network parity.
ADR-0015 owns raw Routes and the one Fetch router. ADR-0018 makes OpenAPI a
compiler projection of canonical App Contract members and Origins, never a new
handler or schema registry. ADR-0019 makes `questpie.json.projections` the
artifact selector. ADR-0023 fixes the post-commit Mutation outcome and HTTP 500.

Deep-DX packet sections 4.11 and 15 are directionally approved research, not
authority. This candidate replaces their custom-path sketch with the later
human direction: codec and Resource Identity are sufficient for ordinary HTTP.

The polymorphic `POST /_questpie/operation` transport is deleted by the linked
Kernel contract. There is no compatibility route or fallback. OpenAPI describes
the same distinct endpoint per network Operation and never creates exposure.

## Two KISS candidates

### Candidate A — project existing network exposure (recommended)

```ts
export const ticketDetail = defineQuery({
	name: "tickets.detail",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	// output, errors, Policy, limits, metadata, and handler remain canonical
});
```

Existing `network: true` is the sole exposure decision. The compiler projects
the endpoint, generated-client method, schemas, and documentation from Resource
kind, name, and codecs. There is no HTTP/OpenAPI-specific authoring member.

### Candidate B — add `http: true`

This duplicates the network exposure fact and lets surfaces drift. It is
rejected. A server-only Operation stays direct; a network Operation always has
the linked canonical endpoint.

## Descriptive metadata is deferred

This candidate adds no `summary`, `description`, `examples`, group, or other
descriptive authoring member. OpenAPI V1 uses only already-canonical Resource
identity and codec facts and invents no prose. A projection-neutral metadata
owner shared by declarations, public docs, OpenAPI, and MCP requires its own
focused decision and executable artifact/digest proof; no projection-specific
description registry may precede it.

## Selector, artifact, and exact fields

```json
{ "projections": { "openapi": true } }
```

Missing selection emits nothing. Exact true emits compiler-owned `openapi.json`;
false, object, string, array, null, unknown projection names, paths, URLs, and
environment placeholders fail application-v1. Absence is the only disabled
spelling. Selection emits documentation only and never exposes an Operation.

OpenAPI has exactly top-level `openapi: "3.1.0"`, `info`, `paths`, and
`components.schemas`; no servers, security, top-level tags, or inferred prose.
`info.title` is application identity; `info.version` is Client Contract digest.
Each network Operation produces one canonical path with inferred method, exact
Resource Identity `operationId`, derived Query parameters or JSON body, and
compiler-derived success/declared/framework/post-commit schemas. Shared statuses
use ASCII-sorted `oneOf`. Content key is `application/json`. Paths, parameters,
statuses, schemas, properties, omissions, and Origins sort before canonical
bytes.

The schema is exact where JSON Schema 2020-12 can express the Runtime value set.
Where it cannot express a constraint—currently NFC and lone-surrogate rules,
negative-zero rejection, PostgreSQL bigint bounds, or canonical calendar/time
semantics—the emitted standard schema is a conservative superset and carries
`x-questpie-runtime-validation: { exact: false, requirements: [...] }`. This is
an honest marker, not a validator keyword. The canonical Runtime codec remains
the exact request/response validator; authors cannot restate or weaken it.

`operationId` is the full Qualified Resource Name without kind prefix. Because
Accepted Resource Identity permits equal names across kinds, selecting OpenAPI
with two included Operations of different kinds but the same name fails linked
diagnostic `QP-COMPOSE-029 openApiOperationIdCollision` with both Origins; the
compiler never suffixes or chooses one. `tags` contains exactly one inferred
group: the first namespace segment for qualified names, or configured
application name for an unqualified name. No OpenAPI/MCP-specific group metadata
is authored. A future projection-neutral `group` requires evidence and focused
ratification; MCP must consume the same metadata owner.

Raw Routes are omitted with their Origin and exact reason
`rawRouteUnsupported`; security and `components.securitySchemes` are absent.
Artifact names, digest domains, checksum/Runtime Build membership, and exact
explain bytes are deferred to the production tracer. These are repository
mechanics, not public protocol. The V1 selector/output contract is exactly
`projections.openapi: true` and compiler-owned `openapi.json`; absence deletes a
previous compiler-owned file on the next successful atomic generation.

## Explain parity

Explain reports the same selected/included/omitted identities and Origins as
generation, writes nothing, and discloses no credentials, Context, Policy
evidence, handler source, values, or database detail. Its exact CLI record shape
is deferred to the production tracer rather than frozen without evidence.

## Proof and hostile acceptance matrix

The isolated prototype retains the negative proof that the giant RPC envelope
is the wrong OpenAPI story. Its positive extension composes one generated
`withContext` client with one canonical adapter and the shared Runtime codec.
It proves per-Operation paths; required/order/duplicate/percent and every-current-
scalar GET encoding; exact empty/non-empty Context behavior; disjoint Query,
Mutation, and Action option types; deadline/cancellation/credential precedence;
post-handler Action `RESOURCE_LIMIT`; Action response ambiguity; exact/
parameter/wildcard raw Route collisions and omission Origins; partial
compatibility-header refusal; and Query `private, no-store` across Principal and
Context. No helper-only model is transport evidence.

Implementation starts with these hostiles plus exact envelopes, nondisclosure,
selector/stale-output behavior, explain equality, and deletion of polymorphic
RPC, raw Route OpenAPI, security, MCP/skills, custom paths, duplicate schemas,
handlers, or registries.

## Product ratification boundary

This Product projection supersedes nothing independently and depends on the
single supersession boundary in
[CANONICAL-HTTP-CONTRACT.md](./CANONICAL-HTTP-CONTRACT.md). Ratify the combined
candidate through ADR-0027 focused formal acceptance. ADR-0036, SPEC, CONTEXT,
ADR index, public docs, and HANDOFF remain Proposed until a committed protocol-v2
PASS record. This candidate adds no production compiler, Runtime, config,
golden, compatibility handler, fallback, or parallel wire.
