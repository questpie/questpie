import type { ChatAttachment } from "./chat-attachments";

export type KnowledgeAttachmentDoc = {
	id: string;
	title?: string | null;
	name?: string | null;
	path?: string | null;
	kind?: string | null;
	contentType?: string | null;
	body?: string | null;
	renderer?: string | null;
	source?: string | null;
	sourceRef?: string | null;
	scopeType?: string | null;
	project?: unknown;
	task?: unknown;
	run?: unknown;
	metadata?: unknown;
};

const MAX_ATTACHMENT_CONTENT_LENGTH = 4_000;
const MAX_SUMMARY_LENGTH = 260;
const MAX_METADATA_STRING_LENGTH = 320;

const USEFUL_METADATA_KEYS = new Set([
	"artifactType",
	"branch",
	"commit",
	"description",
	"language",
	"model",
	"provider",
	"runtime",
	"sha",
	"sourceUrl",
	"status",
	"summary",
	"title",
	"url",
	"workspacePath",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.replace(/\r\n/g, "\n").trim();
	return cleaned ? cleaned : undefined;
}

function truncate(value: string, maxLength: number) {
	if (value.length <= maxLength) return value;
	const sliced = value.slice(0, maxLength);
	const boundary = sliced.lastIndexOf(" ");
	const prefix =
		boundary > Math.floor(maxLength * 0.65)
			? sliced.slice(0, boundary)
			: sliced;
	return `${prefix.trimEnd()} [truncated]`;
}

function relationId(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value;
	if (isRecord(value) && typeof value.id === "string" && value.id.trim()) {
		return value.id;
	}
	return undefined;
}

function addIfValue(
	target: Record<string, unknown>,
	key: string,
	value: unknown,
) {
	if (value === undefined || value === null || value === "") return;
	target[key] = value;
}

function usefulMetadataValue(value: unknown): unknown {
	if (typeof value === "string") {
		const cleaned = value.replace(/\s+/g, " ").trim();
		return cleaned ? truncate(cleaned, MAX_METADATA_STRING_LENGTH) : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (
		Array.isArray(value) &&
		value.length <= 6 &&
		value.every(
			(item) =>
				typeof item === "string" ||
				typeof item === "number" ||
				typeof item === "boolean",
		)
	) {
		return value;
	}
	return undefined;
}

function sourceMetadata(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return {};
	const metadata: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (!USEFUL_METADATA_KEYS.has(key)) continue;
		addIfValue(metadata, key, usefulMetadataValue(item));
	}
	return metadata;
}

export function knowledgeLabel(doc: KnowledgeAttachmentDoc) {
	const title = cleanString(doc.title) ?? cleanString(doc.name);
	if (title) return title;
	const path = cleanString(doc.path);
	if (path) return path.split("/").at(-1) || path;
	return doc.id;
}

export function conciseKnowledgeContent(doc: KnowledgeAttachmentDoc) {
	const body = cleanString(doc.body);
	if (!body) return undefined;
	return truncate(body, MAX_ATTACHMENT_CONTENT_LENGTH);
}

export function knowledgeSummary(doc: KnowledgeAttachmentDoc) {
	const metadata = sourceMetadata(doc.metadata);
	const summary = cleanString(metadata.summary);
	if (summary) return truncate(summary, MAX_SUMMARY_LENGTH);
	const body = cleanString(doc.body);
	if (!body) return undefined;
	const plain = body
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim();
	return plain ? truncate(plain, MAX_SUMMARY_LENGTH) : undefined;
}

export function knowledgeAttachmentMetadata(doc: KnowledgeAttachmentDoc) {
	const metadata = sourceMetadata(doc.metadata);
	addIfValue(metadata, "path", cleanString(doc.path));
	addIfValue(metadata, "kind", cleanString(doc.kind));
	addIfValue(metadata, "contentType", cleanString(doc.contentType));
	addIfValue(metadata, "renderer", cleanString(doc.renderer));
	addIfValue(metadata, "sourceRef", cleanString(doc.sourceRef));
	addIfValue(metadata, "scopeType", cleanString(doc.scopeType));
	addIfValue(metadata, "projectId", relationId(doc.project));
	addIfValue(metadata, "taskId", relationId(doc.task));
	addIfValue(metadata, "runId", relationId(doc.run));
	return metadata;
}

export function knowledgeMetadataEntries(value: unknown) {
	return Object.entries(sourceMetadata(value));
}

export function knowledgeSourceLine(doc: KnowledgeAttachmentDoc) {
	return [
		cleanString(doc.kind),
		cleanString(doc.source),
		cleanString(doc.contentType),
	]
		.filter(Boolean)
		.join(" / ");
}

export function createKnowledgeChatAttachment(
	doc: KnowledgeAttachmentDoc,
): ChatAttachment {
	const attachment: ChatAttachment = {
		type: "ref",
		source: "knowledge-detail",
		label: knowledgeLabel(doc),
		refType: "knowledge",
		refId: doc.id,
	};
	const content = conciseKnowledgeContent(doc);
	if (content) attachment.content = content;
	const metadata = knowledgeAttachmentMetadata(doc);
	if (Object.keys(metadata).length > 0) attachment.metadata = metadata;
	return attachment;
}
