# Operation Documentation implementation map

- Status: ready for implementation
- Date: 2026-09-02
- Classification: compiler Kernel implementation plus Product projections
- Primary consumer: `fixtures/team-support-desk`
- Hostile consumer: `fixtures/collaboration`
- Accepted candidate: `df237a5938e9cd3d5b9529e899c067bbbca8d780`
- Verified PASS record: `4360a4582b3f17e0791eaeaf3f3e1a38ada232f7`
- Authority projection: `476df65ec60ab02ad9820b43390daf13f4883b23`

## Authority

- `docs/adr/0040-freeze-projection-neutral-operation-documentation.md`
- `docs/adr/0036-freeze-canonical-operation-http-and-openapi-projection.md`
- `docs/adr/0018-freeze-file-search-and-contract-projections.md`
- `docs/adr/0019-freeze-semantic-kernels-and-public-surface.md`
- `SPEC.md`
- `CONTEXT.md`
- `apps/docs/content/docs/v4/operation-http-and-openapi.mdx`

The accepted proof fixes one authoring envelope and one compiler-owned
documentation artifact. Production must integrate that contract into the
current Definition factories, structural evaluator, artifact graph, generated
declarations, Package projection, OpenAPI, explain, and release output. It must
not copy the proof implementation or add a codec decorator, projection-owned
prose, Runtime reader, second digest owner, compatibility alias, or fallback.

## Outcome and ownership

Query, Mutation, Action, and each generated Collection Operation Set member may
carry one optional `describe` value. Generated factory types infer example
input/output from the existing codecs and preserve the real disjoint Query
variants and per-kind member asymmetry. The compiler validates text and
examples before emitting one relocation-stable
`operation-documentation.json`. Its domain-separated digest is independent of
Client Contract, Operation Wire, Schema Projection, and Schema Fingerprint.

Documentation changes compilation and generated projections only. Examples
never execute. Runtime request dispatch, transaction ownership, retry,
cancellation, Policy, disclosure, and Execution Envelope behavior remain
unchanged. Explain may identify the Operation, Origin, diagnostic reason, and
member path; it never prints rejected prose/example values, handler source,
Context, Policy evidence, credentials, SQL, or PostgreSQL detail.

```text
DOC-01 authoring + artifact + Package parity
  -> DOC-02 OpenAPI + JSDoc + explain + public/release closure
       -> HTTP-04 reference/network closure
       -> later MCP projection only after its own accepted authority
```

`DOC-02` is the documentation part of `HTTP-03`; they are one implementation
slice, not sequential OpenAPI generators. HTTP-03 must not first create a
metadata-free projection that DOC-02 then replaces.

## DOC-01 — Compile one exact Operation Documentation artifact

Blocked by: none.

Start red with a Team Support Desk Query, Mutation, Action, and Collection
Operation Set member that author `describe`. Carry the envelope through the
existing application and Package factories, controlled structural evaluation,
normalized Resources, Origin Map, artifact graph, generated declarations, and
atomic output lifecycle. Keep handler-backed and plan-backed Query definitions
disjoint while closing every Definition/member shape at its Origin.

Acceptance:

- generated app and Package definitions infer exact example input/output and
  reject unknown members without widening, `any`, a registry, or recursive
  application inference;
- `QP-COMPOSE-030 invalidDocumentation` covers the accepted closed reasons,
  exact Origin/member path, Unicode-scalar bounds, cursor refusal, codec
  decode/re-encode, canonical byte bound, and value-free diagnostics;
- canonical ASCII-ordered artifact bytes and the documentation digest are
  relocation-stable and change for every semantic documentation change;
- prose-only edits leave Client Contract, Operation Wire, Schema Projection,
  Schema Fingerprint, migration plan, and generated client identity unchanged;
- selection emits and atomically replaces the current artifact, while removed
  selection/documentation deletes stale compiler-owned output;
- application and activated Package Origins use the same primitive,
  diagnostics, bytes, and digest, with installed-only Package content inert;
- no Runtime bundle reader, request-time branch, executable example, codec or
  Field metadata, projection-specific registry, compatibility alias, or
  application-generated skill appears; and
- focused compiler/type/package tests, `check:changed`, architecture, atomic
  generation hostiles, and `git diff --check` pass.

## DOC-02 / HTTP-03 — Project once into OpenAPI, JSDoc, and explain

Blocked by: DOC-01 and HTTP-02.

Start red from one compiled application containing documented network and
server-only Operations, an undocumented Operation, a raw Route, Package
Origins, declared errors, and hostile prose including `*/`, quotes, line feeds,
U+2028, and U+2029. Generate the complete OpenAPI document only once from the
canonical HTTP and documentation artifacts. Generate declarations/JSDoc and
explain from the same bytes and pin the documentation digest beside each
consumer's semantic source digests.

Acceptance:

- OpenAPI projects the accepted summary, description, and schema-valid examples
  without authored paths, methods, schemas, exposure, security, or custom
  groups;
- JSON/OpenAPI and JSDoc escaping keep every accepted text value inert,
  deterministic, parseable, and unable to terminate comments or generated
  source;
- generated JSDoc originates only from the documentation artifact, preserves
  exact Definition typing, and contains no executable or authority-bearing
  annotation;
- explain inclusion/omission exactly matches generation and reports Origins
  without disclosing rejected values, direct-only hidden members, Policy
  evidence, Context, credentials, handlers, SQL, or PostgreSQL detail;
- direct-only prose cannot make an Operation OpenAPI-visible, and an omitted or
  Policy-hidden Operation/value remains undisclosed;
- Runtime and the canonical HTTP adapter do not load or inspect the
  documentation artifact at startup or request time; call retry, cancellation,
  transaction, result, error, and observability semantics remain byte-equivalent
  with and without prose;
- stale OpenAPI/JSDoc/explain output is deleted by the owning atomic generation
  path, and every consumer refuses stale or mismatched documentation digests;
- the public guide and packed examples compile against the generated app and
  Package declarations; MCP and application-specific skill generation remain
  absent pending their separate accepted contracts; and
- Team Support Desk and Collaboration projection hostiles, package isolation,
  docs type/build, `quality:release`, two byte-identical release dry-runs,
  independent Standards/Spec/docs reviews, cleanup, and `git diff --check`
  pass.

## Test-first and deletion rules

Each ticket starts with one failing end-to-end assertion and uses the smallest
changed-scope compiler/type loop. Generated files change only through their
current compiler owner. DOC-02 consumes DOC-01 bytes directly; it does not
reparse source or copy validation. Delete the accepted proof implementation
after production parity. Retain no dual artifact format, old member spelling,
projection-local metadata map, compatibility reader, POST fallback, or test-only
production seam.

## Explicit non-goals

- no codec/Field/error/Route/Job/application-configuration prose;
- no custom OpenAPI/MCP grouping, path, method, schema, security scheme, or
  authority hint;
- no Runtime documentation API, dynamic documentation merge, executable
  example, content filter, or compiler-proven prompt purity claim;
- no generated application skill in beta.2; the public `skills/questpie` tree
  is a separate portable repository deliverable; and
- no OpenTelemetry change, push, tag, publish, or deployment.
