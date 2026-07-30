---
"@questpie/admin": patch
---

Remove the last two `@deprecated` aliases in the admin package:
`formatFieldLabel` (an alias for `formatLabel`) and `useBlockDefinition` (an
alias for `useBlockSchema`), plus the unused private
`useSelectedBlockDefinition`. Call sites now use the names the tags pointed at.

Both were one-line pass-throughs, and neither was reachable from
`src/exports/`, so this is internal cleanup with no public API change.

The framework now has **zero internal imports of its own `@deprecated` API**,
down from 166 when the ratchet was introduced. Nine files still declare
something deprecated for external callers; nothing inside the framework depends
on any of it, so each is now free to be deleted on its own schedule rather than
being pinned by internal use.
