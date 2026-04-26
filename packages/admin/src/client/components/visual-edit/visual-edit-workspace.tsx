/**
 * VisualEditWorkspace
 *
 * Two-pane layout for the Visual Edit experience: preview canvas on
 * the left, inspector on the right (mobile collapses to tabs).
 *
 * Phase 2 MVP keeps the layout decoupled from the data layer — the
 * caller passes `renderInspector` (typically the configured
 * `VisualInspectorPanel`) and an iframe URL. Selection plumbing,
 * patch protocol, and form integration land in subsequent phases.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import { useIsMobile } from "../../hooks/use-media-query.js";
import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { PreviewPane, type PreviewPaneRef } from "../preview/preview-pane.js";
import {
	mapPreviewBlockClickToSelection,
	mapPreviewClickToSelection,
} from "./click-router.js";
import {
	VisualEditProvider,
	useVisualEdit,
} from "./visual-edit-context.js";
import type { VisualEditSelection } from "./types.js";

// ============================================================================
// Resize hook (kept local for now — will be promoted to a shared
// `useResizablePane` once the live preview also consumes it).
// ============================================================================

function useResizableInspector(
	defaultSize: number,
	minSize: number,
	enabled: boolean,
) {
	const [inspectorPercent, setInspectorPercent] = React.useState(defaultSize);
	const isDragging = React.useRef(false);
	const containerRef = React.useRef<HTMLDivElement>(null);

	const handleMouseDown = React.useCallback(
		(event: React.MouseEvent) => {
			if (!enabled) return;
			event.preventDefault();
			isDragging.current = true;
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		},
		[enabled],
	);

	React.useEffect(() => {
		if (!enabled) return;

		const handleMouseMove = (event: MouseEvent) => {
			if (!isDragging.current || !containerRef.current) return;
			const rect = containerRef.current.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const canvasPercent = (x / rect.width) * 100;
			const next = Math.min(
				100 - minSize,
				Math.max(minSize, 100 - canvasPercent),
			);
			setInspectorPercent(next);
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

	return { inspectorPercent, containerRef, handleMouseDown };
}

// ============================================================================
// Component
// ============================================================================

export type VisualEditWorkspaceProps = {
	/** Preview iframe URL (null while loading) */
	previewUrl: string | null;
	/** Allowed origins for preview postMessage validation */
	allowedOrigins?: string[];
	/** Inspector content — typically a configured `VisualInspectorPanel`. */
	renderInspector: () => React.ReactNode;
	/**
	 * Default inspector pane size, percentage 0–100.
	 * @default 32
	 */
	defaultInspectorSize?: number;
	/**
	 * Minimum inspector pane size, percentage 0–100.
	 * @default 24
	 */
	minInspectorSize?: number;
	/**
	 * Initial selection. Defaults to `{ kind: "idle" }` (Document mode).
	 */
	initialSelection?: VisualEditSelection;
	/**
	 * Selection change observer. Called for every `select`/`clear`.
	 */
	onSelectionChange?: (selection: VisualEditSelection) => void;
	/**
	 * Default `blocksPath` used when a preview click only carries a
	 * `blockId` hint (no fully-scoped path). Defaults to the canonical
	 * `content` blocks-field name.
	 */
	defaultBlocksPath?: string;
	/** Optional preview ref (refresh hooks etc.) */
	previewRef?: React.RefObject<PreviewPaneRef | null>;
	/** Custom class name applied to the workspace root */
	className?: string;
};

export function VisualEditWorkspace({
	previewUrl,
	allowedOrigins,
	renderInspector,
	defaultInspectorSize = 32,
	minInspectorSize = 24,
	initialSelection,
	onSelectionChange,
	defaultBlocksPath,
	previewRef: externalPreviewRef,
	className,
}: VisualEditWorkspaceProps) {
	const fallbackPreviewRef = React.useRef<PreviewPaneRef>(null);
	const previewRef = externalPreviewRef ?? fallbackPreviewRef;

	return (
		<VisualEditProvider
			initialSelection={initialSelection}
			onSelectionChange={onSelectionChange}
		>
			<VisualEditWorkspaceContent
				previewUrl={previewUrl}
				allowedOrigins={allowedOrigins}
				renderInspector={renderInspector}
				defaultInspectorSize={defaultInspectorSize}
				minInspectorSize={minInspectorSize}
				defaultBlocksPath={defaultBlocksPath}
				previewRef={previewRef}
				className={className}
			/>
		</VisualEditProvider>
	);
}

/**
 * Workspace content without the `VisualEditProvider`. Use this when
 * you need to mount the provider yourself (e.g. so a sibling effect
 * can `useVisualEdit()` to read or react to the active selection).
 *
 * Most consumers want `VisualEditWorkspace` instead, which wraps
 * this with the provider.
 */
export type VisualEditWorkspaceContentProps = Omit<
	VisualEditWorkspaceProps,
	"initialSelection" | "onSelectionChange"
>;

