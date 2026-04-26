/**
 * Preview Pane
 *
 * Admin-side component that renders the preview iframe
 * and handles postMessage communication with the preview page.
 */

"use client";

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import type {
	AdminToPreviewMessage,
	PreviewToAdminMessage,
} from "../../preview/types.js";
import { isPreviewToAdminMessage } from "../../preview/types.js";
import { selectClient, useAdminStore } from "../../runtime/provider.js";

const DEV_TELEMETRY = process.env.NODE_ENV === "development";

// ============================================================================
// Types
// ============================================================================

export type PreviewPaneRef = {
	/** Force the preview to re-run its loader (`PREVIEW_REFRESH`). */
	triggerRefresh: () => void;
	/** Highlight a field in the preview iframe (`FOCUS_FIELD`). */
	sendFocusToPreview: (fieldPath: string) => void;
	/**
	 * Seed the preview's local draft with a fresh snapshot
	 * (`INIT_SNAPSHOT`). Sent once per resource load — usually
	 * after `PREVIEW_READY`.
	 */
	sendInitSnapshot: (
		snapshot: Record<string, unknown>,
		extras?: { schemaVersion?: string; locale?: string; stage?: string },
	) => void;
	/**
	 * Apply a patch batch to the preview's local draft
	 * (`PATCH_BATCH`). The caller owns the monotonic `seq`.
	 */
	sendPatchBatch: (
		seq: number,
		ops: Array<
			| { op: "set"; path: string; value: unknown }
			| { op: "remove"; path: string }
		>,
	) => void;
	/**
	 * Tell the preview the active record was just saved
	 * (`COMMIT`). Pass an optional refreshed snapshot when the
	 * server may have changed derived data the preview can't
	 * compute locally (slug, computed, joins).
	 */
	sendCommit: (snapshot?: Record<string, unknown>) => void;
	/**
	 * Tell the preview to discard its local draft and re-run the
	 * loader (`FULL_RESYNC`). Used after revert / locale or stage
	 * switch / desync.
	 */
	sendFullResync: (
		reason?: "revert" | "locale-switch" | "stage-switch" | "desync" | "manual",
	) => void;
	/**
	 * Forward the current Visual Edit selection to the preview
	 * (`SELECT_TARGET`). Pass `null` for idle.
	 */
	sendSelectTarget: (
		fieldPath: string | null,
		extras?: { kind?: string; blockId?: string },
	) => void;
};

