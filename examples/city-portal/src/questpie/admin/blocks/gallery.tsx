/**
 * Gallery Block Renderer
 */

import type { BlockProps } from "../.generated/client";

type GalleryImage = {
	id: string;
	caption?: string;
};

export function GalleryRenderer({ values, data }: BlockProps<"gallery">) {
	const imageUrls = (data as Record<string, any>)?.imageUrls || {};
	const images = (values.images as GalleryImage[] | null) || [];

	const columnsClasses: Record<string, string> = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-2 lg:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	};

	const gapClasses: Record<string, string> = {
		small: "gap-2",
		medium: "gap-4",
		large: "gap-8",
	};

	const columnsClass = columnsClasses[values.columns || "3"];
	const gapClass = gapClasses[values.gap || "medium"];

	return (
		<section className="px-6 py-16">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="mb-8 text-center text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}

				<div className={`grid grid-cols-1 ${columnsClass} ${gapClass}`}>
					{images.map((image) => {
						const url = imageUrls[image.id];
						return (
							<figure
								key={image.id}
								className="group bg-muted relative aspect-square overflow-hidden rounded-lg"
							>
								{url ? (
									<img
										src={url}
										alt={image.caption || ""}
										className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
								) : (
									<div className="text-muted-foreground flex h-full w-full items-center justify-center">
										No image
									</div>
								)}
								{values.showCaptions && image.caption && (
									<figcaption className="absolute right-0 bottom-0 left-0 bg-black/60 p-3 text-sm text-white">
										{image.caption}
									</figcaption>
								)}
							</figure>
						);
					})}
				</div>
			</div>
		</section>
	);
}
