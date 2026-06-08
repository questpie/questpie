"use client";

import {
	DocumentView,
	type CollectionFormViewProps,
} from "@questpie/admin/client";

import { documentTitle, type KnowledgeDoc } from "../lib/knowledge-doc";
import { KNOWLEDGE_DOCUMENT_CONFIG } from "../views/file-detail";

/**
 * Editable text/markdown row → the framework `document` view primitive
 * (Notion-style, immediately editable, autosaving). The primitive brings its OWN
 * page shell (centered layout + title + autosave indicator), so this renderer is
 * returned directly by the dispatcher — not wrapped in the autopilot viewer
 * chrome. The `viewConfig.document` (declared once beside the `file-detail` view)
 * says which field is the body, which are property rows, and that edits autosave.
 *
 * Receives the form-view props (the primitive is a drop-in with the same
 * `CollectionFormViewProps`) plus the resolved `doc` used only to derive the page
 * title.
 */
export default function FileRenderDocument({
	doc,
	...props
}: { doc: KnowledgeDoc } & CollectionFormViewProps) {
	return (
		<DocumentView
			{...props}
			viewConfig={KNOWLEDGE_DOCUMENT_CONFIG}
			title={documentTitle(doc)}
		/>
	);
}
