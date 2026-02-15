/**
 * Block Editor Layout
 *
 * Main layout for the block editor with inline editable blocks.
 * Uses a scrollable container with FAB for adding blocks.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { BlockCanvas } from "./block-canvas.js";
import {
	useBlockEditor,
	useBlockEditorActions,
} from "./block-editor-context.js";
import { BlockLibrarySidebar } from "./block-library-sidebar.js";

// ============================================================================
// Types
// ============================================================================

export type BlockEditorLayoutProps = {
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
	const { state } = useBlockEditor();
	const actions = useBlockEditorActions();
	const [sidebarOpen, setSidebarOpen] = React.useState(false);

	// Open sidebar with insert position at end of root
	const handleOpenSidebar = () => {
		actions.openLibrary({ parentId: null, index: state.content._tree.length });
		setSidebarOpen(true);
	};

	// Handle sidebar close
	const handleCloseSidebar = () => {
		setSidebarOpen(false);
		actions.closeLibrary();
	};

	// Sync sidebar state with context
	React.useEffect(() => {
		if (state.isLibraryOpen && !sidebarOpen) {
			setSidebarOpen(true);
		}
	}, [state.isLibraryOpen, sidebarOpen]);

	const hasBlocks = state.content._tree.length > 0;

	return (
		<div
			className={cn("relative flex flex-col", className)}
			style={{ minHeight }}
		>
			{/* Main content area */}
				<BlockCanvas />

				{/* Empty state hint */}
				{!hasBlocks && (
					<div className="py-8 text-center">
						<div className="text-muted-foreground">
							<Icon
								icon="ph:stack"
								className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4"
							/>
							<p className="text-sm font-medium">No blocks yet</p>
							<p className="text-xs text-muted-foreground mt-1">
								Add your first block to get started
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							className="mt-4"
							onClick={handleOpenSidebar}
						>
							<Icon icon="ph:plus" className="mr-2 h-4 w-4" />
							Add block
						</Button>
					</div>
				)}


			{/* Block Library Sidebar */}
			<BlockLibrarySidebar open={sidebarOpen} onClose={handleCloseSidebar} />
		</div>
	);
}
