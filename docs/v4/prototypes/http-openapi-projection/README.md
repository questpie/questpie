# HTTP/OpenAPI projection proof

- Status: executable prototype evidence; not product authority or production
  source
- Owner: focused HTTP/OpenAPI Product proposal

The prototype establishes four bounded facts:

1. the compiler's closed Operation codec descriptor can lower deterministically
   to closed OpenAPI 3.1 schemas without a second authored grammar; and
2. projecting the polymorphic `/_questpie/operation` RPC envelope produces the
   wrong public HTTP story; and
3. compiler-owned kind/name paths, readable codec-driven Query values, typed
   non-empty Context in a disjoint reserved header, and the exact POST
   `{input, context}` shape are deterministic without authored placement or
   schema maps; and
4. one candidate generated client reaches the same candidate adapter through
   those GET/POST bindings with exact identity, timeout, compatibility, Context,
   and Effect carriers. That composed path round-trips every current scalar and
   rejects unsafe integer, PostgreSQL bigint, and numeric precision witnesses;
   maps post-handler Action resource limits without authorizing replay; preserves
   Action ambiguity; and disables Query cache reuse across Principal and Context.

The codec-owned JSON Schema projection is exact where JSON Schema 2020-12 can
express the Runtime set. Where it cannot (for example NFC, negative zero, or
PostgreSQL bigint bounds), the document is an explicitly marked conservative
superset and the shared Runtime codec remains the exact validator. It never
pretends a vendor annotation is a JSON Schema assertion.

The second fact is a negative result. Production implementation must project
every existing `network: true` Operation onto its canonical endpoint; it adds no
second exposure bit and leaves raw external-protocol Routes unchanged. Nothing
under this directory may be imported by shipped compiler or Runtime modules.

Run the evidence with:

```sh
bun test docs/v4/prototypes/http-openapi-projection/projector.test.ts
bun test docs/v4/prototypes/http-openapi-projection/candidate-adapter.test.ts
```
