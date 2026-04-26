# RFC: Visual Edit Workspace

**Status:** Draft
**Authors:** @drepkovsky, OpenCode
**Date:** 2026-04-25

## Summary

Add a Visual Edit Workspace to QUESTPIE admin: an admin-shell editing mode with the frontend page as the primary canvas and a smart inspector sidebar for the selected field, block, relation, array item, or document-level settings.

The iframe model stays. The full form view does not become the primary UI in this mode. Instead, the workspace reuses the same form state, schema introspection, field registry, validation, locks, autosave, history, versioning, and workflow transition plumbing that the current form view already uses.

Current live preview:
Admin form + iframe preview + save/autosave refresh

Proposed visual edit:
Iframe canvas + inspector sidebar + hidden shared form state + patch-based preview updates

This is not a second field system. Existing custom fields continue to work through the existing admin field renderer contract. Field authors may optionally provide visual-edit-specific behavior when the default inspector rendering is not good enough.

## Goals

- Keep the current iframe preview security and draft-cookie model.
- Make visual editing feel fast by applying local preview patches before persistence.
- Support real CMS data shapes: title, slug, SEO/meta fields, object fields, arrays, relations, uploads, rich text, blocks, nested blocks, localized fields, reactive fields, locks, history, versioning, and workflow transitions.
- Reuse the existing registry-first admin architecture and field components.
- Let module/custom-field authors opt into better visual edit behavior without requiring a new renderer for every field.
- Provide a migration path from current `LivePreviewMode` and `useCollectionPreview` instead of replacing everything at once.

## Non-Goals

- No public-page standalone editor as the first implementation.
- No stega/source-map system in MVP.
- No contenteditable editing directly inside the iframe in MVP.
- No separate persisted draft database model beyond existing versioning/workflow support.
- No hardcoded field, block, component, or view names in runtime logic.

## Codebase Survey

### Current Preview Shell

Relevant files:

| File | Current responsibility |
|------|------------------------|
| `packages/admin/src/client/views/collection/form-view.tsx` | Owns collection form state, schema loading, autosave, locks, history, workflow transition UI, and wraps the form in `LivePreviewMode`. |
| `packages/admin/src/client/components/preview/live-preview-mode.tsx` | Fullscreen split-screen shell. Left side is the full form, right side is `PreviewPane`. Also maps iframe clicks to `FocusContext`. |
| `packages/admin/src/client/components/preview/preview-pane.tsx` | Iframe, preview token minting, `PREVIEW_REFRESH`, `FOCUS_FIELD`, `SELECT_BLOCK`, and preview-to-admin click messages. |
| `packages/admin/src/client/preview/use-collection-preview.ts` | Frontend hook. Detects iframe, sends `PREVIEW_READY`, handles `PREVIEW_REFRESH`, tracks selected block and focused field. |
| `packages/admin/src/client/preview/preview-field.tsx` | Frontend wrapper for clickable and highlightable fields. |
| `packages/admin/src/client/preview/block-scope-context.tsx` | Resolves block field paths for `PreviewField`. |
| `packages/admin/src/client/contexts/focus-context.tsx` | Admin-side focus state machine for regular fields, block fields, and relation fields. |

Important observations:

- `form-view.tsx` already has most of the needed controller logic: `useForm`, autosave, lock acquisition, reactive fields, locale switching, preview URL RPC, history sidebar, revert version, workflow stage badge, and transition dialog.
- `LivePreviewMode` currently renders the full form and preview iframe side-by-side. Visual edit should reuse its transport ideas but replace the left form pane with an inspector.
- `PreviewPane` already validates incoming origins on the admin side, but outgoing fallback can still use `"*"` if URL parsing fails. The preview side currently posts to `"*"` and has a TODO-style origin validation gap.
- Current preview is refresh-driven. `useCollectionPreview` returns `initialData` and calls `onRefresh` when receiving `PREVIEW_REFRESH`; it does not maintain an optimistic draft store.
- Current click/focus messages are unversioned and minimal. Existing Preview V2 docs already describe sequence numbers, session IDs, and patch batches; this RFC should align with that direction.

### Field Rendering Contract

Relevant files:

