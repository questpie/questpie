# `authority.isSystem()` cannot be true at runtime

A finding, not a decision. It records what is true of the shipped tree and names
who owns the answer. It takes no decision, changes no ADR, no public projection,
no gate, and no tracker state.

First recorded in `authority-mechanism.md` on the unmerged branch
`feat/v4-beta-09`. It is repeated here because it is **not BETA-09's to decide**
— it concerns the public `Authority` contract — and because that branch's
records are exposed to the merge hazard described in
`docs/v4/implementation/beta09/README.md`. Every claim below was re-verified
against the tree independently before being written here.

Base: `feat/v4` at `d7edf0d2`.

## What is true

**The public `Authority` type has exactly one member.**

```ts
export type Authority = Readonly<{ kind: "ordinary" }>;
```

`packages/questpie/src/context.ts:26`. The only construction site anywhere in
the runtime execution path is
`packages/runtime/src/execution/index.ts:282`, which always builds
`{ kind: "ordinary" as const }` — a whole-tree search for another finds none.

Three things sit around that single member and assume more:

| Assumes two classes                                                                                          | Where                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| the glossary — "System Authority is an explicit trusted capability and cannot be derived from request input" | `CONTEXT.md`                                   |
| the relational layer's own type, `Readonly<{ kind: "ordinary" \| "system" }>`                                | `packages/runtime/src/relational/query.ts:132` |
| its admission vocabulary, `"authenticated" \| "public" \| "system"`                                          | `packages/runtime/src/relational/query.ts:104` |

And Policy can author it. `isSystem()` is declared at
`packages/questpie/src/relational/model.ts:34` and lowered by the compiler to a
comparison against the literal `'system'`
(`packages/compiler/src/relational/discovery.ts:54`).

**So `authority.isSystem()` compiles, lowers correctly, and is unsatisfiable at
runtime.** It is a Policy predicate that always evaluates false, by
construction, with nothing anywhere reporting that.

## The consequence already in the tree

`fixtures/collaboration/src/message-policy.ts:206` reads:

```ts
export const membershipPolicy = definePolicy(memberships, {
	name: "memberships.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ authority }) => authority.isSystem(),
	},
});
```

Memberships are therefore readable by **nobody** through an ordinary Query.

That is very likely the intent — memberships back Policy decisions and should
not be listable — but it is achieved by an expression that reads as _"system
callers may read this"_ and means _"no caller may read this"_. The two readings
diverge the moment a system Authority exists, and anyone relying on the first
reading would be relying on something the runtime has never done.

`isSystem()` appears nowhere else in `packages/` or `tests/`, so this fixture is
the whole exposure today.

## Why this is recorded rather than decided

Three resolutions are visible and each belongs to a different owner:

- **Construct a system Authority** where a trusted path warrants it. That
  changes the public `Authority` contract and belongs to the ADR that froze it,
  not to a slice.
- **Remove `isSystem()` from the authoring surface** until something can satisfy
  it. That narrows a published Policy vocabulary, which is an API decision.
- **Leave it and document that it is always false.** Cheapest, and it leaves an
  authoring surface whose plain reading is wrong.

BETA-09 does not own any of them, which is exactly why its own record set
declines the question and this one records it instead.

## What would change the finding

A construction site for a non-ordinary Authority appearing anywhere in the
execution path. At that point `isSystem()` becomes satisfiable, the fixture's
membership policy silently changes meaning from "nobody" to "system callers",
and that change would be invisible in the Policy source — which is the sharpest
reason to settle this before such a site is added rather than after.

## What actually keeps memberships safe, and it is not the Policy

Following the finding one step further changes its shape. Memberships are read
at runtime — just not through a Query.

`packages/runtime/src/relational/bootstrap.ts` is 411 lines and contains **no
reference to Policy of any kind**. It builds a keyed lookup straight against the
collection's PostgreSQL table. That is a necessity rather than an oversight:
Context Resolution has to run before Policy can be evaluated, because Policy
needs the resolved Context.

The collaboration Context uses it (`fixtures/collaboration/src/execution.ts:44`):

```ts
const membership = await bootstrap.get(memberships, {
	key: {
		companyId: input.companyId,
		principalId: principal.id,
		scopeKey: "company",
	},
	select: {
		id: true,
		companyId: true,
		principalId: true,
		role: true,
		scopeKey: true,
		status: true,
	},
});
```

