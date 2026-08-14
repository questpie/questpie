# P16 implementation collapse proof

`QUEUE.json` is the exact dependency-ordered beta.1 implementation queue.
`check.ts` rejects incomplete issue contracts, dependency cycles, invalid
agent-ready labels, missing fixture coverage, missing performance ownership,
and forbidden beta scope. `render-issue.ts` renders the accepted GitHub body.

```sh
bun run docs/v4/prototypes/implementation-collapse-p16/check.ts
bun run docs/v4/prototypes/implementation-collapse-p16/negative-control.ts
bun run docs/v4/prototypes/implementation-collapse-p16/render-issue.ts BETA-01
bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/implementation-collapse-p16/tsconfig.json
bunx oxfmt --check docs/v4/prototypes/implementation-collapse-p16
bunx oxlint --deny-warnings docs/v4/prototypes/implementation-collapse-p16/*.ts
git diff --check
```
