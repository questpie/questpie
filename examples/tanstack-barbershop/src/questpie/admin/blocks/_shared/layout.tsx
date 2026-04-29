/**
 * Layout Blocks
 *
 * Columns, Spacer, Divider for page structure.
 * Design: Minimal utility blocks.
 */

import { cn } from "../../../../lib/utils";
import type { BlockProps } from "../../.generated/client";
import {
	getColumnsClass,
	getGapClass,
	getPaddingClass,
	getSpacerSizeClass,
} from "./utils";

// ============================================================================
// COLUMNS
// ============================================================================

export function ColumnsRenderer({ values, children }: BlockProps<"columns">) {
	return (
		<section className={cn("px-6", getPaddingClass(values.padding))}>
			<div
				className={cn(
					"container grid grid-cols-1",
					getColumnsClass(values.columns),
					getGapClass(values.gap),
				)}
			>
				{children}
			</div>
		</section>
	);
}

// ============================================================================
// SPACER
// ============================================================================

export function SpacerRenderer({ values }: BlockProps<"spacer">) {
	return <div className={getSpacerSizeClass(values.size)} aria-hidden="true" />;
}

// ============================================================================
// DIVIDER
// ============================================================================

const dividerWidthClasses = {
	full: "w-full",
	medium: "w-1/2 mx-auto",
	small: "w-24 mx-auto",
} as const;

export function DividerRenderer({ values }: BlockProps<"divider">) {
	const widthClass =
		dividerWidthClasses[
			(values.width || "full") as keyof typeof dividerWidthClasses
		] ?? dividerWidthClasses.full;

	return (
		<div className="px-6 py-8">
			<hr
				className={cn(
					"border-border border-t",
					widthClass,
					values.style === "dashed" && "border-dashed",
				)}
			/>
		</div>
	);
}
