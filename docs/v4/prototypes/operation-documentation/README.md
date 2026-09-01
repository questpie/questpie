# Projection-neutral Operation documentation proof

- Status: executable candidate; not Accepted authority
- Decision: [ADR-0040](../../../adr/0040-freeze-projection-neutral-operation-documentation.md)
- Candidates: [CANDIDATES.md](./CANDIDATES.md)

The proof isolates the smallest new authoring seam. It demonstrates
fixture-bound closed Operation and Collection Operation Set members, bounded
text including Unicode-scalar edges, example decode/re-encode through the
existing codec kernel, composed closure and artifact compilation,
deterministic relocation-stable artifact bytes, and a domain-separated
documentation digest.

Run:

```sh
bun test docs/v4/prototypes/operation-documentation/contract.test.ts
bunx tsc -p docs/v4/prototypes/operation-documentation/tsconfig.json
```

`DOC-01` owns production compiler wiring, Package/application parity, emitted
artifact lifecycle and cross-artifact digest independence. `DOC-02` owns
OpenAPI/MCP/JSDoc/explain projection, target-specific escaping, exposure and
request-time Runtime absence. Fixture migration and the public
`skills/questpie` router remain implementation work after ratification.
