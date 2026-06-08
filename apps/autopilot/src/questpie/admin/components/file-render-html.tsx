"use client";

import { hasUploadBlob, type KnowledgeDoc } from "../lib/knowledge-doc";
import FileRenderBlob from "./file-render-blob";

/**
 * HTML body row: render the markup sandboxed in an `<iframe srcDoc>` with the
 * source available in a collapsed `<details>`. An empty body falls back to a
 * download (blob row) or an empty-state.
 */
export default function FileRenderHtml({ doc }: { doc: KnowledgeDoc }) {
	const body = doc.body ?? "";
	if (!body.trim()) {
		if (hasUploadBlob(doc)) return <FileRenderBlob doc={doc} />;
		return (
			<div className="text-foreground-muted border-border-subtle rounded-[var(--surface-radius)] border px-4 py-8 text-center text-sm">
				No body content.
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
				<iframe
					title={doc.title ?? doc.path ?? "Knowledge preview"}
					sandbox=""
					srcDoc={body}
					className="h-[28rem] w-full bg-white"
				/>
			</div>
			<details className="border-border-subtle bg-card rounded-[var(--surface-radius)] border p-3">
				<summary className="text-foreground-muted hover:text-foreground cursor-pointer text-xs font-medium">
					Source
				</summary>
				<pre className="mt-3 max-h-[24rem] overflow-auto font-mono text-xs leading-relaxed tabular-nums whitespace-pre-wrap">
					{body}
				</pre>
			</details>
		</div>
	);
}
