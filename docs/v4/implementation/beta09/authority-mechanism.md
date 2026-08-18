# BETA-09: what maintenance Authority is evaluated against

`maintenance-decisions.md` Q3 decided that inspection Authority and maintenance
Authority are distinct and separately evaluated. It did not say what they are
evaluated _against_, because the record was written without checking what
`Authority` actually is at this base. Implementing it surfaced the gap.

This record closes it. It corrects a record this slice already committed rather
than leaving both standing.

Base: `feat/v4-beta-09` at the fixture increment.

## The finding

**The public `Authority` type has exactly one member.**

```
export type Authority = Readonly<{ kind: "ordinary" }>;
```

at `packages/questpie/src/context.ts:26`. The only construction site in the
execution path is `packages/runtime/src/execution/index.ts:282`, which always
builds `{ kind: "ordinary" }`.

Three things sit around that single member and disagree with it:

- `CONTEXT.md:402` defines Authority as "the immutable class of actions an
  Execution may request" and states that "System Authority is an explicit
  trusted capability and cannot be derived from request input." The glossary
  describes a class system with at least two members.
- The relational query layer's own type is
  `authority: Readonly<{ kind: "ordinary" | "system" }>`
  (`packages/runtime/src/relational/query.ts:132`), and its admission vocabulary
  is `"authenticated" | "public" | "system"` (`:104`). The lower layer expects
  two classes.
- Policy can author `authority.isSystem()`, which the compiler lowers to a
  comparison against the literal `'system'`
  (`packages/compiler/src/relational/discovery.ts:54`).

So `authority.isSystem()` compiles correctly, lowers correctly, and **can never
be true at runtime**, because nothing constructs a system Authority.

### A consequence outside this slice

`membershipPolicy` in the collaboration fixture is
`rows: ({ authority }) => authority.isSystem()`. Since that predicate is
unsatisfiable at runtime, memberships are readable by nobody through an
ordinary Query. That is very likely the intent — memberships back Policy
decisions and should not be listable — but it is achieved by an expression that
reads as "system callers may read this" while meaning "no caller may read
this". Worth knowing before someone relies on the first reading. It is not
BETA-09's to change.

## The decision

**Maintenance Authority is an ordinary Policy decision evaluated inside an
Execution. BETA-09 adds no new Authority class.**

The alternatives and why they lose:

- **Extending the `Authority` union with a system class.** It would match
  `CONTEXT.md` and the query layer, but minting System Authority needs a trusted
  path, and ADR-0013 is emphatic that "a worker process, region, Queue, missing
  credential, or failed resolution cannot imply System Authority." Introducing a
  mintable system class inside a Studio slice is the widest possible blast
  radius for the narrowest possible need, and the accepted contract does not
  ask for it.
- **A dedicated authoring seam.** Gate 8 names `defineStudio` among the things
  Studio must not have.
- **Ordinary Policy.** ADR-0003 says Studio "operates it through public
  application contracts". ADR-0014 says "Studio reads application data through
  ordinary generated Operations and Policy". Using the accepted authorization
  model needs no new class, no new authoring surface, and no new trust path.

This also retroactively explains a shape BETA-08 shipped and disclosed as
narrower: the maintenance commands take a trusted `Principal` rather than an
Authority token. Under this decision that is the correct signature. The
Authority decision happens in the Execution that reaches the command, and the
`Principal` is what that Execution carries. BETA-08's gap was never a wrong
signature; it was that nothing evaluated a decision before the call.

## What that means concretely

- Maintenance commands remain `Principal`-taking. The brand check stays as a
  trust boundary on the value, and stops being mistaken for an authorization
  decision.
- The decision is expressed as Policy the application author declares, which is
  what makes it "explicitly authorized" in ADR-0014's sense — explicit means the
  author wrote it, not that the framework inferred it.
- Inspection Authority is the same mechanism at a different scope, so Q3's
  "separately evaluated" holds without two mechanisms.
