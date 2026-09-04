# Data, Policy, and lifecycle

Read [Context and Policy](https://questpie.com/docs/v4/context-and-policy) and
[Queries and Mutations](https://questpie.com/docs/v4/queries-and-mutations)
before changing authorization or write behavior.

## Keep authority in Policy

Resolve one immutable Context for each root Execution. Use Collection-bound
Policy for row visibility, Field authority, create/update/delete authority,
and candidate checks. Policy applies equally to direct, generated-client,
HTTP, MCP, nested, worker, and recompute paths.

Treat nondisclosure as part of the contract: an unauthorized or hidden row
must not reveal whether it exists, which Policy failed, or any PostgreSQL
detail. Keep routing hints and session claims non-authoritative when current
database evidence decides access.

## Use the fixed write lifecycle

A Collection has exactly four authored phases:

1. `normalize` transforms caller values with capability-free ordinary
   TypeScript accepted by compiler analysis.
2. `validate` returns Collection-owned validation issues for the complete
   candidate without reads.
3. `check` performs bounded Policy-aware reads in the Mutation transaction.
4. `afterWrite` performs bounded kernel reads/writes or accepts a Job in the
   same transaction.

Keep caller `patch` and trusted server `values` disjoint. Trusted values bypass
only caller Field authority; complete candidate validation and candidate
Policy still apply. Use `ctx.now` for the operation timestamp and database-owned
`onUpdate: "now"` when PostgreSQL owns update time.

Named Mutations compose generated Collection operations and map
Collection-owned issues to their declared Operation errors explicitly. Do not
borrow the error map of whichever Mutation happens to call the Collection.

`normalize` has no Context, Services, reads, time, randomness, or external
effects. `afterWrite` has no Actions, Requests, Routes, Services, or external
effects. Put externally visible work in an Action or retryable Job.

Retries rerun the transaction with a fresh attempt while preserving the root
call identity. Cancellation rolls back unfinished transaction work. Observe
lifecycle failures through their owning Mutation without disclosing hidden
evidence.
