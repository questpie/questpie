/**
 * Columns Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function ColumnsRenderer({ values, children }: BlockProps<"columns">) {
	const columnsClasses: Record<string, string> = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-2 lg:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	};

	const gapClasses: Record<string, string> = {
		small: "gap-4",
		medium: "gap-6 md:gap-8",
		large: "gap-8 md:gap-12",
	};

	const paddingClasses: Record<string, string> = {
		none: "py-0",
		small: "py-8",
		medium: "py-16",
		large: "py-24",
	};

	const columnsClass = columnsClasses[values.columns || "2"];
	const gapClass = gapClasses[values.gap || "medium"];
	const paddingClass = paddingClasses[values.padding || "medium"];

	return (
		<section className={paddingClass}>
			<div
				className={`mx-auto max-w-7xl px-6 grid grid-cols-1 ${columnsClass} ${gapClass}`}
			>
				{children}
			</div>
		</section>
	);
}