and puts four of those fields into `values` (`:64`–`:69`) —
`selectedMembershipId`, `selectedMembershipPrincipalId`,
`selectedMembershipScope`, `selectedRole` — which reach every handler as
`ctx.values` through `ExecutionFacts`
(`packages/runtime/src/execution/index.ts:285`).

So a collection whose read Policy denies everyone hands four of its columns to
every handler on every Execution.

**This is not a disclosure hole, and the reason matters.** The bootstrap key is
`principalId: principal.id` — the caller's own identity. A caller can only reach
their own membership row. The scoping is correct.

But it is correct because **the application author wrote a caller-scoped key**,
not because any Policy checked it. `membershipPolicy` contributes nothing here:
it is unsatisfiable, so it denies every path, including the one nobody uses.

### The generalizable finding

**There is a third read path, and no Policy governs it.**
`inspection-contract.md` reasons about two lanes — application data through
generated Operations and Collection Policy, and operational facts through their
own inspection Authority. Context bootstrap is a third, and it is the only one
that reads Collection rows with no authorization layer at all.

An author who writes a bootstrap key that is not caller-scoped gets no
protection from Policy, because Policy is never consulted. Nothing in the
compiler or the runtime reports that, and the collaboration fixture's safety
would look identical either way.

That is worth knowing for BETA-09's red test, which asks whether Studio can
disclose something not available through the equivalent generated Operation. The
same question applied to Context bootstrap has a different and less comfortable
answer, and it is not BETA-09's to fix.

## How far the third path actually reaches

"No Policy governs it" is true and, left alone, overstates the exposure. The
path is tightly bounded by construction, and the bounds are worth stating
because they change what the risk actually is.

Every bootstrap read is validated before it runs
(`packages/runtime/src/relational/bootstrap.ts`):

- the Collection must be known — `unknown ContextBootstrap Collection` (`:328`,
  `:330`);
- every selected Field must exist and be a supported codec (`:308`, `:310`), and
  the selection must be explicit and `true` (`:359`, `:362`);
- **the key must be the complete primary key** — `ContextBootstrap requires the
exact primary key` (`:356`). No partial key, no predicate, no scan;
- the generated statement is `SELECT <named fields> FROM <collection> WHERE
<every primary-key column> = $n ... LIMIT 1` (`:368`–`:382`);
- zero rows returns `null`, and anything other than one row throws (`:391`,
  `:393`).

So the path is: **one row, named by its exact primary key, with an explicit
field list, and no Policy check.** It cannot enumerate, filter, or scan.

**That narrows the risk to a specific authoring mistake.** The collaboration
Context is safe because its key mixes a trusted value into the lookup —
`principalId: principal.id` comes from the Principal, not from Context input
(`fixtures/collaboration/src/execution.ts:47`–`:51`). An author who instead
keyed entirely on Context input would read any row whose primary key a caller
could name, with the selected fields landing in `ctx.values` for every handler.
Policy would not catch it, because Policy is never consulted on this path, and
nothing in the compiler or runtime reports the difference.

The distinction between those two Contexts is one identifier's provenance. That
is the whole safety property.

**Checked against the accepted projection, and the result splits.** The _bounds_
are documented: `docs/v4/context-and-policy.md:74`–`:79` states that "Bootstrap
accepts one known Collection, its exact key, and an explicit selection" and that
"it can neither enumerate application Collections nor reach raw SQL, the
database, writes, Services, Queue, or System Authority." So the section above is
confirmed by accepted authority, not only by reading the code.

**The provenance rule is not documented anywhere.** Nothing in that projection or
in ADR-0010 says where key values may come from. And the projection's own worked
example (`context-and-policy.md:40`–`:46`) uses `principalId: principal.id` —
demonstrating the safe pattern without ever naming it as the safety property.

That is the sharper version of the finding. A reader who _copies_ the example is
safe by imitation. A reader who _adapts_ it — swapping `principal.id` for an
input field, which the surrounding prose gives no reason not to do — loses the
property silently.

Nothing reports it either: the compiler emits no Context-resolver or bootstrap
analysis at all. Neither `packages/compiler/src/model.ts` nor
`packages/compiler/src/artifacts.ts` references bootstrap, and resolver bodies
are inline functions the compiler never inspects.

### What this does not claim

Not that the design is wrong. Trusted Context is what ADR-0010 froze, and a
keyed pre-Policy read is the only way Context Resolution can work at all. The
finding is that the safety of a bootstrap read rests entirely on where its key
values come from, and that this is currently an unwritten convention rather than
a checked property.
