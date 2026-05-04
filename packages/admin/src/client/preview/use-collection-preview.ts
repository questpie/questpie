/**
 * useCollectionPreview Hook
 *
 * Hook for frontend pages to receive live preview data from admin.
 * Handles postMessage communication with the admin iframe parent.
 */

"use client";

import * as React from "react";

import {
	applyPatchBatchImmutable,
	cloneSnapshot,
	shouldApplyPatchBatch,
	type PreviewPatchOp,
} from "./patch.js";

// ============================================================================
// Types
// ============================================================================

export type UseCollectionPreviewOptions<TData> = {
	/** Server-loaded data (from loader/SSR) */
	initialData: TData;
	/**
	 * Callback to refresh data (e.g., router.invalidate()).
	 * Required for preview functionality.
	 */
	onRefresh: () => void | Promise<void>;
};

export type UseCollectionPreviewResult<TData> = {
	/** Current data from the iframe draft mirror */
	data: TData;
	/** Whether we're in preview mode (inside admin iframe) */
	isPreviewMode: boolean;
	/** Currently selected block ID */
	selectedBlockId: string | null;
	/** Focused field path */
	focusedField: string | null;
	/** Call when a field is clicked in preview */
	handleFieldClick: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
	/** Call when a block is clicked in preview */
	handleBlockClick: (blockId: string) => void;
	/** Call when a preview insert control requests a new block */
	handleBlockInsert: (payload: PreviewBlockInsertRequestedPayload) => void;
	/** Call when an inline preview edit is committed */
	handleFieldValueEdited: (payload: PreviewFieldValueEditedPayload) => void;
};

export type PreviewBlockInsertRequestedPayload = {
	position: {
		parentId: string | null;
		index: number;
	};
	referenceBlockId?: string;
};

export type PreviewFieldValueEditedPayload = {
	path: string;
	value: unknown;
	inputKind: "text" | "textarea" | "number" | "boolean";
	blockId?: string;
	fieldType?: "regular" | "block" | "relation";
};

type PreviewAdminMessage =
	| { type: "PREVIEW_REFRESH"; changedField?: string }
	| { type: "SELECT_BLOCK"; blockId: string }
	| { type: "FOCUS_FIELD"; fieldPath: string }
	| { type: "INIT_SNAPSHOT"; seq: number; data: unknown }
	| {
			type: "PATCH_BATCH";
			seq: number;
			ops: PreviewPatchOp[];
			snapshotVersion?: number;
	  }
	| { type: "COMMIT"; seq: number; data: unknown }
	| { type: "FULL_RESYNC"; reason?: string };

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for receiving live preview data from admin.
 *
 * Use this in your frontend page components to enable live preview.
 *
 * @example
 * ```tsx
 * function PageRoute() {
 *   const loaderData = Route.useLoaderData();
 *   const router = useRouter();
 *
 *   const { data, isPreviewMode, selectedBlockId, handleBlockClick } =
 *     useCollectionPreview({
 *       initialData: loaderData.page,
 *       onRefresh: () => router.invalidate(),
 *     });
 *
 *   return (
 *     <article>
 *       <PreviewField field="title" as="h1">{data.title}</PreviewField>
 *       <BlockRenderer
 *         content={data.content}
 *         blocks={blocks}
 *         selectedBlockId={selectedBlockId}
 *         onBlockClick={handleBlockClick}
 *       />
 *     </article>
 *   );
 * }
 * ```
 */