| File | Current responsibility |
|------|------------------------|
| `packages/admin/src/client/builder/field/field.ts` | Defines `FieldDefinition` and `FieldInstance`: name, component, optional cell, plus introspection options. |
| `packages/admin/src/client/views/collection/field-renderer.tsx` | Shared field renderer used by forms. Builds `FieldContext`, resolves lazy components, applies dynamic options and hooks. |
| `packages/admin/src/client/views/collection/field-context.ts` | Converts a field instance plus form state into component props. |
| `packages/admin/src/client/utils/build-field-definitions-from-schema.ts` | Maps server introspection metadata to admin field instances. Handles relation, upload, object, array, blocks, rich text metadata. |
| `packages/admin/src/client/components/fields/*` | Built-in field components. Most use react-hook-form `Controller` or `useFormContext`. |

Important observations:

- The admin field system is already registry-first. This is the main reuse point.
- `FieldRenderer` can render one field by path, which is exactly what the inspector needs.
- `object`, `array`, and `blocks` already have specialized components. The inspector should not duplicate them for MVP.
- Custom fields only need a `component` today. Visual edit should keep this as the default fallback.
- A small optional `visualEdit` extension on `FieldDefinition` is enough for advanced custom fields.

### Blocks

Relevant files:

| File | Current responsibility |
|------|------------------------|
| `packages/admin/src/client/components/fields/blocks-field/blocks-field.tsx` | Form field for block content. Wraps `BlockEditorProvider` and `BlockEditorLayout`. |
| `packages/admin/src/client/components/blocks/block-editor-provider.tsx` | Zustand-backed block editor state and actions: add, remove, duplicate, move, update values. |
| `packages/admin/src/client/components/blocks/utils/tree-utils.ts` | Pure helpers for tree insert/remove/reorder/duplicate/default values. |
| `packages/admin/src/client/components/blocks/block-fields-renderer.tsx` | Converts block field metadata to field instances and renders block fields with scoped names. |
| `packages/admin/src/client/blocks/block-renderer.tsx` | Frontend renderer for block trees. Wraps each block in `BlockScopeProvider`, optionally makes blocks clickable. |

Important observations:

- Block mutations already exist as pure tree/value transformations. Visual edit can reuse these for sidebar block operations.
- `BlockFieldsRenderer` currently hardcodes scoped block field names as `content._values.${blockId}.${name}`. Visual edit should generalize this to use the actual blocks field path instead of assuming `content`.
- `BlockScopeProvider` appends nested block IDs to the parent scope. For current `BlockContent`, this is wrong for nested blocks because values are stored flat by block ID. Nested blocks should still resolve to `${blocksFieldPath}._values.${blockId}.${field}`. The tree stores hierarchy; `_values` does not.
- `BlockRenderer` supports block click selection, but field-level selection depends on block renderers using `PreviewField`.

### Workflow, Versioning, Drafts, and Locks

Relevant files:

| File | Current responsibility |
|------|------------------------|
| `packages/admin/src/client/views/collection/form-view.tsx` | Reads workflow config from schema, queries latest version stage, renders stage badge, transition menu, history, revert, and scheduled transition dialog. |
| `packages/admin/src/client/hooks/use-transition-stage.ts` | Calls collection/global transition endpoints, supports `scheduledAt`, invalidates queries. |
| `packages/admin/src/client/hooks/use-collection.ts` | Collection CRUD hooks. Update/create currently use locale from query options but do not expose stage control in the hook API. |
| `packages/questpie/src/client/index.ts` | Client SDK supports `locale`, `localeFallback`, and `stage` options for collection reads/writes. |
| `packages/questpie/src/server/collection/crud/crud-generator.ts` | Workflow stage read/write behavior, transition validation, version snapshots. |
| `packages/questpie/src/server/adapters/routes/collections.ts` | Transition route accepts `stage` and optional `scheduledAt`. |
| `packages/admin/src/client/hooks/use-locks.ts` | Document lock acquisition, refresh, blocking state. |

Important observations:

- Workflow transitions are version snapshots, not arbitrary data mutation. `transitionStage` validates access and allowed transitions, then creates a version at the target stage.
- Dirty visual edit data must be saved before transition, otherwise transition hooks inspect stale persisted data.
- The core client already supports `stage` options. The admin hooks need a write-stage/read-stage bridge for visual edit and workflow-aware preview.
- Existing locks should apply unchanged. If another user owns the lock, the canvas can remain navigable but inspector edits and save/transition actions must be disabled.

## Proposed Architecture

### High-Level Shape

```
+--------------------------------------------------------------+
| Admin Shell                                                   |
| Header: title, locale, save state, stage, actions, close       |
|                                                              |
| +--------------------------------------+ +-----------------+ |
| | Preview iframe canvas                | | Inspector       | |
| |                                      | |                 | |
| | Frontend route in draft mode         | | Selected field  | |
| | PreviewField / PreviewBlock targets  | | Document fields | |
| | Local patch store                    | | Blocks list     | |
| |                                      | | Workflow        | |
| +--------------------------------------+ +-----------------+ |
|                                                              |
| Hidden shared controller: react-hook-form, schema, validation |
+--------------------------------------------------------------+
```

