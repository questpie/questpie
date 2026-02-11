/**
 * Video Block Renderer
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

function getEmbedUrl(url: string): string | null {
	// YouTube
	const ytMatch = url.match(
		/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
	);
	if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

	// Vimeo
	const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
	if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

	return null;
}

export function VideoRenderer({
	values,
}: BlockComponentProps<AppCMS, "video">) {
	const embedUrl = values.url ? getEmbedUrl(values.url) : null;

	return (
		<section className="py-16 px-6">
			<div className="container mx-auto max-w-4xl">
				{values.title && (
					<h2 className="text-2xl font-bold tracking-tight mb-6">
						{values.title}
					</h2>
				)}

				{embedUrl ? (
					<div className="aspect-video rounded-lg overflow-hidden bg-muted">
						<iframe
							src={embedUrl}
							title={values.title || "Video"}
							className="w-full h-full"
							allowFullScreen
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						/>
					</div>
				) : (
					<div className="aspect-video rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
						{values.url ? "Invalid video URL" : "No video URL provided"}
					</div>
				)}

				{values.caption && (
					<p className="mt-3 text-center text-sm text-muted-foreground">
						{values.caption}
					</p>
				)}
			</div>
		</section>
	);
}