export function useCollectionPreview<TData extends Record<string, unknown>>({
	initialData,
	onRefresh,
}: UseCollectionPreviewOptions<TData>): UseCollectionPreviewResult<TData> {
	const [draftData, setDraftData] = React.useState<TData>(() =>
		cloneSnapshot(initialData),
	);
	const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(
		null,
	);
	const [focusedField, setFocusedField] = React.useState<string | null>(null);
	const [isPreviewMode, setIsPreviewMode] = React.useState(false);
	const lastAppliedSeqRef = React.useRef<number | null>(null);
	const initialDataRef = React.useRef(initialData);

	// Check after mount so the first client render matches SSR output.
	React.useEffect(() => {
		try {
			setIsPreviewMode(window.self !== window.top);
		} catch {
			// Cross-origin iframe - assume we're in preview mode
			setIsPreviewMode(true);
		}
	}, []);

	// Keep onRefresh in a ref to avoid stale closures while maintaining stable reference
	const onRefreshRef = React.useRef(onRefresh);
	React.useEffect(() => {
		onRefreshRef.current = onRefresh;
	}, [onRefresh]);

	React.useEffect(() => {
		initialDataRef.current = initialData;
		setDraftData(cloneSnapshot(initialData));
	}, [initialData]);

	// Set up postMessage listener
	React.useEffect(() => {
		if (!isPreviewMode) return;

		// Signal that preview is ready
		window.parent.postMessage({ type: "PREVIEW_READY" }, "*");

		const handleMessage = async (event: MessageEvent<unknown>) => {
			// In production, validate origin here
			const message = event.data;

			if (!isPreviewAdminMessage(message)) {
				return;
			}

			switch (message.type) {
				case "PREVIEW_REFRESH": {
					await onRefreshRef.current();
					setDraftData(cloneSnapshot(initialDataRef.current));
					window.parent.postMessage(
						{
							type: "REFRESH_COMPLETE",
							timestamp: Date.now(),
						},
						"*",
					);
					break;
				}

				case "SELECT_BLOCK":
					setSelectedBlockId(message.blockId);
					break;

				case "FOCUS_FIELD": {
					setFocusedField(message.fieldPath);
					// Scroll field into view (with delay to ensure React render)
					setTimeout(() => {
						const element = findPreviewFieldElement(message.fieldPath);
						if (element) {
							element.scrollIntoView({ behavior: "smooth", block: "center" });
						}
					}, 150);
					break;
				}

				case "INIT_SNAPSHOT":
					lastAppliedSeqRef.current = message.seq;
					setDraftData(cloneSnapshot(message.data) as TData);
					break;

				case "PATCH_BATCH": {
					if (!shouldApplyPatchBatch(lastAppliedSeqRef.current, message.seq)) {
						break;
					}

					try {
						setDraftData((current) =>
							applyPatchBatchImmutable(current, message.ops),
						);
						lastAppliedSeqRef.current = message.seq;
						window.parent.postMessage(
							{
								type: "PATCH_APPLIED",
								seq: message.seq,
								snapshotVersion: message.snapshotVersion,
							},
							"*",
						);
					} catch (error) {
						window.parent.postMessage(
							{
								type: "RESYNC_REQUEST",
								reason:
									error instanceof Error
										? error.message
										: "Failed to apply preview patch batch",
							},
							"*",
						);
					}
					break;
				}

				case "COMMIT":
					lastAppliedSeqRef.current = message.seq;
					setDraftData(cloneSnapshot(message.data) as TData);
					break;

				case "FULL_RESYNC":
					await onRefreshRef.current();
					setDraftData(cloneSnapshot(initialDataRef.current));
					window.parent.postMessage(
						{
							type: "REFRESH_COMPLETE",
							timestamp: Date.now(),
						},
						"*",
					);
					break;
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [isPreviewMode]);

	// Field click handler
	const handleFieldClick = React.useCallback(
		(
			fieldPath: string,
			context?: {
				blockId?: string;
				fieldType?: "regular" | "block" | "relation";
			},
		) => {
			if (isPreviewMode) {
				window.parent.postMessage(
					{
						type: "FIELD_CLICKED",
						fieldPath,
						blockId: context?.blockId,
						fieldType: context?.fieldType,
					},
					"*",
				);
			}
		},
		[isPreviewMode],
	);

	// Block click handler
	const handleBlockClick = React.useCallback(
		(blockId: string) => {
			if (isPreviewMode) {
				window.parent.postMessage({ type: "BLOCK_CLICKED", blockId }, "*");
			}
		},
		[isPreviewMode],
	);

	const handleFieldValueEdited = React.useCallback(
		(payload: PreviewFieldValueEditedPayload) => {
			if (isPreviewMode) {
				window.parent.postMessage(
					{
						type: "FIELD_VALUE_EDITED",
						...payload,
					},
					"*",
				);
			}
		},
		[isPreviewMode],
	);

	const handleBlockInsert = React.useCallback(
		(payload: PreviewBlockInsertRequestedPayload) => {
			if (isPreviewMode) {
				window.parent.postMessage(
					{
						type: "BLOCK_INSERT_REQUESTED",
						...payload,
					},
					"*",
				);
			}
		},
		[isPreviewMode],
	);

	return {
		data: draftData,
		isPreviewMode,
		selectedBlockId,
		focusedField,
		handleFieldClick,
		handleBlockClick,
		handleBlockInsert,
		handleFieldValueEdited,
	};
}

function isPreviewAdminMessage(data: unknown): data is PreviewAdminMessage {
	if (!data || typeof data !== "object") {
		return false;
	}

	const message = data as {
		type?: unknown;
		seq?: unknown;
		data?: unknown;
		ops?: unknown;
		blockId?: unknown;
		fieldPath?: unknown;
	};

	switch (message.type) {
		case "PREVIEW_REFRESH":
		case "FULL_RESYNC":
			return true;
		case "SELECT_BLOCK":
			return typeof message.blockId === "string";
		case "FOCUS_FIELD":
			return typeof message.fieldPath === "string";
		case "INIT_SNAPSHOT":
		case "COMMIT":
			return typeof message.seq === "number";
		case "PATCH_BATCH":
			return (
				typeof message.seq === "number" &&
				Array.isArray(message.ops) &&
				message.ops.every(isPreviewPatchOp)
			);
		default:
			return false;
	}
}

function isPreviewPatchOp(value: unknown): value is PreviewPatchOp {
	if (!value || typeof value !== "object") {
		return false;
	}

	const op = value as { op?: unknown; path?: unknown };
	return (op.op === "set" || op.op === "remove") && typeof op.path === "string";
}

function findPreviewFieldElement(fieldPath: string): Element | null {
	const escaped =
		typeof CSS !== "undefined" && typeof CSS.escape === "function"
			? CSS.escape(fieldPath)
			: fieldPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

	return document.querySelector(`[data-preview-field="${escaped}"]`);
}
