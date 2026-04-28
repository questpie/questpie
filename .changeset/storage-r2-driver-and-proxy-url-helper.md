---
"questpie": minor
---

Add `questpie/storage` entry: `R2Driver` wrapper, `makeProxyUrlBuilder` helper, and re-exports of flydrive's `S3Driver` / `FSDriver` / `GCSDriver`.

**`questpie/storage` — new public entry:**

- **`R2Driver(options)`** — wraps flydrive's `S3Driver` with Cloudflare R2 conventions (`region: "auto"`, `forcePathStyle: true`, `supportsACL: false`) and defaults `urlBuilder` to the QUESTPIE storage proxy. Fixes a long-standing footgun where `new S3Driver({...})` against R2 produced asset URLs pointing at the unsigned S3 endpoint and returned HTTP 400 even with bucket public access on. Optional `publicUrl` opt-out: when set, `generateURL` returns `${publicUrl}/${key}` (CDN / r2.dev / custom domain). Signed URLs always go through the proxy regardless, so visibility-aware access control stays in effect.

- **`makeProxyUrlBuilder(config, { publicUrl? })`** — utility for plugging the QUESTPIE storage proxy into any flydrive driver's `urlBuilder`. Use it with `S3Driver`/`GCSDriver`/`FSDriver` for the same proxy-by-default behaviour. The single source of truth — `createDiskDriver` (default FS) now uses it too.

- **Re-exports** — `S3Driver`, `FSDriver`, `GCSDriver` and their option types are re-exported from `questpie/storage` so a single import is enough to wire any supported backend. Plus `buildStorageFileUrl`, `generateSignedUrlToken`, `verifySignedUrlToken` for users serving files from custom routes.

**`StorageDriverConfig.driver` accepts a factory:**

`storage.driver` now accepts either a `DriverContract` (existing behaviour, unchanged) or a `(config: QuestpieConfig) => DriverContract` factory. The factory form gives the closure access to the resolved `app.url`, `secret`, `storage.basePath`, and `storage.signedUrlExpiration` — that's what makes `R2Driver` and `makeProxyUrlBuilder` work without piping these values into the driver options manually.

```ts
import { R2Driver } from "questpie/storage";

runtimeConfig({
  storage: {
    driver: R2Driver({
      bucket: process.env.R2_BUCKET!,
      endpoint: process.env.R2_ENDPOINT!,
      credentials: { accessKeyId: ..., secretAccessKey: ... },
      visibility: "public",
      publicUrl: process.env.R2_PUBLIC_URL, // optional CDN domain
    }),
  },
});
```

Existing apps importing raw flydrive drivers keep working — wrappers and helpers are purely additive.

**Docs:**

- New page [Storage Flow](/docs/production/storage-flow) — visibility model, proxy lifecycle, signed-token format, `asset.url` computation, perf trade-offs.
- [Storage](/docs/production/storage) updated with R2/S3/GCS recipes plus a copy-pasteable migration diff for users coming from raw flydrive imports.
