/**
 * Heading Block Renderer
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export function HeadingRenderer({
	values,
}: BlockComponentProps<AppCMS, "heading">) {
	const Tag = values.level || "h2";

	const sizeClass = {
		h1: "text-4xl md:text-5xl",
		h2: "text-3xl md:text-4xl",
		h3: "text-2xl md:text-3xl",
		h4: "text-xl md:text-2xl",
	}[Tag];

	const alignClass = {
		left: "text-left",
		center: "text-center",
		right: "text-right",
	}[values.align || "left"];

	return (
		<section className="px-6 py-8">
			<Tag
				className={`font-bold tracking-tight text-foreground ${sizeClass} ${alignClass}`}
			>
				{values.text || "Heading"}
			</Tag>
		</section>
	);
}
