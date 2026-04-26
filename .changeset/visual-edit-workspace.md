---
"@questpie/admin": minor
"questpie": patch
---

Add the Visual Edit Workspace — an opt-in 2-pane editing experience with a live preview canvas on the left and a contextual inspector on the right.

- Register `visual-edit-form` view alongside the default `collection-form`. Enable per collection with `c.collection(...).admin().form({ view: "visual-edit-form" })`.
- New `VisualEditFormHost`, `VisualEditWorkspace`, `VisualInspectorPanel`, `BlockInspectorBody`, and `VisualEditProvider` primitives in `@questpie/admin/client`. Reuse the same field components and form state as the legacy form view, so behaviour is consistent across surfaces.
- Patch-based preview protocol (`INIT_SNAPSHOT`, `PATCH_BATCH`, `COMMIT`, `FULL_RESYNC`, `SELECT_TARGET`, `NAVIGATE_PREVIEW`, `PATCH_APPLIED`, `RESYNC_REQUEST`) replaces the previous full-refresh-only protocol while staying backwards compatible with the V1 `PREVIEW_REFRESH` flow.
- New optional `visualEdit` field metadata (`inspector`, `patchStrategy`, `hidden`, `group`, `order`) lets fields tune how they appear in the workspace without disturbing the legacy form view.
- New shared `useResourceFormController` hook extracts the data, locking, validation, and react-hook-form setup that both `FormView` and the workspace use.
- Pure block operations (`addBlockToContent`, `removeBlockFromContent`, `duplicateBlockInContent`, `moveBlockInContent`, `updateBlockValuesInContent`) ensure the inline block tree and the workspace's block inspector apply edits through the same code path.
- Hardened admin <-> preview iframe communication: drop wildcard postMessage targets and validate `event.origin` against the resolved peer.
- Block-field paths now flow through a shared `blockValuePath` helper so nested blocks always resolve to flat `_values` paths regardless of depth.
- Preview pane now respects `defaultSize` / `minSize` (with `defaultWidth` / `minWidth` aliases) on `PreviewConfig`.
