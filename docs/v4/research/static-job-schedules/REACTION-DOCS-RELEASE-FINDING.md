# Reaction documentation release finding

The public durable-work guide contains examples that do not compile against the
current generated contract. This finding separates those errors from the
accepted beta.1 release cut. It makes no product decision or acceptance verdict.
Static schedules and the Proposed ADR-0043 checkpoint boundary are not authority
for the retained Reaction surface.

## Accepted release cut

ADR-0013 and `docs/v4/transactional-dispatch-and-reaction.md` describe generated
Reaction Action calls. ADR-0021 then limits beta.1: Action authoring and its
generated client are absent. ADR-0024 changes only Studio scope.

The BETA-08 implementation record makes the narrower effect surface explicit:
`docs/v4/implementation/beta08/design-context.md:303` uses `perform`/`recover`
callbacks instead of a generated Action because Action is outside beta.1. The
same paragraph assigns replacement of that callback to the later Action slice,
over the existing durable effect ledger.

This is recorded acceptance evidence, not an inference from current code:

- `docs/v4/implementation/beta08/acceptance-manifest.json` binds that design
  record and explicitly names the deferred Action seam in criterion 15.
- `docs/v4/implementation/beta08/REVIEW-04.json` records PASS for ticket #295
  against `d0aedd54dc6420b48e632590a6c2319f8516bc9f`.
- Reading the design record at that reviewed head reproduces the callback
  qualification. Its current SHA-256 also matches the manifest binding.
- `docs/v4/implementation/beta12/REVIEW-RC-05.json` records the later beta.1
  package closure PASS. The frozen public `beta1-release.mdx` inventory still
  explicitly excludes Action authoring.

ADR-0026 retains ADR-0013 and supersedes only the separate Workflow projection.
ADR-0028 retains durable production effect identity derivation and gives ordinary
Action a disjoint identity domain. Neither explicitly closes BETA-08's callback
replacement assignment. ADR-0025 permits an Action or external-effect Service
boundary, without specifying a replacement for the generated Reaction handle.

Therefore the retained callback surface has an accepted release-cut basis.
Documenting it does not require a new product choice. Claiming that the later
Reaction Action integration is complete would still be incorrect. The beta.2
closure must keep that inherited assignment explicit rather than treating a
working ordinary Action as proof of a generated Reaction Action capability.

## Executable documentation failures

The audited page is `apps/docs/content/docs/v4/durable-reactions.mdx`. A read-only
TypeScript probe used the generated Collaboration App Contract after the
compiler hostile suite passed. It emitted these seven diagnostics:

| Page expression                    | Diagnostic | Current generated fact                             |
| ---------------------------------- | ---------- | -------------------------------------------------- |
| Handler destructures `run`         | TS2339     | `run` belongs to `ctx`.                            |
| Handler destructures `attempt`     | TS2339     | `attempt` belongs to `ctx`.                        |
| `ctx.data.messages`                | TS2339     | Reaction data exposes the structural Query runner. |
| `ctx.actions`                      | TS2339     | No generated Reaction Action capability exists.    |
| Effect handle used as a string key | TS2322     | `ctx.run.effect` returns `ReactionEffectHandle`.   |
| `ctx.operationTime`                | TS2339     | ADR-0031 replaces this spelling with `ctx.now`.    |
| `operation.error` without import   | TS2552     | The example imports only `codec` and `durable`.    |

The probe used an in-memory TypeScript source and wrote no application source.
It checked the disputed expressions against the existing `messagePublished`
Reaction and `message.publish` Mutation types; it did not claim that the full
page's invented domain Operations had compiled.

Source inspection also confirms that the Reaction factory requires an output
codec, while the first example omits one. An omitted `effects` array lowers to
an empty literal-name set, yet the example calls `deliver-message`. Ordinary
Action options use `effectKey`, not the example's `idempotencyKey`.

The relevant owners are `packages/compiler/src/reaction/declarations.ts`,
`packages/compiler/src/reaction/index.ts`,
`packages/runtime/src/durable/reaction-context.ts`, and
`packages/compiler/src/action/index.ts`. The working retained consumer is
`fixtures/collaboration/src/message-published.ts`: it reads through
`ctx.data.run`, calls `ctx.run.effect(...).invoke`, and records state through a
generated Mutation.

## Minimum closure

Repair imports, `ctx.now`, and `ctx.run`/`ctx.attempt` spelling throughout the
example and heartbeat prose. Replace the first tutorial with a complete example
exercised against the generated contract, including its output codec and any
literal effect declaration. Do not fabricate `ctx.actions` or convert an effect
handle into an ordinary Action key.

Keep the retained Reaction effect example distinct from ordinary Action and
from Job checkpoints. Record the later callback replacement as inherited work,
not as a newly invented requirement or a completed capability. The public
`skills/questpie` durable reference has no executable snippet with these errors;
its checkpoint availability must still match the final accepted release cut.
