"use client";

import { resolveBlobUrl, type KnowledgeDoc } from "../lib/knowledge-doc";
import FileRenderBlob from "./file-render-blob";

/**
 * Image row → inline preview. Resolves the blob url and renders it contained in a
 * bordered surface; an unresolved url falls back to the download affordance.
 */
export default function FileRenderImage({ doc }: { doc: KnowledgeDoc }) {
	const url = resolveBlobUrl(doc);
	if (!url) return <FileRenderBlob doc={doc} />;
	return (
		<div className="border-border-subtle bg-surface-mid flex justify-center overflow-hidden rounded-[var(--surface-radius)] border p-4">
			<img
				src={url}
				alt={doc.title ?? doc.path ?? "Image preview"}
				className="max-h-[40rem] max-w-full rounded-[var(--control-radius-inner)] object-contain"
			/>
		</div>
	);
}
