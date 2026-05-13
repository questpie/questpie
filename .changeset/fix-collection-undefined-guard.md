---
"@questpie/admin": patch
---

fix(admin): guard collection hooks and relation fields against undefined collection name

- Add `!!collection` checks to `useCollectionList`, `useCollectionCount`, `useCollectionItem`, and `useCollectionVersions` to prevent Proxy-based client from converting `undefined` to string `"undefined"` and hitting `/api/undefined`
- Apply same guards in `createTypedHooks` factory variants
- Add `!!targetCollection` guards to `RelationSelect` and `RelationPicker` query enabled flags and loadOptions callbacks
