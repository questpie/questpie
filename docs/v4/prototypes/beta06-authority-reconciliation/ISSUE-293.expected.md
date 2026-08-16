## Parent

#261

## Exact authority

- ADR-0010
- ADR-0011
- ADR-0013
- ADR-0016
- ADR-0021

Fixed proof heads are recorded in `docs/v4/prototypes/implementation-collapse-p16/QUEUE.json`.

## What to build

message.publish normalizes pure input, assigns server values, rechecks mutable Membership, and writes Message/audit/pending Reaction intent/result receipt in one transaction.

Start with this red test: Duplicate delivery or lost response applies message.publish twice or emits intent outside the business transaction.

## Required artifacts

- Mutation/value/transaction programs
- call/result receipts
- pending Reaction intent
- generated Mutation client declarations

## Acceptance criteria

- [ ] Mutation/value/transaction programs exists and matches the accepted contract.
- [ ] call/result receipts exists and matches the accepted contract.
- [ ] pending Reaction intent exists and matches the accepted contract.
- [ ] generated Mutation client declarations exists and matches the accepted contract.
- [ ] The named hostile cases pass without weakening nondisclosure, authority, transaction, retry, cancellation, or durable ownership.
- [ ] The slice remains independently demoable through its stated fixture.

## Hostile cases

- forbidden sparse Field
- candidate Policy failure
- lock waiter role revocation
- constraint conflict
- pre-commit cancellation
- post-commit ambiguity
- same key different digest
- unsafe Service in retryable transaction

## Budgets

- changed loop <= 5 s
- Mutation type/declaration baseline recorded
- bounded transaction and payload limits explicit

## Performance ownership

Owner: `BETA-06`

- Mutation transaction microbenchmark manifest
- selected-PR stable Mutation measurement and stable-runner budget

## Non-goals

- generic lifecycle hooks
- automatic transaction retry around effects
- Change Ledger capture and compiler-owned triggers
- Action
- generic Job

## Blocked by

- #292

## Verification

`bun run check:changed -- --test tests/integration/beta06-publish-mutation.test.ts --typecheck @questpie/runtime`
`bun run test:postgres -- --scenario beta06`
`bun run bench:micro -- --scenario beta06`
`bun run quality:full`
`git diff --check`
