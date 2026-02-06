/**
 * Collection Preview Types
 *
 * PostMessage protocol and types for live preview communication
 * between admin and preview iframe.
 */

// ============================================================================
// Admin -> Preview Messages
// ============================================================================

/**
 * Signal preview to refresh (invalidate and re-run loader).
 */
export type PreviewRefreshMessage = {
  type: "PREVIEW_REFRESH";
  /** Optional hint about which field changed */
  changedField?: string;
};

/**
 * Select a block in the preview.
 */
export type SelectBlockMessage = {
  type: "SELECT_BLOCK";
  /** Block ID to select */
  blockId: string;
};

/**
 * Focus a field in the preview.
 */
export type FocusFieldMessage = {
  type: "FOCUS_FIELD";
  /** Field path to focus (supports full scoped paths) */
  fieldPath: string;
};

/**
 * All messages from Admin to Preview.
 */
export type AdminToPreviewMessage =
  | PreviewRefreshMessage
  | SelectBlockMessage
  | FocusFieldMessage;

// ============================================================================
// Preview -> Admin Messages
// ============================================================================

/**
 * Preview is ready to receive data.
 */
export type PreviewReadyMessage = {
  type: "PREVIEW_READY";
};

/**
 * A field was clicked in the preview.
 */
export type FieldClickedMessage = {
  type: "FIELD_CLICKED";
  /** Full scoped field path */
  fieldPath: string;
  /** Block context hint */
  blockId?: string;
  /** Field type for routing */
  fieldType?: "regular" | "block" | "relation";
};

/**
 * A block was clicked in the preview.
 */
export type BlockClickedMessage = {
  type: "BLOCK_CLICKED";
  /** Block ID that was clicked */
  blockId: string;
};

/**
 * Preview refresh completed.
 * Sent after preview successfully re-runs loader.
 */
export type RefreshCompleteMessage = {
  type: "REFRESH_COMPLETE";
  /** Timestamp of completion */
  timestamp: number;
};

/**
 * All messages from Preview to Admin.
 */
export type PreviewToAdminMessage =
  | PreviewReadyMessage
  | FieldClickedMessage
  | BlockClickedMessage
  | RefreshCompleteMessage;

// ============================================================================
// Preview Configuration
// ============================================================================

/**
 * Preview configuration for a collection.
 */
export type PreviewConfig = {
  /**
   * URL builder for preview iframe.
   * Receives current form values and locale.
   */
  url: (values: Record<string, unknown>, locale: string) => string;

  /**
   * Enable/disable preview.
   * @default true if url is defined
   */
  enabled?: boolean;

  /**
   * Preview pane position.
   * @default "right"
   */
  position?: "right" | "bottom" | "modal";

  /**
   * Default preview pane size (percentage).
   * @default 50
   */
  defaultSize?: number;

  /**
   * Minimum pane size (percentage).
   * @default 30
   */
  minSize?: number;
};

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a message is from admin to preview.
 */
export function isAdminToPreviewMessage(
  data: unknown,
): data is AdminToPreviewMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as { type?: string };
  return (
    msg.type === "PREVIEW_REFRESH" ||
    msg.type === "SELECT_BLOCK" ||
    msg.type === "FOCUS_FIELD"
  );
}

/**
 * Check if a message is from preview to admin.
 */
export function isPreviewToAdminMessage(
  data: unknown,
): data is PreviewToAdminMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as { type?: string };
  return (
    msg.type === "PREVIEW_READY" ||
    msg.type === "FIELD_CLICKED" ||
    msg.type === "BLOCK_CLICKED" ||
    msg.type === "REFRESH_COMPLETE"
  );
}
