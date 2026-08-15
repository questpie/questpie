/**
 * Heading Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function HeadingRenderer({ values }: BlockProps<"heading">) {
	const Tag = (values.level || "h2") as "h1" | "h2" | "h3" | "h4";

	const sizeClasses: Record<string, string> = {
		h1: "text-4xl md:text-5xl",
		h2: "text-3xl md:text-4xl",
		h3: "text-2xl md:text-3xl",
		h4: "text-xl md:text-2xl",
	};

	const alignClasses: Record<string, string> = {
		left: "text-left",
		center: "text-center",
		right: "text-right",
	};

	const sizeClass = sizeClasses[values.level || "h2"];
	const alignClass = alignClasses[values.align || "left"];

	return (
		<section className="py-8">
			<div className="mx-auto max-w-7xl px-6">
				<Tag
					className={`text-foreground font-bold tracking-tight ${sizeClass} ${alignClass}`}
				>
					{values.text || "Heading"}
				</Tag>
			</div>
		</section>
	);
}
