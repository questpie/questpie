# ADR 0031: Freeze Collection lifecycle programs and issue mapping

- Status: Accepted
- Date: 2026-08-28

## Context

ADR-0011 fixes one Mutation-owned transaction and one generated Collection
write kernel. ADR-0030 adds exact caller and trusted-value lanes while deferring
authored lifecycle phases. The approved Deep-DX direction names exactly four
phases: `normalize`, `validate`, `check`, and `afterWrite`.

Two proof holes prevented ratification. A Collection cannot borrow the declared
error map of whichever Mutation calls it, and arbitrary TypeScript cannot be
proved pure merely by narrowing its parameter type or running it in a process.

## Decision

The existing generated Collection kernel gains four Collection-owned lifecycle
programs. It remains the only create/update write owner.

### Collection issues and Operation errors

A Collection may declare payloadless named issues. Each issue has a stable
Collection-scoped identity. It has no public code, status, message, payload, or
transport meaning.

`validate` and `check` may throw only generated issue values. The first issue
raised in authored program order wins. The Runtime immediately dooms the owning
transaction, so application `catch` code cannot commit after an issue. Unknown
throws, forged issues, and issues absent from the outer Operation's mapping
roll back and become sanitized, non-retryable `INTERNAL` failures.

Each named Mutation explicitly maps every reachable Collection issue to one of
its own payloadless declared errors through structural `issueMappings`.
Reachability includes `check` and `afterWrite` calls into other Collection
kernels. The compiler reports the complete call path for a missing mapping and
the generated Mutation Context does not expose an issue-bearing kernel call
without the required mapping. A Collection never receives Operation error
factories.

The shared Operation engine performs mapping only after rollback and before
direct or wire adaptation. Direct and network calls therefore expose the same
declared error. Collection identity, candidate/current rows, protected Field
values, Policy evidence, PostgreSQL detail, stacks, and issue identities never
cross that seam. PostgreSQL constraints are not Collection issues.

### One canonical lifecycle program

All four callbacks use ordinary TypeScript syntax that the compiler parses and
lowers to a versioned canonical lifecycle program. Runtime never invokes the
authored callbacks as JavaScript.

The common grammar admits closed operands, immutable literals and locals,
static property access, branches, returns, exact object construction, and a
small versioned set of deterministic operators and locale-free scalar methods.
It rejects ambient globals, imports and captures, dynamic properties, arbitrary
calls, constructors, prototypes, mutation, module state, nondeterministic
built-ins, and unsupported syntax with Origin-bound diagnostics.

`normalize` and `validate` admit no effects or `async` work. `check` additionally
admits awaited bounded Policy-aware kernel reads. `afterWrite` additionally
admits sequential bounded kernel reads/writes and Job acceptance. Bounded
`for...of` is legal only over a compiler-known bounded result. `Promise.all`,
detached work, Services, Actions, Request, Route, filesystem, network, timers,
raw SQL, raw transactions, and external effects are unrepresentable.

Lifecycle Program v1 accepts only these ordinary-TypeScript forms:

- `const` locals; `if`/`else`; `return`; exact object and array literals;
  object spread from the phase input; static member access; optional chaining;
  nullish coalescing; and deterministic template literals;
- `null`, boolean, finite-number, string, timestamp, exact object, and bounded
  array values;
- `!`, unary `-`, `+`, `-`, `*`, `/`, `%`, `===`, `!==`, `<`, `<=`, `>`, `>=`,
  `&&`, `||`, `??`, and the conditional expression;
- the closed string methods `trim`, `toUpperCase`, `toLowerCase`, `startsWith`,
  `endsWith`, and `includes`; and
- `throw issues.<declared>()`, awaited calls from the current phase's generated
  capability object, plus bounded `for...of` in `afterWrite` only.

There is no assignment, increment, `var`/`let`, `switch`, `try`/`catch`, nested
function, class, generator, recursion, computed member, user-defined call, or
spread from any value other than the normalize input. An accepted method's
semantics belong to the interpreter version rather than the host JavaScript
engine.

Compiler diagnostics are closed: `QP-COMPOSE-026` has
`unsupportedLifecycleSyntax`, `lifecycleCapture`, and
`unsupportedLifecycleCapability`; `QP-COMPOSE-027` has
`invalidIssueDeclaration`, `invalidIssueMapping`, and `missingIssueMapping`.
Each names the phase and Origin, and the mapping diagnostic includes the full
Collection-call path and a supported rewrite. `QP-DATA-023
databaseOwnedField` rejects an `onUpdate` Field in either lane.
`QP-DATA-024 lifecycleRecursionExceeded` dooms an executing transaction whose
artifact-bound re-entry limit is exceeded. Diagnostics never include row,
candidate, Policy, PostgreSQL, or issue-detail values.

