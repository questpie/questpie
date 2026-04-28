---
"questpie": minor
"@questpie/admin": minor
---

Make layout-level escape-hatch `props` actually work end-to-end — including function values that depend on form state.

## What was broken

`FormFieldLayoutItem.props` (`v.collectionForm({ fields: [{ field: f.author, props: { filter: () => ({ ... }) } }] })`) silently produced wrong behaviour: introspection ran `JSON.stringify` / `superjson.stringify` over the function value, the function was either dropped or replaced with a placeholder, and the field component received `undefined` for that prop. Relation `filter`s in particular looked like they "filtered" but actually returned every record because the consumer's `if (filter) options.where = filter({})` short-circuited.

There was also a mirror dead type `FieldLayoutItemWithReactive` in `packages/admin/src/client/builder/types/field-types.ts` that nothing outside its own file consumed.

## What this changes

Function-valued layout props now follow the same pattern as `hidden` / `readOnly` / `compute`: the function stays on the server, introspection emits a small placeholder, and the client resolves the value on demand against current form state.

**Wire-level contract (new):**

```ts
// in @questpie/server (re-exported from `questpie`)
export type ReactivePropPlaceholder = {
  "~reactive": "prop";
  watch: string[];        // form paths the handler reads
  debounce?: number;
};
```

**Server: introspection serialization.** `serializeFormLayoutProps` walks `state.adminForm.fields` (and `sidebar`, `tabs`, `sections`) and replaces each function or `{ handler, deps?, debounce? }` value inside `item.props` with a `ReactivePropPlaceholder`. Plain JSON values pass through unchanged. Hooked into `introspectCollection` and `introspectGlobal`.

**Server: `/admin/reactive` `prop` type.** `batchReactiveInputSchema.requests[].type` now accepts `"prop"` with a required `propPath`. The dispatcher resolves the original handler from `state.adminForm.fields[*].props[propPath]` on the live server state and runs it with the same `ReactiveContext` shape (`{ data, sibling, prev, ctx }`) used for `compute` / `hidden`.

**Client: `useReactiveProps` hook.** `FieldRenderer` calls a new `useReactiveProps({ entity, entityType, field, props })` hook before spreading `extraProps` into the field component. The hook:

- Returns static entries synchronously — **no network**.
- Batches all placeholder entries into one `batchReactive` call (single round-trip per field, not one per prop).
- Watches the union of `watch` deps via `react-hook-form` `useWatch`; refetches only when a tracked dep changes.
- Debounces using `max(placeholder.debounce)` (default 100ms).
- Caches under TanStack Query key `["questpie", "reactive-props", entityType, entity, field, propKeys, depHash]` with `placeholderData: prev` so consumers see the previous value during refetches instead of a flicker.

**Client: relation-select / relation-picker.** `filter` is now consumed as the resolved value (`Record<string, unknown> | (legacy fn)`). The legacy callable shape still works for any custom field renderer that hasn't migrated.

**Type tightening.**

- `FormFieldLayoutItem.props?: Record<string, FormReactivePropValue<TData>>` (was `Record<string, any>`). `FormReactivePropValue` accepts JSON, a handler `(ctx) => T`, or a `{ handler, deps?, debounce? }` config — same shape as the existing `FormReactiveConfig` for `hidden` / `compute`, so the dev experience is consistent.
- Removed dead `FieldLayoutItemWithReactive` from `packages/admin/src/client/builder/types/field-types.ts`. Its replacement `FieldLayoutItemRef` mirrors the server `FormFieldLayoutItem` post-serialization shape (`props?: Record<string, unknown>`) so the client only ever sees the wire shape.

## Migration

Existing callers that already used static JSON for `props.<key>` are unaffected.

Existing callers that used a function (the silently-broken case the bug surfaced) now actually work — no code changes required, just a re-deploy. If you want explicit dependency control or debouncing, swap to the `{ handler, deps?, debounce? }` form:

```ts
// Before — silently received undefined on the client
{ field: f.author, props: { filter: ({ data }) => ({ team: data.team }) } }

// After — works as written, deps inferred via Proxy tracking, default 100ms debounce
{ field: f.author, props: { filter: ({ data }) => ({ team: data.team }) } }

// Or, explicit:
{
  field: f.author,
  props: {
    filter: {
      handler: ({ data }) => ({ team: data.team }),
      deps: ["team"],
      debounce: 200,
    },
  },
}
```
