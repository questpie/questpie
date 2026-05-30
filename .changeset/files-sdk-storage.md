---
"questpie": patch
---

Migrate QUESTPIE storage from Flydrive to the direct Files SDK API. Storage is now configured with `runtimeConfig({ storage: { adapter } })`, `app.storage` is the typed `Files` instance, and route, service, job, and hook contexts receive that same direct storage API.

Remove the legacy `app.storage.use`, `storage.files`, `storage.driver`, Flydrive, DriveManager, QUESTPIE storage-disk, and storage-specific `createStorageRoutes()` closure surfaces. Upload CRUD cleanup and storage routes now call Files SDK operations directly, including streaming upload/download behavior and typed adapter access; `createAdapterRoutes()` remains as the broader deprecated compatibility shim.
