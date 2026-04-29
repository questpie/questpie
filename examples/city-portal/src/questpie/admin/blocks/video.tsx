/**
 * Video Block Renderer
 */

import type { BlockProps } from "../.generated/client";

function getEmbedUrl(url: string): string | null {
	const ytMatch = url.match(
		/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
	);
	if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

	const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
	if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

	return null;
}

export function VideoRenderer({ values }: BlockProps<"video">) {
	const embedUrl = values.url ? getEmbedUrl(values.url) : null;

	return (
		<section className="px-6 py-16">
			<div className="container mx-auto max-w-4xl">
				{values.title && (
					<h2 className="mb-6 text-2xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}

				{embedUrl ? (
					<div className="bg-muted aspect-video overflow-hidden rounded-lg">
						<iframe
							src={embedUrl}
							title={values.title || "Video"}
							className="h-full w-full"
							allowFullScreen
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						/>
					</div>
				) : (
					<div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center rounded-lg">
						{values.url ? "Invalid video URL" : "No video URL provided"}
					</div>
				)}

				{values.caption && (
					<p className="text-muted-foreground mt-3 text-center text-sm">
						{values.caption}
					</p>
				)}
			</div>
		</section>
	);
}
