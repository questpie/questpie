---
"@questpie/admin": minor
"questpie": patch
---

Add the Visual Edit Workspace — an opt-in 2-pane editing experience with a live preview canvas on the left and a contextual inspector on the right.

**Workspace primitives**

- Register `visual-edit-form` view alongside the default `collection-form`. Enable per collection with `.form(({ v }) => v.visualEditForm({...}))`.
- New `VisualEditFormHost`, `VisualEditWorkspace`, `VisualInspectorPanel`, `BlockInspectorBody`, `DocumentInspectorBody`, and `VisualEditProvider` primitives in `@questpie/admin/client`. Reuse the same field components and form state as the legacy form view, so behaviour is consistent across surfaces.
- New shared `useResourceFormController` hook extracts the data, locking, validation, mutation, workflow-stage, and react-hook-form setup that both `FormView` and the workspace use.
- Pure block operations (`addBlockToContent`, `removeBlockFromContent`, `duplicateBlockInContent`, `moveBlockInContent`, `updateBlockValuesInContent`) ensure the inline block tree and the workspace's block inspector apply edits through the same code path.
- The Document inspector body auto-switches to a grouped layout (`DocumentInspectorBody`) when at least one field declares `visualEdit.group`; otherwise it keeps the legacy `AutoFormFields` layout so existing sections/tabs carry into the workspace untouched.

**V2 preview protocol**

- New patch-based protocol (`INIT_SNAPSHOT`, `PATCH_BATCH`, `COMMIT`, `FULL_RESYNC`, `SELECT_TARGET`, `NAVIGATE_PREVIEW`, `PATCH_APPLIED`, `RESYNC_REQUEST`) replaces the previous full-refresh-only protocol while staying backwards compatible with the V1 `PREVIEW_REFRESH` flow.
- `useFormToPreviewPatcher` debounces react-hook-form changes, generates minimal patch ops via the recursive `diffSnapshot` helper (nested objects descend; arrays stay atomic), and routes each op through its field's resolved `visualEdit.patchStrategy` (`"patch"` for scalars, `"refresh"` for relations/uploads/blocks/computed, `"deferred"` to drop).
- `useVisualEditPreviewBridge` translates controller mutation results into the V2 ladder: `INIT_SNAPSHOT` on item load, `COMMIT` on save success (deduped by data reference), `FULL_RESYNC` on delete/restore/revert/transition with a precise `reason` code, `SELECT_TARGET` mirroring the inspector's selection.
- `PreviewPane` buffers the latest `INIT_SNAPSHOT` and replays it on every `PREVIEW_READY` it receives, so an iframe reload (NAVIGATE_PREVIEW or hard refresh) re-seeds without parent-side intervention. A new `onReady` prop fires after the buffered replay so the workspace bridge can re-seed with **current `react-hook-form` values** — preserving unsaved edits across iframe reloads (the patcher would otherwise diff against a stale snapshot).
- `useCollectionPreview` now handles every V2 message on the iframe side: `INIT_SNAPSHOT` seeds the local draft, `PATCH_BATCH` applies ops with stale-seq guarding, `COMMIT` swaps or drops the draft, `FULL_RESYNC` resets state, `SELECT_TARGET` updates focus state. `NAVIGATE_PREVIEW` honors same-origin only and uses `location.replace` so the iframe never traps the user with a back-button stack.

**Per-field tuning**

- Optional `visualEdit` field metadata (`inspector`, `patchStrategy`, `hidden`, `group`, `order`) lets fields tune how they appear in the workspace without disturbing the legacy form view. `visualEdit.inspector` swaps the field's component for a registered override; the override receives `fieldName`, `fieldPath`, `collection`, `fieldDef`, `registry`, and `allCollectionsConfig`, runs inside `FormProvider`, and falls back to `FieldRenderer` when the registry can't resolve the type.
- Server-side `visualEdit` overrides on nested object fields are now honored: a deep `visualEdit.inspector` (e.g. on `meta.seo.title`) wins over a shallower ancestor's override via `resolveNestedVisualEditMeta` walking `metadata.nestedFields`.
- Server-emitted `visualEdit` metadata is read from the correct path (`fieldSchema.metadata.meta.admin.visualEdit`) — earlier iterations had this as `fieldSchema.admin.visualEdit`, which silently never matched introspection output.

**Production hardening**

- Hardened admin ↔ preview iframe communication: dropped wildcard `postMessage` targets, validates `event.origin` against the resolved peer, wraps `postMessage` in defensive `try/catch` so a non-serializable payload (function, class, blob) logs in dev and is swallowed in production.
- New `InspectorErrorBoundary` wraps each inspector body so a misbehaving field component can't unmount the workspace; resets automatically on selection change.
- `Esc` (outside editable elements) clears the active selection.
- `NAVIGATE_PREVIEW` uses `window.location.replace` so the iframe never traps the user with a back-button stack.

**Path / config plumbing**

- Block-field paths now flow through a shared `blockValuePath` helper so nested blocks always resolve to flat `_values` paths regardless of depth.
- `PreviewConfig` accepts `defaultSize` / `minSize` (with `defaultWidth` / `minWidth` aliases) end-to-end.

**Workspace example + DX**

- Barbershop example's `pages` collection wired up end-to-end with `v.visualEditForm` + `visualEdit.group` field metadata.
- New docs page in the Live Preview section walks through enabling the workspace, the selection model, the V2 patch protocol, and the per-field `visualEdit` block. The protocol page is rewritten to faithfully document the wire format that ships, and the architecture / same-tab / shared-preview / migration pages now flag themselves as design notes that point readers at the canonical exports.
- The full visual-edit + V2 surface is now re-exported from `@questpie/admin/client` (`VisualEditFormHost`, `VisualEditWorkspace`, `useFormToPreviewPatcher`, `useVisualEditPreviewBridge`, `BlockInspectorBody`, `DocumentInspectorBody`, `diffSnapshot`, `applyPatchBatch`, `useInitSnapshotBuffer`, every public type, and the V2 message-type union) so consumers can build against documented APIs without reaching into internal paths.

**Test coverage**

- Bun's test runner now boots `happy-dom` + `@testing-library/react` via a preload, unlocking real component tests. The visual-edit module ships with 396+ tests across pure helpers (path utilities incl. degenerate-block-path edge cases, recursive diff incl. both-undefined / object↔primitive / class-instance opacity branches, group fields, click router incl. blockId-hint default fallback + relation-without-collection branches, patch ops incl. empty-path / empty-batch / unknown-op safety + deep-clone immutability, block operations, keyboard predicate, visualEdit meta + nested resolution, strategy map), components (`InspectorErrorBoundary`, `VisualEditProvider`, `VisualInspectorPanel`), hook integrations (`useFormToPreviewPatcher` incl. baseline-reset and null-ref edge cases, `useVisualEditPreviewBridge` incl. iframe-reload re-seed, `useCollectionPreview` covering every V2 message handler from the iframe side, `useDeselectOnEscape`), and the production-hardening primitive `useInitSnapshotBuffer` (extracted from `PreviewPane` for direct testability).
