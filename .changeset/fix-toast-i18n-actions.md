---
"@questpie/admin": patch
"questpie": minor
---

fix(admin): fix broken toast i18n in action execution flow

- Add missing `toast.processing` translation key to all 8 locale files
- Forward server toast message through action dialog instead of showing generic fallback
- Add `t` translation function to `ServerActionContext` for custom action handlers
- Replace hardcoded English strings in user collection handlers with `t()` calls
- Fix hardcoded strings in action-dialog.tsx and execute-action.ts

feat(questpie): remove legacy `/storage/files/:key` alias route

- File URLs now use collection-specific pattern: `/{collection}/files/{key}`
- `buildStorageFileUrl()` accepts `collection` parameter (breaking change for direct callers)
- Upload afterRead hook builds URLs directly instead of going through the storage driver
- Remove `storage.collection` from `AdapterConfig`
- Remove unused `generateFileUrl()` and `StorageUrlConfig`
