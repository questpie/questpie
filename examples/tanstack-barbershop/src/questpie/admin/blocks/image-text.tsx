/**
 * Image-Text Block
 *
 * Image and text content side by side.
 * Design: Flexible layout with image on left or right.
 *
 * The `image` upload field is expanded via `.prefetch({ with: ['image'] })`.
 */

import { RichTextRenderer, type TipTapDoc } from "@questpie/admin/client";

import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function ImageTextRenderer({ values, data }: BlockProps<"image-text">) {
	const imageUrl = (data?.image?.url as string | undefined) || values.image;

	const aspectClass = {
		square: "aspect-square",
		portrait: "aspect-[3/4]",
		landscape: "aspect-[4/3]",
	}[values.imageAspect || "square"];

	const isImageRight = values.imagePosition === "right";
	const richTextStyles = {
		doc: "max-w-none",
		paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
		link: "text-highlight no-underline hover:underline",
		strong: "text-foreground font-semibold",
		blockquote: "border-l-highlight text-muted-foreground",
	};

	return (
		<section className="px-6 py-20">
			<div className="container">
				<div
					className={cn(
						"grid grid-cols-1 items-center gap-12 lg:grid-cols-2",
						isImageRight && "lg:grid-flow-dense",
					)}
				>
					{/* Image */}
					<div
						className={cn(
							"overflow-hidden rounded-lg",
							isImageRight && "lg:col-start-2",
						)}
					>
						<div className={cn("bg-muted", aspectClass)}>
							{imageUrl ? (
								<img
									src={imageUrl}
									alt={values.title || ""}
									className="h-full w-full object-cover"
								/>
							) : (
								<div className="text-muted-foreground flex h-full w-full items-center justify-center">
									No image
								</div>
							)}
						</div>
					</div>

					{/* Content */}
					<div className={cn(isImageRight && "lg:col-start-1 lg:row-start-1")}>
						<h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
							{values.title || "Title"}
						</h2>
						<div className="prose prose-neutral dark:prose-invert mb-6 max-w-none">
							<RichTextRenderer
								content={values.content}
								styles={richTextStyles}
							/>
						</div>
						{values.ctaText && values.ctaLink && (
							<a
								href={values.ctaLink}
								className={cn(
									buttonVariants({ size: "lg" }),
									"text-base font-semibold",
								)}
							>
								{values.ctaText}
							</a>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