New primary components:

| Component | Purpose |
|-----------|---------|
| `VisualEditWorkspace` | Fullscreen admin-shell workspace replacing the split form pane with canvas plus inspector. |
| `VisualEditProvider` | Selection state, preview session state, patch dispatch, stage/locale context. |
| `VisualInspectorPanel` | Renders the selected target editor, document panel, blocks panel, workflow/history actions. |
| `VisualTargetRenderer` | Renders one selected field/block/relation/array item by reusing existing field/block renderers. |
| `useVisualEditController` | Extracted controller from `FormView`: form state, mutations, autosave, locks, reactive fields, locale, history, workflow. |
| `useVisualPreviewSession` | Admin-side preview transport and patch batching. |
| `useCollectionPreviewDraft` | Frontend-side replacement/evolution of `useCollectionPreview`, with a local draft store and patch application. |

### Controller Extraction

`form-view.tsx` has become the owner of many unrelated concerns. Visual edit should first extract the shared resource controller:

```ts
type ResourceFormController = {
  collection: string;
  id: string;
  mode: "collection" | "global";
  form: UseFormReturn<any>;
  schema: CollectionSchema | GlobalSchema;
  fields: Record<string, FieldInstance>;
  item: Record<string, unknown> | null;
  transformedItem: Record<string, unknown> | null;
  contentLocale: string;
  setContentLocale: (locale: string) => void;
  previewUrl: string | null;
  autoSave: AutoSaveController;
  lock: LockController;
  workflow: WorkflowController | null;
  history: HistoryController;
  actions: ActionController;
  save: (options?: SaveOptions) => Promise<Record<string, unknown>>;
  refreshPreview: (reason?: string) => void;
};
```

The regular form view and Visual Edit Workspace should both consume this controller. That keeps behavior aligned and prevents a second save/validation/workflow implementation.

### Selection Model

The iframe never sends arbitrary UI commands. It sends a canonical target. The admin resolves that target against schema, field metadata, block metadata, access state, and form state.

```ts
type VisualEditTarget =
  | { type: "document" }
  | {
      type: "field";
      path: string;
      locale?: string;
      source: "canvas" | "document" | "inspector";
    }
  | {
      type: "array";
      path: string;
      locale?: string;
    }
  | {
      type: "arrayItem";
      path: string;
      index: number;
      itemPath: string;
      locale?: string;
    }
  | {
      type: "block";
      blocksPath: string;
      blockId: string;
      blockType: string;
      locale?: string;
    }
  | {
      type: "blockField";
      blocksPath: string;
      blockId: string;
      blockType: string;
      fieldPath: string;
      fullPath: string;
      locale?: string;
    }
  | {
      type: "relation";
      path: string;
      targetCollection: string;
      targetId?: string;
      mode: "select" | "quickEdit" | "open";
      locale?: string;
    };
```

#### Canonical Paths

Canonical paths use react-hook-form dot notation.

| Target | Canonical path |
|--------|----------------|
| Root field | `title` |
| Object child | `seo.metaTitle` |
| Array item | `highlights.2.label` |
| Blocks field | `content` |
| Block values | `content._values.blockId` |
| Block field | `content._values.blockId.heading` |
| Nested block field | `content._values.childBlockId.heading` |

Nested blocks must not produce `content._values.parentBlockId.childBlockId.heading`. The block tree encodes nesting; values stay flat by block ID.

### Inspector Modes

| Mode | Trigger | Contents |
|------|---------|----------|
| Empty | No selection | Click hint, document summary, quick actions. |
| Field | Canvas field click or document field selection | One field editor, label, description, validation errors, dirty/revert controls. |
| Object | Object field selected | Grouped child editors or selected child editor. |
| Array | Array field selected | Add/remove/reorder list, selected item editor. |
| Block | Block wrapper click | Block title/type, actions, block field list, children controls. |
| Block field | Field inside block click | One block field editor using scoped path. |
| Relation | Relation field/card click | Relation picker by default, quick edit/open related record as explicit actions. |
| Document | Sidebar tab | Title, slug, SEO/meta, publish/status, visibility, non-visual fields. |
| Blocks list | Sidebar tab or blocks field selection | Add/reorder/delete/duplicate blocks. |
| Workflow | Header/sidebar | Current stage, allowed transitions, scheduled transition dialog. |
| History | Header/sidebar | Existing audit/version sidebar reused. |

