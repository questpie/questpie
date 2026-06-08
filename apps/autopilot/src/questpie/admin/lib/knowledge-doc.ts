/**
 * Shared shape + helpers for a knowledge/asset row, imported by the file-detail
 * dispatcher and every `file-render-*` renderer component. Kept here (not inside
 * the detail component) so a discovered renderer can resolve its blob URL / app
 * id without importing the detail component itself.
 */

export type RelationValue =
	| string
	| { id?: string; title?: string; name?: string }
	| null;

export type KnowledgeDoc = {
	id: string;
	title?: string | null;
	path?: string | null;
	kind?: string | null;
	contentType?: string | null;
	body?: string | null;
	renderer?: string | null;
	source?: string | null;
	sourceRef?: string | null;
	scopeType?: string | null;
	/** Upload-blob fields (present when the row carries an uploaded file). */
	url?: string | null;
	key?: string | null;
	filename?: string | null;
	project?: RelationValue;
	task?: RelationValue;
	run?: RelationValue;
	metadata?: unknown;
	createdAt?: string | Date | null;
	updatedAt?: string | Date | null;
};

/**
 * Extract the `{appId}` from a `.app` bundle row path:
 * `company/apps/{appId}.app/...` → `{appId}`. Returns `null` when the path is not
 * inside an `.app` bundle.
 */
export function appIdFromPath(path: string | null | undefined): string | null {
	if (typeof path !== "string") return null;
	const match = path.match(/(?:^|\/)apps\/([a-z0-9][a-z0-9-]*)\.app\//);
	return match ? match[1] : null;
}

/** Resolve a same-origin-friendly blob URL for an upload row (or undefined). */
export function resolveBlobUrl(doc: KnowledgeDoc): string | undefined {
	const url = doc.url;
	if (typeof url !== "string" || url.trim().length === 0) return undefined;
	return url.trim();
}

/** A row that carries an uploaded blob (a `key`) rather than a text `body`. */
export function hasUploadBlob(doc: KnowledgeDoc): boolean {
	return typeof (doc as { key?: unknown }).key === "string";
}

/**
 * Human page title for a knowledge doc. Prefer an explicit `title`; otherwise
 * the file's display name (last path segment, e.g. `text-doc-test.md`) so the
 * document page never shows a raw record id. Falls back to the full path.
 */
export function documentTitle(doc: KnowledgeDoc): string | undefined {
	if (doc.title && doc.title.trim()) return doc.title.trim();
	const path = doc.path?.trim();
	if (!path) return undefined;
	const segment = path.split("/").filter(Boolean).pop();
	return segment || path;
}
