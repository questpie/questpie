# P14 conformance map proof

This paper proof turns every accepted contract into an implementation-owned
conformance cell without implementing production QUESTPIE code. It is complete
only when every required row in `MATRIX.md` has an owner, fixture, execution
surface, hostile case, schedule, and artifact. `check.ts` rejects omissions,
forbidden optional-authority claims, and a single-domain matrix.

Run:

```sh
bun run docs/v4/prototypes/conformance-p14/check.ts
bun run docs/v4/prototypes/conformance-p14/negative-control.ts
bunx oxfmt --check docs/v4/prototypes/conformance-p14
git diff --check
```