type PreviewPaneProps = {
	/** Preview URL */
	url: string;
	/** Selected block ID (for block editor integration) */
	selectedBlockId?: string | null;
	/** Field click handler */
	onFieldClick?: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
	/** Block click handler */
	onBlockClick?: (blockId: string) => void;
	/** Custom class name */
	className?: string;
	/** Allowed preview origins (for security) */
	allowedOrigins?: string[];
	/**
	 * Fires every time the preview iframe sends `PREVIEW_READY`.
	 *
	 * Used by the Visual Edit Workspace to re-seed the iframe's
	 * local draft with current form values whenever the iframe
	 * reloads (e.g. via `NAVIGATE_PREVIEW` or a hard refresh).
	 * Without this, the patcher's snapshot reference can diverge
	 * from the iframe's draft state — the iframe gets a stale
	 * canonical snapshot replayed by `PreviewPane`'s buffer,
	 * while the patcher's next batch only carries the diff
	 * against its own snapshot.
	 *
	 * Called *after* the buffered INIT_SNAPSHOT replay, so
	 * consumers can override the buffer with a fresher payload.
	 */
	onReady?: () => void;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Preview pane component for admin.
 *
 * Renders an iframe with the preview page and handles
 * bidirectional communication via postMessage.
 */
export const PreviewPane = React.forwardRef<PreviewPaneRef, PreviewPaneProps>(
	(
		{
			url,
			selectedBlockId,
			onFieldClick,
			onBlockClick,
			className,
			allowedOrigins,
			onReady,
		},
		ref,
	) => {
		const onReadyRef = React.useRef(onReady);
		React.useEffect(() => {
			onReadyRef.current = onReady;
		}, [onReady]);
		const { t } = useTranslation();
		const client = useAdminStore(selectClient);
		const iframeRef = React.useRef<HTMLIFrameElement>(null);
		const [isReady, setIsReady] = React.useState(false);
		const isReadyRef = React.useRef(false);
		const [iframeLoading, setIframeLoading] = React.useState(true);
		const [isRefreshing, setIsRefreshing] = React.useState(false);
		const isRefreshingRef = React.useRef(false);
		const pendingRefreshRef = React.useRef(false);
		const refreshMetricsRef = React.useRef({
			startedAt: 0,
			requested: 0,
			queued: 0,
			completed: 0,
			lastLogAt: 0,
		});
		// Buffer for the most recent INIT_SNAPSHOT payload — replayed on
		// every PREVIEW_READY received from the iframe so:
		//   1. an INIT_SNAPSHOT sent before the iframe is ready isn't lost
		//   2. an iframe reload (e.g. via NAVIGATE_PREVIEW or back/forward)
		//      re-receives the latest snapshot without the parent having
		//      to re-mint it
		const lastInitSnapshotRef = React.useRef<{
			snapshot: Record<string, unknown>;
			schemaVersion?: string;
			locale?: string;
			stage?: string;
		} | null>(null);

		const {
			data: previewUrl,
			error: tokenQueryError,
			isLoading: isTokenLoading,
		} = useQuery({
			queryKey: ["questpie", "preview-token", url],
			queryFn: async () => {
				const result = await (client as any).routes.mintPreviewToken({
					path: url,
					ttlMs: 60 * 60 * 1000,
				});
				return `/api/preview?token=${result.token}`;
			},
			enabled: !!url && !!client,
			staleTime: 50 * 60 * 1000,
			retry: false,
		});
		const previewUrlResolved = previewUrl ?? null;
		const tokenError =
			tokenQueryError instanceof Error
				? tokenQueryError.message
				: tokenQueryError
					? t("error.failedToGeneratePreviewToken")
					: null;
		const isLoading = isTokenLoading || iframeLoading;

		// Validate origin for security
		const isValidOrigin = React.useCallback(
			(origin: string): boolean => {
				if (!allowedOrigins || allowedOrigins.length === 0) {
					// If no origins specified, allow same origin and preview URL origin
					if (origin === window.location.origin) {
						return true;
					}
					try {
						const previewOrigin = new URL(url).origin;
						return origin === previewOrigin;
					} catch {
						return false;
					}
				}
				return allowedOrigins.includes(origin);
			},
			[url, allowedOrigins],
		);

		// Resolve the preview iframe origin once and re-use it for every
		// outbound message. Wildcard (`"*"`) targets are never used: if the
		// origin cannot be determined we drop the message rather than leak
		// admin state to an unknown frame.
		const targetOrigin = React.useMemo<string | null>(() => {
			try {
				const parsed = new URL(url, window.location.href);
				return parsed.origin;
			} catch {
				return null;
			}
		}, [url]);

		const sendToPreview = React.useCallback(
			(message: AdminToPreviewMessage) => {
				const iframe = iframeRef.current;
				if (!iframe?.contentWindow) return;
				if (!targetOrigin) {
					if (process.env.NODE_ENV !== "production") {
						console.warn(
							"[PreviewPane] Skipping postMessage — could not resolve preview origin from URL:",
							url,
						);
					}
					return;
				}
				try {
					iframe.contentWindow.postMessage(message, targetOrigin);
				} catch (err) {
					// `DataCloneError` lands here when a payload contains
					// a non-serializable value (function, class instance,
					// blob, etc.). We surface it loudly in dev and swallow
					// in production so a single misshapen field doesn't
					// take the workspace down.
					if (process.env.NODE_ENV !== "production") {
						console.error(
							`[PreviewPane] postMessage failed for type=${(message as { type?: string })?.type}:`,
							err,
						);
					}
				}
			},
			[targetOrigin, url],
		);

		const requestRefresh = React.useCallback(() => {
			if (!isReady) {
				return;
			}

			const metrics = refreshMetricsRef.current;
			const now = performance.now();
			if (!metrics.startedAt) {
				metrics.startedAt = now;
			}
			metrics.requested += 1;

			if (isRefreshingRef.current) {
				pendingRefreshRef.current = true;
				metrics.queued += 1;
				if (DEV_TELEMETRY && now - metrics.lastLogAt >= 5000) {
					metrics.lastLogAt = now;
					const elapsedSec = Math.max(1, (now - metrics.startedAt) / 1000);
					const refreshPerMinute = (metrics.completed * 60) / elapsedSec;
					console.debug(
						`[LivePreviewTelemetry] refresh requested=${metrics.requested} completed=${metrics.completed} queued=${metrics.queued} rpm=${refreshPerMinute.toFixed(1)}`,
					);
				}
				return;
			}

			isRefreshingRef.current = true;
			setIsRefreshing(true);
			sendToPreview({ type: "PREVIEW_REFRESH" });
		}, [isReady, sendToPreview]);

		// Expose refresh and focus methods via imperative handle
		React.useImperativeHandle(
			ref,
			() => ({
				triggerRefresh: () => {
					requestRefresh();
				},
				sendFocusToPreview: (fieldPath: string) => {
					if (isReady) {
						sendToPreview({ type: "FOCUS_FIELD", fieldPath });
					}
				},
				sendInitSnapshot: (snapshot, extras) => {
					// Buffer regardless of ready state so:
					//   - if the iframe isn't ready yet, the next
					//     PREVIEW_READY replays this snapshot
					//   - if the iframe later reloads, the new
					//     PREVIEW_READY re-receives it
					lastInitSnapshotRef.current = {
						snapshot,
						schemaVersion: extras?.schemaVersion,
						locale: extras?.locale,
						stage: extras?.stage,
					};
					if (!isReady) return;
					sendToPreview({
						type: "INIT_SNAPSHOT",
						snapshot,
						schemaVersion: extras?.schemaVersion,
						locale: extras?.locale,
						stage: extras?.stage,
					});
				},
				sendPatchBatch: (seq, ops) => {
					if (!isReady) return;
					sendToPreview({ type: "PATCH_BATCH", seq, ops });
				},
				sendCommit: (snapshot) => {
					if (!isReady) return;
					sendToPreview({
						type: "COMMIT",
						timestamp: Date.now(),
						snapshot,
					});
				},
				sendFullResync: (reason) => {
					if (!isReady) return;
					sendToPreview({ type: "FULL_RESYNC", reason });
				},
				sendSelectTarget: (fieldPath, extras) => {
					if (!isReady) return;
					sendToPreview({
						type: "SELECT_TARGET",
						fieldPath,
						kind: extras?.kind,
						blockId: extras?.blockId,
					});
				},
			}),
			[isReady, requestRefresh, sendToPreview],
		);

		// Listen for messages from preview
		React.useEffect(() => {
			const handleMessage = (event: MessageEvent<PreviewToAdminMessage>) => {
				// Validate origin
				if (!isValidOrigin(event.origin)) {
					return;
				}

				// Validate message structure
				if (!isPreviewToAdminMessage(event.data)) {
					return;
				}

				switch (event.data.type) {
					case "PREVIEW_READY": {
						isReadyRef.current = true;
						isRefreshingRef.current = false;
						pendingRefreshRef.current = false;
						refreshMetricsRef.current = {
							startedAt: 0,
							requested: 0,
							queued: 0,
							completed: 0,
							lastLogAt: 0,
						};
						setIsReady(true);
						setIframeLoading(false);
						setIsRefreshing(false);
						// Replay the most recent INIT_SNAPSHOT — covers
						// the bridge-fired-before-ready race AND the
						// iframe-reload re-init case.
						const buffered = lastInitSnapshotRef.current;
						if (buffered) {
							sendToPreview({
								type: "INIT_SNAPSHOT",
								snapshot: buffered.snapshot,
								schemaVersion: buffered.schemaVersion,
								locale: buffered.locale,
								stage: buffered.stage,
							});
						}
						// Fire the consumer-provided onReady AFTER the
						// buffered replay so the consumer can override
						// the buffer with a fresher payload (e.g. the
						// Visual Edit bridge re-seeding with current
						// form values after an iframe reload).
						onReadyRef.current?.();
						break;
					}

					case "REFRESH_COMPLETE":
						if (refreshMetricsRef.current.startedAt) {
							refreshMetricsRef.current.completed += 1;
						}
						if (pendingRefreshRef.current) {
							pendingRefreshRef.current = false;
							sendToPreview({ type: "PREVIEW_REFRESH" });
						} else {
							isRefreshingRef.current = false;
							setIsRefreshing(false);
							if (DEV_TELEMETRY) {
								const metrics = refreshMetricsRef.current;
								const now = performance.now();
								if (now - metrics.lastLogAt >= 5000 && metrics.startedAt) {
									metrics.lastLogAt = now;
									const elapsedSec = Math.max(
										1,
										(now - metrics.startedAt) / 1000,
									);
									const refreshPerMinute =
										(metrics.completed * 60) / elapsedSec;
									console.debug(
										`[LivePreviewTelemetry] refresh requested=${metrics.requested} completed=${metrics.completed} queued=${metrics.queued} rpm=${refreshPerMinute.toFixed(1)}`,
									);
								}
							}
						}
						break;

					case "FIELD_CLICKED":
						onFieldClick?.(event.data.fieldPath, {
							blockId: event.data.blockId,
							fieldType: event.data.fieldType,
						});
						break;

					case "BLOCK_CLICKED":
						onBlockClick?.(event.data.blockId);
						break;
				}
			};

			window.addEventListener("message", handleMessage);
			return () => window.removeEventListener("message", handleMessage);
		}, [isValidOrigin, onFieldClick, onBlockClick, sendToPreview]);

		// Send selected block updates
		React.useEffect(() => {
			if (isReady && selectedBlockId) {
				sendToPreview({ type: "SELECT_BLOCK", blockId: selectedBlockId });
			}
		}, [isReady, selectedBlockId, sendToPreview]);

		// Handle iframe load
		const handleLoad = React.useCallback(() => {
			// Preview should signal PREVIEW_READY, but set a fallback timeout
			setTimeout(() => {
				if (!isReadyRef.current) {
					setIframeLoading(false);
				}
			}, 3000);
		}, []);

		return (
			<div className={cn("relative h-full w-full", className)}>
				{/* Loading overlay */}
				{isLoading && (
					<div className="bg-muted absolute inset-0 z-10 flex items-center justify-center">
						<Icon
							icon="ph:spinner"
							className="text-muted-foreground h-6 w-6 animate-spin"
						/>
						<span className="text-muted-foreground ml-2 text-sm">
							{t("preview.loadingPreview")}
						</span>
					</div>
				)}

				{/* Error overlay */}
				{tokenError && (
					<div className="bg-muted absolute inset-0 z-10 flex items-center justify-center">
						<div className="bg-destructive/10 border-destructive text-destructive border px-4 py-3 text-sm">
							<p className="font-medium">{t("preview.previewError")}</p>
							<p>{tokenError}</p>
						</div>
					</div>
				)}

				{/* Refreshing indicator */}
				{isRefreshing && !isLoading && (
					<div className="bg-background absolute top-4 right-4 z-10 flex items-center gap-2 border px-3 py-2 shadow-md">
						<Icon
							icon="ph:spinner"
							className="text-muted-foreground h-4 w-4 animate-spin"
						/>
						<span className="text-muted-foreground text-sm">
							{t("preview.refreshing")}
						</span>
					</div>
				)}

				{/* Preview iframe */}
				{previewUrlResolved && (
					<iframe
						ref={iframeRef}
						src={previewUrlResolved}
						className="h-full w-full border-0"
						title={t("common.preview")}
						onLoad={handleLoad}
						sandbox="allow-scripts allow-same-origin allow-forms"
					/>
				)}
			</div>
		);
	},
);

PreviewPane.displayName = "PreviewPane";

// ============================================================================
// Preview Toggle Button
// ============================================================================

type PreviewToggleButtonProps = {
	/** Whether preview is currently visible */
	isPreviewVisible: boolean;
	/** Toggle handler */
	onToggle: () => void;
	/** Custom class name */
	className?: string;
};

/**
 * Button to toggle preview pane visibility.
 */
function _PreviewToggleButton({
	isPreviewVisible,
	onToggle,
	className,
}: PreviewToggleButtonProps) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onToggle}
			className={cn(
				"inline-flex items-center gap-2 px-3 py-1.5 text-sm",
				"border transition-colors",
				isPreviewVisible
					? "border-border-strong bg-surface-high text-foreground"
					: "border-border hover:bg-muted",
				className,
			)}
		>
			{isPreviewVisible ? t("preview.hidePreview") : t("preview.showPreview")}
		</button>
	);
}
