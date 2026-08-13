# ADR 0018: Freeze File, Search, and Contract Projections

- Status: Accepted
- Date: 2026-08-13

## Context

QUESTPIE needs first-party File and Search ergonomics plus OpenAPI, MCP, and
skill outputs without introducing parallel schema, authorization, handler, or
provider systems. PostgreSQL and object storage cannot share one atomic
transaction, Search indexes may lag or contain stale keys, and generated
protocol descriptions can accidentally become alternate application truth.

## Decision

QUESTPIE accepts capability-scoped compiler projections over existing owners.

- File is not a new root Definition or hidden Collection kind. An ordinary
  Collection owns explicit metadata Fields, Constraints, Relations, Policy,
  migration, and row types. A closed structural File projection maps exact
  source Field references to identity, opaque storage key, lifecycle state,
  media type, size, checksum, display name, creator, and timestamp roles.
- The compiler lowers that projection to ordinary reserve, finalize, abort,
  and delete Mutations; bounded upload/download Routes and SDK members; durable
  verification, deletion, and orphan-cleanup Jobs; exact generated types;
  Origins; limits; and Execution Envelope events.
- Upload has explicit `pending`, `ready`, `aborted` or failed, and deleted
  lifecycle states. Reserve commits metadata and stable upload identity;
  transfer is checksummed, cancellable, and idempotent; finalize verifies bytes
  before making metadata ready. Response loss reuses stable identities. Delete
  first makes metadata nondisclosable, then removes bytes idempotently.
- Metadata Policy always authorizes before byte access. Missing metadata,
  denied metadata, and missing bytes are externally nondisclosing. The byte
  capability receives only an opaque key, bounded stream, size/checksum
  conditions, cancellation, and operation identity. It receives no Principal,
  Context, Policy, Collection, transaction, raw database, or System authority.
- One narrow byte-store portability seam is accepted because both filesystem
  and S3-compatible adapters prove `put`, `open`, `head`, and `delete` plus
  bounded streaming, conditions, and closed failure classes. Provider
  configuration, multipart, presigning, CDN, transforms, scanning, and
  lifecycle policy are not part of that seam.
- Search is a compiler Resource over one source Collection. It owns projection
  identity, deterministic context-free document bytes, schema/version, query
  grammar, limits, durable checkpoint, rebuild/cutover, and generated Query
  shape. Transactional Dispatch records exact committed source keys; a shared
  derived-projection worker rereads current rows and idempotently updates or
  removes documents.
- A Search engine returns ranked candidate keys only. One bounded plan rejoins
  current source rows and applies Tenant, Collection Policy, deletion, facets,
  Field output authority, totals, statistics, cursor, and `first + 1` paging
  over the same authorized universe before bounding a page. Runtime post-filter
  and refill, unfiltered counts, and trusted index rows are forbidden.
- PostgreSQL is the first Search engine seam, but this ADR does not add a
  non-B-tree public Index or claim PostgreSQL full-text index support. Any real
  full-text physical Index must receive a focused decision compatible with the
  fixed B-tree-only public Index contract. External Search engines require a
  second concrete implementation and hostile lag, revocation, refill, count,
  facet, cursor, rebuild, failure, and side-channel proof before a provider
  interface exists.
- OpenAPI, MCP, and skill bundles are compiler outputs of canonical App
  Contract members and Origins, never authored Resource kinds or handler
  registries. Unsupported contracts are omitted with an Origin diagnostic.
  MCP invokes the same generated Operation adapter and current Execution/
  Policy engine. A skill carries portable routing documentation and grants no
  Runtime authority.
- Every projection pins source artifact digests and fails on collisions,
  unsupported codecs, stale bytes, or inconsistent exposure. Projection and
  invocation telemetry remains inside the accepted Execution Envelope and
  excludes secrets, raw payloads, Policy evidence, serialized Context, and
  Service state.

Ticket #21 owns final factory and export spelling. It may simplify syntax but
cannot merge these capability views into a universal builder or move their
authority boundaries without a superseding proof.

## Consequences

- File metadata remains ordinary application data and participates in the one
  schema, Policy, migration, client, and Studio model.
- Byte storage is portable without becoming a general provider framework or a
  second authorization surface. Application code never selects a backend as a
  business fact.
- Search lag affects freshness, not authority. Stale, forged, deleted, foreign-
  tenant, or newly denied candidates disclose nothing, including through
  totals, facets, cursors, or statistics.
- OpenAPI, MCP, and skills cannot drift into alternate business execution or
  observability paths.
- Beta.1 may defer public upload, Search, OpenAPI, MCP, and skill breadth, but
  implementation must retain these named compiler and capability seams and
  cannot substitute a generic storage/search/provider SPI.

## Rejected alternatives

- Independent File or Search provider Definitions that own schema, Policy,
  migration, SDK, or Runtime lifecycle.
- A hidden File mini-Collection or one pretend-atomic `upload(file)` operation.
- Hand-written Route/Job registries as the framework integration mechanism.
- Search authorization by JavaScript post-filter/refill or provider totals.
- A generic storage or Search provider matrix before concrete conformance.
- Authored OpenAPI/MCP/skill handlers or separate telemetry pipelines.
