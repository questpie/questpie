/**
 * Image Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function ImageRenderer({ values, data }: BlockProps<"image">) {
	const imageUrl = (data?.image as any)?.url || values.image;

	const widthClasses: Record<string, string> = {
		full: "max-w-none",
		medium: "max-w-3xl",
		small: "max-w-xl",
	};

	const aspectClasses: Record<string, string> = {
		original: "",
		square: "aspect-square",
		video: "aspect-video",
		portrait: "aspect-[3/4]",
	};

	const widthClass = widthClasses[values.width || "full"];
	const aspectClass = aspectClasses[values.aspectRatio || "original"];

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
					className={`bg-muted text-muted-foreground flex w-full items-center justify-center rounded-lg ${aspectClass || "aspect-video"}`}
				>
					No image
				</div>
			)}
			{values.caption && (
				<figcaption className="text-muted-foreground mt-3 text-center text-sm">
					{values.caption}
				</figcaption>
			)}
		</figure>
	);
}
