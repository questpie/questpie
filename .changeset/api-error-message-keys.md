---
"questpie": minor
---

`ApiError.conflict`, `ApiError.notFound`, `ApiError.forbidden` and
`ApiError.internal` now accept an optional `messageKey` and `messageParams`, so
the errors they raise can be localized. Previously only `badRequest` and
`unauthorized` could carry a caller-supplied key.

Before this change a consumer localizing its UI had no way to localize these
four. Two of them were worse than merely untranslated: `conflict` and `internal`
**unconditionally** set the generic keys `error.conflict` and `error.internal`,
so an app with a translator configured did not just fail to translate the
specific message — it discarded it. `ApiError.conflict("Post 42 was modified by
someone else")` reached the client as "Resource conflict". Without a translator
you got untranslated English; with one you got a generic string. Neither is a
localized, specific message.

Conflicts are the most visible class of these — optimistic-concurrency
failures, uniqueness violations, invariant breaches. They are exactly the errors
a user is most likely to see and least able to act on, and they were the ones
with no path to the user's language at all.

The framework had already been routing around the gap. The search routes in
`server/adapters/routes/search.ts` hand-build
`new ApiError({ code: "FORBIDDEN", ..., messageKey: "search.reindexAccessDenied" })`
and `new ApiError({ code: "NOT_FOUND", ..., messageKey: "search.serviceNotConfigured" })`
rather than call the constructors, because the constructors could not carry a
key. Those call sites are left alone here, but they no longer have to be written
that way.

```ts
throw ApiError.conflict(
	`Post ${id} was modified by someone else`,
	"post.conflict.staleVersion",
	{ id },
);
```

Both parameters are **appended** and optional — nothing was reordered and
nothing became required. All 95 existing call sites in `packages/questpie/src`
compile untouched, and so does any consumer code calling these four. When no key
is passed, every constructor produces the same `ApiError` it did before: same
`code`, same `message`, same default `messageKey`, same `messageParams`.

Two details worth knowing:

`forbidden` takes the key as a further parameter rather than as a field on its
`AccessErrorContext`. That context is serialized verbatim into the client-facing
`context.access` payload, so putting translation metadata there would change the
wire shape and ship the key twice. Trailing parameters also match how
`badRequest` and `unauthorized` already read.

The parameters a constructor already derives stay available to your key and can
be overridden: `notFound` always exposes `{{resource}}` and `{{id}}`, and
`forbidden` always exposes `{{reason}}`. So `ApiError.notFound("Post", id,
"post.notFound")` can interpolate `{{id}}` without you passing it again.

No rendering-side change was needed — `toJSON` and `getTranslatedMessage`
already translate through whatever `messageKey` an error carries.
