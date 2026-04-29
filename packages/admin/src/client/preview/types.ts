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

// ----------------------------------------------------------------------------
// Visual Edit Workspace — patch-based preview protocol
// ----------------------------------------------------------------------------

/**
 * Operation in a {@link PatchBatchMessage}. Mirrors the JSON-Patch
 * shape but stays minimal — preview consumers only need set/remove
 * to drive most field updates.
 */
export type PreviewPatchOp =
	| {
			op: "set";
			/** Form-field path (e.g. `title`, `content._values.abc.title`) */
			path: string;
			/** New value — JSON-serialisable */
			value: unknown;
	  }
	| {
			op: "remove";
			path: string;
	  };

/**
 * Initialise the preview's local draft store with the canonical
 * record snapshot. Sent once after `PREVIEW_READY`.
 */
export type InitSnapshotMessage = {
	type: "INIT_SNAPSHOT";
	/** Full record at the current stage/locale, JSON-serialisable */
	snapshot: Record<string, unknown>;
	/** Schema version hint so preview can refuse mismatched updates */
	schemaVersion?: string;
	/** Locale the snapshot was taken in */
	locale?: string;
	/** Workflow stage the snapshot was taken in */
	stage?: string;
};

/**
 * Apply one or more patch operations to the preview's local draft.
 * Patch ops should be idempotent — out-of-order delivery is allowed
 * thanks to the monotonic `seq`.
 */
export type PatchBatchMessage = {
	type: "PATCH_BATCH";
	/** Monotonic sequence number; preview ignores stale batches */
	seq: number;
	/** Ordered list of operations to apply atomically */
	ops: PreviewPatchOp[];
};

/**
 * Mark the current draft as committed (saved on the server). The
 * preview should swap its local draft for the canonical snapshot.
 */
export type CommitMessage = {
	type: "COMMIT";
	/** Server timestamp of the saved version */
	timestamp: number;
	/** Optional refreshed snapshot — admin sends one when commit
	 * changes derived data the preview can't compute locally
	 * (slug, computed fields, relation joins). */
	snapshot?: Record<string, unknown>;
};

/**
 * Force the preview to discard its local draft and re-fetch the
 * canonical record. Used after revert, locale/stage switch, or
 * desync detection.
 */
export type FullResyncMessage = {
	type: "FULL_RESYNC";
	/** Reason hint for telemetry / dev console */
	reason?: "revert" | "locale-switch" | "stage-switch" | "desync" | "manual";
};

/**
 * Tell the preview which target the inspector currently has
 * selected. Lets the preview render the same outline that the
 * legacy `FOCUS_FIELD` did, but for arbitrary selection kinds.
 */
export type SelectTargetMessage = {
	type: "SELECT_TARGET";
	/** Form-field path of the selected target, or `null` for idle */
	fieldPath: string | null;
	/** Selection kind hint (`field`, `block`, `block-field`, …) */
	kind?: string;
	/** Block id when the selection sits inside a block */
	blockId?: string;
};

/**
 * Navigate the preview to a different URL inside the same origin.
 * Used by the toolbar's URL-bar / "open page" affordance.
 */
export type NavigatePreviewMessage = {
	type: "NAVIGATE_PREVIEW";
	/** Target URL (must be same-origin) */
	url: string;
};

/**
 * All messages from Admin to Preview.
 */
export type AdminToPreviewMessage =
	| PreviewRefreshMessage
	| SelectBlockMessage
	| FocusFieldMessage
	| InitSnapshotMessage
	| PatchBatchMessage
	| CommitMessage
	| FullResyncMessage
	| SelectTargetMessage
	| NavigatePreviewMessage;

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
 * Preview ack for a {@link PatchBatchMessage}. Lets the admin track
 * which patches actually landed and detect dropped batches.
 */
export type PatchAppliedMessage = {
	type: "PATCH_APPLIED";
	/** Mirror of the batch's `seq` */
	seq: number;
	/** Number of operations applied — informational */
	applied: number;
	/** Timestamp of completion */
	timestamp: number;
};

/**
 * Preview is requesting a full resync — it detected its local draft
 * is out of sync (e.g. it received a patch with an older seq than
 * the last committed snapshot).
 */
export type ResyncRequestMessage = {
	type: "RESYNC_REQUEST";
	/** Reason hint for telemetry / dev console */
	reason?: "stale-seq" | "missing-snapshot" | "manual";
};

/**
 * All messages from Preview to Admin.
 */
export type PreviewToAdminMessage =
	| PreviewReadyMessage
	| FieldClickedMessage
	| BlockClickedMessage
	| RefreshCompleteMessage
	| PatchAppliedMessage
	| ResyncRequestMessage;

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

const ADMIN_TO_PREVIEW_TYPES = new Set<string>([
	"PREVIEW_REFRESH",
	"SELECT_BLOCK",
	"FOCUS_FIELD",
	"INIT_SNAPSHOT",
	"PATCH_BATCH",
	"COMMIT",
	"FULL_RESYNC",
	"SELECT_TARGET",
	"NAVIGATE_PREVIEW",
]);

const PREVIEW_TO_ADMIN_TYPES = new Set<string>([
	"PREVIEW_READY",
	"FIELD_CLICKED",
	"BLOCK_CLICKED",
	"REFRESH_COMPLETE",
	"PATCH_APPLIED",
	"RESYNC_REQUEST",
]);

/**
 * Check if a message is from admin to preview.
 */
export function isAdminToPreviewMessage(
	data: unknown,
): data is AdminToPreviewMessage {
	if (!data || typeof data !== "object") return false;
	const msg = data as { type?: string };
	return typeof msg.type === "string" && ADMIN_TO_PREVIEW_TYPES.has(msg.type);
}

/**
 * Check if a message is from preview to admin.
 */
export function isPreviewToAdminMessage(
	data: unknown,
): data is PreviewToAdminMessage {
	if (!data || typeof data !== "object") return false;
	const msg = data as { type?: string };
	return typeof msg.type === "string" && PREVIEW_TO_ADMIN_TYPES.has(msg.type);
}