- `AUTHORITY_DENIED` remains the typed, audited rejection from
  `hostile-cases.md` case 5 and `internal-protocol-v5.md`. Nothing about the
  rejection changes; only the question of what produced it.

## Where the Policy is declared

The mechanism above left one thing implicit — _where_ the author writes the
Policy. Accepted authority already answers it, at ADR-0016:62:

> Applications expose selected request, status, cancellation, and signal jobs
> through ordinary Policy-protected Query and Mutation Operations.

So there is no maintenance-Policy declaration site to invent. **The author
writes an ordinary Mutation, gives it ordinary Policy, and that Mutation calls
the durable command.** The Policy on that Operation _is_ the maintenance
Authority decision.

This has a consequence worth stating plainly, because it changes what the
surface is for:

**`app.durable.cancelRun` is not the Studio path.** It is a server-internal
capability, in the same class as the kernel itself — reachable only from server
code, never from a client, and not the thing Studio calls. Studio calls a
generated Operation whose Policy the application declared. A caller that has
reached `app.durable.*` has already passed whatever Operation exposed it.

That resolves the tension in `hostile-cases.md` case 5 differently than a naive
reading suggests. The denial the hostile case drives is a Policy denial on the
exposing Operation, and `AUTHORITY_DENIED` is the durable surface's own guard
for the case where a server path reaches a command it should not — defence in
depth, not the primary gate. Both are worth having; only the first is what a
Studio user encounters.

## The seam ADR-0016 assumes does not exist

Implementing the declared path found the next gap, and it is structural rather
than a matter of wiring.

**A Mutation handler cannot reach a maintenance command.** The generated
`MutationContext` is `RootExecution` minus `services`, plus `data`,
`operationTime`, `callId`, `transactionId`, and `dispatch`
(`packages/compiler/src/generate.ts:327`). `RootExecution` itself is
`principal`, `authority`, `tenant`, `values`, `services`, `signal`, `deadline`
(`:352`). Nothing in either exposes `cancelRun`, `retryRun`,
`acknowledgeAmbiguity`, or any durable control surface.

So ADR-0016:62 names a path — "applications expose selected request, status,
cancellation, and signal jobs through ordinary Policy-protected Query and
Mutation Operations" — that an author cannot currently write. `ctx.dispatch`
lets a Mutation _create_ durable work; nothing lets it _operate_ durable work.

An earlier revision of this record explained the asymmetry by saying a
maintenance command "manages its own transaction", so a Mutation-side seam
would nest transactions or escape the Mutation's atomicity. **That reasoning
was wrong, and adversarial review caught it.** Two facts kill it:

- **A Mutation transaction already carries the kernel marker.**
  `markDurableKernelTransaction(query)` runs inside the Mutation's own
  `BEGIN`/`COMMIT` (`packages/runtime/src/mutation/postgres.ts:281`).
- **A kernel write path already accepts a caller's transaction.**
  `acceptDurableDispatch` takes a caller-supplied `query`, marks it, and inserts
  into `durable_runs` — the most protected table in the internal protocol — and
  its docstring says so: "inside the caller's transaction"
  (`packages/runtime/src/durable/acceptance.ts:24`, `:45`, `:59`).

So kernel-owned transactions are not an invariant of the kernel. They are a
local choice in `postgres-maintenance.ts` that another kernel write path
already declines. A Mutation-side seam would pass the Mutation's transaction
in, not open a second one, and the command bodies are already written against a
`DurableQuery` rather than against `sql`.

The real objections are different and are recorded below with the options.

**This blocks the maintenance Authority red test**, and the block is worse than
"defence in depth is waiting for its primary gate". The generated application
constructs `createPostgresDurableMaintenance({ sql, application })` with no
`authorize` (`packages/compiler/src/runtime/application.ts:410`), so the guard
is **inert in the shipped Runtime**. The Policy on an exposing Operation is not
the primary gate today; it is the only conceivable gate, and it cannot be
written. Nothing authorizes a maintenance command at this base.