The artifact refers to Collection, Field, issue, Operation, and Job identities,
not source variable names. Canonical bytes, a domain-separated digest, schema
and issue bindings, Runtime Build integrity, exact decoding, and interpreter
version compatibility fail closed on drift or tampering.

### Phase semantics

- `normalize` receives one supplied lane at a time after caller Field authority
  and scalar decoding. It may replace values only at paths already present; it
  cannot add, remove, move, or overlap caller and trusted paths.
- `validate` receives the complete candidate, optional locked current row, the
  transaction-stable `now`, and generated issue factories. It performs local
  candidate checks without capabilities.
- Candidate Policy runs before `check`, so unauthorized candidates cannot use
  database-backed validation as an oracle. `check` reads only through current
  Policy and selection authority in the owning transaction.
- PostgreSQL applies constraints and database-owned values, then returns the
  written row. `afterWrite` receives that row and optional previous row and
  remains pre-commit. Its nested work shares the outer transaction.

All phase work counts against the outer Mutation's statement, row, dependency,
duration, and cancellation budgets. Nested lifecycle writes run synchronously
in authored invocation order through the same kernel. A compiler-selected
finite re-entry limit is part of the artifact; exceeding it dooms and rolls
back the transaction.

There is no automatic retry of authored lifecycle work. A pre-commit failure or
cancellation rolls back. An explicit exact-call retry starts a fresh
transaction and reruns lifecycle work. A committed receipt replay runs none of
it. ADR-0023 still owns post-commit ambiguity and recovery.

### Clock and database-owned updates

The public transaction-stable clock is `ctx.now`; it supersedes
`ctx.operationTime` without changing its PostgreSQL
`transaction_timestamp()` semantics. Lifecycle `now` is the same value.

`onUpdate: "now"` makes a timestamp Field database-owned. No caller or trusted
lane may supply it. PostgreSQL advances it for every kernel update and every
explicitly supported managed-writer update, and the returned row and Change
Ledger observe the final database value. It cannot also be `server: true`.

## Acceptance evidence

Candidate `ca7d18e3fce4b55bd0e0ce36aa212a48dcec7af1` binds the complete authority,
canonical compiler/interpreter artifact, PostgreSQL 17 transaction proof, and
deterministic gates through
`docs/v4/prototypes/collection-lifecycle-boundary/acceptance-manifest.json`.
The project owner authorized GPT-5.6-sol high as the independent replacement
reviewer while the pinned provider transport was unavailable. The committed
exception record at `1437338c9a605c171819adee184b1ac00ffc1d3c` reproduces
packet digest
`9732b0cd31f73e0cd422082fe1d4e527c746e2ddd77c3bce4b4d76b8a214e2c3` and
reports `PASS` with no blocking finding. It is explicitly not represented as an
Opus v2 review artifact.

## Consequences

- Collections own reusable invariant facts without owning public errors.
- Operations remain the only public error and disclosure contract.
- The purity and no-external-effect guarantees are executable claims, not
  conventions inferred from TypeScript parameter shapes.
- `check` complements Policy; it never authorizes. `afterWrite` complements a
  Job or Action only for bounded transactional work and durable acceptance.
- There is still no `afterRead`, priority registry, hook catalogue, raw
  transaction, or second CRUD kernel.

## Supersession ledger

- ADR-0011's closed normalizer/value-program spelling is replaced by the four
  Collection lifecycle programs, while its ownership and write ordering remain.
- ADR-0011's rule that named Mutations own application errors is retained and
  made explicit through Operation-owned issue mapping.
- ADR-0011's `operationTime` public spelling becomes `ctx.now`.
- ADR-0011's explicit Mutation-owned `updatedAt` assignment is superseded only
  for Fields declaring database-owned `onUpdate: "now"`.
- ADR-0030's lifecycle and `onUpdate` deferrals are resolved. Its provenance,
  disjoint lanes, candidate Policy, and one-kernel rules remain unchanged.
- `defineCollectionOperations`, `operation.text`, and `mutation.overwrite`
  remain temporary compatibility authoring only until all current fixtures use
  named Operations; no lifecycle implementation is added to that adapter.

## Rejected alternatives

- Borrowing the caller Mutation's `errors` factories inside a Collection.
- Public Collection issue codes, statuses, messages, or payloads.
- Arbitrary payload transforms or mapping PostgreSQL errors into issues.
- Sandboxed or bundled arbitrary JavaScript described as compiler-proven pure.
- A narrowed `ctx` type described as proof against ambient or imported effects.
- A second expression language, executable lifecycle plugin, or parallel CRUD
  kernel.
