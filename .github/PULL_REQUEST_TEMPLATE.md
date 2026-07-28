# What and why

<!-- What changes, and what problem it solves. If there is an issue, link it. -->

## Scope

<!--
One reviewable change per PR. If this touches more than one subsystem, say why it
could not be split — that is a real answer, but it should be a deliberate one.

Mechanical changes (formatting, renames, regenerated codegen) belong in their own
commit at minimum, so the behavioural diff stays readable.
-->

- [ ] One subsystem, or an explanation below of why not
- [ ] Mechanical changes are in separate commits from behavioural ones

## Checks

<!-- Tick what you ran. Do not tick what you did not. -->

- [ ] `bun run lint` — 0 errors
- [ ] `bunx oxfmt --list-different` — empty
- [ ] `bunx turbo run check-types`
- [ ] `bunx turbo run test --filter='./packages/*'`
- [ ] Changeset added (any change to a published package)

If this touches shipped code:

- [ ] `bun run scripts/size-budget.ts`
- [ ] `bun run scripts/type-budget.ts`
- [ ] `bun run scripts/any-census.ts`

## Ratchets

<!--
If you re-baselined any of the gates above, say which and why. Re-baselining is
fine when a change legitimately moves a number; raising a tolerance to make a red
gate green is not.
-->

- [ ] No baseline changed, **or** the change is explained here

## Breaking changes

<!--
Anything a consumer must do differently. Include the before/after. If nothing
breaks, write "none".
-->

## Verification

<!--
How you know it works — the specific test, the measured number, the manual check.
"Tests pass" is weaker than "added a test that fails without this change".
-->
