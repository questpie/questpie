/**
 * LivePreviewMode Component
 *
 * Fullscreen overlay for live preview editing.
 * Left side: Form panel (inline, not portal)
 * Right side: Preview iframe
 * Mobile: Tabs to switch between form and preview
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import {
	FocusProvider,
	type FocusState,
	parsePreviewFieldPath,
	scrollFieldIntoView,
	useFocus,
} from "../../context/focus-context.js";
import { useIsMobile } from "../../hooks/use-media-query.js";
import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { PreviewPane, type PreviewPaneRef } from "./preview-pane.js";

// ============================================================================
// Types
// ============================================================================

interface LivePreviewModeProps {
	/** Whether preview mode is open */
	open: boolean;
	/** Callback to close preview mode */
	onClose: () => void;
	/** Form content rendered in the left pane */
	children: React.ReactNode;
	/** Preview URL (null while loading) */
	previewUrl: string | null;
	/** Optional external ref for preview pane control */
	previewRef?: React.RefObject<PreviewPaneRef | null>;
	/** Default preview pane size (percentage, 0-100). @default 50 */
	defaultSize?: number;
	/** Minimum preview pane size (percentage, 0-100). @default 30 */
	minSize?: number;
}

// ============================================================================
// Inner Component (with FocusContext access)
// ============================================================================

type LivePreviewContentProps = LivePreviewModeProps & {
	previewRef: React.RefObject<PreviewPaneRef | null>;
};

const DEV_TELEMETRY = process.env.NODE_ENV === "development";

// ============================================================================
// Resize Hook
// ============================================================================

