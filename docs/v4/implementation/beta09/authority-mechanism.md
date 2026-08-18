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

That asymmetry looks deliberate rather than forgotten, and the reason matters
for whoever closes it: `ctx.dispatch` writes intent inside the Mutation's own
transaction, which is exactly ADR-0013's atomicity guarantee. A maintenance
command manages its own transaction — `createPostgresDurableMaintenance` opens
one per command and marks it as a kernel transaction. Handing a Mutation a
surface that opens a second transaction inside the first would either nest
transactions or silently escape the Mutation's atomicity, and neither is
something to add by reflex.

**This blocks the maintenance Authority red test**, and the block is honest:
the guard added alongside it is defence in depth, the primary gate is the
Policy on an exposing Operation, and no such Operation can be authored today.

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
