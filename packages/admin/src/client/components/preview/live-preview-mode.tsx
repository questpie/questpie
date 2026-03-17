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
import type { CollectionBuilderState } from "../../builder/types/collection-types.js";
import type { ComponentRegistry } from "../../builder/types/field-types.js";
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
import { LocaleScopeProvider } from "../../runtime/locale-scope.js";
import {
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../../runtime/provider.js";
import FormView from "../../views/collection/form-view.js";
import { Button } from "../ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { PreviewPane, type PreviewPaneRef } from "./preview-pane.js";

// ============================================================================
// Context
// ============================================================================

type LivePreviewContextValue = {
	triggerPreviewRefresh: () => void;
};

const LivePreviewContext = React.createContext<LivePreviewContextValue | null>(
	null,
);

export function useLivePreviewContext() {
	return React.useContext(LivePreviewContext);
}

// ============================================================================
// Types
// ============================================================================

interface LivePreviewModeProps {
	/** Whether preview mode is open */
	open: boolean;
	/** Callback to close preview mode */
	onClose: () => void;
	/** Collection name */
	collection: string;
	/** Item ID (for edit mode) */
	itemId?: string;
	/** Collection config */
	config?: any;
	/** All collections config (for embedded) */
	allCollectionsConfig?: Record<string, any>;
	/** Component registry */
	registry?: ComponentRegistry;
	/** Preview URL (null while loading) */
	previewUrl: string | null;
	/** Callback after successful save */
	onSuccess?: (data: any) => void;
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

// ============================================================================
// Resize Hook
// ============================================================================

function useResizablePane(defaultSize = 50, minSize = 30) {
	const [previewPercent, setPreviewPercent] = React.useState(defaultSize);
	const isDragging = React.useRef(false);
	const containerRef = React.useRef<HTMLDivElement>(null);

	const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		isDragging.current = true;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}, []);

	React.useEffect(() => {
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
	}, [minSize]);

	return { previewPercent, containerRef, handleMouseDown };
}