function useResizablePane(defaultSize = 50, minSize = 30, enabled = true) {
	const [previewPercent, setPreviewPercent] = React.useState(defaultSize);
	const isDragging = React.useRef(false);
	const containerRef = React.useRef<HTMLDivElement>(null);

	const handleMouseDown = React.useCallback(
		(e: React.MouseEvent) => {
			if (!enabled) return;
			e.preventDefault();
			isDragging.current = true;
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		},
		[enabled],
	);

	React.useEffect(() => {
		if (!enabled) {
			return;
		}

		const handleMouseMove = (e: MouseEvent) => {
			if (!isDragging.current || !containerRef.current) return;
			const rect = containerRef.current.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const formPercent = (x / rect.width) * 100;
			const newPreview = Math.min(
				100 - minSize,
				Math.max(minSize, 100 - formPercent),
			);
			setPreviewPercent(newPreview);
		};
		const handleMouseUp = () => {
			if (isDragging.current) {
				isDragging.current = false;
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
			}
		};
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [enabled, minSize]);

	return { previewPercent, containerRef, handleMouseDown };
}

function useLivePreviewRenderTelemetry({
	open,
	isMobile,
	activeTab,
}: {
	open: boolean;
	isMobile: boolean;
	activeTab: "form" | "preview";
}) {
	const renderCountRef = React.useRef(0);
	const startAtRef = React.useRef(0);
	const lastLogAtRef = React.useRef(0);

	React.useEffect(() => {
		if (!DEV_TELEMETRY) return;

		if (!open) {
			renderCountRef.current = 0;
			startAtRef.current = 0;
			lastLogAtRef.current = 0;
			return;
		}

		const now = performance.now();
		if (!startAtRef.current) {
			startAtRef.current = now;
		}

		renderCountRef.current += 1;
		const shouldLogByCount = renderCountRef.current % 25 === 0;
		const shouldLogByTime = now - lastLogAtRef.current >= 5000;
		if (!shouldLogByCount && !shouldLogByTime) {
			return;
		}

		lastLogAtRef.current = now;
		const elapsedMs = Math.max(1, now - startAtRef.current);
		const rendersPerSecond = (renderCountRef.current * 1000) / elapsedMs;
		console.debug(
			`[LivePreviewTelemetry] renders=${renderCountRef.current} rps=${rendersPerSecond.toFixed(2)} mobile=${isMobile} tab=${activeTab}`,
		);
	});
}

function LivePreviewContent({
	open,
	onClose,
	children,
	previewUrl,
	previewRef,
	defaultSize = 50,
	minSize = 30,
}: LivePreviewContentProps) {
	const { t } = useTranslation();
	const isMobile = useIsMobile();
	const [activeTab, setActiveTab] = React.useState<"form" | "preview">("form");
	useLivePreviewRenderTelemetry({ open, isMobile, activeTab });
	const { previewPercent, containerRef, handleMouseDown } = useResizablePane(
		defaultSize,
		minSize,
		open && !isMobile,
	);

	// Access FocusContext
	const focusContext = useFocus();
	const focusState = focusContext.state; // Extract for effect dependency

	// Handle exit preview (clear draft mode cookie)
	const handleExitPreview = React.useCallback(() => {
		// Redirect to exit preview endpoint
		window.location.href = "/api/preview?disable=true";
	}, []);

	React.useEffect(() => {
		if (!open) {
			setActiveTab("form");
		}
	}, [open]);

	// Sync focus changes to preview iframe
	React.useEffect(() => {
		if (!open) return;
		if (!previewRef.current) return;

		if (focusState.type === "field") {
			previewRef.current.sendFocusToPreview(focusState.fieldPath);
		} else if (focusState.type === "block") {
			// Send full block field path
			if (focusState.fieldPath) {
				const fullPath = `content._values.${focusState.blockId}.${focusState.fieldPath}`;
				previewRef.current.sendFocusToPreview(fullPath);
			} else {
				// Just the block itself
				const fullPath = `content._values.${focusState.blockId}`;
				previewRef.current.sendFocusToPreview(fullPath);
			}
		}
	}, [focusState, previewRef, open]);

	// Keyboard navigation: Tab/Shift+Tab cycles through fields in preview form
	React.useEffect(() => {
		if (!open) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			const formScope = document.querySelector<HTMLElement>(
				"[data-preview-form-scope]",
			);
			if (!formScope) return;

			const fields = Array.from(
				formScope.querySelectorAll<HTMLElement>("[data-field-path]"),
			);
			if (fields.length === 0) return;

			// Only intercept Tab when focus is inside the form scope
			if (!formScope.contains(document.activeElement)) return;

			e.preventDefault();
			const currentPath =
				focusState.type === "field" ? focusState.fieldPath : null;
			const currentIdx = currentPath
				? fields.findIndex(
						(el) => el.getAttribute("data-field-path") === currentPath,
					)
				: -1;

			let nextIdx: number;
			if (e.shiftKey) {
				nextIdx = currentIdx <= 0 ? fields.length - 1 : currentIdx - 1;
			} else {
				nextIdx = currentIdx >= fields.length - 1 ? 0 : currentIdx + 1;
			}

			const nextField = fields[nextIdx];
			const nextPath = nextField?.getAttribute("data-field-path");
			if (nextPath) {
				focusContext.focusField(nextPath);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [focusState, focusContext, open]);

	// Preview click handlers - update FocusContext state
	const handlePreviewFieldClick = React.useCallback(
		(fieldPath: string, context?: any) => {
			const state = parsePreviewFieldPath(fieldPath, context);

			if (state.type === "field") {
				focusContext.focusField(state.fieldPath);
			} else if (state.type === "block") {
				focusContext.focusBlock(state.blockId, state.fieldPath);
			} else if (state.type === "relation") {
				focusContext.focusRelation(state.fieldPath, state.targetCollection);
			}
		},
		[focusContext],
	);

	const handlePreviewBlockClick = React.useCallback(
		(blockId: string) => {
			focusContext.focusBlock(blockId);
		},
		[focusContext],
	);

	return (
		<div
			className={
				open ? "bg-background fixed inset-0 z-50 flex flex-col" : "w-full"
			}
		>
			{/* Header */}
			{open && (
				<div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
					<div className="flex items-center gap-2">
						<Icon icon="ph:eye" className="text-muted-foreground h-4 w-4" />
						<span className="font-medium">{t("preview.livePreview")}</span>
					</div>

					{/* Mobile tabs in header */}
					{isMobile && (
						<Tabs
							value={activeTab}
							onValueChange={(v) => setActiveTab(v as "form" | "preview")}
							className="mx-4"
						>
							<TabsList className="h-8">
								<TabsTrigger value="form" className="px-3 text-xs">
									{t("common.form")}
								</TabsTrigger>
								<TabsTrigger value="preview" className="px-3 text-xs">
									{t("preview.title")}
								</TabsTrigger>
							</TabsList>
						</Tabs>
					)}

					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={handleExitPreview}
							className="gap-1.5"
							title={t("preview.exitTooltip")}
						>
							<Icon icon="ph:sign-out" className="h-4 w-4" />
							<span className="hidden sm:inline">
								{t("preview.exitPreview")}
							</span>
						</Button>
						<Button variant="ghost" size="icon" onClick={onClose}>
							<Icon icon="ph:x" className="h-4 w-4" />
							<span className="sr-only">{t("common.close")}</span>
						</Button>
					</div>
				</div>
			)}

			{/* Content */}
			<div
				ref={open && !isMobile ? containerRef : undefined}
				className={
					open
						? isMobile
							? "min-h-0 flex-1"
							: "flex min-h-0 flex-1"
						: "w-full"
				}
			>
				<div
					data-preview-form-scope
					className={
						open
							? isMobile
								? cn(
										"h-full overflow-y-auto p-6",
										activeTab !== "form" && "hidden",
									)
								: "bg-background h-full overflow-y-auto border-r p-6"
							: "w-full"
					}
					style={
						open && !isMobile
							? { width: `${100 - previewPercent}%` }
							: undefined
					}
				>
					{children}
				</div>

				{open && isMobile && (
					<div className={activeTab === "preview" ? "h-full" : "hidden"}>
						{previewUrl ? (
							<PreviewPane
								ref={previewRef}
								url={previewUrl}
								onFieldClick={handlePreviewFieldClick}
								onBlockClick={handlePreviewBlockClick}
							/>
						) : (
							<div className="flex h-full items-center justify-center">
								<Icon
									icon="ph:spinner"
									className="text-muted-foreground h-6 w-6 animate-spin"
								/>
								<span className="text-muted-foreground ml-2 text-sm">
									{t("preview.loadingPreview")}
								</span>
							</div>
						)}
					</div>
				)}

				{open && !isMobile && (
					<>
						{/* Drag handle */}
						<button
							type="button"
							aria-label="Resize preview pane"
							onMouseDown={handleMouseDown}
							onClick={(e) => e.preventDefault()}
							className="bg-border hover:bg-primary/40 w-1 shrink-0 cursor-col-resize appearance-none border-0 p-0 transition-colors"
						/>

						{/* Preview panel */}
						<div
							className="bg-muted min-w-0"
							style={{ width: `${previewPercent}%` }}
						>
							{previewUrl ? (
								<PreviewPane
									ref={previewRef}
									url={previewUrl}
									onFieldClick={handlePreviewFieldClick}
									onBlockClick={handlePreviewBlockClick}
								/>
							) : (
								<div className="flex h-full items-center justify-center">
									<Icon
										icon="ph:spinner"
										className="text-muted-foreground h-6 w-6 animate-spin"
									/>
									<span className="text-muted-foreground ml-2 text-sm">
										{t("preview.loadingPreview")}
									</span>
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function LivePreviewMode({
	open,
	onClose,
	children,
	previewUrl,
	previewRef: previewRefProp,
	defaultSize,
	minSize,
}: LivePreviewModeProps) {
	const fallbackPreviewRef = React.useRef<PreviewPaneRef>(null);
	const previewRef = previewRefProp ?? fallbackPreviewRef;

	// Handle focus changes from FocusContext - scroll to and focus the field
	const handleFocusChange = React.useCallback((state: FocusState) => {
		if (state.type === "field") {
			scrollFieldIntoView(state.fieldPath);
		} else if (state.type === "block") {
			// Wait for block form to render before scrolling
			setTimeout(() => {
				const fullPath = state.fieldPath
					? `content._values.${state.blockId}.${state.fieldPath}`
					: `content._values.${state.blockId}`;
				scrollFieldIntoView(fullPath);
			}, 150);
		}
	}, []);

	return (
		<FocusProvider onFocusChange={handleFocusChange}>
			<LivePreviewContent
				open={open}
				onClose={onClose}
				previewUrl={previewUrl}
				previewRef={previewRef}
				defaultSize={defaultSize}
				minSize={minSize}
			>
				{children}
			</LivePreviewContent>
		</FocusProvider>
	);
}
