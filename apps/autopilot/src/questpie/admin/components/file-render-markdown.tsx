"use client";

import { type KnowledgeDoc } from "../lib/knowledge-doc";
import FileRenderBlob from "./file-render-blob";

/**
 * Read-only markdown render of a blob row's inline `body`. The framework
 * `document` view owns the EDITABLE inline-body rows (resolved by shape); this
 * renderer covers a markdown row that ALSO carries an uploaded blob — e.g.
 * `renderer:"markdown"` with a stored file — where the body is shown but not
 * edited. An empty body falls back to the download affordance, matching the
 * pre-refactor behavior for blob rows with no text body.
 */
function MarkdownBlock({ value }: { value: string }) {
	const trimmed = value.trim();
	const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
	if (heading) {
		const level = heading[1].length;
		// Real type scale: H1/H2 read as subsection headings (18-20px), H3/H4
		// step down toward body. Headings balance their wrap (DESIGN §Typography).
		if (level === 1) {
			return (
				<h2 className="text-foreground mt-8 text-xl font-semibold tracking-tight text-balance first:mt-0">
					{heading[2]}
				</h2>
			);
		}
		if (level === 2) {
			return (
				<h3 className="text-foreground mt-7 text-lg font-semibold tracking-tight text-balance first:mt-0">
					{heading[2]}
				</h3>
			);
		}
		if (level === 3) {
			return (
				<h4 className="text-foreground mt-6 text-base font-semibold text-balance first:mt-0">
					{heading[2]}
				</h4>
			);
		}
		return (
			<h5 className="text-foreground mt-5 text-sm font-semibold text-balance first:mt-0">
				{heading[2]}
			</h5>
		);
	}

	const lines = trimmed.split("\n");
	if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
		return (
			<ul className="text-foreground marker:text-foreground-subtle list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
				{lines.map((line, index) => (
					<li key={index} className="text-pretty">
						{line.replace(/^\s*[-*]\s+/, "")}
					</li>
				))}
			</ul>
		);
	}

	if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
		return (
			<ol className="text-foreground marker:text-foreground-subtle list-decimal space-y-1.5 pl-5 text-sm leading-relaxed tabular-nums">
				{lines.map((line, index) => (
					<li key={index} className="text-pretty">
						{line.replace(/^\s*\d+\.\s+/, "")}
					</li>
				))}
			</ol>
		);
	}

	return (
		<p className="text-foreground text-sm leading-relaxed text-pretty whitespace-pre-wrap">
			{trimmed}
		</p>
	);
}

function MarkdownPreview({ body }: { body: string }) {
	const blocks = body.split(/(```[\s\S]*?```)/g);
	return (
		<div className="space-y-4">
			{blocks.map((block, index) => {
				const fence = block.match(/^```([\w-]*)\n?([\s\S]*?)```$/);
				if (fence) {
					return (
						<pre
							key={index}
							className="bg-card border-border-subtle max-h-[38rem] overflow-auto rounded-[var(--surface-radius)] border p-4 font-mono text-xs leading-relaxed tabular-nums"
						>
							<code>{fence[2]}</code>
						</pre>
					);
				}

				return block
					.split(/\n{2,}/)
					.filter((part) => part.trim())
					.map((part, partIndex) => (
						<MarkdownBlock key={`${index}-${partIndex}`} value={part} />
					));
			})}
		</div>
	);
}

export default function FileRenderMarkdown({ doc }: { doc: KnowledgeDoc }) {
	const body = doc.body ?? "";
	if (!body.trim()) return <FileRenderBlob doc={doc} />;
	return <MarkdownPreview body={body} />;
}