The canvas should never be the only way to edit content. Non-visual fields such as SEO, slug, publish flags, internal settings, hidden fields, and computed read-only fields must be accessible from the Document panel.

### Field Type Support Matrix

| Field type | Canvas target | Inspector rendering | Patch behavior | Refresh/reconcile behavior |
|------------|---------------|---------------------|----------------|----------------------------|
| `text`, `email`, `url` | Yes when rendered | Existing field component, inspector variant optional | Debounced `PATCH_BATCH` | No refresh by default |
| `textarea` | Yes when rendered | Existing textarea | Debounced patch | No refresh by default |
| `number` | Yes when rendered | Existing number input | Immediate/debounced patch | No refresh by default |
| `boolean` | Usually document/sidebar | Existing switch | Immediate patch | No refresh by default |
| `date`, `datetime`, `time` | Usually document/sidebar | Existing date/time field | Immediate patch | No refresh by default |
| `select` | Yes when rendered | Existing select | Immediate patch | Reconcile if options/deps are reactive |
| `relation` | Yes for cards/links | Relation picker plus quick edit/open | Patch if value shape is enough | Reconcile or refresh when resolved relation data changes |
| `upload` | Yes for images/media | Existing media/upload picker | Patch after asset result | Reconcile or refresh if renderer needs expanded asset |
| `richText` | Yes when rendered | Existing rich text field | Debounced patch | Fallback refresh if renderer cannot consume raw doc |
| `object` | By child targets | Object field or child field renderer | Child path patch | Reconcile if reactive child affects layout |
| `array` | By field or item | Existing array/object-array components | Item path or whole-array patch | Reconcile for relation/upload item data |
| `json` | No by default | JSON editor fallback | Manual patch/save | Refresh on save by default |
| `blocks` | Yes | Blocks panel and selected block inspector | Block content patch | Reconcile for prefetch, relations, upload expansion |
| `from`/computed | No by default | Read-only/source field | No direct patch | Server reactive compute or full refresh |

### Title, Slug, and Meta Tags

| Field | Behavior |
|-------|----------|
| Title field | If rendered in canvas, click opens the title field inspector. Also always available in Document panel. |
| Slug | Document panel. Changing slug marks preview URL stale and triggers server URL recomputation plus iframe navigation. |
| Meta title | SEO section in Document panel. May patch local preview if frontend renders it visibly, otherwise no canvas target. |
| Meta description | SEO section in Document panel. Same behavior as meta title. |
| Publish/status/stage | Workflow panel/header. Not a canvas target. |
| Hidden fields | Hidden from default panels unless explicitly shown in advanced/admin-only section. |
| Reactive read-only/disabled fields | Must reuse `useReactiveFields` results and existing field options. |

### Reusing Existing Field Renderers

#### Default Path

The default inspector renderer should reuse `FieldRenderer` for regular fields and a generalized block field renderer for block fields.

```tsx
<FormProvider {...controller.form}>
  <FieldRenderer
    fieldName="title"
    fieldDef={controller.fields.title}
    collection={controller.collection}
    className="qa-visual-inspector-field"
  />
</FormProvider>
```

For block fields:

```tsx
<VisualBlockFieldRenderer
  blocksPath="content"
  blockId="abc123"
  fieldName="heading"
  blockSchema={blockSchema}
/>
```

This renderer should be a small refactor of `BlockFieldsRenderer`, replacing the hardcoded `content._values` prefix with `blocksPath._values`.

#### Optional Field Contract Extension

Field authors should not need to create new renderers for visual edit. The existing component remains the fallback.

Add optional visual edit metadata to the client field definition:

```ts
export interface FieldDefinition<TName extends string = string> {
  readonly name: TName;
  readonly component: MaybeLazyComponent<FieldComponentProps>;
  readonly cell?: MaybeLazyComponent;
  readonly visualEdit?: VisualFieldDefinition;
}

export type VisualFieldDefinition = {
  inspector?: MaybeLazyComponent<VisualFieldInspectorProps>;
  inlinePreview?: MaybeLazyComponent<VisualInlinePreviewProps>;
  capabilities?: VisualFieldCapabilities;
  patchStrategy?: VisualPatchStrategy | ((ctx: VisualPatchContext) => VisualPatchStrategy);
};

export type VisualFieldCapabilities = {
  canvasSelectable?: boolean;
  documentPanel?: boolean;
  supportsLocalPatch?: boolean;
  requiresReconcile?: boolean;
  relationQuickEdit?: boolean;
};

export type VisualPatchStrategy = "local" | "reconcile" | "refresh" | "manual";
```

