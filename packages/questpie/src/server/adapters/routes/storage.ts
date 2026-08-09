/**
 * Storage Routes
 *
 * File upload and serving route handlers.
 */

import { and, eq, isNull } from "drizzle-orm";
import { alias, type PgTable } from "drizzle-orm/pg-core";
import type { Files } from "files-sdk";

import type { CollectionAccess } from "../../collection/builder/types.js";
import { buildWhereClause } from "../../collection/crud/query-builders/where-builder.js";
import { executeAccessRule } from "../../collection/crud/shared/access-control.js";
import { getColumn } from "../../collection/crud/shared/index.js";
import type { Questpie } from "../../config/questpie.js";
import type { StorageVisibility } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { verifySignedUrlToken } from "../../modules/core/integrated/storage/signed-url.js";
import type { AdapterConfig, AdapterContext, UploadFile } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { resolveUpload } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

// ============================================================================
// Standalone Handlers
// ============================================================================

type ByteRange = {
	start: number;
	end: number;
	length: number;
};

type StorageRouteContext = {
	storage: Files;
};

const FILE_EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
	"3gp": "video/3gpp",
	aac: "audio/aac",
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	heic: "image/heic",
	heif: "image/heif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	m4a: "audio/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	mpeg: "video/mpeg",
	mpg: "video/mpeg",
	ogg: "audio/ogg",
	ogv: "video/ogg",
	png: "image/png",
	wav: "audio/wav",
	webm: "video/webm",
	webp: "image/webp",
};

const mimeTypeFromFilename = (filename: unknown): string | undefined => {
	if (typeof filename !== "string") return undefined;
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === filename.length - 1) return undefined;
	const extension = filename.slice(dotIndex + 1).toLowerCase();
	return FILE_EXTENSION_MIME_TYPES[extension];
};

const getStorageFromContext = (
	context: AdapterContext["appContext"],
	app: Questpie<any>,
): Files => {
	const storage =
		(context as AdapterContext["appContext"] & Partial<StorageRouteContext>)
			.storage ?? app.storage;
	if (!storage) {
		throw ApiError.internal("Storage not configured");
	}
	return storage as Files;
};

async function matchesServeAccessWhere(params: {
	app: Questpie<any>;
	collection: {
		table: PgTable;
		i18nTable?: PgTable | null;
		state: any;
	};
	accessWhere: Record<string, unknown>;
	recordId: unknown;
	context: AdapterContext["appContext"];
}): Promise<boolean> {
	const { app, collection, accessWhere, recordId, context } = params;
	const db = context.db ?? app.db;
	const table = collection.table;
	const idColumn = getColumn(table, "id");
	if (!idColumn || recordId === null || recordId === undefined) return false;

	const i18nSource = collection.i18nTable ?? null;
	const locale = context.locale ?? context.defaultLocale ?? "en";
	const defaultLocale = context.defaultLocale ?? locale;
	const needsFallback =
		!!i18nSource &&
		context.localeFallback !== false &&
		locale !== defaultLocale;
	const i18nCurrentTable = i18nSource
		? alias(i18nSource, "storage_serve_i18n_current")
		: null;
	const i18nFallbackTable =
		i18nSource && needsFallback
			? alias(i18nSource, "storage_serve_i18n_fallback")
			: null;

	const accessPredicate = buildWhereClause(accessWhere as any, {
		table,
		state: collection.state,
		i18nCurrentTable,
		i18nFallbackTable,
		context,
		app,
		useI18n: !!i18nSource,
		db,
		failClosedAccess: true,
	});
	if (!accessPredicate) return false;

	let query: any = db.select({ id: idColumn }).from(table);
	if (i18nCurrentTable) {
		query = query.leftJoin(
			i18nCurrentTable,
			and(
				eq(getColumn(i18nCurrentTable, "parentId")!, idColumn),
				eq(getColumn(i18nCurrentTable, "locale")!, locale),
			),
		);
	}
	if (i18nFallbackTable) {
		query = query.leftJoin(
			i18nFallbackTable,
			and(
				eq(getColumn(i18nFallbackTable, "parentId")!, idColumn),
				eq(getColumn(i18nFallbackTable, "locale")!, defaultLocale),
			),
		);
	}

	const predicates = [eq(idColumn, recordId), accessPredicate];
	if (collection.state.options?.softDelete) {
		const deletedAt = getColumn(table, "deletedAt");
		if (deletedAt) predicates.push(isNull(deletedAt));
	}

	const rows = await query.where(and(...predicates)).limit(1);
	return rows.length === 1;
}

