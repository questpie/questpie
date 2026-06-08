"use client";

import { Icon } from "@iconify/react";

import { Button, getFileIcon } from "@questpie/admin/client";

import {
	resolveBlobUrl,
	type KnowledgeDoc,
} from "../lib/knowledge-doc";

/**
 * Download fallback for a blob row with no inline preview — also the resolver's
 * default renderer (`getComponents().fileRenderBlob`) when a row's `renderer` is
 * unknown. Uses the canonical `getFileIcon` for the neutral file glyph.
 */
export default function FileRenderBlob({ doc }: { doc: KnowledgeDoc }) {
	const url = resolveBlobUrl(doc);
	const name = doc.filename ?? doc.title ?? doc.path ?? "file";
	return (
		<div className="border-border-subtle bg-card flex flex-col items-center justify-center gap-3 rounded-[var(--surface-radius)] border px-4 py-12 text-center">
			<Icon
				icon={getFileIcon(doc.contentType ?? undefined)}
				className="text-foreground-subtle size-8"
			/>
			<div className="text-sm font-medium">{name}</div>
			{doc.contentType ? (
				<div className="text-foreground-muted font-mono text-xs">
					{doc.contentType}
				</div>
			) : null}
			{url ? (
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={<a href={url} download={doc.filename ?? undefined} />}
				>
					<Icon icon="ph:download-simple" data-icon="inline-start" />
					Download
				</Button>
			) : (
				<div className="text-foreground-muted text-xs">
					No downloadable file on this record.
				</div>
			)}
		</div>
	);
}
