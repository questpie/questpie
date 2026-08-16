# P16 implementation collapse proof

`QUEUE.json` is the exact dependency-ordered beta.1 implementation queue. Its
`acceptedIssues` map pins completed tracers to their merge heads; `agentReady`
is derived from that evidence and every declared dependency, with exactly one
next tracer ready. `check.ts` rejects incomplete issue contracts, dependency
cycles, invalid completion or readiness evidence, missing fixture coverage,
missing performance ownership, and forbidden beta scope. `render-issue.ts`
renders the accepted GitHub body.

The BETA-06/BETA-07 boundary is mechanically fixed. BETA-06 owns the
transaction-bound pending Reaction intent accepted by P3/P5, but it does not
own a committed Change Ledger fact. ADR-0012 assigns that capture to
compiler-owned PostgreSQL triggers, and BETA-07 owns those triggers together
with the reactive-Collection capture proof. The queue checker and four hostile
mutations prevent either slice from absorbing or losing the boundary.

```sh
bun run docs/v4/prototypes/implementation-collapse-p16/check.ts
bun run docs/v4/prototypes/implementation-collapse-p16/negative-control.ts
for id in BETA-{01..12}; do bun run docs/v4/prototypes/implementation-collapse-p16/render-issue.ts "$id" > "/tmp/$id.md"; done
bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/implementation-collapse-p16/tsconfig.json
bunx oxfmt --check docs/v4/prototypes/implementation-collapse-p16
bunx oxlint --deny-warnings docs/v4/prototypes/implementation-collapse-p16/*.ts
git diff --check
```