Inspector props should extend the existing field props instead of replacing them:

```ts
export interface VisualFieldInspectorProps<TValue = unknown>
  extends FieldComponentProps<TValue> {
  target: VisualEditTarget;
  fieldSchema: FieldSchema;
  variant: "inspector";
  patch: (value: TValue, options?: VisualPatchOptions) => void;
  refresh: (reason: string) => void;
}
```

Existing field components can safely ignore `variant`, `target`, `patch`, and `refresh` because they are optional/additive props. Custom fields only implement `visualEdit.inspector` if their normal form component is too large or not useful in a narrow inspector.

#### Server Admin Metadata Extension

Add optional server-side admin metadata for field placement and behavior:

```ts
f.text().admin({
  visualEdit: {
    panel: "document",
    group: "seo",
    label: "Meta title",
    canvasSelectable: false,
    patchStrategy: "local",
  },
});
```

This metadata is advisory. The field registry still decides how to render field types.

### Preview Protocol

The current protocol should evolve from minimal messages to a versioned session protocol. Existing messages remain supported for compatibility.

#### Envelope

```ts
type VisualPreviewEnvelope<TType extends string, TPayload> = {
  type: TType;
  protocolVersion: 2;
  sessionId: string;
  seq: number;
  timestamp: number;
  payload: TPayload;
};
```

#### Admin to Frame

| Message | Purpose |
|---------|---------|
| `INIT_SNAPSHOT` | Send full form snapshot when frame becomes ready. |
| `PATCH_BATCH` | Apply local draft patches in the iframe. |
| `SELECT_TARGET` | Highlight selected field/block/relation target. |
| `FOCUS_TARGET` | Scroll selected target into view. |
| `COMMIT` | Replace baseline after successful save. |
| `FULL_RESYNC` | Replace iframe draft after desync/revert/locale/stage change. |
| `NAVIGATE_PREVIEW` | Navigate iframe after slug/URL/locale/stage recomputation. |
| `ERROR` | Surface validation/save/reconcile error to preview runtime. |

#### Frame to Admin

| Message | Purpose |
|---------|---------|
| `READY` | Frame runtime loaded and ready. |
| `ACK` | Acknowledge sequencing for reliable patch delivery. |
| `TARGET_CLICKED` | Canonical selection target clicked in iframe. |
| `FIELD_CLICKED` | Legacy field click compatibility. |
| `BLOCK_CLICKED` | Legacy block click compatibility. |
| `NAVIGATION_ATTEMPT` | User clicked a link/form navigation in preview. Admin decides allow/block. |
| `RENDER_ERROR` | Preview runtime failed to apply patch or render. |

#### Patch Shape

Use dot paths initially. JSON Patch can be added later if needed.

```ts
type VisualPatch = {
  op: "set" | "unset" | "insert" | "remove" | "move";
  path: string;
  value?: unknown;
  from?: string;
  meta?: {
    fieldType?: string;
    reason?: string;
    locale?: string;
  };
};
```

Examples:

```ts
{ op: "set", path: "title", value: "New title" }
{ op: "set", path: "seo.metaTitle", value: "About us" }
{ op: "set", path: "content._values.hero123.heading", value: "Book today" }
{ op: "move", path: "content._tree", from: "2", value: { to: 0 } }
```

#### Origin and Session Requirements

- Admin sends to the explicit preview origin only.
- Preview validates `event.origin` against the admin origin derived from `document.referrer` or an injected session parameter.
- No `postMessage(..., "*")` in the V2 path.
- Every message carries `sessionId` and `protocolVersion`.
- Frame discards stale session messages.
- Admin falls back to current refresh protocol for V1 preview pages.

### Preview Runtime

`useCollectionPreview` should evolve into a draft-aware hook while keeping the current API compatible.

```ts
type UseCollectionPreviewDraftOptions<TData> = {
  initialData: TData;
  onRefresh?: () => void | Promise<void>;
  onNavigate?: (url: string) => void;
  session?: {
    allowedAdminOrigin?: string;
  };
};

type UseCollectionPreviewDraftResult<TData> = {
  data: TData;
  baseline: TData;
  isPreviewMode: boolean;
  selectedTarget: VisualEditTarget | null;
  focusedTarget: VisualEditTarget | null;
  sendTargetClicked: (target: VisualEditTarget) => void;
  handleFieldClick: UseCollectionPreviewResult<TData>["handleFieldClick"];
  handleBlockClick: UseCollectionPreviewResult<TData>["handleBlockClick"];
};
```

