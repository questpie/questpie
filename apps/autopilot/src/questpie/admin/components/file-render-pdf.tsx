"use client";

import { resolveBlobUrl, type KnowledgeDoc } from "../lib/knowledge-doc";
import FileRenderBlob from "./file-render-blob";

/** PDF row: browsers render `application/pdf` natively in an `<iframe>`. */
export default function FileRenderPdf({ doc }: { doc: KnowledgeDoc }) {
	const url = resolveBlobUrl(doc);
	if (!url) return <FileRenderBlob doc={doc} />;
	return (
		<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
			<iframe
				title={doc.title ?? doc.path ?? "PDF preview"}
				src={url}
				className="h-[40rem] w-full bg-white"
			/>
		</div>
	);
}
