/**
 * Layout Block Renderers
 *
 * Columns, Spacer, Divider for page structure.
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

// ============================================================================
// COLUMNS
// ============================================================================

export function ColumnsRenderer({
	values,
	children,
}: BlockComponentProps<AppCMS, "columns">) {
	const columnsClass = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-2 lg:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	}[values.columns || "2"];

	const gapClass = {
		small: "gap-4",
		medium: "gap-6 md:gap-8",
		large: "gap-8 md:gap-12",
	}[values.gap || "medium"];

	const paddingClass = {
		none: "py-0",
		small: "py-8",
		medium: "py-16",
		large: "py-24",
	}[values.padding || "medium"];

	return (
		<section className={`px-6 ${paddingClass}`}>
			<div
				className={`container mx-auto grid grid-cols-1 ${columnsClass} ${gapClass}`}
			>
				{children}
			</div>
		</section>
	);
}

// ============================================================================
// SPACER
// ============================================================================

export function SpacerRenderer({
	values,
}: BlockComponentProps<AppCMS, "spacer">) {
	const sizeClass = {
		small: "h-8 md:h-12",
		medium: "h-12 md:h-20",
		large: "h-20 md:h-32",
		xlarge: "h-32 md:h-48",
	}[values.size || "medium"];

	return <div className={sizeClass} aria-hidden="true" />;
}

// ============================================================================
// DIVIDER
// ============================================================================

export function DividerRenderer({
	values,
}: BlockComponentProps<AppCMS, "divider">) {
	const widthClass = {
		full: "w-full",
		medium: "w-1/2 mx-auto",
		small: "w-24 mx-auto",
	}[values.width || "full"];

	const styleClass =
		values.style === "dashed"
			? "border-dashed"
			: values.style === "dotted"
				? "border-dotted"
				: "";

	return (
		<div className="py-8 px-6">
			<hr className={`border-t border-border ${widthClass} ${styleClass}`} />
		</div>
	);
}
