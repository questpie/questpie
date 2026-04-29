---
"questpie": minor
"@questpie/admin": minor
---

Fix save hanging on collections with blocks that use `.prefetch()`, fix custom actions disappearing after `CollectionBuilder.merge()`, and make form-state-dependent admin config (relation `filter`, etc.) actually work end-to-end.

**merge() losing extension keys** — `CollectionBuilder.merge()` constructed its merged state from an explicit key list, silently dropping any keys added via `.set()` (e.g. `admin`, `adminList`, `adminForm`, `adminActions`, `adminPreview`). Custom actions defined on the source builder vanished after merge. Fixed by spreading both states before the explicit overrides.

**Save deadlock with blocks prefetch** — `_executeUpdate` re-fetched updated records inside the open transaction, which triggered field output hooks (blocks `afterRead` → `prefetch()` functions). Those prefetch functions issued inner CRUD calls that inherited the tx connection via AsyncLocalStorage context propagation (`normalizeContext` resolves `db: context.db ?? stored?.db`). Under parallel load, all queries serialized through the single tx connection and Bun SQL deadlocked with the connection stuck `idle in transaction`. Fixed with a `skipOutputHooks` flag on `_executeFind` used for the in-tx refetch — output hooks already re-run after the tx commits.

---

**Reactive admin props** — function-valued admin config (e.g. `f.relation("users").admin({ filter: ({ data }) => ({ team: data.team }) })` or layout `props.filter`) was silently dropped by introspection's `JSON.stringify` / `superjson.stringify`, the field component received `undefined`, and consumers like `relation-select`'s `if (filter) options.where = filter({})` short-circuited — making it look like the filter "worked" while returning every record.

Function values now follow the same pattern as `hidden` / `readOnly` / `compute`: the function stays on the server, introspection emits a small placeholder, and the client resolves the value on demand against current form state.

**Wire-level contract:**

```ts
export type ReactivePropPlaceholder = {
  "~reactive": "prop";
  watch: string[];        // form paths the handler reads
  debounce?: number;
};
```

**Server.** `serializeFormLayoutProps` walks `state.adminForm.fields` (sidebar/tabs/sections too) and `serializeFieldMetaProps` walks every field's `metadata.meta`, replacing function or `{ handler, deps?, debounce? }` values with a `ReactivePropPlaceholder`. Static JSON passes through unchanged. Hooked into `introspectCollection` and `introspectGlobal`.

**Server: `/admin/reactive` `prop` type.** `batchReactiveInputSchema.requests[].type` now accepts `"prop"` with a required `propPath`. The dispatcher resolves the original handler from layout `state.adminForm.fields[*].props[propPath]` first; if not found there, falls back to field-level `state.fieldDefinitions[fieldPath]._state.extensions.admin[propPath]`. So layout-level overrides field-level when both exist.

**Client: `useReactiveProps` hook.** `FieldRenderer` calls a new `useReactiveProps({ entity, entityType, field, props })` hook over the merged `componentProps` — both field-level admin meta and layout-level `extraProps` go through it. The hook:

- Returns static entries synchronously — no network.
- Batches all placeholder entries into one `batchReactive` call.
- Watches the union of `watch` deps via `react-hook-form` `useWatch`; refetches only when a tracked dep changes.
- Debounces using `max(placeholder.debounce)` (default 100ms).
- Caches under TanStack Query key `["questpie", "reactive-props", entityType, entity, field, propKeys, depHash]` with `placeholderData: prev` so consumers don't flicker on dep changes.

**Type augmentation.** `RelationFieldAdminMeta.filter?: ReactivePropValue<Record<string, unknown>>` plus the same option key on every admin meta where it makes sense (object/array/etc.). `FormFieldLayoutItem.props?: Record<string, FormReactivePropValue<TData>>`. Removed dead `FieldLayoutItemWithReactive` from client builder — replaced with `FieldLayoutItemRef` mirroring the server post-serialization wire shape.

**Recommended usage.** Field-level `.admin({ filter })` is the primary location — define once on the field, get the filter wherever the field renders. Layout-level `props.filter` is the per-instance override:

```ts
// Field-level — primary
counselorId: f.relation("users").admin({
  filter: ({ data }) => ({ role: "admin", team: data.team }),
})

// Layout-level — per-instance override (wins over field-level)
.form(({ v, f }) => v.collectionForm({
  fields: [
    f.counselorId,                            // gets field-level filter
    { field: f.counselorId, props: {          // overrides for THIS form
      filter: { role: "super-admin" },
    }},
  ],
}))
```
