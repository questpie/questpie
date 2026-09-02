# Projection-neutral Operation documentation proof

- Status: accepted proof; executable prototype deleted after production parity
- Decision: [ADR-0040](../../../adr/0040-freeze-projection-neutral-operation-documentation.md)
- Candidates: [CANDIDATES.md](./CANDIDATES.md)

The retained proof record isolates the smallest new authoring seam. It
demonstrated fixture-bound closed Operation and Collection Operation Set members, bounded
text including Unicode-scalar edges, example decode/re-encode through the
existing codec kernel, composed closure and artifact compilation,
deterministic relocation-stable artifact bytes, and a domain-separated
documentation digest.

The executable prototype was deleted by `DOC-01` after the production
compiler, generated types, Package parity, artifact lifecycle, and digest
independence tests passed. Current executable coverage is owned by:

```sh
bun test tests/unit/doc01-operation-documentation.test.ts
bun test tests/unit/doc01-operation-documentation-compiler.test.ts
bun node_modules/typescript/bin/tsc -p tests/type/tsconfig.doc01-operation-documentation.json --pretty false
```

`DOC-01` completed production compiler wiring, Package/application parity,
emitted artifact lifecycle, and cross-artifact digest independence. `DOC-02` owns
OpenAPI/MCP/JSDoc/explain projection, target-specific escaping, exposure and
request-time Runtime absence. Further fixture projection and the public
`skills/questpie` router remain separately owned implementation work.
