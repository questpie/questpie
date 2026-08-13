# Files, Search, and contract projections

ADR-0018 closes atlas ticket #20. It preserves first-party File and Search jobs
without creating another data, Policy, provider, or handler framework.

## File is a projection over ordinary metadata

An application owns one ordinary Collection for File metadata. Its explicit
Fields and Policy remain the authority for identity, relations, disclosure,
migration, and generated row types. A closed structural File projection assigns
exact source Field references to byte-lifecycle roles and lowers to ordinary
Mutations, Routes/SDK members, and durable cleanup Jobs.

PostgreSQL and object storage do not pretend to commit atomically:

```text
reserve pending metadata + stable upload identity
  -> transfer bounded checksummed bytes
  -> verify and finalize ready metadata
  -> serve only after current metadata Policy

cancel/failure -> abort -> durable idempotent orphan cleanup
delete -> durable nondisclosure intent -> idempotent byte removal
```

Metadata Policy runs before byte access. The byte capability sees only an
opaque key, stream, size/checksum conditions, cancellation, and operation
identity. It cannot read Principal, Context, Policy, Collections, a transaction,
raw PostgreSQL, or System Authority.

Filesystem and S3-compatible implementations prove one narrow capability:
`put`, `open`, `head`, `delete`, bounded streams, conditional/idempotent keys,
and closed not-found, unavailable, ambiguous-write, and integrity failures.
Multipart, presigned URLs, CDN, transforms, scanning, and provider lifecycle
configuration remain later verticals rather than optional methods on a generic
provider object.

## Search is a derived compiler Resource

Search owns deterministic document projection, query grammar, limits,
checkpoint, rebuild, and generated Query shape. A source Mutation commits an
exact changed key through Transactional Dispatch. The derived-projection worker
rereads current committed rows and idempotently updates or removes documents.
The document projection has no Principal, Context, Service, clock, or external
effect.

The index returns ranked candidate keys, never trusted application rows. One
bounded source Query constructs the authorized universe before page bounding:

```text
ranked candidates
  intersect current source rows
  intersect Tenant and current Collection Policy
  intersect deletion and requested facets
  apply current Field output authority
  -> total, facets, statistics, cursor, first + 1 page
```

A forged, stale, deleted, cross-tenant, or revoked key discloses nothing.
Runtime post-filter/refill and provider counts are forbidden. PostgreSQL is the
first engine seam, but the accepted public Index remains B-tree-only. A real
PostgreSQL full-text physical index and every external Search engine require a
separate focused contract rather than silently broadening Index or creating a
provider matrix.

## OpenAPI, MCP, and skills are projections

OpenAPI projects explicitly network-exposed Operations and eligible Routes
from exact runtime codecs, errors, security ingress, limits, identity, and wire
version. Unsupported raw protocol contracts are omitted with an Origin
diagnostic.

MCP projects an explicitly selected App Contract subset. Invocation uses the
same generated Operation adapter, fresh Execution, Context, Policy, limits,
errors, and Execution Envelope as every other caller. It owns no business
handler or authorization.

A generated skill bundle contains concise routing metadata, public docs,
selected generated tool names, examples, and provenance. It is portable and
grants no Runtime authority. All projection artifacts pin their source digests,
reject collisions or stale/unsupported inputs, and emit no secrets, raw
payloads, Policy evidence, serialized Context, Service state, or database URL.

## Proof and retained edges

The initial reviewed head `fb06a82c195ad3eeb3f1feddc4a9261e278033fd`
received a valid fresh stateless Opus-medium `BLOCKED` verdict. Repair head
`eaa21e0ca2c4a3b941a04e98b1a0278d0fe0aba9` moved byte effects out of
Mutation context, proved authorization before bounded cursor paging, and
executed File recovery/cancellation/cleanup through both adapters. Its
replacement fresh stateless Opus-medium review returned `PASS`; acceptance
evidence is `6e056bc44c15740b2797a9489fe3823c3100bdad`.

Implementation must additionally prove correct mixed-direction cursor
lowering, role-specific File Field pinning, Search Field-output disclosure,
codec-exact denied results, PostgreSQL checkpoint contention/removal, and Route
byte-capability lifetime/disposal. These edges refine realization and do not
change the accepted owners.
