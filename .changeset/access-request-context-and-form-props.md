---
"questpie": minor
"@questpie/admin": minor
---

Access functions receive `request`, no-op field writes are allowed, global forms auto-expand M:N, and form layout gains a `props` escape hatch.

**`questpie` — access control:**

- `AccessContext` now carries `request?: Request`. The HTTP adapter pipes the incoming `Request` through `app.createContext` into both collection and global CRUD evaluation, so collection/global `.access()` rules can branch on URL or headers (e.g. distinguish admin panel calls at `/admin/api/...` from public frontend calls at `/api/...`). Bound automatically — opt-in by destructuring `request` in your access function:

  ```ts
  read: ({ session, request }) => {
    const fromAdmin = request?.url.includes("/admin/api/");
    if (fromAdmin && isAdmin(session?.user)) return true;
    return { createdById: session?.user?.id };
  }
  ```

- `validateFieldsWriteAccess` now skips fields whose value is unchanged on update. Forms (especially the admin's auto-generated form) re-submit `readOnly` fields with their original value; previously every save failed with `Cannot write field 'X': access denied` even though nothing changed. The check runs only when `existingRow` is available and uses `Object.is` for identity comparison.

**`@questpie/admin`:**

- `GlobalFormView` now auto-detects M:N relations via `detectManyToManyRelations` (parity with `CollectionFormView`) and requests them via `useGlobal(name, { with: ... })`. Upload-through and `relation().multiple()` fields on globals are now visible in the form instead of silently empty. Loaded relation arrays of objects are normalized to arrays of ids before the form resets, matching collection-form behavior.

- `FormFieldLayoutItem` (server augmentation) and `FieldLayoutItemWithReactive` (client builder) gain `props?: Record<string, any>` — an escape hatch for component-specific configuration that doesn't have a dedicated layout key. Forwarded as extra props to the field component via the new `extraProps` slot on `FieldRenderer`. Use it for things like the relation field's `filter`:

  ```ts
  { field: f.counselorId, props: { filter: () => ({ role: "admin" }) } }
  ```

No breaking changes: existing access functions ignore the new `request` field; layout items without `props` behave exactly as before.