Behavior:

- `INIT_SNAPSHOT` replaces `baseline` and `data`.
- `PATCH_BATCH` applies patches to `data` only.
- `COMMIT` replaces `baseline` and `data` with server result.
- `FULL_RESYNC` replaces everything and clears local patch queue.
- `PREVIEW_REFRESH` remains supported and calls `onRefresh`.

`PreviewField` should gain a `target` prop but keep `field` for existing code:

```tsx
<PreviewField field="title">{data.title}</PreviewField>

<PreviewField
  target={{ type: "field", path: "seo.metaTitle", source: "canvas" }}
>
  {data.seo.metaTitle}
</PreviewField>
```

Add `PreviewBlock` only if block-level wrappers need better semantics than the current `BlockRenderer` wrapper:

```tsx
<PreviewBlock blocksPath="content" blockId={id} blockType="hero">
  <HeroBlock />
</PreviewBlock>
```

### Draft, Versioning, and Workflow Semantics

QUESTPIE has two different concepts that must not be conflated:

| Concept | Meaning |
|---------|---------|
| Local visual draft | Unsaved form state plus preview patches in the current browser session. |
| Workflow/version draft | Persisted version snapshot at a workflow stage such as draft, review, or published. |

#### Read Stage

The preview iframe must know which stage it is reading.

Default behavior:

- If workflow is disabled, read the normal record.
- If workflow is enabled, read `currentStage` from the latest version query.
- If the workspace is opened specifically for drafting, read the workflow initial stage.
- If the user switches stage from a stage selector, perform `FULL_RESYNC` and recompute preview URL.

The existing core client already accepts `stage` in `LocaleOptions`. Visual edit should thread this through preview loaders and admin hooks.

#### Write Stage

Manual save/autosave should write to the active edit stage.

```ts
await client.collections.pages.update(
  { id, data },
  { locale, stage: activeWriteStage },
);
```

Admin hooks need an additive option:

```ts
useCollectionUpdate(collection, {
  questpieOptions: { stage: activeWriteStage },
});
```

or the shared controller should bypass the existing hook and call the client directly until hooks support stage options.

#### Transition Flow

Before any transition:

1. If form is dirty, save current form data to the active write stage.
2. Wait for save success and `COMMIT` the iframe baseline.
3. Call `transitionStage({ id, stage, scheduledAt })`.
4. Invalidate versions/audit/current item queries.
5. Send `FULL_RESYNC` or `NAVIGATE_PREVIEW` if stage affects the frontend route.

This is necessary because `beforeTransition` hooks receive persisted data. Transitioning without saving first would publish or review stale content.

#### Scheduled Transitions

Scheduled transitions reuse the existing dialog and `useTransitionStage` support for `scheduledAt`. If dirty content exists, Visual Edit must save first, then schedule. The scheduled job should transition the saved version, not transient local patches.

#### Revert Version

Revert should reuse the existing version revert flow:

1. User picks version in History.
2. Server reverts and returns result.
3. Form resets to result.
4. Preview receives `FULL_RESYNC`.
5. Dirty state clears.

### Blocks in Visual Edit

Blocks need first-class behavior, not just field focus.

#### Block Selection

- Clicking a block wrapper selects `{ type: "block", blocksPath, blockId, blockType }`.
- Clicking `PreviewField` inside a block selects `{ type: "blockField", blocksPath, blockId, blockType, fieldPath, fullPath }`.
- Inspector shows block-level actions plus editable fields.

#### Block Operations

Reuse `tree-utils.ts` and extract provider actions into pure operations usable without rendering `BlockEditorLayout`.

```ts
type BlockContentOperation =
  | { type: "add"; blockType: string; position: InsertPosition }
  | { type: "remove"; blockId: string }
  | { type: "duplicate"; blockId: string }
  | { type: "move"; blockId: string; parentId: string | null; fromIndex: number; toIndex: number }
  | { type: "updateValues"; blockId: string; values: Record<string, unknown> };
```

Each operation returns next `BlockContent`, updates form state at `blocksPath`, sends a patch, and marks dirty.

#### Add Block UX

MVP:

- Blocks panel lists current tree.
- Add button opens existing block library UI adapted as inspector drawer/popover.
- New block is inserted after selected block or at root end.
- Newly added block becomes selected.

Later:

