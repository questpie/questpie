/**
 * useCollectionPreview Hook
 *
 * Hook for frontend pages to receive live preview data from admin.
 * Handles postMessage communication with the admin iframe parent.
 */

"use client";

import * as React from "react";

import { applyPatchBatchImmutable } from "./patch.js";
import type { AdminToPreviewMessage } from "./types.js";

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
	/**
	 * Current data — either the live local draft (after `INIT_SNAPSHOT`
	 * + `PATCH_BATCH`) or `initialData` when no snapshot has arrived
	 * yet. This is what consumer pages should read from.
	 */
	data: TData;
	/** Whether we're in preview mode (inside admin iframe) */
	isPreviewMode: boolean;
	/**
	 * `true` once the admin has sent an `INIT_SNAPSHOT` and the
	 * preview is driving its local draft from patches. Until then,
	 * `data` mirrors `initialData` and `PREVIEW_REFRESH` controls
	 * updates.
	 */
	isDraftActive: boolean;
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
};

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
function resolveAdminOrigin(): string | null {
	if (typeof document === "undefined") return null;
	const referrer = document.referrer;
	if (!referrer) return null;
	try {
		return new URL(referrer).origin;
	} catch {
		return null;
	}
}

export function useCollectionPreview<TData extends Record<string, unknown>>({
	initialData,
	onRefresh,
}: UseCollectionPreviewOptions<TData>): UseCollectionPreviewResult<TData> {
	const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(
		null,
	);
	const [focusedField, setFocusedField] = React.useState<string | null>(null);

	// Local draft store: populated by `INIT_SNAPSHOT`, mutated by
	// `PATCH_BATCH`, swapped by `COMMIT`, cleared by `FULL_RESYNC`.
	// `null` means "no draft active yet — fall back to initialData".
	const [draftData, setDraftData] = React.useState<TData | null>(null);
	// Track the last patch batch we applied so we can ignore stale
	// out-of-order deliveries.
	const lastSeqRef = React.useRef<number>(-1);

	// Check if we're in an iframe (preview mode)
	const isPreviewMode = React.useMemo(() => {
		if (typeof window === "undefined") return false;
		try {
			return window.self !== window.top;
		} catch {
			// Cross-origin iframe - assume we're in preview mode
			return true;
		}
	}, []);

	// Resolve the admin origin from document.referrer once. If unresolved we
	// drop messages rather than broadcasting admin state with a wildcard.
	const adminOrigin = React.useMemo<string | null>(() => {
		if (!isPreviewMode) return null;
		return resolveAdminOrigin();
	}, [isPreviewMode]);

	const sendToAdmin = React.useCallback(
		(message: Record<string, unknown>) => {
			if (!isPreviewMode) return;
			if (typeof window === "undefined") return;
			if (!adminOrigin) {
				if (process.env.NODE_ENV !== "production") {
					console.warn(
						"[useCollectionPreview] Skipping postMessage — could not resolve admin origin from document.referrer.",
					);
				}
				return;
			}
			window.parent.postMessage(message, adminOrigin);
		},
		[adminOrigin, isPreviewMode],
	);

	// Keep onRefresh in a ref to avoid stale closures while maintaining stable reference
	const onRefreshRef = React.useRef(onRefresh);
	React.useEffect(() => {
		onRefreshRef.current = onRefresh;
	}, [onRefresh]);

	// Mirror initialData in a ref so the patch handler always sees
	// the latest value when applying ops on top of the draft.
	const initialDataRef = React.useRef(initialData);
	React.useEffect(() => {
		initialDataRef.current = initialData;
	}, [initialData]);

	// Set up postMessage listener
	React.useEffect(() => {
		if (!isPreviewMode) return;

		// Signal that preview is ready
		sendToAdmin({ type: "PREVIEW_READY" });

		const handleMessage = async (
			event: MessageEvent<AdminToPreviewMessage>,
		) => {
			// Reject messages from unexpected origins. If we never resolved the
			// admin origin, accept only same-origin parents to avoid silently
			// trusting arbitrary frames in V2 patch flows.
			if (adminOrigin) {
				if (event.origin !== adminOrigin) return;
			} else if (event.origin !== window.location.origin) {
				return;
			}

			const message = event.data;
			if (!message || typeof message !== "object" || !message.type) {
				return;
			}

			switch (message.type) {
				case "PREVIEW_REFRESH": {
					await onRefreshRef.current();
					sendToAdmin({
						type: "REFRESH_COMPLETE",
						timestamp: Date.now(),
					});
					break;
				}

				case "SELECT_BLOCK":
					setSelectedBlockId(message.blockId);
					break;

				case "FOCUS_FIELD": {
					setFocusedField(message.fieldPath);
					// Scroll field into view (with delay to ensure React render)
					setTimeout(() => {
						const element = document.querySelector(
							`[data-preview-field="${message.fieldPath}"]`,
						);
						if (element) {
							element.scrollIntoView({ behavior: "smooth", block: "center" });
						}
					}, 150);
					break;
				}

				case "SELECT_TARGET":
					setFocusedField(message.fieldPath);
					if (message.blockId) {
						setSelectedBlockId(message.blockId);
					}
					break;

				case "INIT_SNAPSHOT":
					lastSeqRef.current = -1;
					setDraftData(message.snapshot as TData);
					break;

				case "PATCH_BATCH": {
					if (typeof message.seq === "number") {
						if (message.seq <= lastSeqRef.current) break;
						lastSeqRef.current = message.seq;
					}
					setDraftData((prev) => {
						const base = prev ?? (initialDataRef.current as TData);
						return applyPatchBatchImmutable(
							base as Record<string, unknown>,
							message.ops ?? [],
						) as TData;
					});
					sendToAdmin({
						type: "PATCH_APPLIED",
						seq: message.seq,
						applied: message.ops?.length ?? 0,
						timestamp: Date.now(),
					});
					break;
				}

				case "COMMIT": {
					lastSeqRef.current = -1;
					if (message.snapshot) {
						setDraftData(message.snapshot as TData);
					} else {
						// No snapshot — drop the draft so the next render
						// re-uses `initialData` (which loader/SSR will have
						// refreshed).
						setDraftData(null);
					}
					await onRefreshRef.current();
					break;
				}

				case "FULL_RESYNC":
					lastSeqRef.current = -1;
					setDraftData(null);
					await onRefreshRef.current();
					break;

				case "NAVIGATE_PREVIEW": {
					try {
						const target = new URL(message.url, window.location.href);
						if (target.origin !== window.location.origin) {
							if (process.env.NODE_ENV !== "production") {
								console.warn(
									"[useCollectionPreview] Refusing cross-origin NAVIGATE_PREVIEW:",
									message.url,
								);
							}
							break;
						}
						window.location.href = target.toString();
					} catch {
						// Invalid URL — ignore.
					}
					break;
				}
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [adminOrigin, isPreviewMode, sendToAdmin]);

	// Field click handler
	const handleFieldClick = React.useCallback(
		(
			fieldPath: string,
			context?: {
				blockId?: string;
				fieldType?: "regular" | "block" | "relation";
			},
		) => {
			sendToAdmin({
				type: "FIELD_CLICKED",
				fieldPath,
				blockId: context?.blockId,
				fieldType: context?.fieldType,
			});
		},
		[sendToAdmin],
	);

	// Block click handler
	const handleBlockClick = React.useCallback(
		(blockId: string) => {
			sendToAdmin({ type: "BLOCK_CLICKED", blockId });
		},
		[sendToAdmin],
	);

	return {
		data: draftData ?? initialData,
		isPreviewMode,
		isDraftActive: draftData !== null,
		selectedBlockId,
		focusedField,
		handleFieldClick,
		handleBlockClick,
	};
}
