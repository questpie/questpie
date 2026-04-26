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
- `PreviewPane` buffers the latest `INIT_SNAPSHOT` and replays it on every `PREVIEW_READY` it receives, so an iframe reload (NAVIGATE_PREVIEW or hard refresh) re-seeds without parent-side intervention.

**Per-field tuning**

- Optional `visualEdit` field metadata (`inspector`, `patchStrategy`, `hidden`, `group`, `order`) lets fields tune how they appear in the workspace without disturbing the legacy form view. `visualEdit.inspector` swaps the field's component for a registered override; the override receives `fieldName`, `fieldPath`, `collection`, `fieldDef`, `registry`, and `allCollectionsConfig`, runs inside `FormProvider`, and falls back to `FieldRenderer` when the registry can't resolve the type.

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
- New docs page in the Live Preview section walks through enabling the workspace, the selection model, the V2 patch protocol, and the per-field `visualEdit` block.

**Test coverage**

- Bun's test runner now boots `happy-dom` + `@testing-library/react` via a preload, unlocking real component tests. The visual-edit module ships with 348+ tests across pure helpers (path utilities, recursive diff, group fields, click router, patch ops, block operations, keyboard predicate, visualEdit meta), components (`InspectorErrorBoundary`, `VisualEditProvider`, `VisualInspectorPanel`), and hook integrations (`useFormToPreviewPatcher`, `useVisualEditPreviewBridge`, `useDeselectOnEscape`).