There is also no fourth Operation kind to escape into. `defineRoute`,
`defineAction`, `defineJob`, and `defineWorkflow` are emitted as
`export declare const … : EmptyDefinitionFactory`, where
`EmptyDefinitionFactory` is `(definition: never) => never`
(`packages/compiler/src/generate.ts:255`, `:388`) — reserved names that accept
no definition. Query, Mutation, and Reaction are the only authorable kinds, and
none of them can reach a maintenance command.

Three ways out, none taken here because each is a contract decision rather than
an implementation detail:

1. **A Mutation-side seam that joins the Mutation transaction.** Cancellation
   becomes atomic with a business write. Needs the maintenance commands to
   accept a caller-supplied transaction, which they currently refuse by design.
2. **A Query-side seam.** ADR-0016 names Query as well as Mutation. Inspection
   fits a Query cleanly; commands do not, since a Query is read-only.
3. **An Operation kind whose handler runs after the transaction commits.**
   Closest to what an operator action actually is, and the largest new concept.

Recorded rather than decided, because BETA-09's own records do not settle it
and choosing here would be inventing the seam at the point of needing it — the
failure this slice has twice avoided.

## The seam decision, after adversarial review

Two teams argued the fork. The team assigned the separate-path position
**conceded**, and did so on an argument it found against itself, which is the
strongest form the concession could take.

**Decision: the seam passes the Mutation's transaction into the command.** A
member on `MutationContext` beside `dispatch`, returning the frozen
`DurableMaintenanceOutcome` the commands already build. `RootExecution` does not
change; this is Mutation-only, as `dispatch` is.

### What decided it

Not the transaction argument, which turned out to be a non-issue, but
**idempotency**. The Mutation's call receipt is written _inside_ the Mutation
transaction with `outcome = 'executing'`
(`packages/runtime/src/mutation/postgres.ts:183`). Under a separately-transacted
command, a Mutation rollback erases the receipt while the command has already
committed — so a client retry on the same `callId` re-enters the handler and
issues a **second** maintenance command. That converts exactly-once into
at-least-once and writes a spurious `ALREADY_REQUESTED` row into the very audit
`hostile-cases.md` exists to protect. Joining the Mutation transaction gets
exactly-once from the receipt for free.

The rolled-back-audit objection, which looked like the strongest case for a
separate transaction, survives but does not decide. A rejection does not throw —
`AUTHORITY_DENIED`, `VERSION_MISMATCH`, `RUN_IS_TERMINAL` and
`ALREADY_REQUESTED` all return an outcome — so an author who returns it commits
the audit row. The row is lost only when the whole attempt is lost, and then the
operator gets an error, the run is untouched, and the audit is silent.
Consistent-and-silent beats the separate path's cancelled-run-plus-rolled-back-
business-write-plus-error.

### Two repairs the seam must ship with

1. **The runtime raises and lowers the kernel marker around the command call,
   never author-reachable control flow.** This is the one objection from the
   losing side that stands. `set_config('questpie.durable_kernel', 'on', true)`
   is `is_local` (`packages/runtime/src/durable/rows.ts:23`), so its lifetime is
   subtransaction-scoped; the runtime already sets it unconditionally after the
   handler and never clears it (`mutation/postgres.ts:281`); and the handler
   shares one reserved session, so `Promise.all([ctx.durable.cancelRun(…),
ctx.data.x.update(…)])` interleaves user statements into the armed window.
   The guard triggers are `FOR EACH STATEMENT` and the predicate is only "is the
   flag on right now" — it cannot tell a kernel statement from a user statement
   inside that window. A `finally` block cannot be asked to carry that.
2. **The authorization check moves ahead of the lock, and the lock takes
   `NOWAIT`.** Today `lockRun` runs before `denied()`
   (`packages/runtime/src/durable/postgres-maintenance.ts:239` against `:244`),
   so an unauthorized caller takes `FOR UPDATE` on a run it may not touch. Under
   a Mutation-held transaction that lock is held for the Mutation's remaining
   lifetime, and `lockRun` has no `SKIP LOCKED`, so a second maintenance command
   waits out `lock_timeout`. That is a denial-of-service surface handed to
   exactly the caller who was refused. It is a defect in the guard committed at
   `decb3a39` and is independent of which seam wins.

