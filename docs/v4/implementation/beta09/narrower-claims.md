# BETA-09: every claim narrower than the accepted contract

Criterion 17. One authoritative list, with a count, so a reviewer reads the gap
in one place rather than assembling it from eight records. BETA-08's fourth
round caught a recitation saying five where its record carried nine; this is the
list the count is taken from.

**Fourteen.** Each names what accepted authority says, what this slice ships,
and who owns the remainder.

## Prohibitions in accepted authority

These are not deferred work. Closing them means changing an accepted clause.

1. **Inspection Operations carry no Policy.** ADR-0010:41 binds
   `definePolicy(collection, body)` to one Collection; a Query has no admission
   Policy at all (`packages/compiler/src/generate.ts:375`) and operational facts
   are not Collection rows. Owner: an ADR-0010 amendment.
2. **Maintenance Authority is not evaluated for the shipped surface.** ADR-0014
   requires commands to be "explicitly authorized". The `authorize` hook exists
   and is driven, and the generated application supplies none
   (`packages/compiler/src/runtime/application.ts:410`). Same owner as 1, or an
   owner ruling.
3. **A Mutation admission Policy can only say `authenticated`.**
   `packages/compiler/src/model.ts:242` rejects any other expression, so
   ADR-0016:62's declared path cannot carry an Authority decision. Owner: the
   Operation contract.
4. **`MutationContext` exposes no durable control surface**, so the ADR-0016:62
   path cannot be authored at all. The seam was built and reverted twice as
   capability nothing could use.

## Accepted contract corrected rather than implemented

5. **`drainRuntime` is Runtime lifecycle, not a maintenance command.** The
   accepted list of four becomes three. Its seven required properties are
   run-scoped and cannot apply to a process: no durable identity under
   ADR-0017's no-leader invariant, no `event_sequence` to fence on, and an audit
   keyed by `run_id`. The projection moves after `PASS`.

## Absences this slice closed after first calling them prohibitions

6. **The same-origin Studio mount** was recorded as unbuildable and was not.
   `beta1-build-spec.md:29` asks for it and ADR-0014 does not bound how many
   paths `fetch` answers. Built.

## Narrower than the record claimed

7. **`relational-nondisclosure.json` is verified and unconsumed.** Its integrity
   cannot drift from the build, and nothing reads its contents to enforce
   anything. The reconciliation first recorded it as unverified, which was
   reading for a name instead of reading the loop.
8. **The independent producer is a function of its input, not agreed with
   anything.** Mutating an artifact byte moves its digest. Byte parity against a
   second producer is not asserted, because there is no second producer.
9. **The Studio interface is a mechanism, not a product.** `apps/studio` builds
   real assets, the mount serves a shell, and the two are not connected. Owner:
   the packaging fork in `studio-interface.md`.
10. **The Execution Envelope has no store**, so no Execution history lane exists
    and its absence is stated rather than drawn.
11. **Live Query reset history survives about thirty seconds** under a
    CHECK-pinned scope TTL and hard-deleted generations, so there is no reset
    lane either.
12. **The maintenance audit is not globally listable** at acceptable cost;
    `run_id` precedes `requested_at` in its only index.
13. **The audit reason is nullable at the schema.** A null means "written before
    v5", because fabricating audit content to satisfy a constraint is worse than
    a loose constraint.
14. **`questpie explain` is not built**, though ADR-0014, ADR-0019 and
    `implementation-gates.md` all name it. The byte-parity hostile case was
    reframed onto the producers that exist.

## What this count is for

Ten of seventeen acceptance criteria are met, two are partial, and five remain —
all five behind one of the four prohibitions above or the packaging fork. A
manifest asserting seventeen while meeting ten would be the failure this slice
has spent its length avoiding, so the count in `acceptance-reconciliation.md`
and the count here are the two numbers a reviewer should check against each
other first.
