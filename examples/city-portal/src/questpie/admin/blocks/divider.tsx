/**
 * Divider Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function DividerRenderer({ values }: BlockProps<"divider">) {
	const widthClasses: Record<string, string> = {
		full: "w-full",
		medium: "w-1/2 mx-auto",
		small: "w-24 mx-auto",
	};

	const widthClass = widthClasses[values.width || "full"];
	const styleClass =
		values.style === "dashed"
			? "border-dashed"
			: values.style === "dotted"
				? "border-dotted"
				: "";

	return (
		<div className="px-6 py-8">
			<hr className={`border-border border-t ${widthClass} ${styleClass}`} />
		</div>
	);
}
