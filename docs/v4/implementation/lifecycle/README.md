# Collection lifecycle implementation map

- Status: ready for ticketed implementation
- Date: 2026-08-29
- Classification: Kernel implementation of Accepted ADR-0031 plus Product
  projection through the reference consumers
- Primary tracer: `fixtures/team-support-desk`
- Hostile consumer: `fixtures/collaboration`

## Authority

- `docs/adr/0031-freeze-collection-lifecycle-programs-and-issue-mapping.md`
- `docs/adr/0030-freeze-collection-provenance-and-trusted-values.md`
- `docs/adr/0011-freeze-query-mutation-and-explicit-lifecycle.md`
- `docs/v4/query-mutation-and-lifecycle.md`
- `docs/v4/executable-definition-compiler.md`
- `apps/docs/content/docs/v4/queries-and-mutations.mdx`
- `docs/v4/implementation-gates.md`

Candidate `ca7d18e3fce4b55bd0e0ce36aa212a48dcec7af1` contains the
manifest-bound compiler/interpreter and PostgreSQL proof. The proof fixes the
contract; production code must integrate the behavior into current compiler,
artifact, generated-contract, Runtime, PostgreSQL, direct, wire, and client
owners rather than copy the prototype as a parallel kernel.

## Outcome

An application author declares payloadless Collection Issues and exactly four
ordinary-TypeScript lifecycle phases. The compiler accepts only the closed
Lifecycle Program v1 syntax and capabilities, emits one canonical artifact,
and discards authored callbacks. Generated App Contract types expose only legal
phase inputs and bound capabilities. Runtime interprets the artifact inside the
existing generated Collection create/update kernel and owning Mutation
transaction. Direct calls and generated clients receive identical mapped
Operation errors without Collection, Policy, row, PostgreSQL, or stack detail.

## Owners

| Concern                                                   | Owner                                          |
| --------------------------------------------------------- | ---------------------------------------------- |
| lifecycle syntax, Origin diagnostics, issue reachability  | compiler                                       |
| canonical bytes, digest, identity bindings, compatibility | artifact layer                                 |
| phase and issue authoring types                           | generated App Contract                         |
| phase execution, budgets, cancellation, re-entry          | Runtime interpreter                            |
| row lock, constraints, `ctx.now`, `onUpdate`, commit      | existing PostgreSQL Mutation transaction       |
| public error mapping after rollback                       | owning Operation engine                        |
| direct/wire/client parity                                 | existing Operation Wire and generated client   |
| durable acceptance                                        | existing Job transition kernel                 |
| observation                                               | owning Mutation execution and transaction path |

Policy remains the sole authored authorization mechanism. Collection Issues
state reusable invariant facts but own no public error contract. The generated
Collection kernel remains the sole create/update write owner.

## Fixed execution contract

The production path must preserve the accepted order:

1. decode exact Operation input and enforce admission;
2. open one Mutation transaction and freeze PostgreSQL-owned `ctx.now`;
3. decode disjoint caller and trusted lanes;
4. scope and lock the current row for update;
5. enforce caller Field authority before normalization;
6. scalar-normalize and run authored `normalize` separately per lane;
7. merge the create base or locked row, lanes, defaults, and SQL `NULL`s;
8. reject missing required Fields and validate every complete-candidate Field;
9. run authored `validate`;
10. enforce candidate Policy;
11. run authored Policy-aware `check`;
12. execute constraints, DML, and database-owned `onUpdate: "now"`;
13. run pre-commit `afterWrite`, including bounded nested kernel work and Job
    acceptance in authored order;
14. enforce output authority and codec, write the result receipt, and commit;
15. encode the result or map a doomed transaction's first Collection Issue
    after rollback.

All phase work shares the outer statement, row, dependency, duration,
cancellation, and artifact-re-entry budgets. A caught issue, limit, deadline,
cancellation, nested failure, or incompatible artifact still dooms the root
transaction. There is no automatic Mutation retry. An explicit uncommitted
retry is fresh; committed Call Identity replay executes no lifecycle work.

## Tracer-bullet slices

### LIFE-01 — Compile and execute normalize/validate with one mapped issue

Blocked by: none.

