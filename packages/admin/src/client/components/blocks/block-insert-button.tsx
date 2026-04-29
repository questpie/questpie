/**
 * Block Insert Button
 *
 * Button to add new blocks at a specific position.
 * Opens the block library sidebar.
 */

"use client";

import { Icon } from "@iconify/react";

import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { useBlockEditorActions } from "./block-editor-context.js";
import type { InsertPosition } from "./utils/tree-utils.js";

// ============================================================================
// Types
// ============================================================================

type BlockInsertButtonProps = {
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

export function BlockInsertButton({
	position,
	compact = false,
	variant = "default",
	parentLabel,
	className,
}: BlockInsertButtonProps) {
	const { t } = useTranslation();
	const { openLibrary } = useBlockEditorActions();

	const handleOpen = () => {
		openLibrary(position);
	};

	// Compact variant - thin hover line with add badge
	if (variant === "compact" || compact) {
		return (
			<div
				className={cn(
					"group relative z-10 -my-0.5 w-full cursor-pointer",
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
				<div className="bg-border-strong sm:group-hover:bg-foreground absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors sm:bg-transparent" />

				{/* Add button that appears on hover */}
				<div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
					<div className="bg-foreground text-background pointer-events-auto flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs shadow-sm">
						<Icon icon="ph:plus-bold" width={10} height={10} />
						<span>{t("common.add")}</span>
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
					"group text-muted-foreground hover:text-foreground relative flex min-h-10 items-center gap-2 text-xs font-medium transition-colors active:scale-[0.96]",
					className,
				)}
				onClick={handleOpen}
			>
				{/* Add button */}
				<div className="border-border bg-background text-muted-foreground group-hover:border-foreground group-hover:text-foreground relative z-10 flex h-5 w-5 items-center justify-center rounded-full border transition-[background-color,border-color,color]">
					<Icon icon="ph:plus" className="h-3 w-3" />
				</div>

				{/* Label */}
				<span className="truncate">
					{parentLabel
						? t("blocks.addTo", { parent: parentLabel })
						: t("blocks.add")}
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
			{t("blocks.add")}
		</Button>
	);
}
