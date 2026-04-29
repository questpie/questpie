/**
 * Block Editor Layout
 *
 * Main layout for the block editor with inline editable blocks.
 * Uses a scrollable container with FAB for adding blocks.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../i18n/hooks.js";
import { SEARCH_PARAMS_EVENT } from "../../lib/events.js";
import { RenderProfiler } from "../../lib/render-profiler.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { BlockCanvas } from "./block-canvas.js";
import {
	useBlockEditorActions,
	useBlockLibraryOpen,
	useBlockTree,
} from "./block-editor-context.js";
import { BlockLibrarySidebar } from "./block-library-sidebar.js";

// ============================================================================
// Types
// ============================================================================

type BlockEditorLayoutProps = {
	/** Custom class name */
	className?: string;
	/** Minimum height for the editor */
	minHeight?: number;
};

// ============================================================================
// Component
// ============================================================================

export function BlockEditorLayout({
	className,
	minHeight = 500,
}: BlockEditorLayoutProps) {
	const { t } = useTranslation();
	const actions = useBlockEditorActions();
	const tree = useBlockTree();
	const isLibraryOpen = useBlockLibraryOpen();

	// One-way sync: Zustand (source of truth) → URL (persistence mirror)
	React.useEffect(() => {
		const url = new URL(window.location.href);
		if (isLibraryOpen) {
			url.searchParams.set("sidebar", "block-library");
		} else if (url.searchParams.get("sidebar") === "block-library") {
			url.searchParams.delete("sidebar");
		}
		window.history.replaceState({}, "", url.toString());
		window.dispatchEvent(new Event(SEARCH_PARAMS_EVENT));
	}, [isLibraryOpen]);

	// Initialize from URL on mount (for page refresh with ?sidebar=block-library)
	const treeLengthRef = React.useRef(tree.length);
	React.useEffect(() => {
		treeLengthRef.current = tree.length;
	}, [tree.length]);
	React.useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("sidebar") === "block-library") {
			actions.openLibrary({
				parentId: null,
				index: treeLengthRef.current,
			});
		}
	}, [actions]);

	const handleOpenSidebar = () => {
		actions.openLibrary({ parentId: null, index: tree.length });
	};

	const handleCloseSidebar = () => {
		actions.closeLibrary();
	};

	const hasBlocks = tree.length > 0;

	return (
		<div
			className={cn("qa-block-editor relative flex flex-col", className)}
			style={{ minHeight }}
		>
			{/* Main content area */}
			<RenderProfiler id="blocks.canvas" minDurationMs={8}>
				<BlockCanvas />
			</RenderProfiler>

			{/* Empty state hint */}
			{!hasBlocks && (
				<div className="py-8 text-center">
					<div className="text-muted-foreground">
						<Icon
							icon="ph:stack"
							className="text-muted-foreground/30 mx-auto mb-4 h-12 w-12"
						/>
						<p className="text-sm font-medium">{t("blocks.emptyTitle")}</p>
						<p className="text-muted-foreground mt-1 text-xs">
							{t("blocks.addFirst")}
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="mt-4"
						onClick={handleOpenSidebar}
					>
						<Icon icon="ph:plus" className="mr-2 h-4 w-4" />
						{t("blocks.add")}
					</Button>
				</div>
			)}

			{/* Block Library Sidebar */}
			{isLibraryOpen && (
				<RenderProfiler id="blocks.library" minDurationMs={8}>
					<BlockLibrarySidebar
						open={isLibraryOpen}
						onClose={handleCloseSidebar}
					/>
				</RenderProfiler>
			)}
		</div>
	);
}
