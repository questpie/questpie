/**
 * Text Block Renderer
 */

import { RichTextRenderer } from "@questpie/admin/client";

import type { BlockProps } from "../.generated/client";

export function TextRenderer({ values }: BlockProps<"text">) {
	const maxWidthClasses: Record<string, string> = {
		narrow: "max-w-xl",
		medium: "max-w-3xl",
		wide: "max-w-5xl",
		full: "max-w-none",
	};

	const paddingClasses: Record<string, string> = {
		none: "py-0",
		small: "py-8",
		medium: "py-16",
		large: "py-24",
	};

	const maxWidthClass = maxWidthClasses[values.maxWidth || "medium"];
	const paddingClass = paddingClasses[values.padding || "medium"];

	const richTextStyles = {
		doc: `max-w-none ${maxWidthClass}`,
		paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
		heading1: "text-3xl font-bold tracking-tight mb-4",
		heading2: "text-2xl font-bold tracking-tight mb-3",
		heading3: "text-xl font-semibold tracking-tight mb-3",
		heading4: "text-lg font-semibold tracking-tight mb-2",
		link: "text-primary underline hover:no-underline",
		strong: "text-foreground font-semibold",
		blockquote: "border-l-primary text-muted-foreground",
	};

	return (
		<section className={`px-6 ${paddingClass}`}>
			<div className="prose prose-neutral dark:prose-invert mx-auto">
				<RichTextRenderer content={values.content} styles={richTextStyles} />
			</div>
		</section>
	);
}
