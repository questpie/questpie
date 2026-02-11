/**
 * Gallery Block Renderer
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

type GalleryImage = {
	id: string;
	caption?: string;
};

export function GalleryRenderer({
	values,
	data,
}: BlockComponentProps<AppCMS, "gallery">) {
	const imageUrls = (data as Record<string, any>)?.imageUrls || {};
	const images = (values.images as GalleryImage[] | null) || [];

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
		<section className="py-16 px-6">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="text-3xl font-bold tracking-tight mb-8 text-center">
						{values.title}
					</h2>
				)}

				<div className={`grid grid-cols-1 ${columnsClass} ${gapClass}`}>
					{images.map((image) => {
						const url = imageUrls[image.id];
						return (
							<figure
								key={image.id}
								className="group relative overflow-hidden rounded-lg bg-muted aspect-square"
							>
								{url ? (
									<img
										src={url}
										alt={image.caption || ""}
										className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center text-muted-foreground">
										No image
									</div>
								)}
								{values.showCaptions && image.caption && (
									<figcaption className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-3 text-sm">
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