const toUint8Array = (chunk: unknown): Uint8Array => {
	if (chunk instanceof Uint8Array) return chunk;
	if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
	if (ArrayBuffer.isView(chunk)) {
		return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	return new TextEncoder().encode(String(chunk));
};

const parseByteRange = (
	rangeHeader: string,
	totalSize: number,
): ByteRange | "unsatisfiable" | null => {
	const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;

	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return null;
	if (totalSize <= 0) return "unsatisfiable";

	let start: number;
	let end: number;

	if (rawStart === "") {
		const suffixLength = Number.parseInt(rawEnd, 10);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
		start = Math.max(totalSize - suffixLength, 0);
		end = totalSize - 1;
	} else {
		start = Number.parseInt(rawStart, 10);
		end = rawEnd === "" ? totalSize - 1 : Number.parseInt(rawEnd, 10);
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (start > end || start >= totalSize) return "unsatisfiable";

	end = Math.min(end, totalSize - 1);
	return { start, end, length: end - start + 1 };
};

const createRangeStream = (
	stream: ReadableStream<Uint8Array>,
	start: number,
	end: number,
): ReadableStream<Uint8Array> => {
	const reader = stream.getReader();
	let offset = 0;
	let closed = false;

	const close = async () => {
		if (closed) return;
		closed = true;
		await reader.cancel();
	};

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (closed) {
				controller.close();
				return;
			}

			try {
				while (true) {
					const next = await reader.read();
					if (next.done) {
						closed = true;
						controller.close();
						return;
					}

					const chunk = toUint8Array(next.value);
					const chunkStart = offset;
					const chunkEnd = offset + chunk.byteLength - 1;
					offset += chunk.byteLength;

					if (chunkEnd < start) continue;
					if (chunkStart > end) {
						await close();
						controller.close();
						return;
					}

					const sliceStart = Math.max(start - chunkStart, 0);
					const sliceEnd = Math.min(end - chunkStart + 1, chunk.byteLength);
					if (sliceEnd > sliceStart) {
						controller.enqueue(chunk.subarray(sliceStart, sliceEnd));
					}

					if (chunkEnd >= end) {
						await close();
						controller.close();
					}
					return;
				}
			} catch (error) {
				await close().catch(() => {});
				controller.error(error);
			}
		},
		async cancel() {
			await close();
		},
	});
};

/**
 * Upload a file to a collection.
 * POST /:collection/upload
 */
export async function storageCollectionUpload(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
	file?: UploadFile | null,
): Promise<Response> {
	const errorResponse = (
		error: unknown,
		req: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request: req, app, locale });
	};
	const resolved = await resolveContext(app, request, config, context);

	if (request.method !== "POST") {
		return errorResponse(
			ApiError.badRequest(
				"Method not allowed",
				undefined,
				"error.methodNotAllowed",
			),
			request,
			resolved.appContext.locale,
		);
	}

	const { collection } = params;

	// Check if collection exists and has upload configured
	let collectionConfig: any;
	try {
		collectionConfig = app.getCollectionConfig(collection as any);
	} catch {
		return errorResponse(
			ApiError.notFound("Collection", collection),
			request,
			resolved.appContext.locale,
		);
	}

	// Check if upload is enabled for this collection
	if (!collectionConfig.state?.upload) {
		return errorResponse(
			ApiError.badRequest(
				`Collection "${collection}" does not support file uploads. Use .upload() to enable.`,
				undefined,
				"upload.collectionNotSupported",
				{ collection },
			),
			request,
			resolved.appContext.locale,
		);
	}

	const { file: uploadFile, path: uploadPath } = await resolveUpload(
		request,
		file,
	);

	if (!uploadFile) {
		return errorResponse(
			ApiError.badRequest(
				"No file uploaded. Send 'file' in form-data.",
				undefined,
				"upload.noFileUploaded",
			),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		// Use the collection's upload method which handles validation and storage
		const crud = app.collections[collection as any] as any;
		if (!crud?.upload) {
			return errorResponse(
				ApiError.badRequest(
					`Collection "${collection}" upload method not available`,
					undefined,
					"upload.methodNotAvailable",
					{ collection },
				),
				request,
				resolved.appContext.locale,
			);
		}

		const result = await crud.upload(
			uploadFile,
			resolved.appContext,
			uploadPath ? { path: uploadPath } : undefined,
		);
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(error, request, resolved.appContext.locale);
	}
}

