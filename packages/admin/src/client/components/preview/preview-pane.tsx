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
	triggerRefresh: () => void;
	sendFocusToPreview: (fieldPath: string) => void;
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

		// Send message to preview iframe
		const sendToPreview = React.useCallback(
			(message: AdminToPreviewMessage) => {
				const iframe = iframeRef.current;
				if (!iframe?.contentWindow) return;

				try {
					const targetOrigin = new URL(url).origin;
					iframe.contentWindow.postMessage(message, targetOrigin);
				} catch {
					// If URL parsing fails, use wildcard (less secure)
					iframe.contentWindow.postMessage(message, "*");
				}
			},
			[url],
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
						<div className="bg-destructive/10 border-destructive text-destructive rounded-md border px-4 py-3 text-sm">
							<p className="font-medium">{t("preview.previewError")}</p>
							<p>{tokenError}</p>
						</div>
					</div>
				)}

				{/* Refreshing indicator */}
				{isRefreshing && !isLoading && (
					<div className="bg-background absolute top-4 right-4 z-10 flex items-center gap-2 rounded-md border px-3 py-2 shadow-md">
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
				"inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
				"border transition-colors",
				isPreviewVisible
					? "border-primary bg-primary/10 text-primary"
					: "border-border hover:bg-muted",
				className,
			)}
		>
			{isPreviewVisible ? t("preview.hidePreview") : t("preview.showPreview")}
		</button>
	);
}
