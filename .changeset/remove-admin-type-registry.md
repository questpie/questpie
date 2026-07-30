---
"@questpie/admin": patch
---

Remove the `AdminTypeRegistry` module-augmentation point and the four
`Registered*` types derived from it.

The registry was an empty interface that was never exported from
`src/exports/`, so no user code could reach it to augment. Left empty, every
derived type resolved to a constant — `RegisteredCMS` and `RegisteredAdmin` to
`unknown`, `RegisteredCollectionNames` and `RegisteredGlobalNames` to plain
`string` — which made each consumer conditional a dead branch:
`RegisteredCMS extends Questpie<any> ? RegisteredCollectionNames : string` was
always `string`, and `type ResolvedCMS = RegisteredCMS extends Questpie<any> ?
RegisteredCMS : any` was always `any`.

Nothing about hook typing changes, because the conditionals were already
collapsing this way at compile time. What changes is that the code now says so.
Two READMEs documented the augmentation and promised inference it could not
deliver ("data?.docs is typed as Post[]"); they had also drifted onto different
module specifiers, `@questpie/admin/client` in the example app versus
`@questpie/admin/builder` in the package — the usual sign that neither snippet
had ever been run. Both now state the actual typing.

Not a breaking change: the removed names were unreachable from userland.
Inferring collection types from the app remains worth building, on a seam that
is actually public.
