# Four of seven authoring factories have no runtime behind them

A finding, not a decision. It generalizes a pattern that produced three separate
corrections in this record set within four ticks, and it is checkable in one
command.

Base: `feat/v4` at `b28a2904`.

## What is true

The compiler generates seven authoring factories
(`packages/compiler/src/discovery.ts:27`–`:33`): `defineAction`, `defineJob`,
`defineMutation`, `defineQuery`, `defineReaction`, `defineRoute`,
`defineWorkflow`.

Testing each for a runtime execution path — not by counting references in one
file, which is the grep-shaped mistake this repository keeps making, but by
asking what executes it:

| Factory          | Runtime path | Evidence                                                                      |
| ---------------- | ------------ | ----------------------------------------------------------------------------- |
| `defineQuery`    | yes          | the Operation engine                                                          |
| `defineMutation` | yes          | the Operation engine, `packages/runtime/src/mutation/`                        |
| `defineReaction` | yes          | the durable worker, `packages/runtime/src/durable/worker.ts`                  |
| `defineAction`   | **none**     | no file under `packages/runtime/src` mentions it                              |
| `defineJob`      | **none**     | same                                                                          |
| `defineWorkflow` | **none**     | same                                                                          |
| `defineRoute`    | **none**     | no Fetch dispatch, no `routes` projection; ADR-0014:32 assigns it to ADR-0015 |

`packages/runtime/src` contains modules for `application`, `codec`, `durable`,
`execution`, `live-query`, `mutation`, `operation`, and `relational`. There is
no job, workflow, action, or route module.

**This is expected and mostly accepted.** ADR-0016 says "Job remains a distinct
later vertical" and "Workflow remains later still"; ADR-0014 defers `routes` to
ADR-0015. Nothing here is a defect on its own.

An earlier revision of this paragraph said "ADR-0009 fixes six Current App
Contract factories and the compiler emits the whole set", which makes the
seventh sound like the compiler running past its ADR. It is not. ADR-0009:21-23
does fix an allowlist of exactly six, without `defineWorkflow` — but `:57`–`:59`
extends it: "ADR-0019 deliberately extends this allowlist to seven by adding
`defineWorkflow` after the shared durable/checkpoint kernel passed its focused
proof." The compiler agrees in its own diagnostics, which say "the seven current
factories" (`packages/compiler/src/discovery.ts:365` and `:377`). Seven is
authorized.

**Worth knowing because the mismatch looks real for exactly nine lines.**
Grepping ADR-0009 for the factory list returns `:20`–`:22` and stops there, and
six-versus-seven then reads as an ADR-vs-tree gap. It is not one; the ADR
reconciles itself further down. This record set's own rule applies —
reading finds candidates, only reading the matches settles anything — and this
is a case where the grep window was the whole error.

## Why it is worth recording anyway

**Three corrections in this record set came from reasoning across this gap**,
each one an accepted contract read as though the tree implemented it:

- `authority.isSystem()` compiles and lowers correctly and can never be true —
  the Policy vocabulary is ahead of the `Authority` type
  (`FINDING.md` in this directory).
- `drainRuntime` is named in the accepted projection and Gate 8 and exists
  nowhere in code, which took a whole decision to resolve
  (`docs/v4/implementation/beta09/maintenance-decisions.md`).
- A Route was offered as the home for the maintenance commands on the strength
  of ADR-0015 accepting it, before checking that nothing dispatches one
  (`docs/v4/prototypes/durable-evidence-gaps/ROUTE-SHAPE.md`).

The common shape: **an authored name is not evidence of a runtime.** In a
docs-first project the contract is deliberately ahead of the implementation, so
"ADR X accepts Y" and "Y works" are different claims, and design reasoning that
substitutes the first for the second produces plans that cannot be built.

## The cheap check

Before a design record depends on a mechanism, ask what executes it and name the
file. For the seven factories that is the table above; for anything else it is
one `grep -rl` over `packages/runtime/src` followed by opening a hit, because a
name can appear in a type or a comment without a path behind it.

That is the same rule as the grep-shaped-conclusion lesson recorded in
`HANDOFF.md`, aimed at a different question. Reading finds candidates. Only
opening the execution path settles whether a mechanism exists.

## What would change this

Any of the four gaining a runtime module. `defineRoute` is the nearest — its
owning slice is already named — and it is the one most likely to be assumed
present, because ADR-0015 is Accepted and the factory is generated.

## The absence is typed, not merely missing

The table above argues from absence — "no file under `packages/runtime/src`
mentions it". That is the weaker half of the case, and it invites the reading
that adding a module would close the gap. The positive evidence is stronger and
was not in the first revision of this record.

**The generated factories are uncallable by construction.** The real generated
contract declares them against an empty parameter type:

- `fixtures/collaboration/.questpie/generated/app.ts:184` —
  `type EmptyDefinitionFactory = (definition: never) => never;`
- `:198`–`:201` — `defineAction`, `defineRoute`, `defineJob`, `defineWorkflow`
  are all declared as that type. `defineQuery`, `defineMutation` and
  `defineReaction` are not; they get real typed declarations.

Nothing is assignable to `never`, so `defineJob({ … })` does not compile. **The
failure is a TypeScript error at the call site, not a silent no-op at runtime.**
That is the opposite of how an absent capability usually fails, and it is worth
stating because the risk this record warns about — an accepted contract read as
though the tree implemented it — cannot actually reach a running application
through these four. It stops at the author's editor.

**The runtime end is closed the same way.**
`RuntimeExecutableInventoryBinding` (`packages/runtime/src/application/bindings.ts:19`–`:35`)
is a union of exactly four members: `RuntimeExecutableBinding` (`kind: "mutation"
| "query"`, `packages/runtime/src/operation/index.ts:9`), `RuntimeReactionBinding`
(`kind: "reaction"`), `context`, and `service`. The switch at `:146`–`:158` has
no other case, and `:163`–`:176` returns only `operations` and `reactions`. No
binding for the four can be represented, let alone loaded.

**What this changes about scoping the missing slices.** "No module under
`packages/runtime/src`" sizes the Route + Auth and Job + Workflow work as
writing a module. The floor is higher: the binding union, the switch, the
returned partition, and the generated declaration all encode the absence
deliberately, and each is a place the work has to touch.
