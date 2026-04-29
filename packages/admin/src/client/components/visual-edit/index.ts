/**
 * Visual Edit Workspace barrel.
 *
 * Re-exports the full public surface of the workspace:
 *
 * - Selection model (`VisualEditSelection`, helpers, click router).
 * - Workspace shell (`VisualEditWorkspace`, `VisualEditFormHost`,
 *   `VisualInspectorPanel`).
 * - Inspector bodies (`DocumentInspectorBody`, `BlockInspectorBody`)
 *   plus their grouping helpers and `visualEdit` meta resolution.
 * - Patch-protocol bridges (`useFormToPreviewPatcher`,
 *   `useVisualEditPreviewBridge`).
 * - Production-hardening primitives (`InspectorErrorBoundary`,
 *   `useDeselectOnEscape`, `isEditableElement`).
 *
 * The same surface is re-exported from `@questpie/admin/client` so
 * downstream consumers don't need to reach into `client/components/`.
 */

export type {
	VisualEditSelection,
	ParsedBlockPath,
	BlockPathParts,
} from "./types.js";
export { selectionFieldPath } from "./types.js";
export {
	VisualEditProvider,
	useVisualEdit,
	useVisualEditOptional,
	type VisualEditContextValue,
	type VisualEditProviderProps,
} from "./visual-edit-context.js";
export {
	VisualInspectorPanel,
	type VisualInspectorPanelProps,
} from "./visual-inspector-panel.js";
export {
	VisualEditWorkspace,
	VisualEditWorkspaceContent,
	type VisualEditWorkspaceContentProps,
	type VisualEditWorkspaceProps,
} from "./visual-edit-workspace.js";
export {
	useVisualEditPreviewBridge,
	type UseVisualEditPreviewBridgeArgs,
} from "./use-visual-edit-preview-bridge.js";
export {
	useFormToPreviewPatcher,
	type UseFormToPreviewPatcherArgs,
} from "./use-form-to-preview-patcher.js";
export {
	isEditableElement,
	useDeselectOnEscape,
	type UseDeselectOnEscapeOptions,
} from "./keyboard.js";
export {
	InspectorErrorBoundary,
	type InspectorErrorBoundaryProps,
} from "./inspector-error-boundary.js";
export {
	mapPreviewClickToSelection,
	mapPreviewBlockClickToSelection,
	type PreviewClickContext,
	type MapPreviewClickArgs,
} from "./click-router.js";
export {
	VisualEditFormHost,
	VisualEditFormHostWithController,
	useVisualEditController,
	useVisualEditControllerOptional,
	type VisualEditFormHostProps,
	type VisualEditFormHostWithControllerProps,
} from "./visual-edit-form-host.js";
export {
	BlockInspectorBody,
	type BlockInspectorBodyProps,
} from "./block-inspector-body.js";
export {
	DocumentInspectorBody,
	type DocumentInspectorBodyProps,
} from "./document-inspector-body.js";
export {
	groupFieldsForDocument,
	hasExplicitGroups,
	hasGroupedDocumentMetadata,
	DEFAULT_DOCUMENT_GROUP_KEY,
	type DocumentFieldEntry,
	type DocumentFieldGroup,
	type GroupFieldsForDocumentArgs,
} from "./group-fields.js";
export {
	buildStrategyMap,
	defaultPatchStrategy,
	resolveNestedVisualEditMeta,
	resolvePatchStrategy,
	resolveVisualEditMeta,
	type ResolvedVisualEditMeta,
} from "./visual-edit-meta.js";