export function VisualEditWorkspaceContent({
	previewUrl,
	allowedOrigins,
	renderInspector,
	defaultInspectorSize = 32,
	minInspectorSize = 24,
	defaultBlocksPath,
	previewRef: externalPreviewRef,
	className,
}: VisualEditWorkspaceContentProps) {
	const fallbackPreviewRef = React.useRef<PreviewPaneRef>(null);
	const previewRef = externalPreviewRef ?? fallbackPreviewRef;
	return (
		<WorkspaceLayout
			previewUrl={previewUrl}
			allowedOrigins={allowedOrigins}
			renderInspector={renderInspector}
			defaultInspectorSize={defaultInspectorSize}
			minInspectorSize={minInspectorSize}
			defaultBlocksPath={defaultBlocksPath}
			previewRef={previewRef}
			className={className}
		/>
	);
}

type WorkspaceLayoutProps = Required<
	Pick<
		VisualEditWorkspaceProps,
		"renderInspector" | "defaultInspectorSize" | "minInspectorSize"
	>
> &
	Pick<
		VisualEditWorkspaceProps,
		"previewUrl" | "allowedOrigins" | "className" | "defaultBlocksPath"
	> & {
		previewRef: React.RefObject<PreviewPaneRef | null>;
	};

function WorkspaceLayout({
	previewUrl,
	allowedOrigins,
	renderInspector,
	defaultInspectorSize,
	minInspectorSize,
	defaultBlocksPath,
	previewRef,
	className,
}: WorkspaceLayoutProps) {
	const { t } = useTranslation();
	const isMobile = useIsMobile();
	const [activeTab, setActiveTab] = React.useState<"canvas" | "inspector">(
		"canvas",
	);
	const { select } = useVisualEdit();

	const { inspectorPercent, containerRef, handleMouseDown } =
		useResizableInspector(defaultInspectorSize, minInspectorSize, !isMobile);

	const handlePreviewFieldClick = React.useCallback(
		(
			fieldPath: string,
			context?: {
				blockId?: string;
				fieldType?: "regular" | "block" | "relation";
			},
		) => {
			select(
				mapPreviewClickToSelection({
					fieldPath,
					context,
					fallbackBlocksPath: defaultBlocksPath,
				}),
			);
			if (isMobile) {
				setActiveTab("inspector");
			}
		},
		[defaultBlocksPath, isMobile, select],
	);

	const handlePreviewBlockClick = React.useCallback(
		(blockId: string) => {
			select(
				mapPreviewBlockClickToSelection({
					blockId,
					fallbackBlocksPath: defaultBlocksPath,
				}),
			);
			if (isMobile) {
				setActiveTab("inspector");
			}
		},
		[defaultBlocksPath, isMobile, select],
	);

	return (
		<div
			data-visual-edit-workspace
			className={cn(
				"bg-background flex h-full min-h-0 w-full flex-col",
				className,
			)}
		>
			{isMobile && (
				<div className="flex shrink-0 items-center justify-center border-b px-2 py-2">
					<Tabs
						value={activeTab}
						onValueChange={(value) =>
							setActiveTab(value as "canvas" | "inspector")
						}
					>
						<TabsList className="h-8">
							<TabsTrigger value="canvas" className="px-3 text-xs">
								{t("preview.canvasTab", { defaultValue: "Preview" })}
							</TabsTrigger>
							<TabsTrigger value="inspector" className="px-3 text-xs">
								{t("preview.inspectorTab", { defaultValue: "Inspector" })}
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
			)}

			<div
				ref={!isMobile ? containerRef : undefined}
				className={cn("min-h-0 flex-1", !isMobile && "flex flex-row")}
			>
				{/* Canvas */}
				<div
					className={cn(
						"bg-muted min-h-0 min-w-0",
						isMobile
							? cn("h-full", activeTab !== "canvas" && "hidden")
							: "h-full",
					)}
					style={
						!isMobile
							? { width: `${100 - inspectorPercent}%` }
							: undefined
					}
				>
					{previewUrl ? (
						<PreviewPane
							ref={previewRef}
							url={previewUrl}
							allowedOrigins={allowedOrigins}
							onFieldClick={handlePreviewFieldClick}
							onBlockClick={handlePreviewBlockClick}
							className="h-full"
						/>
					) : (
						<CanvasPlaceholder />
					)}
				</div>

				{/* Resize handle (desktop only) */}
				{!isMobile && (
					<button
						type="button"
						aria-label={t("preview.resizePane", {
							defaultValue: "Resize inspector",
						})}
						onMouseDown={handleMouseDown}
						onClick={(event) => event.preventDefault()}
						className="bg-border hover:bg-border-strong w-1 shrink-0 cursor-col-resize appearance-none border-0 p-0 transition-colors"
					/>
				)}

				{/* Inspector */}
				<div
					className={cn(
						"min-h-0 min-w-0",
						isMobile
							? cn("h-full", activeTab !== "inspector" && "hidden")
							: "h-full",
					)}
					style={
						!isMobile ? { width: `${inspectorPercent}%` } : undefined
					}
				>
					{renderInspector()}
				</div>
			</div>
		</div>
	);
}

// ============================================================================
// Helpers
// ============================================================================

function CanvasPlaceholder() {
	const { t } = useTranslation();
	return (
		<div className="flex h-full items-center justify-center">
			<Icon
				icon="ph:spinner"
				className="text-muted-foreground h-6 w-6 animate-spin"
			/>
			<span className="text-muted-foreground ml-2 text-sm">
				{t("preview.loadingPreview")}
			</span>
		</div>
	);
}
