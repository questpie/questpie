"use client";

import { resolveBlobUrl, type KnowledgeDoc } from "../lib/knowledge-doc";
import FileRenderBlob from "./file-render-blob";

/**
 * Office document (doc/docx/xls/xlsx/ppt/pptx): embed via the Microsoft Office
 * Online viewer when the blob is at a publicly reachable absolute URL; otherwise
 * fall back to download.
 */
export default function FileRenderOffice({ doc }: { doc: KnowledgeDoc }) {
	const url = resolveBlobUrl(doc);
	const isAbsolute = !!url && /^https?:\/\//i.test(url);
	if (url && isAbsolute) {
		const viewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
			url,
		)}`;
		return (
			<div className="space-y-3">
				<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
					<iframe
						title={doc.title ?? doc.path ?? "Document preview"}
						src={viewer}
						className="h-[40rem] w-full bg-white"
					/>
				</div>
				<FileRenderBlob doc={doc} />
			</div>
		);
	}
	return <FileRenderBlob doc={doc} />;
}
