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
	BlockInsertRequestedMessage,
	FieldValueEditedMessage,
	PreviewPatchOp,
	PreviewToAdminMessage,
} from "../../preview/types.js";
import { isPreviewToAdminMessage } from "../../preview/types.js";
import { selectClient, useAdminStore } from "../../runtime/provider.js";

const DEV_TELEMETRY = process.env.NODE_ENV === "development";

// ============================================================================
// Types
// ============================================================================

export type PreviewPaneRef = {
	triggerRefresh: () => void;
	sendFocusToPreview: (fieldPath: string) => void;
	sendInitSnapshot: (data: unknown) => number;
	sendPatchBatch: (ops: PreviewPatchOp[], snapshotVersion?: number) => number;
	sendCommit: (data: unknown) => number;
	sendFullResync: (reason?: string) => void;
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
	/** Block insertion request handler */
	onBlockInsertRequest?: (message: BlockInsertRequestedMessage) => void;
	/** Inline field edit handler */
	onFieldValueEdited?: (message: FieldValueEditedMessage) => void;
	/** Patch acknowledgement handler */
	onPatchApplied?: (seq: number) => void;
	/** Resync request handler */
	onResyncRequest?: (reason?: string) => void;
	/** Custom class name */
	className?: string;
	/** Allowed preview origins (for security) */
	allowedOrigins?: string[];
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
			onBlockInsertRequest,
			onFieldValueEdited,
			onPatchApplied,
			onResyncRequest,
			className,
			allowedOrigins,
		},
		ref,
	) => {
		const { t } = useTranslation();
		const client = useAdminStore(selectClient);
		const iframeRef = React.useRef<HTMLIFrameElement>(null);
		const [isReady, setIsReady] = React.useState(false);
		const isReadyRef = React.useRef(false);
		const [iframeLoading, setIframeLoading] = React.useState(true);
		const [isRefreshing, setIsRefreshing] = React.useState(false);
		const isRefreshingRef = React.useRef(false);
		const pendingRefreshRef = React.useRef(false);
		const seqRef = React.useRef(0);
		const pendingMessagesRef = React.useRef<AdminToPreviewMessage[]>([]);
		const refreshMetricsRef = React.useRef({
			startedAt: 0,
			requested: 0,
			queued: 0,
			completed: 0,
			lastLogAt: 0,
		});

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

		const resolveUrlOrigin = React.useCallback((candidate: string | null) => {
			if (!candidate) return null;
			try {
				const base =
					typeof window === "undefined"
						? "http://localhost"
						: window.location.href;
				return new URL(candidate, base).origin;
			} catch {
				return null;
			}
		}, []);

		const targetOrigin = React.useMemo(() => {
			const resolvedPreviewOrigin = resolveUrlOrigin(previewUrlResolved);
			if (resolvedPreviewOrigin) return resolvedPreviewOrigin;

			const configuredPreviewOrigin = resolveUrlOrigin(url);
			if (configuredPreviewOrigin) return configuredPreviewOrigin;

			if (allowedOrigins?.length === 1) {
				return allowedOrigins[0];
			}

			return typeof window === "undefined" ? "*" : window.location.origin;
		}, [allowedOrigins, previewUrlResolved, resolveUrlOrigin, url]);

		const expectedOrigins = React.useMemo(() => {
			const origins = new Set<string>();
			if (typeof window !== "undefined") {
				origins.add(window.location.origin);
			}

			const resolvedPreviewOrigin = resolveUrlOrigin(previewUrlResolved);
			if (resolvedPreviewOrigin) origins.add(resolvedPreviewOrigin);

			const configuredPreviewOrigin = resolveUrlOrigin(url);
			if (configuredPreviewOrigin) origins.add(configuredPreviewOrigin);

			for (const origin of allowedOrigins ?? []) {
				origins.add(origin);
			}

			return origins;
		}, [allowedOrigins, previewUrlResolved, resolveUrlOrigin, url]);

		// Validate origin/source for security
		const isValidOrigin = React.useCallback(
			(origin: string): boolean => {
				return expectedOrigins.has(origin);
			},
			[expectedOrigins],
		);

		const getNextSeq = React.useCallback(() => {
			seqRef.current += 1;
			return seqRef.current;
		}, []);

		// Send message to preview iframe
		const sendToPreview = React.useCallback(
			(message: AdminToPreviewMessage, queueUntilReady = false) => {
				const iframe = iframeRef.current;
				if (!iframe?.contentWindow) {
					if (queueUntilReady) {
						pendingMessagesRef.current.push(message);
					}
					return;
				}

				if (queueUntilReady && !isReadyRef.current) {
					pendingMessagesRef.current.push(message);
					return;
				}

				iframe.contentWindow.postMessage(message, targetOrigin);
			},
			[targetOrigin],
		);

		const flushPendingMessages = React.useCallback(() => {
			const pending = pendingMessagesRef.current;
			if (pending.length === 0) return;

			pendingMessagesRef.current = [];
			for (const message of pending) {
				sendToPreview(message);
			}
		}, [sendToPreview]);

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
				sendInitSnapshot: (data: unknown) => {
					const seq = getNextSeq();
					sendToPreview({ type: "INIT_SNAPSHOT", seq, data }, true);
					return seq;
				},
				sendPatchBatch: (ops: PreviewPatchOp[], snapshotVersion?: number) => {
					const seq = getNextSeq();
					sendToPreview(
						{
							type: "PATCH_BATCH",
							seq,
							ops,
							snapshotVersion,
						},
						true,
					);
					return seq;
				},
				sendCommit: (data: unknown) => {
					const seq = getNextSeq();
					sendToPreview({ type: "COMMIT", seq, data }, true);
					return seq;
				},
				sendFullResync: (reason?: string) => {
					sendToPreview({ type: "FULL_RESYNC", reason }, true);
				},
			}),
			[getNextSeq, isReady, requestRefresh, sendToPreview],
		);

		// Listen for messages from preview
		React.useEffect(() => {
			const handleMessage = (event: MessageEvent<PreviewToAdminMessage>) => {
				// Validate origin
				if (!isValidOrigin(event.origin)) {
					return;
				}

				if (event.source !== iframeRef.current?.contentWindow) {
					return;
				}

				// Validate message structure
				if (!isPreviewToAdminMessage(event.data)) {
					return;
				}

				switch (event.data.type) {
					case "PREVIEW_READY":
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
						flushPendingMessages();
						break;

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

					case "BLOCK_INSERT_REQUESTED":
						onBlockInsertRequest?.(event.data);
						break;

					case "PATCH_APPLIED":
						onPatchApplied?.(event.data.seq);
						break;

					case "RESYNC_REQUEST":
						onResyncRequest?.(event.data.reason);
						sendToPreview(
							{ type: "FULL_RESYNC", reason: event.data.reason },
							true,
						);
						requestRefresh();
						break;

					case "FIELD_VALUE_EDITED":
						onFieldValueEdited?.(event.data);
						break;
				}
			};

			window.addEventListener("message", handleMessage);
			return () => window.removeEventListener("message", handleMessage);
		}, [
			flushPendingMessages,
			isValidOrigin,
			onFieldClick,
			onBlockClick,
			onBlockInsertRequest,
			onFieldValueEdited,
			onPatchApplied,
			onResyncRequest,
			requestRefresh,
			sendToPreview,
		]);

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