/**
 * Serve a file from a collection's storage.
 * GET /:collection/files/:key
 *
 * Authorization is the `serve` access chain, not row read access:
 * `access.serve` → explicit collection `access.read` (row-aware) →
 * `defaultAccess.serve` → allow. Files with `visibility: "private"`
 * additionally always require a valid signed token.
 */
export async function storageCollectionServe(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const errorResponse = (
		error: unknown,
		req: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request: req, app, locale });
	};
	const resolved = await resolveContext(app, request, config, context);

	if (request.method !== "GET") {
		return errorResponse(
			ApiError.badRequest(
				"Method not allowed",
				undefined,
				"error.methodNotAllowed",
			),
			request,
			resolved.appContext.locale,
		);
	}

	const { collection, key } = params;

	// Check if collection exists and has upload configured
	let collectionConfig: any;
	try {
		collectionConfig = app.getCollectionConfig(collection as any);
	} catch {
		return errorResponse(
			ApiError.notFound("Collection", collection),
			request,
			resolved.appContext.locale,
		);
	}

	// Check if upload is enabled for this collection
	if (!collectionConfig.state?.upload) {
		return errorResponse(
			ApiError.badRequest(
				`Collection "${collection}" does not support file serving. Use .upload() to enable.`,
				undefined,
				"upload.collectionServeNotSupported",
				{ collection },
			),
			request,
			resolved.appContext.locale,
		);
	}

	const url = new URL(request.url);
	const token = url.searchParams.get("token");

	try {
		const storage = getStorageFromContext(resolved.appContext, app);

		// The upload row is the authorization ANCHOR for storage objects
		// (orphaned keys still 404), not the authorization decision. Fetch it in
		// system mode — whether the bytes may be served is decided by the serve
		// access chain below, never by list/read access defaults.
		const crud = app.collections[collection as any];
		const record = await crud.findOne(
			{
				where: { key } as any,
			},
			{ ...resolved.appContext, accessMode: "system" },
		);

		if (!record) {
			return errorResponse(
				ApiError.notFound("File", key),
				request,
				resolved.appContext.locale,
			);
		}

		const visibility: StorageVisibility =
			(record as any).visibility ||
			collectionConfig.state.upload?.visibility ||
			app.config.storage?.defaultVisibility ||
			"public";

		// Serve access chain: `access.serve` → explicit collection `access.read`
		// (row-aware, back-compat) → `defaultAccess.serve` → allow. App-level
		// `defaultAccess.read` is deliberately NOT consulted — it governs the
		// list/read API surface, while `visibility` declares whether file bytes
		// are servable by key (private bytes are already token-gated above).
		if (resolved.appContext.accessMode !== "system") {
			const collectionAccess = collectionConfig.state.access as
				| CollectionAccess
				| undefined;
			const serveRule =
				collectionAccess?.serve ??
				collectionAccess?.read ??
				(app.defaultAccess as CollectionAccess | undefined)?.serve;

			if (serveRule !== undefined) {
				const decision = await executeAccessRule(serveRule, {
					app,
					db: resolved.appContext.db ?? app.db,
					session: resolved.appContext.session,
					principal: resolved.appContext.principal,
					actor: resolved.appContext.actor,
					locale: resolved.appContext.locale,
					row: record,
					request,
					contextExtensions: resolved.appContext["~contextExtensions"],
				});
				let allowed = decision === true;
				if (typeof decision === "object") {
					try {
						allowed = await matchesServeAccessWhere({
							app,
							collection: collectionConfig,
							accessWhere: decision,
							recordId: (record as any).id,
							context: resolved.appContext,
						});
					} catch (error) {
						app.logger.warn(
							"[QUESTPIE Storage] Serve access compilation failed closed",
							{ collection, err: error },
						);
						allowed = false;
					}
				}

				if (!allowed) {
					return errorResponse(
						ApiError.notFound("File", key),
						request,
						resolved.appContext.locale,
					);
				}
			}
		}

		// A private signed URL is an additional capability gate. All failures
		// deliberately share the same not-found response as an absent/deleted
		// row or a denied serve rule, so storage keys are not existence probes.
		if (visibility === "private") {
			const secret = app.config.secret;
			if (!token || !secret) {
				return errorResponse(
					ApiError.notFound("File", key),
					request,
					resolved.appContext.locale,
				);
			}
			const payload = await verifySignedUrlToken(
				token,
				secret,
				params.collection,
			);
			if (!payload || payload.key !== key) {
				return errorResponse(
					ApiError.notFound("File", key),
					request,
					resolved.appContext.locale,
				);
			}
		}

		const exists = await storage.exists(key);
		if (!exists) {
			return errorResponse(
				ApiError.notFound("File", key),
				request,
				resolved.appContext.locale,
			);
		}

		const metadata = await storage.head(key);

		const rawFilename = (record as any)?.filename;
		const contentType =
			metadata.type ||
			(record as any)?.mimeType ||
			mimeTypeFromFilename(rawFilename) ||
			"application/octet-stream";

		// Sanitize filename to prevent header injection
		const sanitizedFilename = rawFilename
			? Array.from(String(rawFilename), (char) => {
					const code = char.charCodeAt(0);
					return code < 32 || code >= 127 || char === '"' || char === "\\"
						? "_"
						: char;
				}).join("")
			: null;

		const normalizedContentType = contentType.toLowerCase();
		const isActiveContent =
			normalizedContentType.includes("text/html") ||
			normalizedContentType.includes("application/xhtml+xml") ||
			normalizedContentType.includes("image/svg+xml");
		const recordSize = Number((record as any)?.size);
		const metadataSize = Number(metadata.size);
		const totalSize = Number.isFinite(metadataSize) ? metadataSize : recordSize;
		const hasKnownSize = Number.isFinite(totalSize) && totalSize >= 0;
		const commonHeaders = {
			"Content-Type": contentType,
			"X-Content-Type-Options": "nosniff",
			"Accept-Ranges": "bytes",
			"Cache-Control":
				visibility === "public"
					? "public, max-age=31536000, immutable"
					: "private, no-cache",
			...(isActiveContent && {
				"Content-Security-Policy": "sandbox",
			}),
		};
		const filenameHeaders = sanitizedFilename
			? {
					"Content-Disposition": `${isActiveContent ? "attachment" : "inline"}; filename="${sanitizedFilename}"`,
				}
			: {};

		// HTTP Range request support (for video/audio seeking)
		const rangeHeader = request.headers.get("range");
		if (rangeHeader && hasKnownSize) {
			const range = parseByteRange(rangeHeader, totalSize);
			if (range === "unsatisfiable") {
				return new Response(null, {
					status: 416,
					headers: {
						"Content-Range": `bytes */${totalSize}`,
					},
				});
			}

			if (range) {
				const file = await storage.download(key, { as: "stream" });
				const stream = file.stream();
				return new Response(createRangeStream(stream, range.start, range.end), {
					status: 206,
					headers: {
						...commonHeaders,
						...filenameHeaders,
						"Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
						"Content-Length": String(range.length),
					},
				});
			}
		}

		const file = await storage.download(key, { as: "stream" });
		return new Response(file.stream(), {
			status: 200,
			headers: {
				...commonHeaders,
				...filenameHeaders,
				...(hasKnownSize ? { "Content-Length": String(totalSize) } : {}),
			},
		});
	} catch (error) {
		return errorResponse(error, request, resolved.appContext.locale);
	}
}
