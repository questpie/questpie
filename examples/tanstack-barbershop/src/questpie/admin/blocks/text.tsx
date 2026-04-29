/**
 * Text Block
 *
 * Rich text content with prose styling.
 * Design: Clean typography with proper spacing.
 */

import { RichTextRenderer, type TipTapDoc } from "@questpie/admin/client";

import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function TextRenderer({ values }: BlockProps<"text">) {
	const maxWidthClass = {
		narrow: "max-w-xl",
		medium: "max-w-3xl",
		wide: "max-w-5xl",
		full: "max-w-none",
	}[values.maxWidth || "medium"];

	const alignClass = {
		left: "text-left",
		center: "text-center",
		right: "text-right",
	}[values.align || "center"];

	const paddingClass = {
		none: "py-0",
		small: "py-8",
		medium: "py-16",
		large: "py-24",
	}[values.padding || "medium"];

	const richTextStyles = {
		doc: "",
		paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
		heading1: "text-3xl font-bold tracking-tight mb-4",
		heading2: "text-2xl font-bold tracking-tight mb-3",
		heading3: "text-xl font-semibold tracking-tight mb-3",
		heading4: "text-lg font-semibold tracking-tight mb-2",
		heading5: "text-base font-semibold tracking-tight mb-2",
		heading6: "text-sm font-semibold tracking-tight mb-2",
		link: "text-highlight no-underline hover:underline",
		strong: "text-foreground font-semibold",
		blockquote: "border-l-highlight text-muted-foreground",
	};

	return (
		<section className={cn("px-6", paddingClass)}>
			<div
				className={cn(
					"prose prose-neutral dark:prose-invert mx-auto",
					"prose-headings:font-bold prose-headings:tracking-tight",
					"prose-p:text-muted-foreground prose-p:leading-relaxed",
					"prose-a:text-highlight prose-a:no-underline hover:prose-a:underline",
					"prose-strong:text-foreground prose-strong:font-semibold",
					"prose-blockquote:border-l-highlight prose-blockquote:text-muted-foreground",
					maxWidthClass,
					alignClass,
				)}
			>
				<RichTextRenderer content={values.content} styles={richTextStyles} />
			</div>
		</section>
	);
}
