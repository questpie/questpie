/**
 * Image + Text Block Renderer
 */

import {
	type BlockComponentProps,
	RichTextRenderer,
} from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export function ImageTextRenderer({
	values,
	data,
}: BlockComponentProps<AppCMS, "image-text">) {
	const imageUrl = data?.image?.url || values.image;

	const isImageLeft = values.imagePosition !== "right";

	return (
		<section className="py-16 px-6">
			<div
				className={`container mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center ${
					!isImageLeft ? "direction-rtl" : ""
				}`}
			>
				{/* Image */}
				<div className={!isImageLeft ? "md:order-2" : ""}>
					{imageUrl ? (
						<img
							src={imageUrl}
							alt={values.title || ""}
							className="w-full rounded-lg object-cover aspect-[4/3]"
						/>
					) : (
						<div className="w-full bg-muted rounded-lg aspect-[4/3] flex items-center justify-center text-muted-foreground">
							No image
						</div>
					)}
				</div>

				{/* Content */}
				<div className={!isImageLeft ? "md:order-1" : ""}>
					{values.title && (
						<h2 className="text-3xl font-bold tracking-tight mb-6">
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
							className="inline-flex items-center gap-2 text-primary font-semibold hover:underline"
						>
							{values.ctaText}
							<svg
								className="w-4 h-4"
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