- Canvas plus buttons between blocks.
- Drag handles in the iframe overlay.
- Cross-parent drag/drop.

#### Nested Blocks

Nested block selection uses the child block ID directly. The parent ID is useful for tree operations but not field value paths.

```ts
type BlockLocation = {
  blocksPath: string;
  blockId: string;
  parentId: string | null;
  index: number;
};
```

### Arrays and Relations

#### Arrays

Array fields need two UI levels:

| Array shape | Inspector behavior |
|-------------|--------------------|
| Scalar array | Compact list/tag editor using existing array field. |
| Object array | Repeater item list plus selected item field editors. |
| Relation array | Multi relation picker. |
| Visual item | Canvas item click selects `arrayItem`. |

Patch behavior can start by patching the whole array. Item-level operations can be added once the preview runtime has stable insert/remove/move support.

#### Relations

Relation selection should be explicit and safe.

Default behavior:

- Selecting a relation opens the relation picker for the current document.
- Related record quick edit is a secondary action.
- Opening the full related record is a separate link/action.

This avoids surprising users who click an author/barber/service card expecting to change the relation but instead edit a different document.

Relation changes usually need reconcile because preview renderers often need expanded relation data, not just IDs.

### Save, Autosave, and Patch Pipeline

#### Local Patch First

For fields with `patchStrategy: "local"`:

1. User changes inspector field.
2. `form.setValue(path, value, { shouldDirty: true, shouldTouch: true })`.
3. Visual controller emits `PATCH_BATCH` to iframe after a small debounce.
4. Autosave/manual save persists later.

#### Reconcile When Needed

Use reconcile for slug, URL, relation, upload, block prefetch, reactive compute, and any field marked `requiresReconcile`.

```
field change -> local patch -> async reconcile -> reconciled patch/full snapshot
```

MVP can use refresh as the reconcile fallback:

```
field change -> save/autosave -> PREVIEW_REFRESH
```

But the architecture should reserve a server route for patch reconcile:

```ts
route("preview/reconcile")
  .post()
  .schema(z.object({
    collection: z.string(),
    id: z.string(),
    locale: z.string().optional(),
    stage: z.string().optional(),
    baseline: z.record(z.string(), z.unknown()),
    patches: z.array(visualPatchSchema),
  }))
```

The server applies patches to the snapshot, runs preview URL resolution, relation/upload expansion, block prefetch, and reactive compute as needed, then returns either patches or a full snapshot.

#### Autosave

Current autosave is DOM-event based on the form element. Visual edit may not have a full form DOM. Autosave should move to form-state subscription in the shared controller.

```ts
useWatch({ control: form.control });
// debounce -> form.handleSubmit(save)
```

This also makes inspector-only editing work without hidden input events.

### UX Requirements

- Canvas is always the largest surface on desktop.
- Inspector is fixed-width and remembers the last selected tab.
- Header shows dirty state, saving state, last saved time, locale, current workflow stage, transition actions, history, and close.
- Empty inspector state tells users to click editable content or open Document.
- Selected canvas target has a clear outline and optional label chip.
- Non-editable targets show why: locked, read-only, no field mapping, access denied, or computed.
- Preview navigation is intercepted in visual edit mode. Links can show "Open link" or "Navigate preview" actions instead of unexpectedly leaving the edited page.
- If patching fails, fallback to refresh and show a non-blocking warning.
- Mobile uses tabs or bottom sheet inspector, but MVP can be desktop-first if current live preview mobile tab behavior remains available.

## Implementation Plan

### Phase 0: Harden Current Live Preview

Fast fixes before new workspace:

- Align preview config naming (`defaultWidth` vs `defaultSize`, `minWidth` vs `minSize`) or support both explicitly.
- Fix nested block path resolution in `BlockScopeProvider` so block values stay flat by block ID.
- Remove `"*"` from V2 preview messaging and add preview-side origin validation.
- Add `preventDefault` to preview click wrappers in visual edit mode to block accidental link navigation.
- Add a shared path utility for block paths instead of hardcoding `content._values` in multiple places.

### Phase 1: Shared Controller and Inspector Workspace

- Extract `useResourceFormController` from `form-view.tsx`.
- Keep existing `FormView` behavior unchanged by consuming the controller.
- Add `VisualEditWorkspace` behind a feature flag or `?visualEdit=true`.
- Implement inspector modes for document fields, regular selected fields, relation fields, block fields, and block selection.
- Use existing refresh-on-save preview behavior initially.

### Phase 2: Patch-Based Preview Runtime

