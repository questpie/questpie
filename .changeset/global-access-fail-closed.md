---
"questpie": patch
---

A global access rule that returns something other than a boolean now denies
instead of allowing.

`GlobalAccessRule` is typed `boolean | Promise<boolean>`, so this is only
reachable from untyped JavaScript or a cast. The evaluator did
`return result ? { allowed: true } : { allowed: false }`, which meant any truthy
value became an unconditional allow — including an object, which is exactly what
someone writes if they assume globals support the collection-style filtered
access where a rule returns a where clause. A global is a single row with no
where clause to apply, so there is no filtered mode to fall back to; the object
was silently read as "yes".

Collection rules are unaffected: returning an object there is a supported form
and still means `{ allowed: "filtered", where }`.

If you have an untyped global access rule returning a truthy non-boolean and
relying on it granting access, it now denies. Return `true` explicitly.