### What stays open

Option 3 — a handler that runs after commit — remains the shape that actually
matches an operator action, and is the only one that gets both a durable audit
row and no in-transaction guard toggling. It is the right target for a later
slice, not this one, and ADR-0016:32 and ADR-0013 both already constrain it.

## The decision does not survive contact: a Mutation Policy cannot express Authority

Building the seam found the blocker underneath the blocker, and it invalidates
this record's central decision rather than merely delaying it.

**A Mutation's admission Policy must be exactly `policy.authenticated()`.** The
compiler rejects anything else:

```
policy.kind !== "booleanExpression" ||
policy.operator !== "authenticated" ||
policy.operands.length !== 0
  → QP-COMPOSE-013 "<kind>.policy is outside the accepted authenticated
    admission scope"
```

at `packages/compiler/src/model.ts:242`–`:255`, which then stores the contract
as the constant `{ kind: "authenticated" }`. Every `defineMutation` in the tree
is `policy: policy.authenticated()`, and nothing else compiles.

So the decision recorded above — that maintenance Authority is the ordinary
Policy on the exposing Operation — **cannot be implemented for a Mutation.**
That Policy can say "someone is signed in" and nothing more. Exposing
`cancelRun` through it would let every authenticated caller of any role cancel
any run in the application. That is not an Authority decision; it is the
absence of one wearing the word Policy.

Row and Field Policy _can_ express roles — `messagePolicy` restricts `body`
output to `owner` and `admin` through `policy.exists` over memberships — but
those attach to a Collection, and a maintenance command operates a run, which is
not a Collection row. The expressive Policy is attached to the wrong thing.

### What this leaves

Three shapes, none of them free, and this record does not choose between them
because the choice is larger than BETA-09:

1. **Widen Mutation admission Policy** to the relational expression grammar the
   Collection policies already use. The grammar exists and is compiled; what is
   missing is permission to use it at Operation admission. This is the smallest
   change that makes ADR-0016:62 true as written, and it is a change to the
   accepted Operation contract, not to this slice.
2. **Evaluate authority in the handler** — read a membership through
   `ctx.data`, refuse on the wrong role. Honest and available today, but it is
   handler code rather than Policy, so ADR-0014's "explicitly authorized" is
   satisfied by convention rather than by contract, and nothing stops the next
   author omitting it.
3. **Keep maintenance off the Operation surface entirely** and treat
   `app.durable` as a server-internal capability whose caller is trusted by
   construction — which is what BETA-08 shipped and disclosed, and which the
   `authorize` hook already supports.

### What was built and reverted

The seam itself works: the maintenance factory borrowing a caller's transaction,
a `durable` member on `MutationContext`, and a runtime-owned marker window that
raises and lowers the guard around one command. All of it compiled. It is
reverted rather than committed for the same reason as the previous tick — it is
capability nothing can use, and the bundle budget is a real gate that dead code
should not spend. It returns with whichever of the three shapes above is chosen.

## Judgment call

Choosing Policy over extending the Authority union is mine, and it is the more
conservative of two defensible readings. `CONTEXT.md` and the query layer both
imply a system class is coming, so a future slice may well add one, and if it
does, maintenance Authority could be re-expressed against it.

What would overturn this: an accepted decision that operational facts are not
application data and therefore must not be governed by application-authored
Policy. That argument has force — a tenant's own Policy deciding who may cancel
that tenant's runs is coherent, but a platform operator inspecting across
tenants is not something tenant Policy can express. This slice does not need
that case, because minimal Studio is same-origin and single-application. A
fleet or platform Studio would need the Authority class, and that is exactly
the boundary ADR-0014 already draws by deferring remote and fleet Studio.
