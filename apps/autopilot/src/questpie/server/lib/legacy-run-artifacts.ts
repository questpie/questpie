import { Buffer } from "node:buffer";

import { ApiError } from "questpie/errors";

import { asRecord, relationId, stringFrom } from "./records";

export const legacyArtifactRefKinds = [
	"file",
	"url",
	"inline",
	"base64",
] as const;

export type LegacyArtifactRefKind = (typeof legacyArtifactRefKinds)[number];

export interface LegacyArtifactInput {
	title: string;
	path?: string;
	kind?: string;
	ref_kind?: LegacyArtifactRefKind;
	refKind?: LegacyArtifactRefKind;
	ref_value?: string;
	refValue?: string;
	content?: string;
	body?: string;
	mime_type?: string;
	mimeType?: string;
	content_type?: string;
	contentType?: string;
	metadata?: Record<string, unknown>;
	source?: "worker" | "mcp";
}

export function activeRunStatus(status: unknown) {
	return status === "pending" || status === "claimed" || status === "running";
}

export function artifactContentUrl(runId: string, artifactId: string) {
	return `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(
		artifactId,
	)}/content`;
}

export function legacyArtifactFromResource(resource: Record<string, unknown>) {
	const metadata = asRecord(resource.metadata);
	const refKind = stringFrom(metadata.refKind) ?? "inline";
	const refValue =
		refKind === "inline" || refKind === "base64"
			? typeof resource.body === "string"
				? resource.body
				: ""
			: (stringFrom(metadata.refValue) ?? "");

	return {
		id: String(resource.id),
		run_id: relationId(resource.run) ?? null,
		task_id: relationId(resource.task),
		kind:
			stringFrom(metadata.artifactKind) ?? stringFrom(resource.kind) ?? "other",
		title:
			stringFrom(resource.title) ?? stringFrom(resource.path) ?? "Artifact",
		ref_kind: refKind,
		ref_value: refValue,
		mime_type: stringFrom(resource.contentType),
		metadata: JSON.stringify({
			...metadata,
			knowledgeResourceId: resource.id,
		}),
		blob_id: null,
		created_at:
			resource.createdAt instanceof Date
				? resource.createdAt.toISOString()
				: typeof resource.createdAt === "string"
					? resource.createdAt
					: null,
	};
}

export function normalizeLegacyArtifact(input: LegacyArtifactInput) {
	const refKind = input.refKind ?? input.ref_kind ?? "inline";
	const refValue =
		input.refValue ?? input.ref_value ?? input.content ?? input.body ?? "";
	if (!refValue) throw ApiError.badRequest("ref_value is required");

	const inlineBody =
		refKind === "inline" || refKind === "base64" ? refValue : undefined;

	return {
		title: input.title,
		path: input.path,
		kind: input.kind,
		body: inlineBody,
		content: inlineBody,
		contentType:
			input.contentType ??
			input.content_type ??
			input.mimeType ??
			input.mime_type,
		mimeType: input.mimeType ?? input.mime_type,
		refKind,
		refValue,
		metadata: input.metadata,
		source: input.source,
	};
}

function bodyString(resource: Record<string, unknown>) {
	return typeof resource.body === "string" ? resource.body : "";
}

export async function artifactContentPayload(
	resource: Record<string, unknown>,
) {
	const metadata = asRecord(resource.metadata);
	const refKind = stringFrom(metadata.refKind) ?? "inline";
	const refValue = stringFrom(metadata.refValue);
	const contentType = stringFrom(resource.contentType) ?? "text/plain";

	if (refKind === "url" && refValue) {
		const upstream = await fetch(refValue);
		if (!upstream.ok) {
			throw ApiError.badRequest(
				`Failed to fetch artifact content (${upstream.status})`,
			);
		}
		const upstreamContentType =
			upstream.headers.get("content-type") ?? contentType;
		const bytes = Buffer.from(await upstream.arrayBuffer());
		return payloadFromBytes(bytes, upstreamContentType);
	}

	if (refKind === "file") {
		return {
			content_type: contentType,
			ref_kind: refKind,
			ref_value: refValue,
		};
	}

	if (refKind === "base64") {
		return payloadFromBytes(
			Buffer.from(bodyString(resource), "base64"),
			contentType,
		);
	}

	const text = bodyString(resource) || refValue || "";
	return {
		content_type: contentType,
		size: Buffer.byteLength(text),
		text,
	};
}

export async function artifactContentResponse(
	resource: Record<string, unknown>,
) {
	const payload = await artifactContentPayload(resource);
	const contentType = payload.content_type ?? "text/plain";

	if ("text" in payload && typeof payload.text === "string") {
		return new Response(payload.text, {
			headers: { "content-type": contentType },
		});
	}

	if ("base64" in payload && typeof payload.base64 === "string") {
		return new Response(Buffer.from(payload.base64, "base64"), {
			headers: { "content-type": contentType },
		});
	}

	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
	});
}

function payloadFromBytes(bytes: Buffer, contentType: string) {
	const isText =
		contentType.startsWith("text/") ||
		/(markdown|yaml|json|xml|javascript|typescript|openapi|swagger)/i.test(
			contentType,
		);

	return isText
		? {
				content_type: contentType,
				size: bytes.byteLength,
				text: bytes.toString("utf8"),
			}
		: {
				content_type: contentType,
				size: bytes.byteLength,
				base64: bytes.toString("base64"),
			};
}
