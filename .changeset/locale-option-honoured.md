---
"questpie": patch
---

The `locale` and `localeFallback` options are now honoured. They were declared,
documented, and silently ignored.

Request locale is expressible two ways — on the `CRUDContext`, and as an option
on the call — and only the context spelling worked. Both generators built the
normalized context as `{ ...context, stage: options.stage ?? context.stage }`
and lifted nothing else out of the options, so this returned the context's
locale rather than Slovak:

```ts
await app.globals.siteSettings.get({ locale: "sk" }, ctx);
```

`GlobalGetOptions.locale`, `GlobalUpdateOptions.locale` and the collection
find options all declare the field with the doc comment "Override locale for
this request", and the globals guide shows the call above. The option existed
in the types and in the docs and nowhere in the implementation.

It stayed hidden because nothing breaks over HTTP: `resolveContext` parses the
same query parameters into the context independently, so the REST surface was
always correct. Only the documented server-side call was wrong, and it was
wrong quietly — you got a real translation back, just the wrong one.

Fixed in the collection generator and in both global paths (`get` and
`update`). `normalizeContext` resolves explicit parameter over ALS over default,
so lifting the option there is what makes it win. When the option is absent the
behaviour is unchanged.

Covered by `test/global/locale-option.test.ts`, which asserts the contract
directly: `get({ locale: "sk" }, ctxEn)` must equal `get({}, ctxSk)`, for both
globals and collections.
