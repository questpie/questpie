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
 * Single preview draft patch operation.
 */
export type PreviewPatchOp = {
	op: "set" | "remove";
	path: string;
	value?: unknown;
};

/**
 * Seed preview with a full draft snapshot.
 */
export type InitSnapshotMessage = {
	type: "INIT_SNAPSHOT";
	seq: number;
	data: unknown;
};

/**
 * Apply a batch of draft changes.
 */
export type PatchBatchMessage = {
	type: "PATCH_BATCH";
	seq: number;
	ops: PreviewPatchOp[];
	snapshotVersion?: number;
};

/**
 * Replace preview draft after a successful save.
 */
export type CommitMessage = {
	type: "COMMIT";
	seq: number;
	data: unknown;
};

/**
 * Ask preview to discard its draft and reload from the canonical loader.
 */
export type FullResyncMessage = {
	type: "FULL_RESYNC";
	reason?: string;
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
	| FullResyncMessage;

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

export type BlockInsertPosition = {
	parentId: string | null;
	index: number;
};

/**
 * User asked to insert a block from the preview surface.
 */
export type BlockInsertRequestedMessage = {
	type: "BLOCK_INSERT_REQUESTED";
	/** Insert position in the existing block tree editor */
	position: BlockInsertPosition;
	/** Nearby block used for focus/scroll context */
	referenceBlockId?: string;
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
 * Preview acknowledged a patch batch.
 */
export type PatchAppliedMessage = {
	type: "PATCH_APPLIED";
	seq: number;
};

/**
 * Preview detected a mismatch and requested a full resync.
 */
export type ResyncRequestMessage = {
	type: "RESYNC_REQUEST";
	reason?: string;
};

/**
 * User committed an inline edit inside the preview iframe.
 */
export type FieldValueEditedMessage = {
	type: "FIELD_VALUE_EDITED";
	path: string;
	value: unknown;
	inputKind: "text" | "textarea" | "number" | "boolean";
	blockId?: string;
	fieldType?: "regular" | "block" | "relation";
};

/**
 * All messages from Preview to Admin.
 */
export type PreviewToAdminMessage =
	| PreviewReadyMessage
	| FieldClickedMessage
	| BlockClickedMessage
	| BlockInsertRequestedMessage
	| RefreshCompleteMessage
	| PatchAppliedMessage
	| ResyncRequestMessage
	| FieldValueEditedMessage;

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

const MAX_INLINE_EDIT_PAYLOAD_BYTES = 64 * 1024;
const MAX_PATCH_BATCH_OPS = 500;

function isRecord(data: unknown): data is Record<string, unknown> {
	return !!data && typeof data === "object" && !Array.isArray(data);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0;
}

function isInputKind(
	value: unknown,
): value is FieldValueEditedMessage["inputKind"] {
	return (
		value === "text" ||
		value === "textarea" ||
		value === "number" ||
		value === "boolean"
	);
}

function isPreviewFieldType(
	value: unknown,
): value is NonNullable<FieldClickedMessage["fieldType"]> {
	return value === "regular" || value === "block" || value === "relation";
}

function isBlockInsertPosition(value: unknown): value is BlockInsertPosition {
	if (!isRecord(value)) return false;
	return (
		(value.parentId === null || isString(value.parentId)) &&
		isPositiveInteger(value.index)
	);
}

function isSerializableValue(value: unknown): boolean {
	try {
		const seen = new WeakSet<object>();
		JSON.stringify(value, (_key, nestedValue) => {
			if (typeof nestedValue === "function") {
				throw new TypeError("Functions are not serializable");
			}
			if (typeof nestedValue === "symbol") {
				throw new TypeError("Symbols are not serializable");
			}
			if (typeof nestedValue === "bigint") {
				throw new TypeError("BigInts are not JSON serializable");
			}
			if (nestedValue && typeof nestedValue === "object") {
				if (seen.has(nestedValue)) {
					throw new TypeError("Circular values are not serializable");
				}
				seen.add(nestedValue);
			}
			return nestedValue;
		});
		return true;
	} catch {
		return false;
	}
}

function getJsonByteLength(value: unknown): number {
	try {
		const json = JSON.stringify(value);
		if (json === undefined) return 0;
		if (typeof TextEncoder === "undefined") return json.length;
		return new TextEncoder().encode(json).length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function isReasonablePayload(value: unknown, maxBytes: number): boolean {
	return isSerializableValue(value) && getJsonByteLength(value) <= maxBytes;
}

function isPreviewPatchOp(value: unknown): value is PreviewPatchOp {
	if (!isRecord(value)) return false;
	if (value.op !== "set" && value.op !== "remove") return false;
	if (!isString(value.path) || value.path.length === 0) return false;
	if (value.op === "set" && !isSerializableValue(value.value)) return false;
	return true;
}

/**
 * Check if a message is from admin to preview.
 */
export function isAdminToPreviewMessage(
	data: unknown,
): data is AdminToPreviewMessage {
	if (!isRecord(data)) return false;

	switch (data.type) {
		case "PREVIEW_REFRESH":
			return data.changedField === undefined || isString(data.changedField);
		case "SELECT_BLOCK":
			return isString(data.blockId) && data.blockId.length > 0;
		case "FOCUS_FIELD":
			return isString(data.fieldPath) && data.fieldPath.length > 0;
		case "INIT_SNAPSHOT":
		case "COMMIT":
			return isPositiveInteger(data.seq) && isSerializableValue(data.data);
		case "PATCH_BATCH":
			return (
				isPositiveInteger(data.seq) &&
				Array.isArray(data.ops) &&
				data.ops.length <= MAX_PATCH_BATCH_OPS &&
				data.ops.every(isPreviewPatchOp) &&
				(data.snapshotVersion === undefined ||
					isPositiveInteger(data.snapshotVersion))
			);
		case "FULL_RESYNC":
			return data.reason === undefined || isString(data.reason);
		default:
			return false;
	}
}

/**
 * Check if a message is from preview to admin.
 */
export function isPreviewToAdminMessage(
	data: unknown,
): data is PreviewToAdminMessage {
	if (!isRecord(data)) return false;

	switch (data.type) {
		case "PREVIEW_READY":
			return true;
		case "FIELD_CLICKED":
			return (
				isString(data.fieldPath) &&
				data.fieldPath.length > 0 &&
				(data.blockId === undefined || isString(data.blockId)) &&
				(data.fieldType === undefined || isPreviewFieldType(data.fieldType))
			);
		case "BLOCK_CLICKED":
			return isString(data.blockId) && data.blockId.length > 0;
		case "BLOCK_INSERT_REQUESTED":
			return (
				isBlockInsertPosition(data.position) &&
				(data.referenceBlockId === undefined || isString(data.referenceBlockId))
			);
		case "REFRESH_COMPLETE":
			return isNumber(data.timestamp);
		case "PATCH_APPLIED":
			return isPositiveInteger(data.seq);
		case "RESYNC_REQUEST":
			return data.reason === undefined || isString(data.reason);
		case "FIELD_VALUE_EDITED":
			return (
				isString(data.path) &&
				data.path.length > 0 &&
				isInputKind(data.inputKind) &&
				(data.blockId === undefined || isString(data.blockId)) &&
				(data.fieldType === undefined || isPreviewFieldType(data.fieldType)) &&
				isReasonablePayload(data.value, MAX_INLINE_EDIT_PAYLOAD_BYTES)
			);
		default:
			return false;
	}
}
