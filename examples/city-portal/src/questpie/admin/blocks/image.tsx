/**
 * Image Block Renderer
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export function ImageRenderer({
	values,
	data,
}: BlockComponentProps<AppCMS, "image">) {
	const imageUrl = data?.image?.url || values.image;

	const widthClass = {
		full: "max-w-none",
		medium: "max-w-3xl",
		small: "max-w-xl",
	}[values.width || "full"];

	const aspectClass = {
		original: "",
		square: "aspect-square",
		video: "aspect-video",
		portrait: "aspect-[3/4]",
	}[values.aspectRatio || "original"];

	return (
		<figure className={`mx-auto px-6 py-8 ${widthClass}`}>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt={values.alt || values.caption || ""}
					className={`w-full rounded-lg object-cover ${aspectClass}`}
				/>
			) : (
				<div
					className={`w-full bg-muted rounded-lg flex items-center justify-center text-muted-foreground ${aspectClass || "aspect-video"}`}
				>
					No image
				</div>
			)}
			{values.caption && (
				<figcaption className="mt-3 text-center text-sm text-muted-foreground">
					{values.caption}
				</figcaption>
			)}
		</figure>
	);
}
