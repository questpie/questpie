/**
 * Block Insert Button
 *
 * Button to add new blocks at a specific position.
 * Opens the block library sidebar.
 */

"use client";

import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { useBlockEditorActions } from "./block-editor-context.js";
import type { InsertPosition } from "./utils/tree-utils.js";

// ============================================================================
// Types
// ============================================================================

export type BlockInsertButtonProps = {
	/** Position where the block will be inserted */
	position: InsertPosition;
	/** Compact style (shows on hover between blocks) */
	compact?: boolean;
	/** Rail variant for nested blocks (shows "Add to X" label) */
	variant?: "default" | "compact" | "rail";
	/** Parent block label (for rail variant) */
	parentLabel?: string;
	/** Custom class name */
	className?: string;
};

// ============================================================================
// Component
// ============================================================================

export function 	BlockInsertButton({
	position,
	compact = false,
	variant = "default",
	parentLabel,
	className,
}: BlockInsertButtonProps) {
	const { openLibrary } = useBlockEditorActions();

	const handleOpen = () => {
		openLibrary(position);
	};

	// Compact variant - thin hover line with add badge
	if (variant === "compact" || compact) {
		return (
			<div
				className={cn(
					"group relative w-full cursor-pointer -my-0.5 z-10",
					"h-2 sm:h-1.5",
					className,
				)}
				role="button"
				tabIndex={0}
				onClick={handleOpen}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						handleOpen();
					}
				}}
			>
				{/* Hover indicator line */}
				<div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary/40 transition-colors sm:bg-transparent sm:group-hover:bg-primary" />

				{/* Add button that appears on hover */}
				<div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
					<div className="pointer-events-auto flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground shadow-sm cursor-pointer">
						<Icon icon="ph:plus-bold" width={10} height={10} />
						<span>Add</span>
					</div>
				</div>
			</div>
		);
	}

	// Rail variant - for nested blocks with icon and label
	if (variant === "rail") {
		return (
			<button
				type="button"
				className={cn(
					"group flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors relative",
					className,
				)}
				onClick={handleOpen}
			>

				{/* Add button */}
				<div className="flex items-center justify-center w-5 h-5 rounded-full border border-border bg-background text-muted-foreground group-hover:border-foreground group-hover:text-foreground transition-all relative z-10">
					<Icon icon="ph:plus" className="w-3 h-3" />
				</div>

				{/* Label */}
				<span className="truncate">
					{parentLabel ? `Add to ${parentLabel}` : "Add block"}
				</span>
			</button>
		);
	}

	// Default variant - full button
	return (
		<Button
			variant="outline"
			className={cn("w-full border-dashed", className)}
			onClick={handleOpen}
		>
			<Icon icon="ph:plus" className="mr-2 h-4 w-4" />
			Add block
		</Button>
	);
}
