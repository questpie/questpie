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
