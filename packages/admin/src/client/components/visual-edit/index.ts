/**
 * Visual Edit Workspace barrel.
 *
 * Phase 2 surface — re-exports the selection model, the workspace
 * shell, and the inspector router. Wiring into the admin views
 * registry happens once Phase 3 (patch protocol) is in place.
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
	mapPreviewClickToSelection,
	mapPreviewBlockClickToSelection,
	type PreviewClickContext,
	type MapPreviewClickArgs,
} from "./click-router.js";
export {
	VisualEditFormHost,
	useVisualEditController,
	useVisualEditControllerOptional,
	type VisualEditFormHostProps,
} from "./visual-edit-form-host.js";
export {
	BlockInspectorBody,
	type BlockInspectorBodyProps,
} from "./block-inspector-body.js";
export {
	defaultPatchStrategy,
	resolvePatchStrategy,
	resolveVisualEditMeta,
	type ResolvedVisualEditMeta,
} from "./visual-edit-meta.js";
