/**
 * Image + Text Block Renderer
 */

import { RichTextRenderer } from "@questpie/admin/client";

import type { BlockProps } from "../.generated/client";

export function ImageTextRenderer({ values, data }: BlockProps<"image-text">) {
	const imageUrl = (data?.image as any)?.url || values.image;
	const isImageLeft = values.imagePosition !== "right";

	return (
		<section className="px-6 py-16">
			<div
				className={`container mx-auto grid grid-cols-1 items-center gap-12 md:grid-cols-2 ${
					!isImageLeft ? "direction-rtl" : ""
				}`}
			>
				<div className={!isImageLeft ? "md:order-2" : ""}>
					{imageUrl ? (
						<img
							src={imageUrl}
							alt={values.title || ""}
							className="aspect-[4/3] w-full rounded-lg object-cover"
						/>
					) : (
						<div className="bg-muted text-muted-foreground flex aspect-[4/3] w-full items-center justify-center rounded-lg">
							No image
						</div>
					)}
				</div>

				<div className={!isImageLeft ? "md:order-1" : ""}>
					{values.title && (
						<h2 className="mb-6 text-3xl font-bold tracking-tight">
							{values.title}
						</h2>
					)}

					{values.content && (
						<div className="prose prose-neutral dark:prose-invert mb-6">
							<RichTextRenderer content={values.content} />
						</div>
					)}

					{values.ctaText && (
						<a
							href={values.ctaLink || "#"}
							className="text-primary inline-flex items-center gap-2 font-semibold hover:underline"
						>
							{values.ctaText}
							<svg
								className="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</a>
					)}
				</div>
			</div>
		</section>
	);
}
