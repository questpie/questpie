# Projection-neutral Operation documentation proof

- Status: executable candidate; not Accepted authority
- Decision: [ADR-0040](../../../adr/0040-freeze-projection-neutral-operation-documentation.md)
- Candidates: [CANDIDATES.md](./CANDIDATES.md)

The proof isolates the smallest new authoring seam. It demonstrates closed
Operation members, bounded text, example decode/re-encode through the existing
codec kernel, deterministic artifact bytes, and a digest that changes without
changing the semantic Client Contract digest.

Run:

```sh
bun test docs/v4/prototypes/operation-documentation/contract.test.ts
bunx tsc -p docs/v4/prototypes/operation-documentation/tsconfig.json
```

Production compiler wiring, generated projections, fixture migration, and the
public `skills/questpie` router remain implementation work after ratification.
