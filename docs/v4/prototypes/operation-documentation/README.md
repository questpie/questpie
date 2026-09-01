# Projection-neutral Operation documentation proof

- Status: executable candidate; not Accepted authority
- Decision: [ADR-0040](../../../adr/0040-freeze-projection-neutral-operation-documentation.md)
- Candidates: [CANDIDATES.md](./CANDIDATES.md)

The proof isolates the smallest new authoring seam. It demonstrates closed
Operation members, bounded text, example decode/re-encode through the existing
codec kernel, deterministic relocation-stable artifact bytes, and a
domain-separated documentation digest. Binding the production generated factory
types and keeping this artifact out of the real Client Contract digest remain
explicit implementation gates after ratification.

Run:

```sh
bun test docs/v4/prototypes/operation-documentation/contract.test.ts
bunx tsc -p docs/v4/prototypes/operation-documentation/tsconfig.json
```

Production compiler wiring, generated projections, fixture migration, and the
public `skills/questpie` router remain implementation work after ratification.