Drive one Team Support Desk ticket create from ordinary TypeScript authoring to
canonical artifact, generated types, PostgreSQL write, direct call, Fetch,
generated client, and browser-visible mapped error. Establish exact decoding,
digest/binding checks, callback non-invocation, closed runtime values, Origin
diagnostics, and the first red-green production path without adding `check`,
`afterWrite`, or `onUpdate` breadth prematurely.

### LIFE-02 — Close transitive issue reachability and nondisclosure

Blocked by: LIFE-01.

Add compile-time Operation-owned mappings for every transitively reachable
Collection Issue. Exercise nested Collaboration calls, missing/forged/malformed
mappings, first-issue order, transaction doom after catch, PostgreSQL constraint
separation, and byte-identical direct/wire/generated-client outcomes.

### LIFE-03 — Execute Policy-aware `check` under the outer budget

Blocked by: LIFE-01 and LIFE-02.

Move Team Support Desk team/membership dependent facts into bounded generated
`check` capabilities. Prove candidate Policy runs first, reads apply current
Policy and selection authority in the same PostgreSQL transaction, missing and
invisible remain indistinguishable, and row/dependency/deadline/cancellation
limits roll back without leaking evidence.

### LIFE-04 — Project `ctx.now` and database-owned `onUpdate`

Blocked by: LIFE-01.

Generate exact `ctx.now` types and bind one PostgreSQL
`transaction_timestamp()` value across handler and lifecycle work. Add schema,
migration, DML, returned-row, Change Ledger, receipt, direct/wire/client, and
Team Support Desk browser evidence for `onUpdate: "now"`. Reject either lane,
`server: true` overlap, and unsupported managed-writer paths.

### LIFE-05 — Run bounded `afterWrite` and Job acceptance atomically

Blocked by: LIFE-02, LIFE-03, and LIFE-04.

Add sequential Policy-aware reads, nested Collection writes, and Job acceptance
through the existing kernels. Prove authored order, shared transaction ID,
shared budgets, deterministic re-entry failure, root rollback, fresh retry,
committed replay, and absence of Service, Action, Request, Route, raw SQL,
transaction, timer, parallel, detached, or external-effect capabilities.

### LIFE-06 — Migrate consumers, delete superseded syntax, and close release

Blocked by: LIFE-01 through LIFE-05.

Finish Team Support Desk as the beginner/DX consumer and Collaboration as the
authority/security hostile consumer. Remove old normalizer/value spellings and
compatibility paths once no current consumer needs them; do not add lifecycle
callbacks to the temporary Operation Set adapter. Close generated declarations,
browser and PostgreSQL 17 tracers, hostile artifact tests, public examples,
Standards and Spec reviews, `quality:release`, release dry-runs, resource
cleanup, and `git diff --check`.

## Test-first and verification rules

Each ticket starts with one relevant failing test and uses
`bun run check:changed` for the seconds-long loop. Generated goldens change only
through their compiler owner. Every slice runs its exact unit/type/hostile tests,
the smallest disposable PostgreSQL 17 tracer, direct and wire parity, and
`git diff --check`. Module topology changes also run `architecture:check`.

Before review, each slice runs `quality:full`; release-sensitive slices run
`quality:release`. LIFE-06 additionally runs the Team Support Desk Firefox
journey, Collaboration hostile tracer, documentation build, package and
declaration verification, two release dry-runs, and independent Standards and
Spec reviews over the complete vertical.

## Non-goals and deferred seams

- no general hook catalogue, `afterRead`, Cron, trigger, Workflow, or browser
  Job control;
- no Service, Action, Route, Request, filesystem, network, raw SQL, or raw
  transaction capability in lifecycle;
- no automatic/public CRUD merely because a Collection exists;
- no second expression language, lifecycle VM, CRUD dispatcher, write kernel,
  durable kernel, or observation path;
- no OpenTelemetry API, span naming, attributes, sampling, exporter, or
  persistence decision;
- no declared-unique `key` lookup, typed `ConstraintViolation`, or
  always-generated get/list/delete;
- no push, tag, publish, or deployment as part of this map.

## Completion

The vertical is complete only when every child ticket is closed in dependency
order, both reference consumers use the production contract, superseded syntax
has no current consumer, public docs match executable generated types, all
required PostgreSQL/browser/release evidence passes, resources are cleaned up,
and the final worktree is clean.
