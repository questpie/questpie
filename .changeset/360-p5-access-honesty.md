---
"questpie": minor
"@questpie/admin": patch
---

Access honesty (SECURITY): deny-all now means deny-all, with explicit `serve` and `introspect` access kinds.

- **Removed the public-upload read short-circuit.** Upload collections with `visibility: "public"` were world-listable regardless of app-level `defaultAccess` — a deny-all app still exposed `GET /api/assets` to anonymous enumeration. Upload-row reads now resolve through the normal chain (collection `.access()` → `defaultAccess` → session required). Restore the old behavior explicitly with `.access({ read: true })` on the upload collection.
- **New `serve` access kind** for file bytes (`GET /:collection/files/:key`). Chain: `access.serve` → explicit collection `access.read` (row-aware) → `defaultAccess.serve` → allow. `visibility: "public"` keeps files servable by key under deny-all defaults; `"private"` files always require the signed token in addition. The serve route fetches the upload row in system mode as the authorization anchor (orphaned keys still 404).
- **New `introspect` access kind** gating `GET /:collection/{schema,meta}` and globals equivalents through the access system: visible iff at least one CRUD operation is allowed for the current user (401 anonymous / 403 authenticated otherwise), overridable via `access.introspect` / `defaultAccess.introspect`. Create-only public collections keep their validation schema readable; deny-all apps leak nothing. Batch introspection and the admin config endpoint honor the same `visible` computation.
- **`f.upload()` fields populate through the parent row's read decision** (`RelationConfig.inheritAccess`, set automatically for upload relations including `.multiple()` and `through` junctions). A publicly readable row still shows its assets (with `url`) to anonymous readers while the upload collection stays unlistable; field-level read rules on the upload collection still apply inside population. Hand-written `f.relation()` fields keep normal target-collection access. Block prefetch declared-`with` expansion (`@questpie/admin`) inherits the same way for upload fields.

See MIGRATION.md ("3.6.0 — Access honesty") for the full breaking-change notes.
