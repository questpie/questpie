/**
 * Preview Exports
 *
 * Exports for frontend preview pages.
 */

// Components
export {
  PreviewField,
  type PreviewFieldProps,
  PreviewProvider,
  StandalonePreviewField,
  usePreviewContext,
} from "./preview-field.js";
export { PreviewBanner, type PreviewBannerProps } from "./preview-banner.js";

// Block scope context (for preview field path resolution)
export {
  BlockScopeProvider,
  type BlockScopeProviderProps,
  type BlockScopeContextValue,
  useBlockScope,
  useResolveFieldPath,
} from "./block-scope-context.js";

// Types
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
export { isAdminToPreviewMessage, isPreviewToAdminMessage } from "./types.js";
// Hook
export {
  type UseCollectionPreviewOptions,
  type UseCollectionPreviewResult,
  useCollectionPreview,
} from "./use-collection-preview.js";
