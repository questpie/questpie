import { view, type DocumentViewConfig } from "@questpie/admin/client";

export default view("file-detail", {
	kind: "form",
	component: () =>
		import("../components/knowledge-detail-component.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});

/**
 * Declarative `document` config for a text/markdown file row, co-located with the
 * `file-detail` view and consumed by the `file-render-document` renderer. The
 * `body` field is the dominant rich-text column; a CURATED set of meaningful
 * fields show as inline-editable property rows; edits autosave. Property names
 * absent from the resolved field map are silently dropped by the primitive.
 *
 * Only fields that carry signal are listed — scope, source provenance, and the
 * timestamps. The redundant/implied fields (`path`, `kind`, `contentType`,
 * `renderer`) and the usually-empty refs (`sourceRef`, `project`, `task`, `run`,
 * `metadata`) are intentionally omitted so the page reads like a clean document,
 * not a raw record dump.
 */
export const KNOWLEDGE_DOCUMENT_CONFIG: DocumentViewConfig = {
	document: {
		body: "body",
		title: "title",
		save: "autosave",
		properties: ["scopeType", "source", "createdAt", "updatedAt"],
	},
};
