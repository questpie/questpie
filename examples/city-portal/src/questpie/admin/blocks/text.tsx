/**
 * Text Block Renderer
 *
 * Rich text content with prose styling.
 */

import {
	type BlockComponentProps,
	RichTextRenderer,
} from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export function TextRenderer({ values }: BlockComponentProps<AppCMS, "text">) {
	const maxWidthClass = {
		narrow: "max-w-xl",
		medium: "max-w-3xl",
		wide: "max-w-5xl",
		full: "max-w-none",
	}[values.maxWidth || "medium"];

	const paddingClass = {
		none: "py-0",
		small: "py-8",
		medium: "py-16",
		large: "py-24",
	}[values.padding || "medium"];

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
			<div className="mx-auto prose prose-neutral dark:prose-invert">
				<RichTextRenderer content={values.content} styles={richTextStyles} />
			</div>
		</section>
	);
}
