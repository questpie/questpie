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
ADR-0015. The factories exist because ADR-0009 fixes six Current App Contract
factories and the compiler emits the whole set. Nothing here is a defect on its
own.

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
