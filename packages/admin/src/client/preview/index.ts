/**
 * Preview Exports
 *
 * Exports for frontend preview pages.
 */

// Block scope context (for preview field path resolution)
export {
	type BlockScopeContextValue,
	BlockScopeProvider,
	type BlockScopeProviderProps,
	useBlockScope,
	useResolveFieldPath,
} from "./block-scope-context.js";
// Block path helpers — used by both admin and iframe sides to
// build / parse `<blocksPath>._values.<id>.<field>` paths.
export {
	BLOCKS_TREE_SEGMENT,
	BLOCKS_VALUES_SEGMENT,
	type BlockPathParts,
	blockTreePath,
	blockValuePath,
	defaultBlocksPath,
	parseBlockValuePath,
} from "./block-paths.js";
// Snapshot diff — produces minimal `PreviewPatchOp[]`
export { diffSnapshot } from "./diff.js";
// Patch ops — apply `PreviewPatchOp[]` to a snapshot
export {
	applyPatchBatch,
	applyPatchBatchImmutable,
	applyRemove,
	applySet,
	type PathSegment,
	parsePath,
} from "./patch.js";
export { PreviewBanner, type PreviewBannerProps } from "./preview-banner.js";
// Components
export {
	PreviewField,
	type PreviewFieldProps,
	PreviewProvider,
	StandalonePreviewField,
	usePreviewContext,
} from "./preview-field.js";

// V1 types
export type {
	AdminToPreviewMessage,
	BlockClickedMessage,
	FieldClickedMessage,
	FocusFieldMessage,
	PreviewConfig,
	PreviewReadyMessage,
	PreviewRefreshMessage,
	PreviewToAdminMessage,
	RefreshCompleteMessage,
	SelectBlockMessage,
} from "./types.js";
// V2 protocol types
export type {
	CommitMessage,
	FullResyncMessage,
	InitSnapshotMessage,
	NavigatePreviewMessage,
	PatchAppliedMessage,
	PatchBatchMessage,
	PreviewPatchOp,
	ResyncRequestMessage,
	SelectTargetMessage,
} from "./types.js";
export { isAdminToPreviewMessage, isPreviewToAdminMessage } from "./types.js";
// Hook
export {
	type UseCollectionPreviewOptions,
	type UseCollectionPreviewResult,
	useCollectionPreview,
} from "./use-collection-preview.js";
