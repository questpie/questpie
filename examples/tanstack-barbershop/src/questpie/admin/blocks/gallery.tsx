/**
 * Gallery Block
 *
 * Image gallery with grid layout.
 * Design: Responsive masonry-style grid with lightbox support.
 */

import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function GalleryRenderer({ values, data }: BlockProps<"gallery">) {
	const imageUrls =
		(data?.imageUrls as Record<string, string> | undefined) ?? {};

	const columnsClass = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-2 lg:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	}[values.columns || "3"];

	const gapClass = {
		small: "gap-2",
		medium: "gap-4",
		large: "gap-8",
	}[values.gap || "medium"];

	return (
		<section className="px-6 py-20">
			<div className="container">
				{values.title && (
					<h2 className="mb-12 text-center text-3xl font-bold tracking-tight sm:text-4xl">
						{values.title}
					</h2>
				)}

				<div className={cn("grid grid-cols-1", columnsClass, gapClass)}>
					{(values.images as unknown as string[])?.map((imageId) => {
						const url = imageUrls[imageId];
						return (
							<figure
								key={imageId}
								className="group bg-muted relative aspect-square cursor-pointer overflow-hidden rounded-lg transition-all hover:shadow-lg"
							>
								{url ? (
									<img
										src={url}
										alt=""
										className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
								) : (
									<div className="text-muted-foreground flex h-full w-full items-center justify-center">
										No image
									</div>
								)}
							</figure>
						);
					})}
				</div>
			</div>
		</section>
	);
}
