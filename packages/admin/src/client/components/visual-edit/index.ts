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
	type VisualEditWorkspaceProps,
} from "./visual-edit-workspace.js";