function LivePreviewContent({
	onClose,
	collection,
	itemId,
	config,
	allCollectionsConfig,
	registry,
	previewUrl,
	onSuccess,
	previewRef,
	defaultSize = 50,
	minSize = 30,
}: LivePreviewContentProps) {
	const { t } = useTranslation();
	const isMobile = useIsMobile();
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);
	const [activeTab, setActiveTab] = React.useState<"form" | "preview">("form");
	const { previewPercent, containerRef, handleMouseDown } = useResizablePane(
		defaultSize,
		minSize,
	);

	// Access FocusContext
	const focusContext = useFocus();
	const focusState = focusContext.state; // Extract for effect dependency

	// Handle exit preview (clear draft mode cookie)
	const handleExitPreview = React.useCallback(() => {
		// Redirect to exit preview endpoint
		window.location.href = "/api/preview?disable=true";
	}, []);

	// Sync focus changes to preview iframe
	React.useEffect(() => {
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
	}, [focusState, previewRef]);

	// Keyboard navigation: Tab/Shift+Tab cycles through fields in preview form
	React.useEffect(() => {
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
				nextIdx =
					currentIdx <= 0 ? fields.length - 1 : currentIdx - 1;
			} else {
				nextIdx =
					currentIdx >= fields.length - 1 ? 0 : currentIdx + 1;
			}

			const nextField = fields[nextIdx];
			const nextPath = nextField?.getAttribute("data-field-path");
			if (nextPath) {
				focusContext.focusField(nextPath);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [focusState, focusContext]);

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

	// Use provided config or undefined (schema-driven)
	const resolvedConfig = config;
	const resolvedAllCollections = allCollectionsConfig;

	return (
		<div className="fixed inset-0 z-50 bg-background flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
				<div className="flex items-center gap-2">
					<Icon icon="ph:eye" className="h-4 w-4 text-muted-foreground" />
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
							<TabsTrigger value="form" className="text-xs px-3">
								{t("common.form")}
							</TabsTrigger>
							<TabsTrigger value="preview" className="text-xs px-3">
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
						<span className="hidden sm:inline">{t("preview.exitPreview")}</span>
					</Button>
					<Button variant="ghost" size="icon" onClick={onClose}>
						<Icon icon="ph:x" className="h-4 w-4" />
						<span className="sr-only">{t("common.close")}</span>
					</Button>
				</div>
			</div>

			{/* Content */}
			{isMobile ? (
				/* Mobile: Tabs content */
				<div className="flex-1 min-h-0">
					{activeTab === "form" ? (
						<div className="h-full overflow-y-auto p-6" data-preview-form-scope>
							<LocaleScopeProvider>
								<FormView
									collection={collection}
									id={itemId}
									config={resolvedConfig}
									allCollectionsConfig={resolvedAllCollections}
									registry={registry}
									navigate={navigate}
									basePath={basePath}
									onSuccess={onSuccess}
									showMeta={false}
								/>
							</LocaleScopeProvider>
						</div>
					) : (
						<div className="h-full">
							{previewUrl ? (
								<PreviewPane
									ref={previewRef}
									url={previewUrl}
									onFieldClick={handlePreviewFieldClick}
									onBlockClick={handlePreviewBlockClick}
								/>
							) : (
								<div className="h-full flex items-center justify-center">
									<Icon
										icon="ph:spinner"
										className="h-6 w-6 animate-spin text-muted-foreground"
									/>
									<span className="ml-2 text-sm text-muted-foreground">
										{t("preview.loadingPreview")}
									</span>
								</div>
							)}
						</div>
					)}
				</div>
			) : (
				/* Desktop: Side by side with resizable pane */
				<div ref={containerRef} className="flex-1 flex min-h-0">
					{/* Form panel */}
					<div
						data-preview-form-scope
						className="h-full border-r bg-background overflow-y-auto p-6"
						style={{ width: `${100 - previewPercent}%` }}
					>
						<LocaleScopeProvider>
							<FormView
								collection={collection}
								id={itemId}
								config={resolvedConfig}
								allCollectionsConfig={resolvedAllCollections}
								registry={registry}
								navigate={navigate}
								basePath={basePath}
								onSuccess={onSuccess}
								showMeta={false}
							/>
						</LocaleScopeProvider>
					</div>

					{/* Drag handle */}
					<div
						onMouseDown={handleMouseDown}
						className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors"
					/>

					{/* Preview panel */}
					<div
						className="min-w-0 bg-muted"
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
							<div className="h-full flex items-center justify-center">
								<Icon
									icon="ph:spinner"
									className="h-6 w-6 animate-spin text-muted-foreground"
								/>
								<span className="ml-2 text-sm text-muted-foreground">
									{t("preview.loadingPreview")}
								</span>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function LivePreviewMode({
	open,
	onClose,
	collection,
	itemId,
	config,
	allCollectionsConfig,
	registry,
	previewUrl,
	onSuccess,
	defaultSize,
	minSize,
}: LivePreviewModeProps) {
	// Create ref for PreviewPane
	const previewRef = React.useRef<PreviewPaneRef>(null);

	// Create context value with refresh callback
	const contextValue = React.useMemo(
		() => ({
			triggerPreviewRefresh: () => {
				previewRef.current?.triggerRefresh();
			},
		}),
		[],
	);

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

	if (!open) return null;

	return (
		<LivePreviewContext.Provider value={contextValue}>
			<FocusProvider onFocusChange={handleFocusChange}>
				<LivePreviewContent
					open={open}
					onClose={onClose}
					collection={collection}
					itemId={itemId}
					config={config}
					allCollectionsConfig={allCollectionsConfig}
					registry={registry}
					previewUrl={previewUrl}
					onSuccess={onSuccess}
					previewRef={previewRef}
					defaultSize={defaultSize}
					minSize={minSize}
				/>
			</FocusProvider>
		</LivePreviewContext.Provider>
	);
}

// ============================================================================
// Trigger Button Component
// ============================================================================

interface LivePreviewButtonProps {
	onClick: () => void;
	disabled?: boolean;
}

function LivePreviewButton({ onClick, disabled }: LivePreviewButtonProps) {
	const { t } = useTranslation();
	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			className="size-9"
			onClick={onClick}
			disabled={disabled}
			title={t("preview.livePreview")}
		>
			<Icon icon="ph:eye" className="size-4" />
			<span className="sr-only">{t("preview.livePreview")}</span>
		</Button>
	);
}
