# Tasks: Visual Edit Workspace

Companion task list for [RFC-VISUAL-EDIT-WORKSPACE.md](./RFC-VISUAL-EDIT-WORKSPACE.md).

## 1. Research / Baseline

- Read `AGENTS.md` and `RFC-VISUAL-EDIT-WORKSPACE.md`.
- Inspect current implementation:
  - `form-view.tsx`
  - `live-preview-mode.tsx`
  - `preview-pane.tsx`
  - `use-collection-preview.ts`
  - `preview-field.tsx`
  - `block-scope-context.tsx`
  - `field-renderer.tsx`
  - `block-fields-renderer.tsx`
  - `block-editor-provider.tsx`
  - `tree-utils.ts`
  - workflow/version hooks.
- Run baseline checks: `bun run check-types`, targeted tests where practical.

## 2. Phase 0: Harden Existing Live Preview

- Fix/support preview config naming mismatch: `defaultWidth`/`defaultSize`, `minWidth`/`minSize`.
- Fix nested block path resolution so `_values` stays flat by block ID.
- Add shared visual edit path utilities.
- Prevent accidental iframe navigation from editable preview targets.
- Tighten V2-ready origin/session handling without breaking current V1 refresh preview.

## 3. Phase 1: Extract Shared Form Controller

- Extract reusable controller logic from `form-view.tsx`.
- Preserve existing form behavior exactly.
- Keep current `LivePreviewMode` working.
- Move autosave toward form-state subscription where needed for inspector-only edits.

## 4. Phase 2: Visual Edit Workspace MVP

- Add `VisualEditWorkspace`.
- Add canvas iframe + right inspector layout.
- Add selection model for:
  - document
  - field
  - block
  - block field
  - relation
  - array/array item
- Add Document panel for non-visual fields, SEO/meta, slug, status/workflow entry points.
- Reuse existing `FieldRenderer` by default.
- Add generalized block field renderer using `${blocksPath}._values.${blockId}.${field}`.

## 5. Phase 3: Patch-Based Preview Runtime

- Extend preview message types with:
  - `INIT_SNAPSHOT`
  - `PATCH_BATCH`
  - `COMMIT`
  - `FULL_RESYNC`
  - `SELECT_TARGET`
  - `NAVIGATE_PREVIEW`
- Keep legacy `PREVIEW_REFRESH`, `FIELD_CLICKED`, `BLOCK_CLICKED`.
- Add local draft store to preview hook.
- Patch simple scalar/object fields instantly.
- Use refresh/reconcile fallback for relations, uploads, block prefetch, slug, computed data.

## 6. Phase 4: Blocks

- Extract reusable block operations from `BlockEditorProvider`.
- Add Blocks panel in inspector.
- Support add, duplicate, remove, reorder.
- Support selected block field editing.
- Ensure nested blocks use correct flat `_values` paths.

## 7. Phase 5: Workflow / Draft / Versions

- Thread active stage through reads/writes where needed.
- Save dirty data before workflow transition.
- Reuse scheduled transition dialog.
- Send `COMMIT` after save.
- Send `FULL_RESYNC` after revert, locale/stage switch, or desync.

## 8. Phase 6: Optional Field Contract

- Add optional `visualEdit` field definition extension.
- Default remains existing component.
- Add optional inspector override and patch strategy.
- Add admin metadata support for document panel grouping.

## 9. Tests

- Unit tests for path utilities and patch application.
- Unit tests for block operations.
- Component tests for inspector rendering existing field components.
- E2E/smoke in barbershop if infra exists or add minimal setup:
  - click hero title
  - inspector opens
  - edit value
  - iframe updates
  - save persists
  - block field path works
  - transition saves dirty data first.

## 10. Docs / Cleanup

- Update live preview docs or add visual edit docs.
- Add changeset if public package behavior/API changes.
- Run `bun run check-types`, targeted tests, and relevant build/lint if practical.
- Commit in coherent milestones.
