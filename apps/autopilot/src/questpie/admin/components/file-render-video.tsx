"use client";

import { resolveBlobUrl, type KnowledgeDoc } from "../lib/knowledge-doc";
import FileRenderBlob from "./file-render-blob";

/**
 * Video row → inline native player (the browser handles the codecs it supports).
 * An unresolved url falls back to the download affordance. User-uploaded media has
 * no caption track; the player exposes `controls` for accessibility.
 */
export default function FileRenderVideo({ doc }: { doc: KnowledgeDoc }) {
	const url = resolveBlobUrl(doc);
	if (!url) return <FileRenderBlob doc={doc} />;
	return (
		<div className="border-border-subtle overflow-hidden rounded-[var(--surface-radius)] border bg-black">
			{/* biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no caption track */}
			<video src={url} controls className="max-h-[40rem] w-full">
				{doc.contentType ? <source src={url} type={doc.contentType} /> : null}
			</video>
		</div>
	);
}