- Extend preview message types with `INIT_SNAPSHOT`, `PATCH_BATCH`, `COMMIT`, and `FULL_RESYNC`.
- Add draft store to `useCollectionPreview` while preserving old API.
- Send local patches from inspector field changes.
- Add fallback to `PREVIEW_REFRESH` for unsupported preview pages and unsupported field types.

### Phase 3: Blocks Panel and Operations

- Extract reusable block content operations from `BlockEditorProvider`.
- Add Blocks panel in inspector.
- Support add, remove, duplicate, reorder, and selected block field edits.
- Patch whole blocks field first; optimize granular patches later.

### Phase 4: Workflow-Aware Visual Edit

- Thread active read/write stage through preview URL RPC, collection item queries, and save mutations.
- Save dirty content before transition.
- Reuse existing scheduled transition dialog.
- Ensure revert sends `FULL_RESYNC`.
- Add stage selector/read-stage behavior if product wants previewing other stages.

### Phase 5: Optional Visual Field Contract

- Add `visualEdit` to `FieldDefinition`.
- Add `visualEdit` admin metadata to field options.
- Document custom field defaults and opt-in inspector override.
- Add examples for a color field, upload field, and relation field.

## Testing Plan

### Unit Tests

- Path utilities: regular, object, array, block, nested block.
- Patch apply utilities: set, unset, insert, remove, move.
- Selection resolver: legacy field/block messages and V2 targets.
- Block operations: add, remove, duplicate, move, update values.
- Protocol guards: origin, session, seq, message type validation.

### Component Tests

- Inspector renders existing field components for scalar fields.
- Inspector renders relation picker and upload picker.
- Inspector renders object and array fields without full form view.
- Block field inspector scopes names to `${blocksPath}._values.${blockId}.${field}`.
- Reactive hidden/read-only/disabled states apply in inspector.
- Autosave triggers from form state changes, not DOM form events.

### E2E Tests in Barbershop Example

- Open page visual edit from admin.
- Click hero title in iframe, inspector opens title field.
- Edit title, iframe updates without reload.
- Save, reload page, title persists.
- Edit SEO/meta fields from Document panel.
- Select image/upload field and verify refresh/reconcile fallback.
- Edit relation field and verify related display updates after reconcile/refresh.
- Add, reorder, duplicate, and delete blocks from Blocks panel.
- Edit nested block field and verify correct path.
- Switch locale with dirty state warning.
- Transition draft to review/published after dirty save.
- Schedule transition after dirty save.
- Revert version and verify iframe full resync.
- Verify locked document disables inspector edits.
- Verify preview links do not accidentally navigate away.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Patch preview diverges from server output | Use `COMMIT`, `FULL_RESYNC`, and reconcile for derived data. |
| Custom fields render poorly in narrow inspector | Existing component is fallback; optional `visualEdit.inspector` allows refinement. |
| Workflow transition publishes stale data | Force save dirty form before transition. |
| Nested block paths break selection | Centralize block path utilities and keep `_values` flat by block ID. |
| Relations/uploads cannot patch locally | Mark as reconcile/refresh strategy initially. |
| Autosave misses inspector changes | Move autosave from DOM events to form-state subscription. |
| Preview security regressions | Explicit origins, session IDs, no wildcard in V2 path. |

## Open Questions

1. Should Visual Edit be a separate view kind (`visualEdit`) or a mode inside collection form view (`?visualEdit=true`)? Recommendation: mode first for speed, view kind later if needed.
2. Should active workflow stage be user-selectable in visual edit, or should it always use the current/latest stage? Recommendation: current/latest stage first, explicit stage switch later.
3. Should relations support inline quick edit in MVP? Recommendation: relation picker plus open-related action first.
4. Should block add/reorder be canvas-based in MVP? Recommendation: sidebar Blocks panel first, canvas handles later.
5. Should patch paths use dot notation long-term? Recommendation: dot notation for MVP, JSON Patch-compatible internal representation when nested arrays become complex.

## Recommendation

Build Visual Edit as an admin-shell iframe workspace, not as a public-page standalone editor and not as a duplicate form system.

The fastest correct path is:

1. Extract shared form/controller logic from `FormView`.
2. Add an inspector workspace that renders only selected slices through existing field registries.
3. Add patch-based preview updates for simple fields.
4. Keep save/autosave/workflow/history/locks exactly on the admin side.
5. Add optional visual edit extensions only after the default field reuse path works.

This gives a polished visual editing UX while preserving QUESTPIE's registry-first architecture and keeping custom module authors from rewriting their field renderers.
